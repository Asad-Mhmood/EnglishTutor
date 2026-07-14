import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChartLineUpIcon, MicrophoneIcon } from '@phosphor-icons/react/dist/ssr';
import { ActionCard } from '@/components/home/action-card';
import { AppShell } from '@/components/layout/app-shell';
import { StatTile } from '@/components/progress/stat-tile';
import { getDb } from '@/lib/db';
import { requireLearnerId } from '@/lib/guard';
import { getLearner } from '@/lib/learners';
import { buildSummary } from '@/lib/progress/summary';
import type { ProgressSummary } from '@/lib/progress/types';

/**
 * /home — the hub. Two doors: talk to Alex, or look at your progress.
 *
 * The summary strip above them is deliberately thin. This page's job is to get a learner into
 * a conversation in one tap; anything that invites them to stand here reading numbers instead
 * is working against it. The numbers that *do* appear are the ones that pull towards practising
 * — a streak you don't want to break, a level you want to move.
 */

export const dynamic = 'force-dynamic';

/** The one line under the greeting. It changes with how much we actually know about them. */
function statusLine(summary: ProgressSummary | null): string {
  if (!summary || summary.totals.sessions === 0) {
    return 'Have your first conversation with Alex and your progress starts building from there.';
  }
  if (summary.latestSummary) {
    return summary.latestSummary;
  }
  const { sessions } = summary.totals;
  return `${sessions} session${sessions === 1 ? '' : 's'} of practice so far. Keep going.`;
}

function SummaryStrip({ summary }: { summary: ProgressSummary }) {
  const { totals, level } = summary;

  return (
    <section
      aria-label="Your progress so far"
      className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4"
    >
      <StatTile
        label="Current level"
        value={level.band ?? '—'}
        hint={
          level.band
            ? level.isProvisional
              ? 'first impression'
              : 'CEFR estimate'
            : 'not enough to judge yet'
        }
      />
      <StatTile label="Sessions" value={String(totals.sessions)} />
      <StatTile
        label="Streak"
        value={`${totals.currentStreakDays} day${totals.currentStreakDays === 1 ? '' : 's'}`}
        hint="consecutive days practised"
      />
      <StatTile
        label="Practice time"
        value={`${totals.practiceMinutes} min`}
        hint={`${totals.wordsSpoken.toLocaleString()} words spoken`}
      />
    </section>
  );
}

/**
 * The database vanished after this learner signed in — /api/login refuses to hand out a session
 * without one, so this is only reachable if it went away underneath them.
 *
 * The tutor itself does not need the database, so the call button stays. Only progress is lost,
 * and saying so is better than a chart that renders as zeros.
 */
function NoDatabase() {
  return (
    <main className="bg-background grid min-h-svh place-content-center px-6 text-center">
      <h1 className="text-foreground text-xl font-semibold">Progress tracking is offline</h1>
      <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-sm leading-6">
        The tutor still works — this session just won&apos;t be recorded.
      </p>
      <Link
        href="/call"
        className="bg-primary text-primary-foreground mx-auto mt-6 rounded-full px-6 py-2.5 text-sm font-medium"
      >
        Talk to Alex anyway
      </Link>
    </main>
  );
}

export default async function HomePage() {
  const learnerId = await requireLearnerId();

  const sql = getDb();
  if (!sql) {
    return <NoDatabase />;
  }

  const learner = await getLearner(sql, learnerId);
  if (!learner) {
    // A validly-signed cookie naming a learner who no longer exists: the database was reset
    // under a live session. Signing in again mints a fresh row.
    redirect('/login');
  }

  const summary = await buildSummary(sql, learnerId);
  const hasHistory = (summary?.totals.sessions ?? 0) > 0;

  return (
    <AppShell learner={learner} active="home">
      <header className="mb-8">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight">
          {hasHistory ? 'Welcome back' : 'Welcome'}, {learner.displayName}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-prose text-sm leading-6">
          {statusLine(summary)}
        </p>
      </header>

      {summary && hasHistory && <SummaryStrip summary={summary} />}

      <section className="grid gap-4 md:grid-cols-2">
        <ActionCard
          href="/call"
          icon={MicrophoneIcon}
          emphasis="primary"
          title="Talk to Alex"
          description="Speak naturally about anything. Alex listens, replies, corrects you gently, and can look things up on the web."
          cta="Start a call"
        />
        <ActionCard
          href="/progress"
          icon={ChartLineUpIcon}
          title="Dashboard"
          description={
            hasHistory
              ? 'Your level, the mistakes worth fixing next, and how both have changed over time.'
              : 'Your level, weak areas and trends will appear here once you have practised.'
          }
          cta={hasHistory ? 'See your progress' : 'Take a look'}
        />
      </section>
    </AppShell>
  );
}
