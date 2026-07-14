import { headers } from 'next/headers';
import { App } from '@/components/app/app';
import { getDb } from '@/lib/db';
import { requireLearnerId } from '@/lib/guard';
import { getLearner } from '@/lib/learners';
import { getAppConfig } from '@/lib/utils';

/**
 * /call — the voice session itself.
 *
 * Guarded, but only by the cheap cookie check: /api/token re-checks the session before it mints
 * anything, so this guard is here to spare a signed-out visitor a broken-looking page, not to
 * protect the room. The security boundary is the token route, and it stands on its own.
 *
 * The learner's name is looked up purely so the pre-call screen can greet them. A failed lookup
 * is not fatal — a missing name costs a nicety, and taking the tutor down over it would be
 * absurd.
 */

export const dynamic = 'force-dynamic';

export default async function CallPage() {
  const learnerId = await requireLearnerId();
  const hdrs = await headers();
  const appConfig = await getAppConfig(hdrs);

  const sql = getDb();
  const learner = sql ? await getLearner(sql, learnerId) : null;

  return <App appConfig={appConfig} learnerName={learner?.displayName ?? null} />;
}
