"""
The metric registry — the extension point for everything measurable.

Adding a new tracked parameter is one function:

    from ..models import Transcript
    from .registry import metric

    @metric
    def hesitation(transcript: Transcript) -> dict[str, float | int | None]:
        '''Docstring is documentation, not plumbing.'''
        return {"hesitation_index": ...}

Import it from `progress/metrics/__init__.py` so the decorator runs, and it appears in every
SessionReport from then on. It reaches the database with no migration (repository.py routes
unknown keys into the `extra` JSONB column) and can be promoted to a real column later once
it has proved it's worth charting.

Two rules a metric function must follow:

  1. **Pure.** Transcript in, numbers out. No network, no database, no clock. This is what
     makes the whole analysis layer testable on a hand-written transcript, and it is why
     grading.py — which *does* call an LLM — is deliberately not a metric.

  2. **Return None, never 0.0, when a measurement is impossible.** A learner who said nothing
     has an *unknown* type-token ratio, not a ratio of zero. Zero would plot as a real data
     point and read as catastrophic regression on the trend chart. None is stored as NULL and
     simply doesn't appear.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from ..models import Transcript

logger = logging.getLogger(__name__)

MetricFn = Callable[[Transcript], dict[str, float | int | None]]

_REGISTRY: list[MetricFn] = []


def metric(fn: MetricFn) -> MetricFn:
    """Register a metric function. Used as a decorator."""
    _REGISTRY.append(fn)
    return fn


def registered() -> tuple[MetricFn, ...]:
    """Every registered metric, in registration order. Exposed for tests and introspection."""
    return tuple(_REGISTRY)


def compute_all(transcript: Transcript) -> dict[str, float | int | None]:
    """
    Run every registered metric and merge the results into one flat dict.

    One metric raising must not cost us the other twelve — a session that produced numbers
    for eleven metrics and NULL for one is still a useful data point, whereas a crash here
    would silently drop the entire session (this runs in a shutdown callback, where nobody is
    watching). So failures are logged and skipped, not raised.
    """
    merged: dict[str, float | int | None] = {}

    for fn in _REGISTRY:
        try:
            result = fn(transcript)
        except Exception:  # noqa: BLE001 — one bad metric must not sink the session
            logger.exception("metric %s failed; skipping it", fn.__name__)
            continue

        overlap = merged.keys() & result.keys()
        if overlap:
            # Two metrics claiming the same key means one silently overwrites the other and
            # the chart quietly shows the wrong number. Loud, because it is a code bug.
            logger.error(
                "metric %s re-defines existing key(s) %s; later value wins",
                fn.__name__,
                sorted(overlap),
            )
        merged.update(result)

    return merged
