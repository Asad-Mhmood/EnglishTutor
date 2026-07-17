import type { Sql } from '@/lib/db';
import {
  analyseMetricTrends,
  analyseWeaknesses,
  buildParameters,
  buildTrend,
  currentStreakDays,
  estimateLevel,
} from './analysis';
import type { ErrorRow, ProgressSummary, SessionRow } from './types';

/**
 * Fetch a learner's history and run the analysis over it.
 *
 * Shared by /api/progress (JSON for clients) and /progress (server-rendered page), so the two
 * can never disagree about what a learner's level is — which they would, eventually, if each
 * carried its own copy of these queries.
 *
 * This module is the only place in the web half that reads progress tables. The dashboard
 * components take a ProgressSummary and know nothing about SQL; analysis.ts takes rows and
 * knows nothing about the database. Same three-layer split as the Python side.
 */

interface LearnerRow {
  id: string;
  display_name: string;
}

/**
 * Neon decodes `timestamptz` into a JavaScript `Date`, not a string.
 *
 * Everything downstream — `currentStreakDays` slicing a day out of the date, the charts
 * putting it on an axis, JSON serialisation for the API — wants an ISO string, and TypeScript
 * cannot catch the difference because the driver's row type is `Record<string, unknown>` and
 * the cast to SessionRow is taken on faith. It fails at runtime, inside a `.map()`, with
 * `started_at.slice is not a function`.
 *
 * So the conversion happens once, here, at the boundary where rows enter the application.
 * Past this line a date is always an ISO string and the SessionRow type is honest.
 */
function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Enough history for a real trend without paging. A daily learner reaches this in ~6 months. */
const MAX_SESSIONS = 200;

/** How many individual corrections to show in the "recent mistakes" list. */
const MAX_RECENT_CORRECTIONS = 15;

export async function buildSummary(sql: Sql, learnerId: string): Promise<ProgressSummary | null> {
  const learners = await sql<LearnerRow>`
    SELECT id, display_name FROM learners WHERE id = ${learnerId}
  `;

  if (learners.length === 0) {
    return null;
  }

  // OLDEST-FIRST, and every function in analysis.ts depends on it. The ordering *is* the
  // analysis: "you fixed this and it came back" is only meaningful against a timeline. Sorted
  // once, here, rather than re-sorted at each call site where one could be forgotten.
  const sessionRows = await sql<SessionRow>`
    SELECT id, started_at, duration_seconds, user_turns, word_count,
           unique_word_count, type_token_ratio, advanced_word_ratio, new_word_count,
           mean_sentence_length, sentence_length_stdev, complex_sentence_ratio,
           words_per_minute, filler_rate, self_correction_rate, question_ratio,
           error_count, errors_per_100_words, cefr_estimate, cefr_confidence, summary
      FROM sessions
     WHERE learner_id = ${learnerId}
     ORDER BY started_at ASC
     LIMIT ${MAX_SESSIONS}
  `;

  const errorRows = await sql<ErrorRow>`
    SELECT e.session_id, e.category, e.learner_text, e.corrected_text, e.explanation,
           e.created_at
      FROM session_errors e
      JOIN sessions s ON s.id = e.session_id
     WHERE e.learner_id = ${learnerId}
     ORDER BY s.started_at ASC
  `;

  const vocabulary = await sql<{ size: number }>`
    SELECT count(*)::int AS size FROM learner_vocabulary WHERE learner_id = ${learnerId}
  `;

  const sessions: SessionRow[] = sessionRows.map((row) => ({
    ...row,
    started_at: toIso(row.started_at),
  }));

  const errors: ErrorRow[] = errorRows.map((row) => ({
    ...row,
    created_at: toIso(row.created_at),
  }));

  const newestFirst = [...sessions].reverse();

  const { weaknesses, improving } = analyseWeaknesses(sessions, errors);

  // The parameters are built once and are the single source for both the charts and the prose:
  // the strengths list is *derived* from them, so a parameter can never be charted as improving
  // and described as slipping on the same page.
  const parameters = buildParameters(sessions, errors);
  const { strengths: metricStrengths, slipping } = analyseMetricTrends(parameters);

  const gradedSessions = sessions.filter((s) => s.cefr_estimate !== null).length;

  return {
    learner: { id: learners[0].id, displayName: learners[0].display_name },

    totals: {
      sessions: sessions.length,
      practiceMinutes: Math.round(
        sessions.reduce((total, s) => total + s.duration_seconds, 0) / 60
      ),
      wordsSpoken: sessions.reduce((total, s) => total + s.word_count, 0),
      vocabularySize: vocabulary[0]?.size ?? 0,
      currentStreakDays: currentStreakDays(sessions),
    },

    level: estimateLevel(newestFirst),
    latestSummary: newestFirst.find((s) => s.summary)?.summary ?? null,

    // Mistakes the learner has stopped making come first: "you fixed this" is both more
    // motivating and more informative than "this metric moved 12%".
    strengths: [...improving, ...metricStrengths],

    // A metric that is actively getting worse is surfaced alongside the grammar weaknesses.
    // A learner whose speaking pace has collapsed needs to know, and no error category would
    // ever tell them.
    weaknesses: [
      ...weaknesses,
      ...slipping.map((s) => ({
        category: 'metric',
        label: s.label,
        advice: s.detail,
        status: 'active' as const,
        totalErrors: 0,
        sessionsAffected: 3,
        note: s.detail,
      })),
    ],

    trends: buildTrend(sessions),
    parameters,
    recentCorrections: errors.slice(-MAX_RECENT_CORRECTIONS).reverse(),

    // The rows themselves, for the session explorer. Already fetched for the analysis above —
    // shipping them costs no extra query, and letting the client re-run the pure analysis over
    // a filtered window is what keeps the windowed cards incapable of disagreeing with these.
    sessions,
    errors,

    dataQuality: {
      gradedSessions,
      ungradedSessions: sessions.length - gradedSessions,
    },
  };
}
