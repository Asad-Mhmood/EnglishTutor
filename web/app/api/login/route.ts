import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { signInLearner } from '@/lib/learners';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE,
  USERNAME_RULE,
  normalizeUsername,
  passcodeMatches,
  sessionCookieValue,
} from '@/lib/session';

/**
 * POST /api/login — { username, passcode } → a session cookie.
 *
 * The only place a session cookie is ever minted. Everything else in the app reads one.
 *
 * This replaced /api/unlock + /api/profile, which were two calls the client had to make in the
 * right order, from the same form, where getting the order wrong produced a working tutor that
 * silently recorded nothing. One call cannot be sequenced wrongly.
 */

export const revalidate = 0;

export async function POST(req: Request) {
  let rawUsername: unknown = null;
  let passcode = '';

  try {
    const body = await req.json();
    rawUsername = body?.username;
    passcode = typeof body?.passcode === 'string' ? body.passcode : '';
  } catch {
    // A malformed body is just a failed login. Fall through to the checks below.
  }

  // Passcode FIRST, before the username is even looked at. Validating the username first would
  // let anyone without the passcode probe which usernames exist, from the error messages alone.
  try {
    if (!passcodeMatches(passcode.trim())) {
      return NextResponse.json({ error: "That passcode isn't right." }, { status: 401 });
    }
  } catch (error) {
    // APP_PASSCODE or LIVEKIT_API_SECRET missing on the server — a misconfiguration, not a
    // wrong guess, and the learner can do nothing about it. Don't blame them for it.
    console.error(error);
    return NextResponse.json({ error: 'The tutor is not configured yet.' }, { status: 500 });
  }

  const name = normalizeUsername(rawUsername);
  if (!name) {
    return NextResponse.json({ error: USERNAME_RULE }, { status: 400 });
  }

  const sql = getDb();
  if (!sql) {
    // No database means no learners table to sign in against. The tutor itself would still
    // work, but there is no honest way to hand out an identity that nothing can record.
    return NextResponse.json(
      { error: 'Sign-in is unavailable — this server has no database configured.' },
      { status: 503 }
    );
  }

  let learner;
  try {
    learner = await signInLearner(sql, name);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not sign you in. Try again.' }, { status: 500 });
  }

  const res = NextResponse.json({
    learner: { username: learner.username, displayName: learner.displayName },
  });

  res.cookies.set(SESSION_COOKIE, sessionCookieValue(learner.id), {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE,
  });

  return res;
}
