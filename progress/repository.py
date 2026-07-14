"""
Persistence. The only module in `progress/` that knows SQL exists.

Everything above this line works on dataclasses and can be run — and reasoned about — without
a database. That boundary is the reason you can hand `scoring.build_report()` a transcript
you typed by hand and get a real SessionReport back with no Postgres anywhere.

CONNECTION STRATEGY

One short-lived connection per save, rather than a pool. LiveKit runs each job in its own
subprocess, so a pool created at module import in the parent would not survive the fork; and
the write volume here is exactly one transaction per completed session. A pool would be
machinery in exchange for nothing.

`statement_cache_size=0` is required, not optional. Neon's default `DATABASE_URL` points at
PgBouncer in transaction-pooling mode, which cannot support the prepared statements asyncpg
caches by default — you get `prepared statement "__asyncpg_stmt_1__" does not exist` under
concurrency, intermittently, which is a genuinely horrible thing to debug. Disabling the
cache makes the code correct against both the pooled and unpooled URL.
"""

from __future__ import annotations

import json
import logging

import asyncpg

from .models import SessionReport

logger = logging.getLogger(__name__)

# Metric keys that have a real column in `sessions`. Anything a metric function returns that
# is NOT in this set is written to the `extra` JSONB column instead — which is what lets a new
# metric ship without a migration. Promote a key to a column (and add it here) once it has
# earned a chart.
KNOWN_METRIC_COLUMNS: frozenset[str] = frozenset(
    {
        "unique_word_count",
        "type_token_ratio",
        "advanced_word_ratio",
        "mean_sentence_length",
        "sentence_length_stdev",
        "complex_sentence_ratio",
        "words_per_minute",
        "filler_rate",
        "self_correction_rate",
        "stt_confidence",
        "question_ratio",
    }
)

# Handled explicitly as their own columns; not routed through the metric split.
_HANDLED_ELSEWHERE: frozenset[str] = frozenset({"word_count", "user_turns"})


def _split_metrics(
    metrics: dict[str, float | int | None],
) -> tuple[dict[str, float | int | None], dict[str, float | int | None]]:
    """Partition metric output into known columns and the JSONB overflow."""
    columns = {k: v for k, v in metrics.items() if k in KNOWN_METRIC_COLUMNS}
    extra = {
        k: v
        for k, v in metrics.items()
        if k not in KNOWN_METRIC_COLUMNS and k not in _HANDLED_ELSEWHERE
    }
    return columns, extra


async def save_report(report: SessionReport, *, dsn: str) -> str | None:
    """
    Write one analysed session. Returns the new session id, or None if the write failed.

    Everything happens in a single transaction: a session row without its error rows would
    show up on the dashboard as a flawless conversation, which is worse than the session not
    appearing at all.

    Never raises. This runs in the agent's shutdown callback, where an exception would be
    logged into the void and the learner would simply never know their session vanished.
    Losing a progress row is a bad outcome; taking down a worker over it is a worse one.
    """
    conn: asyncpg.Connection | None = None
    try:
        conn = await asyncpg.connect(dsn, statement_cache_size=0)

        async with conn.transaction():
            columns, extra = _split_metrics(report.metrics)

            session_id = await conn.fetchval(
                """
                INSERT INTO sessions (
                    learner_id, room_name, started_at, ended_at, duration_seconds,
                    user_turns, word_count,
                    unique_word_count, type_token_ratio, advanced_word_ratio,
                    mean_sentence_length, sentence_length_stdev, complex_sentence_ratio,
                    words_per_minute, filler_rate, self_correction_rate, stt_confidence,
                    question_ratio,
                    error_count, errors_per_100_words, cefr_estimate, cefr_confidence,
                    summary, extra
                )
                VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7,
                    $8, $9, $10,
                    $11, $12, $13,
                    $14, $15, $16, $17,
                    $18,
                    $19, $20, $21, $22,
                    $23, $24
                )
                RETURNING id
                """,
                report.learner_id,
                report.room_name,
                report.started_at,
                report.ended_at,
                report.duration_seconds,
                report.user_turns,
                report.word_count,
                columns.get("unique_word_count"),
                columns.get("type_token_ratio"),
                columns.get("advanced_word_ratio"),
                columns.get("mean_sentence_length"),
                columns.get("sentence_length_stdev"),
                columns.get("complex_sentence_ratio"),
                columns.get("words_per_minute"),
                columns.get("filler_rate"),
                columns.get("self_correction_rate"),
                columns.get("stt_confidence"),
                columns.get("question_ratio"),
                len(report.grading.errors) if report.grading else 0,
                report.errors_per_100_words,
                report.grading.cefr_estimate if report.grading else None,
                report.grading.cefr_confidence if report.grading else None,
                report.grading.summary if report.grading else None,
                json.dumps(extra),
            )

            if report.grading and report.grading.errors:
                await conn.executemany(
                    """
                    INSERT INTO session_errors (
                        session_id, learner_id, category,
                        learner_text, corrected_text, explanation
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    [
                        (
                            session_id,
                            report.learner_id,
                            e.category,
                            e.learner_text,
                            e.corrected_text,
                            e.explanation,
                        )
                        for e in report.grading.errors
                    ],
                )

            new_words = await _upsert_vocabulary(conn, report, session_id)

            await conn.execute(
                "UPDATE sessions SET new_word_count = $1 WHERE id = $2",
                new_words,
                session_id,
            )
            await conn.execute(
                "UPDATE learners SET last_seen_at = now() WHERE id = $1",
                report.learner_id,
            )

        logger.info(
            "saved session %s for learner %s: %d words, %d errors, %d new words, CEFR %s",
            session_id,
            report.learner_id,
            report.word_count,
            len(report.grading.errors) if report.grading else 0,
            new_words,
            report.grading.cefr_estimate if report.grading else "ungraded",
        )
        return str(session_id)

    except Exception:  # noqa: BLE001 — a lost progress row must not take down the worker
        logger.exception("failed to save progress for learner %s", report.learner_id)
        return None

    finally:
        if conn is not None:
            await conn.close()


async def _upsert_vocabulary(
    conn: asyncpg.Connection,
    report: SessionReport,
    session_id: str,
) -> int:
    """
    Merge this session's words into the learner's running vocabulary, and count how many had
    never been seen before.

    The `xmax = 0` test is the Postgres idiom for "this ON CONFLICT actually inserted rather
    than updated". It lets the insert and the new-word count be one round trip instead of a
    SELECT-then-INSERT, which would also be racy if a learner somehow had two sessions open.
    """
    if not report.vocabulary:
        return 0

    words = list(report.vocabulary.keys())
    counts = [report.vocabulary[w] for w in words]
    advanced = [w in report.advanced_words for w in words]

    rows = await conn.fetch(
        """
        INSERT INTO learner_vocabulary (
            learner_id, word, first_seen_session_id, is_advanced, times_used
        )
        SELECT $1, v.word, $2, v.is_advanced, v.times_used
        FROM unnest($3::text[], $4::bool[], $5::int[]) AS v(word, is_advanced, times_used)
        ON CONFLICT (learner_id, word) DO UPDATE
            SET times_used = learner_vocabulary.times_used + EXCLUDED.times_used
        RETURNING (xmax = 0) AS is_new
        """,
        report.learner_id,
        session_id,
        words,
        advanced,
        counts,
    )

    return sum(1 for r in rows if r["is_new"])
