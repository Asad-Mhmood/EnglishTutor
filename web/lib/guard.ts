import { redirect } from 'next/navigation';
import { currentLearnerId } from '@/lib/session';

/**
 * The signed-in learner's id, or a redirect to /login.
 *
 * Server components only — a route handler cannot redirect, and should call currentLearnerId()
 * and return a 401 instead.
 *
 * Cheap by design: it verifies the cookie signature and touches no database, so a page that
 * only needs to know *somebody* is signed in (/call does not care what they are called) pays
 * nothing for the check. Pages that need the row load it themselves.
 */
export async function requireLearnerId(): Promise<string> {
  const learnerId = await currentLearnerId();
  if (!learnerId) {
    redirect('/login');
  }
  return learnerId;
}
