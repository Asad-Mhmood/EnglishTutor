import { cookies } from 'next/headers';
import Link from 'next/link';
import { Dashboard } from '@/components/progress/dashboard';
import { Button } from '@/components/ui/button';
import { UNLOCK_COOKIE, isUnlocked } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { LEARNER_COOKIE, learnerIdFrom } from '@/lib/learner';
import { buildSummary } from '@/lib/progress/summary';

/**
 * /progress — the learner's dashboard.
 *
 * Server-rendered by calling the same analysis code /api/progress uses, rather than fetching
 * its own API over HTTP. A server component fetching its own route would mean an extra
 * network hop, cookie forwarding, and a second failure mode for no gain. The API route exists
 * for clients that want JSON; this page shares the logic beneath it.
 */

export const dynamic = 'force-dynamic';

function Gate({ title, body, cta }: { title: string; body: string; cta: React.ReactNode }) {
  return (
    <main className="grid min-h-svh place-content-center px-6">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-foreground text-xl font-semibold">{title}</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">{body}</p>
        <div className="mt-6">{cta}</div>
      </div>
    </main>
  );
}

export default async function ProgressPage() {
  const cookieStore = await cookies();

  if (!isUnlocked(cookieStore.get(UNLOCK_COOKIE)?.value)) {
    return (
      <Gate
        title="Locked"
        body="Enter the passcode on the home page first, then come back here."
        cta={
          <Button asChild className="rounded-full">
            <Link href="/">Go to the tutor</Link>
          </Button>
        }
      />
    );
  }

  const sql = getDb();
  if (!sql) {
    // No DATABASE_URL. The tutor still works — progress tracking is the optional half — so
    // say exactly that rather than showing a broken chart or a 500.
    return (
      <Gate
        title="Progress tracking isn't set up"
        body="This server has no database configured, so sessions aren't being recorded. The tutor itself works fine."
        cta={
          <Button asChild className="rounded-full">
            <Link href="/">Go to the tutor</Link>
          </Button>
        }
      />
    );
  }

  const learnerId = learnerIdFrom(cookieStore.get(LEARNER_COOKIE)?.value);
  if (!learnerId) {
    return (
      <Gate
        title="No profile yet"
        body="Tell Alex your name on the home page and your sessions will start being tracked from then on."
        cta={
          <Button asChild className="rounded-full">
            <Link href="/">Go to the tutor</Link>
          </Button>
        }
      />
    );
  }

  const summary = await buildSummary(sql, learnerId);

  if (!summary) {
    return (
      <Gate
        title="No profile yet"
        body="We couldn't find your profile. Head back and introduce yourself again."
        cta={
          <Button asChild className="rounded-full">
            <Link href="/">Go to the tutor</Link>
          </Button>
        }
      />
    );
  }

  return (
    <main className="bg-background min-h-svh">
      <Dashboard summary={summary} />
    </main>
  );
}
