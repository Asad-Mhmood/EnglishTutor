import type { ErrorRow, SessionRow } from './types';

/**
 * The session-window filters for the session explorer.
 *
 * Pure functions over the oldest-first session list, in their own module so the explorer
 * component stays rendering-only — the same "nothing in components/ computes anything"
 * rule the rest of the dashboard follows.
 *
 * `now` is a parameter rather than `Date.now()` so the date windows are deterministic and
 * testable, and so one render pass cannot straddle midnight and disagree with itself.
 */

export type SessionFilterKey = 'all' | 'last-5' | 'last-10' | 'week' | 'month';

export interface SessionFilter {
  key: SessionFilterKey;
  label: string;
  apply: (sessions: SessionRow[], now: Date) => SessionRow[];
}

function sinceDays(sessions: SessionRow[], now: Date, days: number): SessionRow[] {
  const cutoff = now.getTime() - days * 86_400_000;
  return sessions.filter((session) => new Date(session.started_at).getTime() >= cutoff);
}

/** Presets rather than a date picker: five choices a learner can scan beat a calendar widget. */
export const SESSION_FILTERS: SessionFilter[] = [
  { key: 'all', label: 'All sessions', apply: (sessions) => sessions },
  { key: 'last-5', label: 'Last 5', apply: (sessions) => sessions.slice(-5) },
  { key: 'last-10', label: 'Last 10', apply: (sessions) => sessions.slice(-10) },
  { key: 'week', label: 'Past week', apply: (sessions, now) => sinceDays(sessions, now, 7) },
  { key: 'month', label: 'Past month', apply: (sessions, now) => sinceDays(sessions, now, 30) },
];

/** The corrections belonging to a set of sessions — for scoping errors to a filtered window. */
export function errorsForSessions(errors: ErrorRow[], sessions: SessionRow[]): ErrorRow[] {
  const ids = new Set(sessions.map((session) => session.id));
  return errors.filter((error) => ids.has(error.session_id));
}
