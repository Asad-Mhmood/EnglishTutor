import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/session';

/**
 * POST /api/logout — drop the session cookie.
 *
 * POST, not GET: a GET would be followed by any link prefetcher or image scanner that happened
 * across the URL, and learners would find themselves mysteriously signed out.
 *
 * Nothing is deleted server-side. The learner's history stays exactly where it is, and signing
 * back in with the same username returns them to it — that is the entire point of keying
 * identity to the username instead of the browser.
 */

export const revalidate = 0;

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
