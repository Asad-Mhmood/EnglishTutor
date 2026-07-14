"""
Orchestration: transcript in, SessionReport out.

This module owns one editorial decision — *when a session is too small to judge* — and
otherwise just wires the deterministic metrics to the LLM grader.

    Transcript ──┬──▶ metrics.compute_all()  ── always runs, always cheap
                 └──▶ grading.grade()        ── only above MIN_WORDS_FOR_GRADING
                              │
                              ▼
                        SessionReport
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from . import grading as grading_module
from .metrics import compute_all
from .metrics.lexical import is_advanced
from .models import SessionReport, Transcript
from .text import content_words

logger = logging.getLogger(__name__)

# Below this, we do not grade and we do not estimate a level.
#
# This threshold is the difference between a tracker people trust and one they don't. Thirty
# words is "hello, I'm fine, yes, goodbye" — a learner who says that has produced no evidence
# of anything. An LLM asked to grade it will still cheerfully return a CEFR level and a
# handful of errors, because that is what it was asked for. That level would be noise, and it
# would drag the learner's smoothed estimate around on the chart for the next five sessions.
#
# So: too short means *unknown*, stored as NULL, shown as "not enough to go on". The
# deterministic metrics still run and are still recorded — arithmetic on eleven words is
# honest arithmetic, it is only the *judgement* that needs a sample.
MIN_WORDS_FOR_GRADING = 30


async def build_report(
    transcript: Transcript,
    *,
    groq_api_key: str,
    grading_model: str,
) -> SessionReport:
    """
    Analyse a finished session.

    Never raises on analysis failure: a session that reached the end of a conversation should
    reach the database, even if the grader was down or a metric threw. Missing pieces are
    stored as NULL.
    """
    ended_at = transcript.ended_at or datetime.now(timezone.utc)

    metrics = compute_all(transcript)

    word_count = int(metrics.get("word_count") or 0)
    user_turns = int(metrics.get("user_turns") or 0)

    grading = None
    if word_count >= MIN_WORDS_FOR_GRADING:
        grading = await grading_module.grade(
            transcript.text,
            api_key=groq_api_key,
            model=grading_model,
        )
    else:
        logger.info(
            "session in room %s had %d words (< %d); recording metrics but not grading it",
            transcript.room_name,
            word_count,
            MIN_WORDS_FOR_GRADING,
        )

    vocabulary = _vocabulary_counts(transcript)
    advanced = frozenset(w for w in vocabulary if is_advanced(w))

    return SessionReport(
        learner_id=transcript.learner_id,
        room_name=transcript.room_name,
        started_at=transcript.started_at,
        ended_at=ended_at,
        duration_seconds=transcript.duration_seconds,
        word_count=word_count,
        user_turns=user_turns,
        metrics=metrics,
        grading=grading,
        vocabulary=vocabulary,
        advanced_words=advanced,
    )


def _vocabulary_counts(transcript: Transcript) -> dict[str, int]:
    """
    Content words the learner produced, and how often.

    Function words are excluded — "the" appearing for the thousandth time is not vocabulary
    growth, and letting stopwords into this table would make `new_word_count` meaningless
    after the first session and bloat the row count for nothing.

    No lemmatisation: "run" and "running" count as two words. Doing it properly needs a
    lemmatiser (spaCy, NLTK), which is a heavyweight dependency for the agent image. The
    consequence is that `new_word_count` slightly overstates growth — a learner who already
    knew "run" gets credit for "running". Since the metric is used as a *trend* and the
    overstatement is roughly constant across sessions, the shape of the curve survives; the
    absolute number is soft. Worth revisiting if the number ever gets shown as a hard total.
    """
    counts: dict[str, int] = {}
    for word in content_words(transcript.text):
        counts[word] = counts.get(word, 0) + 1
    return counts
