import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildSummary } from '@/lib/progress/summary';
import { currentLearnerId } from '@/lib/session';

/**
 * The dashboard's data, as JSON.
 *
 * Reads only the learner named by the session cookie. There is no `?learnerId=` parameter and
 * there must never be one — the cookie's HMAC is the only thing between one learner's history
 * and another's, and a query parameter would hand it away for free.
 *
 * The /progress page does not call this route; both call buildSummary directly. This exists
 * for anything that wants the numbers without the HTML.
 */

export const revalidate = 0;

export async function GET() {
  const learnerId = await currentLearnerId();
  if (!learnerId) {
    return NextResponse.json({ error: 'not-signed-in' }, { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ error: 'no-database' }, { status: 503 });
  }

  const summary = await buildSummary(sql, learnerId);
  if (!summary) {
    // Signed cookie, missing row: the database was reset under a live session.
    return NextResponse.json({ error: 'no-profile' }, { status: 404 });
  }

  return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
}
