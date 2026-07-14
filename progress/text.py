"""
Tokenisation shared by the metric functions.

Kept in one place so that "what counts as a word" is decided once. If lexical.py counted
contractions as two tokens and fluency.py counted them as one, words-per-minute and
type-token ratio would silently disagree about how much the learner said.
"""

from __future__ import annotations

import re

# Words, keeping internal apostrophes and hyphens so "don't" and "well-known" stay single
# tokens. Whisper writes contractions out in full, so this matters.
_WORD_RE = re.compile(r"[a-zA-Z]+(?:['’-][a-zA-Z]+)*")

# Sentence boundaries. Whisper punctuates its output, which is the only reason this works at
# all — the learner is not producing these full stops, Whisper is. Sentence-level metrics are
# therefore measuring Whisper's segmentation of the learner's speech, not the learner's own
# sentence boundaries. It tracks real speech rhythm closely enough to trend on, but it is a
# proxy and worth remembering before over-reading a small change.
_SENTENCE_RE = re.compile(r"[.!?]+")

# Function words. Excluded from vocabulary-range metrics: everyone uses "the" and "of", so
# counting them tells you nothing about a learner's range and drags every rare-word ratio
# toward the same value.
STOPWORDS: frozenset[str] = frozenset(
    """
    a an the and or but if then than that this these those so because as of at by for with
    about against between into through during before after above below to from up down in
    out on off over under again further once here there when where why how all any both each
    few more most other some such no nor not only own same too very can will just should now
    i me my myself we our ours ourselves you your yours yourself yourselves he him his
    himself she her hers herself it its itself they them their theirs themselves what which
    who whom am is are was were be been being have has had having do does did doing would
    could shall may might must im ive id ill dont doesnt didnt isnt arent wasnt werent
    cant couldnt wouldnt shouldnt s t re ve ll d m o
    """.split()
)

# Hesitation sounds. Deliberately conservative.
#
# "like" and "so" are NOT here, though they are the two most common English fillers. Both are
# also ordinary words ("I like it", "so I left"), and there is no reliable way to tell filler
# from content without a parser. Counting them would inflate the filler rate for anyone who
# happens to use them normally — and a learner being told to stop saying "like" when they
# said "I like my job" would rightly lose trust in the whole dashboard. Undercounting a real
# filler is a much cheaper mistake than inventing one.
FILLERS: frozenset[str] = frozenset(
    {"um", "uh", "umm", "uhh", "erm", "er", "ah", "eh", "hmm", "mmm", "mhm"}
)

# Multi-word hedges. Same conservatism: these are unambiguous enough to count.
FILLER_PHRASES: tuple[str, ...] = ("you know", "i mean", "sort of", "kind of")

# Subordinating conjunctions and relative pronouns — the mark of a complex sentence. A
# learner who never subordinates is speaking in a chain of simple clauses, which is the
# clearest structural signal separating A2 from B1+.
SUBORDINATORS: frozenset[str] = frozenset(
    """
    although though because since unless until while whereas whether if when whenever where
    wherever after before once as who whom whose which that so
    """.split()
)


def words(text: str) -> list[str]:
    """Lowercased word tokens."""
    return [m.group(0).lower() for m in _WORD_RE.finditer(text)]


def content_words(text_or_tokens: str | list[str]) -> list[str]:
    """Word tokens with function words removed. The basis of every vocabulary metric."""
    tokens = words(text_or_tokens) if isinstance(text_or_tokens, str) else text_or_tokens
    return [w for w in tokens if w not in STOPWORDS and len(w) > 1]


def sentences(text: str) -> list[str]:
    """Non-empty sentences. Text with no terminal punctuation counts as one sentence."""
    parts = [s.strip() for s in _SENTENCE_RE.split(text)]
    return [s for s in parts if s]
