"""
Speech delivery: pace, hesitation, and self-repair.

READ THIS BEFORE ADDING A "PRONUNCIATION SCORE" HERE.

The original spec for this feature asked for pronunciation tracking. It is not in this
module, and its absence is deliberate.

Pronunciation assessment means comparing the phonemes a learner produced against the phonemes
the word requires, and scoring the distance. Whisper does not expose phonemes. It exposes a
best-guess *transcription* — and, worse for our purposes, it is explicitly trained to be
robust to accents, so it will happily transcribe heavily-accented speech as perfectly correct
text. The signal we would need is the exact signal Whisper is designed to throw away.

Everything below is a *delivery* proxy: how fast, how hesitantly, how much self-repair. Those
are real, useful, and worth tracking — a learner whose speech rate climbs from 80 to 120 wpm
while their filler rate halves has genuinely become more fluent. But none of them is
pronunciation, none of them can tell you that "th" is coming out as "z", and the dashboard
must never imply otherwise. A learner who is told their pronunciation is 82% will believe it.

Doing it properly means a phoneme-level scorer — Azure Speech Pronunciation Assessment is the
usual one, and it has a free tier — fed the raw audio frames alongside the STT. That is a
real feature with a real vendor dependency, not a metric to be faked in here.
"""

from __future__ import annotations

import re
import statistics

from ..models import Transcript
from ..text import FILLER_PHRASES, FILLERS, words
from .registry import metric

# "I went— I mean, I go there" — an explicit repair marker. Whisper transcribes these,
# where it usually cleans up bare stutters ("I I went"), so the marker-based signal survives
# transcription and the repetition-based one mostly doesn't.
_REPAIR_MARKERS = (
    "i mean",
    "sorry",
    "no wait",
    "or rather",
    "let me rephrase",
    "what i meant",
)


def _count_phrases(haystack: str, needles: tuple[str, ...]) -> int:
    return sum(len(re.findall(rf"\b{re.escape(n)}\b", haystack)) for n in needles)


@metric
def speech_delivery(transcript: Transcript) -> dict[str, float | int | None]:
    """Speaking rate, hesitation rate, self-correction rate, and mean ASR confidence."""
    text = transcript.text
    lowered = text.lower()
    tokens = words(text)

    if not tokens:
        return {
            "words_per_minute": None,
            "filler_rate": None,
            "self_correction_rate": None,
            "stt_confidence": None,
        }

    per_100 = 100.0 / len(tokens)

    fillers = sum(1 for w in tokens if w in FILLERS)
    fillers += _count_phrases(lowered, FILLER_PHRASES)

    # Self-correction is a *good* sign, not a bad one, and the dashboard frames it that way.
    # A learner who catches their own mistake mid-sentence is monitoring their own output —
    # the thing that has to happen before an error can be fixed unprompted. A rate of zero in
    # a learner who is still making errors means they aren't hearing them yet.
    repairs = _count_phrases(lowered, _REPAIR_MARKERS)

    minutes = transcript.speaking_seconds / 60.0

    # ASR confidence.
    #
    # AS OF TODAY THIS IS ALWAYS None, and that is not a bug. LiveKit's
    # UserInputTranscribedEvent carries transcript/is_final/speaker_id/language and no
    # confidence score, so the collector has nothing to put here. The plumbing is kept
    # because it is the natural landing spot the day the STT does report one (Groq's Whisper
    # endpoint can return segment logprobs; the LiveKit plugin does not currently surface
    # them), and because a NULL column is cheaper than retrofitting the model later.
    #
    # It is NULL rather than 0.0 for the usual reason: the dashboard must not draw a flat
    # line at zero and imply the learner is unintelligible.
    confidences = [u.confidence for u in transcript.utterances if u.confidence is not None]

    return {
        "words_per_minute": round(len(tokens) / minutes, 1) if minutes > 0 else None,
        "filler_rate": round(fillers * per_100, 2),
        "self_correction_rate": round(repairs * per_100, 2),
        "stt_confidence": (
            round(statistics.fmean(confidences), 4) if confidences else None
        ),
    }
