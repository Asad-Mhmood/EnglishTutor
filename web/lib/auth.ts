import { createHash, timingSafeEqual } from 'crypto';

/**
 * Passcode gate for the token endpoint.
 *
 * /api/token hands out a LiveKit room token to whoever asks, and every token
 * spins up a real agent session that costs Groq, Tavily and LiveKit quota. The
 * upstream template refuses to run that route in production at all. This gate is
 * what replaces that refusal: unlock once with the passcode, get an httpOnly
 * cookie, and only then can you mint tokens.
 *
 * The cookie is a hash of the passcode and the LiveKit API secret, so it cannot
 * be forged by someone who has merely seen the cookie name — they'd need the
 * secret, which never leaves the server.
 */
export const UNLOCK_COOKIE = 'tutor_unlocked';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** The value we expect the unlock cookie to carry. Server-side only. */
export function unlockToken(): string {
  const passcode = requireEnv('APP_PASSCODE');
  const secret = requireEnv('LIVEKIT_API_SECRET');
  return createHash('sha256').update(`${passcode}:${secret}`).digest('hex');
}

/** Constant-time compare; false on any length mismatch. */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function passcodeMatches(input: string): boolean {
  return equals(input, requireEnv('APP_PASSCODE'));
}

export function isUnlocked(cookieValue: string | undefined): boolean {
  if (!cookieValue) {
    return false;
  }
  return equals(cookieValue, unlockToken());
}
