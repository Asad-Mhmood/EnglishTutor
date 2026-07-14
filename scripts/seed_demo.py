"""
Seed a demo learner with a known history, so the dashboard can be checked against an
expected answer rather than against "it rendered something".

    python scripts/seed_demo.py            # create the demo learner
    python scripts/seed_demo.py --remove   # delete it and everything it owns

The history is constructed so that each dashboard feature has ONE right answer:

    session:            1    2    3    4    5    6    7    8
    articles            ●    ●    ●    ●    ●    ●    ●    ●     → persistent
    verb_tense          ●    ●    ●    ·    ·    ·    ·    ●     → REGRESSED
    prepositions        ●    ●    ●    ●    ·    ·    ·    ·     → improving (a strength)
    modals              ·    ·    ·    ·    ·    ·    ·    ●     → new
    errors/100 words   8.0  7.4  6.8  6.2  5.6  5.0  4.4  3.8    → improving trend
    CEFR                A2   A2   B1   B1   B1   B1   B2   B2    → smooths to B1→B2

If the dashboard shows verb tenses as "Slipped back", prepositions under "What's going
well", and a downward accuracy line, the analysis layer is working. If it doesn't, it isn't.

This writes real rows to whatever PROGRESS_DATABASE_URL points at. --remove takes them out
again by display name; it deletes nothing else.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone

import asyncpg
from dotenv import load_dotenv

load_dotenv()

from config.settings import settings  # noqa: E402  — must come after load_dotenv()

DEMO_NAME = "Demo learner (seeded)"

# Sign in with this username (plus the shared passcode) to actually look at the seeded history.
# Without it the demo learner exists in the database and is reachable by nobody.
DEMO_USERNAME = "demo"

# (session index) -> error categories present in that session
ERROR_PATTERN: dict[int, list[str]] = {
    1: ["articles", "verb_tense", "prepositions"],
    2: ["articles", "verb_tense", "prepositions"],
    3: ["articles", "verb_tense", "prepositions"],
    4: ["articles", "prepositions"],
    5: ["articles"],
    6: ["articles"],
    7: ["articles"],
    8: ["articles", "verb_tense", "modals"],  # verb_tense returns → regression
}

CEFR_BY_SESSION = {1: "A2", 2: "A2", 3: "B1", 4: "B1", 5: "B1", 6: "B1", 7: "B2", 8: "B2"}

EXAMPLES = {
    "articles": ("I went to store", "I went to the store", "You need 'the' before 'store' here."),
    "verb_tense": ("Yesterday I go there", "Yesterday I went there", "'Yesterday' needs the past tense."),
    "prepositions": ("It depends of you", "It depends on you", "It's always 'depend on'."),
    "modals": ("I must to leave", "I must leave", "After 'must', use the plain verb — no 'to'."),
}


async def remove(conn: asyncpg.Connection) -> None:
    # ON DELETE CASCADE on sessions, session_errors and learner_vocabulary means the learner
    # row is the only thing that needs naming here.
    deleted = await conn.fetchval(
        "DELETE FROM learners WHERE username = $1 RETURNING id", DEMO_USERNAME
    )
    print(f"removed demo learner {deleted}" if deleted else "no demo learner to remove")


async def seed(conn: asyncpg.Connection) -> None:
    await remove(conn)  # idempotent: re-seeding replaces rather than duplicating

    learner_id = await conn.fetchval(
        "INSERT INTO learners (username, display_name) VALUES ($1, $2) RETURNING id",
        DEMO_USERNAME,
        DEMO_NAME,
    )

    # One session per day, ending yesterday — so the streak is real and the most recent
    # session is the one carrying the regression.
    start = datetime.now(timezone.utc) - timedelta(days=len(ERROR_PATTERN))

    for index in sorted(ERROR_PATTERN):
        started_at = start + timedelta(days=index - 1, hours=1)
        categories = ERROR_PATTERN[index]

        word_count = 320 + index * 15
        errors_per_100 = round(8.0 - (index - 1) * 0.6, 2)

        session_id = await conn.fetchval(
            """
            INSERT INTO sessions (
                learner_id, room_name, started_at, ended_at, duration_seconds,
                user_turns, word_count, unique_word_count, type_token_ratio,
                advanced_word_ratio, new_word_count, mean_sentence_length,
                sentence_length_stdev, complex_sentence_ratio, words_per_minute,
                filler_rate, self_correction_rate, question_ratio,
                error_count, errors_per_100_words, cefr_estimate, cefr_confidence, summary
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    $16, $17, $18, $19, $20, $21, $22, $23)
            RETURNING id
            """,
            learner_id,
            f"seed_room_{index}",
            started_at,
            started_at + timedelta(minutes=9),
            9 * 60,
            18 + index,
            word_count,
            int(word_count * 0.55),
            round(0.62 + index * 0.012, 4),
            round(0.06 + index * 0.011, 4),
            22 - index,  # new words taper as vocabulary saturates, which is realistic
            round(7.5 + index * 0.55, 2),
            round(2.1 + index * 0.1, 2),
            round(0.18 + index * 0.05, 4),
            round(88 + index * 3.2, 1),
            round(3.2 - index * 0.2, 2),
            round(0.4 + index * 0.1, 2),
            round(0.05 + index * 0.03, 4),
            len(categories),
            errors_per_100,
            CEFR_BY_SESSION[index],
            round(0.45 + index * 0.05, 2),
            "You spoke more freely this time, and your sentences are getting longer."
            if index == max(ERROR_PATTERN)
            else None,
        )

        for category in categories:
            learner_text, corrected_text, explanation = EXAMPLES[category]
            await conn.execute(
                """
                INSERT INTO session_errors (
                    session_id, learner_id, category, learner_text, corrected_text, explanation
                ) VALUES ($1, $2, $3, $4, $5, $6)
                """,
                session_id,
                learner_id,
                category,
                learner_text,
                corrected_text,
                explanation,
            )

        # Vocabulary: a stable core plus a few words unique to this session, so
        # new_word_count and the cumulative curve are both non-trivial.
        words = [f"core{i}" for i in range(40)] + [f"s{index}word{i}" for i in range(22 - index)]
        await conn.executemany(
            """
            INSERT INTO learner_vocabulary (learner_id, word, first_seen_session_id, is_advanced)
            VALUES ($1, $2, $3, false)
            ON CONFLICT (learner_id, word) DO UPDATE SET times_used = learner_vocabulary.times_used + 1
            """,
            [(learner_id, word, session_id) for word in words],
        )

    # ASCII only. The default Windows console codepage is cp1252 and cannot encode "→" or
    # "·" — printing them raises UnicodeEncodeError *after* the seed has already committed,
    # which looks alarmingly like the seed failed when it did not.
    print(f"seeded {len(ERROR_PATTERN)} sessions for learner {learner_id} ({DEMO_NAME})")
    print(f"sign in as username '{DEMO_USERNAME}' with the app passcode to see the dashboard")
    print("\nExpected on /progress:")
    print("  - Verb tenses      -> 'Slipped back'    (gone for 4 sessions, back in #8)")
    print("  - Articles         -> 'Keeps happening' (every session)")
    print("  - Modal verbs      -> 'New'             (only in #8)")
    print("  - Prepositions     -> under What's going well")
    print("  - Grammar accuracy -> falling 8.0 to 3.8")
    print("  - Level            -> B1 or B2, not provisional")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remove", action="store_true", help="delete the demo learner and exit")
    args = parser.parse_args()

    dsn = settings.PROGRESS_DATABASE_URL
    if not dsn:
        print("PROGRESS_DATABASE_URL is not set in .env", file=sys.stderr)
        return 1

    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        if args.remove:
            await remove(conn)
        else:
            await seed(conn)
    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
