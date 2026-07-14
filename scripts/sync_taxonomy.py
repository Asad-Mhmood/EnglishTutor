"""
Copy the error taxonomy to where the web app can import it.

    python scripts/sync_taxonomy.py           # write the copy
    python scripts/sync_taxonomy.py --check   # fail if the copy is stale (for CI)

WHY THIS EXISTS

`progress/taxonomy.json` is the single source of truth, read directly by the Python agent.
The dashboard needs the same labels and advice — but Vercel deploys from `web/` and does not
upload anything above it, so `web/` cannot reach the file. It gets a generated copy instead.

This is a copy, not a symlink: symlinks do not survive a Windows checkout cleanly, and Vercel
would not follow one out of the deploy root anyway.

Drift is degraded, not broken — the dashboard falls back to showing a raw category key where
it has no label — but `--check` exists so it never has to be discovered that way.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "progress" / "taxonomy.json"
DESTINATION = ROOT / "web" / "lib" / "progress" / "taxonomy.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if the copy is missing or stale, and write nothing",
    )
    args = parser.parse_args()

    source_text = SOURCE.read_text(encoding="utf-8")
    current = DESTINATION.read_text(encoding="utf-8") if DESTINATION.exists() else None

    if current == source_text:
        print(f"up to date: {DESTINATION.relative_to(ROOT)}")
        return 0

    if args.check:
        state = "missing" if current is None else "stale"
        print(
            f"ERROR: {DESTINATION.relative_to(ROOT)} is {state}.\n"
            f"Run: python scripts/sync_taxonomy.py",
            file=sys.stderr,
        )
        return 1

    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    # newline="\n": web/.gitattributes pins LF, and the frontend build runs prettier --check.
    # A CRLF copy written from Windows would fail that build with a wall of `Delete ␍`.
    DESTINATION.write_text(source_text, encoding="utf-8", newline="\n")
    print(f"wrote {DESTINATION.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
