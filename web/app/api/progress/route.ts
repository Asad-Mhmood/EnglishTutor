import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { UNLOCK_COOKIE, isUnlocked } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { LEARNER_COOKIE, learnerIdFrom } from '@/lib/learner';
import { buildSummary } from '@/lib/progress/summary';

/**
 * The dashboard's data, as JSON.
 *
 * Reads only the learner named by the signed cookie. There is no `?learnerId=` parameter and
 * there must never be one — the cookie's HMAC is the only thing between one learner's history
 * and another's, and a query parameter would hand it away for free.
 *
 * The /progress page does not call this route; both call buildSummary directly. This exists
 * for anything that wants the numbers without the HTML.
 */

export const revalidate = 0;

export async function GET() {
  const cookieStore = await cookies();

  if (!isUnlocked(cookieStore.get(UNLOCK_COOKIE)?.value)) {
    return new NextResponse('Locked', { status: 401 });
  }

  // Database first, THEN the profile — the order matters for the error the caller gets back.
  // A learner has no profile *because* there is no database to have created one in, so
  // checking the cookie first would report 'no-profile' for a server that simply has no
  // DATABASE_URL, sending whoever debugs it looking for a bug in the cookie. /progress checks
  // in this same order, so the page and the API always give the same reason.
  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ error: 'no-database' }, { status: 503 });
  }

  const learnerId = learnerIdFrom(cookieStore.get(LEARNER_COOKIE)?.value);
  if (!learnerId) {
    return NextResponse.json({ error: 'no-profile' }, { status: 404 });
  }

  const summary = await buildSummary(sql, learnerId);
  if (!summary) {
    return NextResponse.json({ error: 'no-profile' }, { status: 404 });
  }

  return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
}
