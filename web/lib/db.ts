import { neon } from '@neondatabase/serverless';

/**
 * The Postgres handle for the web half.
 *
 * The agent writes progress rows (progress/repository.py); this reads them. Two runtimes, two
 * drivers, one database — Neon's HTTP driver is used here because Vercel functions are
 * short-lived, and a TCP connection pool across cold starts is a liability rather than an
 * optimisation.
 *
 * `sql` is a tagged template. Interpolations are sent as BOUND PARAMETERS, never as string
 * concatenation, so sql`... WHERE id = ${learnerId}` is parameterised and injection-safe. Do
 * not be tempted to build a query by concatenating strings to "make it dynamic" — that is
 * exactly how this stops being safe.
 */

/**
 * Neon's own return type is a union (`any[][] | Record<string, any>[] | FullQueryResults`)
 * because the shape depends on generic options set at construction. With our default options
 * it is always an array of row objects, but TypeScript cannot narrow that on its own, so every
 * call site would otherwise need its own cast.
 *
 * Narrowing it once, here, means callers get real types — `sql<SessionRow>\`SELECT ...\`` —
 * and the assertion exists in exactly one place instead of a dozen.
 */
export type Sql = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

let cached: Sql | null = null;

/**
 * Returns the query function, or null when no database is configured.
 *
 * Null is a supported state, deliberately mirroring PROGRESS_DATABASE_URL being optional on
 * the agent side: the tutor is the product and must keep working when the progress feature
 * cannot. Callers degrade — the dashboard says "progress tracking isn't set up" — rather than
 * throwing a 500 over a chart.
 */
export function getDb(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return null;
  }
  if (!cached) {
    cached = neon(url) as unknown as Sql;
  }
  return cached;
}
