import { NextResponse } from 'next/server';
import { UNLOCK_COOKIE, passcodeMatches, unlockToken } from '@/lib/auth';

// Never cache an auth check.
export const revalidate = 0;

export async function POST(req: Request) {
  let passcode = '';
  try {
    const body = await req.json();
    passcode = typeof body?.passcode === 'string' ? body.passcode : '';
  } catch {
    // Malformed body is just a failed unlock attempt.
  }

  try {
    if (!passcodeMatches(passcode.trim())) {
      return NextResponse.json({ error: "That passcode isn't right." }, { status: 401 });
    }
  } catch (error) {
    // APP_PASSCODE missing on the server — a misconfiguration, not a bad guess.
    console.error(error);
    return NextResponse.json({ error: 'The tutor is not configured yet.' }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, unlockToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12, // a practice session, not a permanent grant
  });
  return res;
}
