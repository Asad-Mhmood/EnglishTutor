"""
Sentence complexity and structural variety.

The thing being measured is not "are your sentences long". It is "do you have more than one
sentence shape available to you". A learner stuck at A2 produces a chain of short simple
clauses; the move to B1 shows up as subordination appearing — because, although, which, when.

That is why `sentence_length_stdev` is tracked alongside the mean. Someone who produces
nothing but eight-word sentences and someone who produces nothing but twenty-five-word
sentences are both monotonous, and only the standard deviation notices.
"""

from __future__ import annotations

import statistics

from ..models import Transcript
from ..text import SUBORDINATORS, sentences, words
from .registry import metric


@metric
def sentence_complexity(transcript: Transcript) -> dict[str, float | int | None]:
    """Mean sentence length, variability of sentence length, and rate of subordination."""
    text = transcript.text
    sents = sentences(text)

    if not sents:
        return {
            "mean_sentence_length": None,
            "sentence_length_stdev": None,
            "complex_sentence_ratio": None,
        }

    lengths = [len(words(s)) for s in sents]
    lengths = [n for n in lengths if n > 0]

    if not lengths:
        return {
            "mean_sentence_length": None,
            "sentence_length_stdev": None,
            "complex_sentence_ratio": None,
        }

    complex_count = sum(1 for s in sents if SUBORDINATORS & set(words(s)))

    return {
        "mean_sentence_length": round(statistics.fmean(lengths), 2),
        # stdev needs two points. One sentence has no spread — that is unknown, not zero.
        "sentence_length_stdev": (
            round(statistics.stdev(lengths), 2) if len(lengths) > 1 else None
        ),
        "complex_sentence_ratio": round(complex_count / len(sents), 4),
    }


@metric
def conversational_initiative(transcript: Transcript) -> dict[str, float | int | None]:
    """
    How often the learner asks something rather than only answering.

    Not on the original list of parameters, and arguably the most diagnostic thing here.
    Ahmad's prompt ends every single turn with a question (see prompts/tutor.py), so a passive
    learner can hold a forty-turn conversation while producing nothing but answers. That looks
    like fluent practice and isn't: they never once had to *form* a question, which is a
    distinct skill with its own grammar and the one most likely to collapse under pressure in
    real conversation.

    A question ratio near zero, sustained across sessions, is worth surfacing even when every
    other metric looks healthy.
    """
    turns = [u.text.strip() for u in transcript.utterances if u.text.strip()]

    if not turns:
        return {"user_turns": 0, "question_ratio": None}

    # "?" is Whisper's judgement, not the learner's — it punctuates from intonation and
    # syntax. It is a decent signal for a clear question and it misses rising-intonation
    # statements ("you went there?"), so read this as a floor on curiosity, not a census.
    questions = sum(1 for t in turns if "?" in t)

    return {
        "user_turns": len(turns),
        "question_ratio": round(questions / len(turns), 4),
    }
