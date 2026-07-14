"""
Data collection: capture what the learner said. Nothing else.

This layer does no analysis and makes no judgements — it appends strings to a list. That
separation is the point: `attach()` runs inside a live voice session where every millisecond
is audible, so the only thing it is allowed to do is be fast. All the thinking happens in
scoring.py after the call has ended and nobody is waiting.

    live session                         after the call
    ------------                         --------------
    collector.attach()  ──▶ Transcript ──▶ scoring.build_report() ──▶ repository.save()
    (append strings)                       (metrics + LLM grading)     (one transaction)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from livekit.agents import AgentSession
from livekit.agents.voice.events import UserInputTranscribedEvent

from .models import Transcript, Utterance

logger = logging.getLogger(__name__)


class TranscriptCollector:
    """
    Accumulates the learner's final transcriptions over one session.

    Only the learner's speech is kept. Alex's turns are not recorded: nothing downstream
    grades the tutor, and leaving them out means the database holds only what the human said.
    """

    def __init__(self, *, learner_id: str, room_name: str) -> None:
        self.transcript = Transcript(
            learner_id=learner_id,
            room_name=room_name,
            started_at=datetime.now(timezone.utc),
        )

    def attach(self, session: AgentSession) -> None:
        """Subscribe to the session's transcription events."""

        @session.on("user_input_transcribed")
        def _on_transcribed(event: UserInputTranscribedEvent) -> None:
            # Interim results are the partial hypotheses Whisper emits *while* the learner is
            # still talking, and they get revised. Counting them would record "I go... I went
            # to the" as three separate utterances and roughly triple the word count. Only
            # final transcriptions are real.
            if not event.is_final:
                return

            text = event.transcript.strip()
            if not text:
                return

            self.transcript.utterances.append(
                Utterance(
                    text=text,
                    spoken_at=datetime.fromtimestamp(event.created_at, tz=timezone.utc),
                    # No confidence on this event — see the note in metrics/fluency.py.
                    confidence=None,
                )
            )

        # The handler is registered on the session and lives as long as it does. There is no
        # detach: the session is torn down at the end of the job, taking the listener with it.

    def finish(self) -> Transcript:
        """Close the transcript and hand it to the analysis layer."""
        self.transcript.ended_at = datetime.now(timezone.utc)
        logger.info(
            "collected %d learner utterances over %ds in room %s",
            len(self.transcript.utterances),
            self.transcript.duration_seconds,
            self.transcript.room_name,
        )
        return self.transcript
