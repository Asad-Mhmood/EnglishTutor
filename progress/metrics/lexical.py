"""
Vocabulary range: how varied, and how rare, the learner's words are.

Two questions, deliberately kept apart because they answer different things:

  - *Variety*  — are you reaching for different words, or circling the same twenty?
  - *Rarity*   — are the words you reach for ordinary or ambitious?

A learner can score well on one and badly on the other, and the advice differs. High variety
with low rarity is someone with a broad but basic vocabulary. Low variety with high rarity is
someone who knows good words but keeps reusing the same ones.
"""

from __future__ import annotations

from wordfreq import zipf_frequency

from ..models import Transcript
from ..text import content_words, words
from .registry import metric

# Zipf scale (wordfreq): 7 ≈ "the", 5 ≈ "money", 4 ≈ "curious", 3 ≈ "meticulous", 1 ≈ obscure.
# Below 3.5 is the point where a word stops being everyday vocabulary. This is the one tuning
# constant in the whole lexical module; raising it inflates everyone's score, lowering it
# flatters no one.
ADVANCED_ZIPF_THRESHOLD = 3.5

# Window for the moving-average type-token ratio. 50 tokens is the standard choice.
MATTR_WINDOW = 50


def is_advanced(word: str) -> bool:
    """True when a word is rare enough to signal genuine vocabulary range."""
    return zipf_frequency(word, "en") < ADVANCED_ZIPF_THRESHOLD


def _mattr(tokens: list[str], window: int = MATTR_WINDOW) -> float | None:
    """
    Moving-average type-token ratio.

    Plain TTR (unique / total) is unusable for tracking progress over time, and this is the
    trap worth spelling out: TTR falls *mechanically* as text gets longer, because common
    words keep repeating while new ones run out. A learner who talks more in session 5 than
    session 4 would post a lower TTR and the dashboard would tell them their vocabulary had
    shrunk — punishing the exact behaviour we want.

    MATTR averages the TTR of a sliding fixed-size window, so the number stops depending on
    how much was said and starts depending on how varied it was. That is the thing we
    actually want to plot.
    """
    if not tokens:
        return None

    if len(tokens) < window:
        # Too short for a window; fall back to plain TTR. Comparable to other short sessions
        # but not to long ones — scoring.py refuses to grade sessions this small anyway.
        return round(len(set(tokens)) / len(tokens), 4)

    ratios = [
        len(set(tokens[i : i + window])) / window for i in range(len(tokens) - window + 1)
    ]
    return round(sum(ratios) / len(ratios), 4)


@metric
def vocabulary_range(transcript: Transcript) -> dict[str, float | int | None]:
    """
    Word count, unique words, lexical variety (MATTR), and share of advanced vocabulary.

    `new_word_count` is not computed here — "new" means "never said in any previous session",
    which needs the learner's history and therefore a database. The repository fills it in
    when it diffs this session's vocabulary against `learner_vocabulary`. Metrics stay pure.
    """
    all_tokens = words(transcript.text)
    content = content_words(all_tokens)

    if not all_tokens:
        # Nothing said. Every ratio is unknown, not zero — see the registry docstring.
        return {
            "word_count": 0,
            "unique_word_count": 0,
            "type_token_ratio": None,
            "advanced_word_ratio": None,
        }

    advanced = [w for w in set(content) if is_advanced(w)]

    return {
        "word_count": len(all_tokens),
        "unique_word_count": len(set(all_tokens)),
        "type_token_ratio": _mattr(all_tokens),
        # Denominated in *unique* content words, not total: saying "meticulous" nine times is
        # one advanced word you know, not nine.
        "advanced_word_ratio": (
            round(len(advanced) / len(set(content)), 4) if content else None
        ),
    }
