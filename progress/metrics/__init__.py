"""
Deterministic metrics — everything measurable from the transcript alone, with no LLM.

These are the numbers we can stand behind. They are arithmetic on text: they cost nothing,
they never hallucinate, they return the same value for the same input every time, and they
cannot invent a mistake the learner didn't make. The LLM-judged half of the analysis
(grading.py) is the part that can be wrong, and it is kept deliberately separate for exactly
that reason.

Importing this package registers every metric. `compute_all(transcript)` then runs them all
and merges the results — the agent never imports the individual modules.
"""

from ..models import Transcript
from .registry import MetricFn, compute_all, metric, registered

# Imported for their side effect: each module's @metric decorators register on import. Without
# these lines the registry is empty and every session records no metrics at all — silently,
# because an empty registry is not an error. Do not "clean up" these as unused imports.
from . import fluency, lexical, syntax  # noqa: F401  isort:skip

__all__ = ["MetricFn", "Transcript", "compute_all", "metric", "registered"]
