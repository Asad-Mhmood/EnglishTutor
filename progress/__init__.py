"""
Progress tracking: what the learner said, what it says about them, and where it's stored.

Three layers, in strict dependency order. Nothing lower imports anything higher.

    collector.py   COLLECTION   Captures the learner's transcriptions during the live
                                session. Appends strings to a list and does nothing else,
                                because it runs inside a voice call where latency is audible.

    metrics/       ANALYSIS     Deterministic arithmetic on the transcript — vocabulary
    grading.py                  range, sentence complexity, speech delivery — plus one
    scoring.py                  end-of-session LLM call for grammar errors and a CEFR
    taxonomy.py                 estimate. The deterministic half cannot hallucinate; the
                                LLM half can, so they are kept apart and a failed grading
                                run degrades to NULL rather than to a fabricated zero.

    repository.py  PERSISTENCE  The only module here that knows SQL.

The public entry points are `TranscriptCollector` (during the call) and `run_analysis`
(after it). `agent/tutor.py` uses nothing else.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .models import Grading, GrammarError, SessionReport, Transcript, Utterance
from .repository import save_report
from .scoring import build_report

if TYPE_CHECKING:
    from .collector import TranscriptCollector

logger = logging.getLogger(__name__)


def __getattr__(name: str) -> Any:
    """
    Lazily expose TranscriptCollector, so that importing this package does not import livekit.

    This is not a style preference — it is load-bearing on Windows. `collector.py` is the only
    module here that imports `livekit.agents`, and on this machine that import chain reaches
    `livekit.local_inference`, whose native .pyd calls Windows `ExitProcess()` (see the stub in
    main.py and ARCHITECTURE.md §7). A process-level exit cannot be caught. An eager
    `from .collector import TranscriptCollector` at the top of this file therefore means that
    merely importing `progress.metrics` — from a test, a script, a notebook — kills the
    interpreter outright, with no traceback and exit code 29.

    Deferring it keeps the promise the package docstring makes: the analysis layer is pure and
    can be run on a hand-written transcript with no livekit, no room, and no database. Only
    the agent, which installs the stub before any livekit import, ever touches this attribute.
    """
    if name == "TranscriptCollector":
        from .collector import TranscriptCollector

        return TranscriptCollector
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "Grading",
    "GrammarError",
    "SessionReport",
    "Transcript",
    "TranscriptCollector",
    "Utterance",
    "build_report",
    "run_analysis",
    "save_report",
]


async def run_analysis(
    collector: "TranscriptCollector",
    *,
    dsn: str | None,
    groq_api_key: str,
    grading_model: str,
) -> str | None:
    """
    Close the transcript, analyse it, store it. Called once, after the call has ended.

    Returns the new session id, or None if nothing was stored.

    `dsn=None` is a supported state, not an error: progress tracking is an *optional* feature
    of a voice tutor that must keep working without it. See the note on PROGRESS_DATABASE_URL
    in config/settings.py — making the database mandatory would mean a Neon outage silently
    becomes a crashlooping tutor.
    """
    transcript = collector.finish()

    if not transcript.utterances:
        # Someone opened the page, the agent greeted them, they left without speaking. There
        # is nothing to analyse and an empty row would pollute every trend chart with a
        # zero-word session.
        logger.info("no learner speech in room %s; nothing to record", transcript.room_name)
        return None

    report = await build_report(
        transcript,
        groq_api_key=groq_api_key,
        grading_model=grading_model,
    )

    if dsn is None:
        logger.warning(
            "PROGRESS_DATABASE_URL is not set — analysed %d words for learner %s but there "
            "is nowhere to store it; the session is lost",
            report.word_count,
            report.learner_id,
        )
        return None

    return await save_report(report, dsn=dsn)
