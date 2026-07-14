import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Sign-in, and who is signed in.
 *
 * This replaced a two-cookie scheme (one "you knew the passcode" cookie, one "you are learner
 * X" cookie). They always travelled together and always expired apart, which meant a learner
 * could hold a valid identity and no access, or access and no identity — two states that had
 * to be handled everywhere and meant nothing to anybody. One cookie, issued at login, now
 * carries both facts.
 *
 * WHAT THE COOKIE PROVES
 *
 * The value is `learnerId.HMAC(learnerId)`, and the HMAC key is derived from BOTH the shared
 * passcode and LIVEKIT_API_SECRET. So a valid cookie proves two things at once:
 *
 *   1. It was minted by this server after a correct passcode — /api/login is the only place
 *      that signs one, and it signs nothing until the passcode checks out.
 *   2. It names a specific learner, and that name cannot be swapped for someone else's without
 *      LIVEKIT_API_SECRET, which never leaves the server.
 *
 * Folding the passcode into the key has a deliberate consequence: ROTATING APP_PASSCODE
 * INVALIDATES EVERY SESSION. That is the behaviour you want from a rotation — the old passcode
 * stops working for the people who already used it, not just for the people about to.
 *
 * WHAT IT DOES NOT PROVE
 *
 * That you are who you say you are. Everyone shares one passcode and usernames are not secret,
 * so a learner who knows the passcode can log in as their friend and read their history. This
 * is a boundary against forgery and mix-ups, not against a snoop — which is the right trade for
 * a link shared with friends, and the wrong one for a public app. The fix, if this ever goes
 * properly public, is real per-user credentials (Clerk, Auth.js), not a longer HMAC: at that
 * point the shared passcode is the weak link and nothing here can compensate for it.
 */
export const SESSION_COOKIE = 'tutor_session';

/** Thirty days. Long enough that a weekly learner is never asked to log in twice. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Usernames are lowercase, 2–24 characters, starting with a letter or digit.
 *
 * The charset is narrow on purpose. This string is a durable identifier: it goes into the
 * database, into a URL-free lookup, and is the thing a learner has to retype correctly on a
 * phone keyboard six weeks later. Spaces, accents and emoji would all make "the same username"
 * a question with more than one answer.
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,23}$/;

export interface SubmittedName {
  /** Canonical, lowercased. The database key. */
  username: string;
  /** As the learner typed it. Shown back to them, never matched on. */
  displayName: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
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

/**
 * The HMAC key. Both halves matter — see the header: the secret makes the cookie unforgeable,
 * the passcode makes rotation actually revoke.
 */
function signingKey(): string {
  return `${requireEnv('APP_PASSCODE')}:${requireEnv('LIVEKIT_API_SECRET')}`;
}

function sign(learnerId: string): string {
  return createHmac('sha256', signingKey()).update(learnerId).digest('hex');
}

/** The cookie value for a signed-in learner. */
export function sessionCookieValue(learnerId: string): string {
  return `${learnerId}.${sign(learnerId)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recover the learner id from a cookie value, or null if it is missing, malformed, or unsigned.
 *
 * Null means "nobody is signed in" — the normal state of a first-time visitor, not an error.
 */
export function learnerIdFromCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue) {
    return null;
  }

  const separator = cookieValue.lastIndexOf('.');
  if (separator === -1) {
    return null;
  }

  const learnerId = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);

  // Shape before signature: a malformed uuid must never reach a SQL parameter, signed or not.
  if (!UUID_RE.test(learnerId)) {
    return null;
  }

  try {
    return equals(signature, sign(learnerId)) ? learnerId : null;
  } catch {
    // A required env var is missing — a server misconfiguration. Fail closed.
    return null;
  }
}

/**
 * The signed-in learner's id, read from the request's cookies, or null.
 *
 * The one way any page or route learns who is asking. Nothing else reads SESSION_COOKIE.
 */
export async function currentLearnerId(): Promise<string | null> {
  const store = await cookies();
  return learnerIdFromCookie(store.get(SESSION_COOKIE)?.value);
}

/** Cookie options shared by the routes that set and clear the session. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

/**
 * Validate a submitted username, returning both forms, or null if it is unusable.
 *
 * Rejecting is better than silently mangling: a learner who types "Asad Mehmood" and is quietly
 * signed in as "asadmehmood" will type the space again next time and wonder where their
 * history went. Tell them the rule instead.
 */
export function normalizeUsername(raw: unknown): SubmittedName | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const displayName = raw.trim().replace(/\s+/g, ' ');
  const username = displayName.toLowerCase();

  if (!USERNAME_RE.test(username)) {
    return null;
  }

  return { username, displayName };
}

/** The rule, in a sentence, for the login form and the API to agree on. */
export const USERNAME_RULE =
  'Usernames are 2–24 characters: letters, numbers, dots, dashes or underscores. No spaces.';
