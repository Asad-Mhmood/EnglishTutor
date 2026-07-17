/**
 * Deterministic date formatting for the dashboard.
 *
 * NOT `toLocaleDateString`: the page is server-rendered and then hydrated, and a locale- or
 * timezone-dependent formatter can produce different text on the server than in the browser —
 * which React reports as a hydration mismatch on a line you never edited. Fixed month names
 * and UTC fields produce the same string everywhere.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Jul" — compact, for session rows and group headers. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}
