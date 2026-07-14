import type { Sql } from '@/lib/db';
import type { SubmittedName } from '@/lib/session';

/**
 * Learner rows — the only module in the web half that writes to `learners`.
 *
 * Same rule as lib/progress/summary.ts: SQL lives in one place, and the routes above it deal
 * in Learner objects and know nothing about the schema.
 */

export interface Learner {
  id: string;
  username: string;
  displayName: string;
}

interface LearnerRow {
  id: string;
  username: string;
  display_name: string;
}

function toLearner(row: LearnerRow): Learner {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

/**
 * Resolve a username to a learner, creating one on first sight.
 *
 * This is the whole cross-device story in one query: the same username on a phone and a laptop
 * lands on the same row, because the row is keyed by the name and not by the browser.
 *
 * The upsert is a single statement rather than SELECT-then-INSERT on purpose — two learners
 * claiming the same new username at the same moment would both find nothing and both insert,
 * and one of them would get a unique-violation 500 on their first ever login. ON CONFLICT makes
 * the loser of that race a normal sign-in instead.
 *
 * `display_name` is refreshed from what was typed, so a learner who signs in as "ASAD" is
 * greeted as "ASAD". The username — the key — is untouched by that, so no history moves.
 */
export async function signInLearner(sql: Sql, name: SubmittedName): Promise<Learner> {
  const rows = await sql<LearnerRow>`
    INSERT INTO learners (username, display_name)
         VALUES (${name.username}, ${name.displayName})
    ON CONFLICT (username) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                last_seen_at = now()
      RETURNING id, username, display_name
  `;
  return toLearner(rows[0]);
}

/**
 * Look up a signed-in learner by id, or null if the row is gone.
 *
 * Null is reachable in normal operation: a cookie outlives the database it points into, so a
 * reset or a deleted row leaves a perfectly valid signature naming a learner who no longer
 * exists. Callers treat that as "signed out", not as a crash.
 */
export async function getLearner(sql: Sql, learnerId: string): Promise<Learner | null> {
  const rows = await sql<LearnerRow>`
    SELECT id, username, display_name FROM learners WHERE id = ${learnerId}
  `;
  return rows.length > 0 ? toLearner(rows[0]) : null;
}
