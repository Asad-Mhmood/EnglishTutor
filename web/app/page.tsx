import { redirect } from 'next/navigation';
import { currentLearnerId } from '@/lib/session';

/**
 * `/` is a signpost, not a page.
 *
 * The old root *was* the call screen, with the passcode form bolted onto it. Splitting login,
 * home and call into their own routes means the root has nothing left to render — so it sends
 * you to whichever of them applies.
 */

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  redirect((await currentLearnerId()) ? '/home' : '/login');
}
