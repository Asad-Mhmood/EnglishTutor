import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { UNLOCK_COOKIE, isUnlocked } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  LEARNER_COOKIE,
  LEARNER_COOKIE_MAX_AGE,
  learnerCookieValue,
  learnerIdFrom,
  normalizeDisplayName,
} from '@/lib/learner';

/**
 * Learner profiles.
 *
 *   GET  — who is this browser? Returns { learner: { id, displayName } | null }.
 *   POST — { displayName } → create (or rename) the learner and set the signed cookie.
 *
 * Sits behind the passcode gate: an unauthenticated visitor cannot create learner rows, or
 * this endpoint becomes a way for a crawler to fill the database.
 */

export const revalidate = 0;

interface LearnerRow {
  id: string;
  display_name: string;
}

export async function GET() {
  const cookieStore = await cookies();

  if (!isUnlocked(cookieStore.get(UNLOCK_COOKIE)?.value)) {
    return new NextResponse('Locked', { status: 401 });
  }

  const learnerId = learnerIdFrom(cookieStore.get(LEARNER_COOKIE)?.value);
  if (!learnerId) {
    return NextResponse.json({ learner: null });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ learner: null, databaseConfigured: false });
  }

  const rows = await sql<LearnerRow>`
    SELECT id, display_name FROM learners WHERE id = ${learnerId}
  `;

  if (rows.length === 0) {
    // A signed cookie for a learner who no longer exists — the database was reset, or the
    // row was deleted. Treat it as a new visitor rather than 500ing.
    return NextResponse.json({ learner: null });
  }

  return NextResponse.json({
    learner: { id: rows[0].id, displayName: rows[0].display_name },
  });
}

export async function POST(req: Request) {
  const cookieStore = await cookies();

  if (!isUnlocked(cookieStore.get(UNLOCK_COOKIE)?.value)) {
    return new NextResponse('Locked', { status: 401 });
  }

  let displayName: string | null = null;
  try {
    const body = await req.json();
    displayName = normalizeDisplayName(body?.displayName);
  } catch {
    // Malformed body falls through to the same 400 as a missing name.
  }

  if (!displayName) {
    return NextResponse.json({ error: 'Tell me what to call you.' }, { status: 400 });
  }

  const sql = getDb();
  if (!sql) {
    // No database: the tutor still works, there is just nowhere to keep progress. Say so
    // rather than pretending the profile was saved.
    return NextResponse.json(
      { error: 'Progress tracking is not set up on this server yet.' },
      { status: 503 }
    );
  }

  const existingId = learnerIdFrom(cookieStore.get(LEARNER_COOKIE)?.value);

  // An existing learner submitting the form again is renaming themselves, not starting over.
  // Creating a second row would silently orphan every session they had already recorded.
  if (existingId) {
    const updated = await sql<LearnerRow>`
      UPDATE learners
         SET display_name = ${displayName}, last_seen_at = now()
       WHERE id = ${existingId}
      RETURNING id, display_name
    `;
    if (updated.length > 0) {
      return NextResponse.json({
        learner: { id: updated[0].id, displayName: updated[0].display_name },
      });
    }
    // Cookie pointed at a learner that no longer exists; fall through and make a new one.
  }

  const created = await sql<LearnerRow>`
    INSERT INTO learners (display_name) VALUES (${displayName})
    RETURNING id, display_name
  `;
  const learner = created[0];

  const res = NextResponse.json({
    learner: { id: learner.id, displayName: learner.display_name },
  });

  res.cookies.set(LEARNER_COOKIE, learnerCookieValue(learner.id), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: LEARNER_COOKIE_MAX_AGE,
  });

  return res;
}
