"""Apply progress/schema.sql to the progress database.

    python scripts/apply_schema.py

The schema is idempotent — every statement is CREATE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
or a guarded UPDATE — so re-running it is how migrations are applied. There is no migration
tool and no version table: this project has one database and one schema file, and adding
Alembic to it would be more machinery than the thing it manages.

Reads PROGRESS_DATABASE_URL (the agent's name for it) from the repo-root .env.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "progress" / "schema.sql"


async def main() -> int:
    load_dotenv(ROOT / ".env")

    dsn = os.environ.get("PROGRESS_DATABASE_URL")
    if not dsn:
        print("PROGRESS_DATABASE_URL is not set in .env", file=sys.stderr)
        return 1

    import asyncpg

    # statement_cache_size=0 is required for Neon's pooled (PgBouncer) connection string —
    # the same reason progress/repository.py sets it. Without it, prepared statements from a
    # previous connection collide and you get a baffling DuplicatePreparedStatementError.
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        await conn.execute(SCHEMA.read_text(encoding="utf-8"))
    finally:
        await conn.close()

    print(f"applied {SCHEMA.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
