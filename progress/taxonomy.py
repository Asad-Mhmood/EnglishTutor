"""
The error taxonomy: the closed set of mistake categories the grader may assign, and the
practice advice attached to each.

The data lives in `taxonomy.json` next to this file — NOT in this module. It is shared with
the web dashboard, which cannot import Python, so it has to be language-neutral. See the
`_comment` block in that file, and `scripts/sync_taxonomy.py`.

WHY THE SET IS CLOSED

A free-text category field would let the LLM invent "article usage", "articles", and "missing
article" for the same mistake across three sessions, and the trend chart would show three
flat lines instead of one real one. Every category the grader returns is validated against
VALID_KEYS and anything unrecognised is dropped (grading.py::_parse).

To add a category: add it to taxonomy.json and run the sync script. It flows automatically
into the grader's prompt, the dashboard's weak-area list, and the practice suggestions.
Nothing else needs to change.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

_TAXONOMY_PATH = Path(__file__).with_name("taxonomy.json")


@dataclass(frozen=True)
class Category:
    """One kind of mistake, and what to do about it."""

    key: str
    label: str
    """Learner-facing name. Shown on the dashboard."""

    hint: str
    """How the grader should recognise it. Goes into the grading prompt."""

    advice: str
    """What to practice. Shown in 'work on this next'. Written in the second person."""


def _load() -> tuple[Category, ...]:
    raw = json.loads(_TAXONOMY_PATH.read_text(encoding="utf-8"))
    return tuple(
        Category(
            key=item["key"],
            label=item["label"],
            hint=item["hint"],
            advice=item["advice"],
        )
        for item in raw["categories"]
    )


CATEGORIES: tuple[Category, ...] = _load()

BY_KEY: dict[str, Category] = {c.key: c for c in CATEGORIES}

VALID_KEYS: frozenset[str] = frozenset(BY_KEY)


def label_for(key: str) -> str:
    """Learner-facing label, falling back to the raw key for anything unrecognised."""
    category = BY_KEY.get(key)
    return category.label if category else key


def advice_for(key: str) -> str | None:
    """Practice advice for a category, or None if the key is unknown."""
    category = BY_KEY.get(key)
    return category.advice if category else None


def prompt_reference() -> str:
    """
    The taxonomy rendered for the grading prompt, so the LLM sees exactly the keys it is
    allowed to emit. Generated rather than hand-copied — a hand-copied list drifts out of
    sync with the taxonomy the first time someone adds a category.
    """
    return "\n".join(f"- {c.key}: {c.hint}" for c in CATEGORIES)
