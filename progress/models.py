"""
The data types that move between the three layers.

    collection            analysis                 persistence
    ----------            --------                 -----------
    Utterance     ──▶  Transcript  ──▶  SessionReport  ──▶  repository
    (collector.py)     (metrics/, grading.py)              (repository.py)

Every type here is a plain dataclass with no I/O and no dependency on livekit, Groq, or
Postgres. That is what lets the analysis layer be exercised on a hand-written transcript
without a room, a model, or a database — see the `__main__` block in scoring.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .taxonomy import VALID_KEYS


@dataclass(frozen=True)
class Utterance:
    """
    One thing the learner said, as the STT heard it.

    `text` is ASR output, which matters more than it looks. Whisper punctuates and
    capitalises on its own, and it will occasionally *repair* a learner's grammar or
    invent a word it half-heard. So:

      - Punctuation and capitalisation carry no information about the learner. Never
        grade them (the grading prompt says so explicitly).
      - A small share of "errors" will be Whisper's, not the learner's. This is a real
        accuracy ceiling on grammar scoring from speech, not something a better prompt
        fixes. The dashboard says so out loud rather than pretending otherwise.
    """

    text: str
    spoken_at: datetime
    confidence: float | None = None
    """Mean ASR confidence, when the STT reports one. A clarity proxy, not a pronunciation score."""


@dataclass
class Transcript:
    """
    Everything the learner said in one session, plus the wall-clock span it happened in.

    The agent's own turns are deliberately not kept: nothing downstream grades Ahmad, and
    not storing them keeps the learner's speech the only thing in the database.
    """

    learner_id: str
    room_name: str
    started_at: datetime
    utterances: list[Utterance] = field(default_factory=list)
    ended_at: datetime | None = None

    @property
    def text(self) -> str:
        """The whole session as one block of text, for the grader."""
        return " ".join(u.text.strip() for u in self.utterances if u.text.strip())

    @property
    def duration_seconds(self) -> int:
        end = self.ended_at or datetime.now(timezone.utc)
        return max(0, int((end - self.started_at).total_seconds()))

    @property
    def speaking_seconds(self) -> float:
        """
        Time spent *talking*, approximated as the span from first to last utterance.

        Words-per-minute must not be computed against session duration: a learner who talks
        for thirty seconds and then thinks for two minutes would score a third of their real
        speaking rate, and the chart would reward rushing. This is still an approximation —
        it counts Ahmad's replies and the learner's pauses as speaking time — so treat WPM as
        a coarse trend, not a measurement. Getting this properly right needs per-utterance
        audio durations, which the STT does not currently hand us.
        """
        if len(self.utterances) < 2:
            return float(self.duration_seconds)
        span = (self.utterances[-1].spoken_at - self.utterances[0].spoken_at).total_seconds()
        return max(span, 1.0)


@dataclass(frozen=True)
class GrammarError:
    """One mistake, as identified by the grader."""

    category: str
    """A key from taxonomy.CATEGORIES. Validated on construction."""

    learner_text: str
    corrected_text: str
    explanation: str | None = None

    def __post_init__(self) -> None:
        if self.category not in VALID_KEYS:
            raise ValueError(
                f"unknown error category {self.category!r}; "
                f"must be one of {sorted(VALID_KEYS)}"
            )


@dataclass(frozen=True)
class Grading:
    """The LLM's read on a session. Absent when the session was too short to judge."""

    errors: tuple[GrammarError, ...]
    cefr_estimate: str | None
    """A1..C2. Raw and noisy for a single session — smooth it before showing it to anyone."""

    cefr_confidence: float
    """0..1, driven mostly by how much the learner actually said."""

    summary: str | None
    """One or two sentences, learner-facing, written to be read on a dashboard."""


@dataclass
class SessionReport:
    """
    The finished analysis of one session — everything that gets written to `sessions`.

    `metrics` is an open dict rather than a field per measurement on purpose: a new metric is
    a new function in metrics/, and it should reach the database without also touching this
    class, the repository, and a migration. repository.py splits it into known columns and
    the `extra` JSONB catch-all.
    """

    learner_id: str
    room_name: str
    started_at: datetime
    ended_at: datetime
    duration_seconds: int

    word_count: int
    user_turns: int

    metrics: dict[str, float | int | None]
    grading: Grading | None

    vocabulary: dict[str, int] = field(default_factory=dict)
    """word -> times used this session. Diffed against learner_vocabulary to find new words."""

    advanced_words: frozenset[str] = frozenset()
    """Subset of `vocabulary` that is rare enough to count as advanced (Zipf < 3.5)."""

    @property
    def errors_per_100_words(self) -> float | None:
        """
        The headline accuracy number.

        Normalised per 100 words because a raw error *count* punishes the learner for
        talking more, which is the exact opposite of what a practice app should reward.
        """
        if not self.grading or self.word_count == 0:
            return None
        return round(len(self.grading.errors) * 100.0 / self.word_count, 2)
