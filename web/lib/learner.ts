import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Learner identity.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * The passcode gate (lib/auth.ts) decides *whether you may use the tutor at all*. This
 * decides *whose progress chart you are looking at*. They are separate questions and the
 * cookies are separate: one is the shared key to the front door, the other is your name on
 * your own locker.
 *
 * There are no passwords here. Everyone shares one passcode, so this is not — and cannot be
 * — a security boundary between learners who already trust each other with that passcode. It
 * is a boundary against *forgery*: the cookie carries an HMAC over the learner id, so a
 * visitor cannot type someone else's uuid into their cookie jar and read their history. To
 * do that they'd need LIVEKIT_API_SECRET, which never leaves the server.
 *
 * That is the right level of strength for a link shared with friends. If this app ever goes
 * properly public, the fix is real accounts (Clerk), not a stronger cookie — because at that
 * point the shared passcode is the weak link, not this.
 *
 * The identity is per-browser. Switching from a phone to a laptop starts a new profile, and
 * clearing cookies loses the link to your history (the data survives in Postgres, but nothing
 * points at it). Both are accepted costs of not having logins.
 */
export const LEARNER_COOKIE = 'tutor_learner';

/** Twelve weeks. Long enough that a fortnightly learner doesn't lose their history. */
export const LEARNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 84;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function sign(learnerId: string): string {
  return createHmac('sha256', requireEnv('LIVEKIT_API_SECRET')).update(learnerId).digest('hex');
}

/** The cookie value for a learner: the id, plus a signature over it. */
export function learnerCookieValue(learnerId: string): string {
  return `${learnerId}.${sign(learnerId)}`;
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Recover the learner id from a cookie, or null if it is missing, malformed, or unsigned.
 *
 * Null is the normal state for a first-time visitor and callers must handle it — it means
 * "we don't know who this is yet", not "access denied".
 */
export function learnerIdFrom(cookieValue: string | undefined): string | null {
  if (!cookieValue) {
    return null;
  }

  const separator = cookieValue.lastIndexOf('.');
  if (separator === -1) {
    return null;
  }

  const learnerId = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);

  // Check the shape before the signature: a malformed uuid must never reach a SQL parameter,
  // signed or not.
  if (!UUID_RE.test(learnerId)) {
    return null;
  }

  try {
    return equals(signature, sign(learnerId)) ? learnerId : null;
  } catch {
    // LIVEKIT_API_SECRET missing — a server misconfiguration. Fail closed.
    return null;
  }
}

/** Display names are shown back to the learner, so keep them short and free of surprises. */
export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
  return name.length >= 1 ? name : null;
}
