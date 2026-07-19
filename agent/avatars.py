"""
The personalized photo avatar: loading the learner's picture, and matching a voice to it.

The photo arrives here through the database, not through LiveKit. The web half stores it in
`learner_avatars` when the learner unlocks the feature with the avatar passcode
(web/app/api/avatar/route.ts), and the agent reads it back by learner id. The row's existence
IS the entitlement check: there is no way to get a photo into that table without having typed
the passcode, so the agent never needs to see the passcode at all.

Everything here returns None on failure rather than raising — an avatar problem must degrade
to a voice-only call, never to a dead room. Same philosophy as progress tracking.
"""

from __future__ import annotations

import base64
import logging

import asyncpg
from groq import AsyncGroq

logger = logging.getLogger(__name__)

# Guardrail against a hand-inserted database row, not a real limit: the web upload route
# rejects anything over 2 MB long before it reaches Postgres.
_MAX_PHOTO_BYTES = 6 * 1024 * 1024


async def load_avatar_photo(learner_id: str, *, dsn: str | None) -> bytes | None:
    """The learner's uploaded avatar photo (JPEG bytes), or None if there isn't one."""
    if dsn is None:
        return None

    conn: asyncpg.Connection | None = None
    try:
        # statement_cache_size=0 for the same reason as progress/repository.py: Neon's pooled
        # URL goes through PgBouncer, which breaks asyncpg's prepared-statement cache.
        conn = await asyncpg.connect(dsn, statement_cache_size=0)
        row = await conn.fetchrow(
            "SELECT image FROM learner_avatars WHERE learner_id = $1",
            learner_id,
        )
        if row is None:
            return None

        image: bytes = row["image"]
        if not image or len(image) > _MAX_PHOTO_BYTES:
            logger.warning(
                "avatar photo for learner %s is empty or oversized (%d bytes); ignoring",
                learner_id,
                len(image) if image else 0,
            )
            return None
        return image

    except Exception:  # noqa: BLE001 — a broken avatar lookup must not kill the call
        logger.exception("failed to load avatar photo for learner %s", learner_id)
        return None

    finally:
        if conn is not None:
            await conn.close()


async def detect_gender(
    image: bytes,
    *,
    groq_api_key: str,
    model: str,
) -> str | None:
    """
    Whether the person in the photo appears male or female, so the tutor's voice can match
    the face the learner chose. Returns "male", "female", or None when the model can't tell
    (no person in the picture, an animal, an object) — the caller falls back to the default
    persona rather than guessing.
    """
    data_url = "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")

    try:
        client = AsyncGroq(api_key=groq_api_key)
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "This photo will be animated as a talking avatar and needs a "
                                "matching voice. Does the main person in it appear male or "
                                "female? Answer with exactly one word: male, female, or unknown."
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            temperature=0.0,
            # Qwen 3 thinks out loud in a <think> block before the one-word answer, so the
            # budget covers the monologue. Capping at a handful of tokens truncates inside
            # the think block and the answer never arrives.
            max_tokens=512,
        )
        content = (response.choices[0].message.content or "").strip().lower()

        # Only the text AFTER the reasoning is the answer. The think block narrates the
        # decision ("...could be female, but...") and would trip a substring match.
        answer = content.rsplit("</think>", 1)[-1].strip()

        # "female" first — "male" is a substring of it.
        if "female" in answer:
            return "female"
        if "male" in answer:
            return "male"
        logger.info("vision model could not sex the avatar photo (said %r)", answer)
        return None

    except Exception:  # noqa: BLE001 — fall back to the default voice, don't kill the call
        logger.exception("gender detection for the avatar photo failed")
        return None


def photo_as_base64(image: bytes) -> str:
    """The photo in the form bitHuman's cloud API accepts inside its JSON payload."""
    return base64.b64encode(image).decode("ascii")
