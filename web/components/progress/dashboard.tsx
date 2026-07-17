'use client';

import Link from 'next/link';
import { ParameterCard } from '@/components/progress/parameter-card';
import { SessionExplorer } from '@/components/progress/session-explorer';
import { StatTile } from '@/components/progress/stat-tile';
import { TrajectoryReport } from '@/components/progress/trajectory-report';
import { StrengthCard, WeaknessCard } from '@/components/progress/weakness-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PARAMETER_GROUPS } from '@/lib/progress/parameters';
import { CEFR_LEVELS, type ParameterSummary, type ProgressSummary } from '@/lib/progress/types';

/**
 * The dashboard. Rendering only — every number on this page was decided in
 * lib/progress/analysis.ts, and nothing here computes anything beyond formatting.
 *
 * The page answers three questions, in this order, because that is the order a learner
 * actually asks them:
 *
 *   1. Where am I?            → the level band, and the honest confidence in it
 *   2. What should I fix?     → weak areas, regressions first
 *   3. Am I getting better?   → the trend charts
 *
 * A learner who only reads the first screen still gets the useful part.
 *
 * Rendered inside AppShell, which owns the page frame — the width, padding and header live
 * there, not here.
 */

const LEVEL_BLURB: Record<string, string> = {
  A1: 'Just starting — words and set phrases.',
  A2: 'Simple sentences on familiar topics.',
  B1: 'You can hold a conversation and cope when it goes off-script.',
  B2: 'Fluent and spontaneous; you can argue a point.',
  C1: 'Precise and flexible, with real subtlety.',
  C2: 'Effortless and idiomatic.',
};

function LevelCard({ summary }: { summary: ProgressSummary }) {
  const { level } = summary;

  if (!level.band) {
    return (
      <Card className="p-6">
        <h2 className="text-card-foreground text-sm font-semibold">Your level</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Not enough to go on yet. Have a proper conversation with Ahmad — a few minutes of real
          talking — and an estimate will appear here.
        </p>
      </Card>
    );
  }

  const percent = Math.round(level.confidence * 100);

  return (
    <Card className="p-6">
      <h2 className="text-card-foreground text-sm font-semibold">Your level</h2>

      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-card-foreground text-5xl leading-none font-semibold tracking-tight">
          {level.band}
        </span>
        <span className="text-muted-foreground text-sm">{LEVEL_BLURB[level.band]}</span>
      </div>

      {/* The CEFR scale, with the learner's position marked. A bare "B1" means nothing to
          someone who has never met the CEFR scale — which is most people. */}
      <div className="mt-5 flex gap-1" aria-hidden>
        {CEFR_LEVELS.map((band) => {
          const reached = level.numeric !== null && CEFR_LEVELS.indexOf(band) + 1 <= level.numeric;
          return (
            <div key={band} className="flex-1">
              <div
                className="h-1.5 rounded-full"
                style={{
                  background: reached ? 'var(--viz-series)' : 'var(--viz-grid)',
                }}
              />
              <div
                className="mt-1.5 text-center text-[10px] font-medium"
                style={{
                  color: band === level.band ? 'var(--viz-series)' : 'var(--viz-axis)',
                }}
              >
                {band}
              </div>
            </div>
          );
        })}
      </div>

      {/* Confidence is stated, not buried. An estimate from two short sessions is a guess, and
          saying so is what makes the number worth anything at all. */}
      <p className="text-muted-foreground mt-4 text-xs leading-5">
        {level.isProvisional ? (
          <>
            <span className="text-card-foreground font-medium">First impression only</span> — based
            on {level.gradedSessions} graded session
            {level.gradedSessions === 1 ? '' : 's'}. This will move around until you&apos;ve
            practiced a few more times.
          </>
        ) : (
          <>
            Based on {level.gradedSessions} graded sessions, weighted towards your recent ones.
            Confidence: {percent}%.
          </>
        )}
      </p>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-foreground text-xl font-semibold">No practice yet</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-6">
        Have your first conversation with Ahmad and your progress will show up here — your level,
        the mistakes worth fixing, and how both change over time.
      </p>
      <Button asChild size="lg" className="mt-6 rounded-full">
        <Link href="/call">Start talking</Link>
      </Button>
    </div>
  );
}

/**
 * One group of parameters — Accuracy, Vocabulary, Delivery, and so on.
 *
 * Grouped, and collapsed to cards rather than laid out as a wall of full-size charts. There are
 * thirteen parameters plus one per kind of mistake; thirteen charts is a page nobody scrolls to
 * the bottom of, and a parameter nobody reads is worth exactly as much as one nobody records.
 * The card carries the answer — where you are, how far you have come — and the chart is one
 * click away for the learner who wants to see the working.
 */
function ParameterGroupSection({
  title,
  blurb,
  parameters,
}: {
  title: string;
  blurb: string;
  parameters: ParameterSummary[];
}) {
  if (parameters.length === 0) {
    return null;
  }

  return (
    <section className="mb-8">
      <h3 className="text-foreground mb-1 text-base font-semibold">{title}</h3>
      <p className="text-muted-foreground mb-4 max-w-prose text-sm leading-6">{blurb}</p>
      <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {parameters.map((parameter) => (
          <ParameterCard key={parameter.key} parameter={parameter} />
        ))}
      </ul>
    </section>
  );
}

export function Dashboard({ summary }: { summary: ProgressSummary }) {
  const { totals, parameters, strengths, weaknesses, recentCorrections, dataQuality } = summary;

  if (totals.sessions === 0) {
    return <EmptyState />;
  }

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">Your progress</h1>
          {summary.latestSummary && (
            <p className="text-muted-foreground mt-2 max-w-prose text-sm leading-6">
              {summary.latestSummary}
            </p>
          )}
        </div>
        <Button asChild className="rounded-full">
          <Link href="/call">Practice again</Link>
        </Button>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Sessions" value={String(totals.sessions)} />
        <StatTile
          label="Practice time"
          value={`${totals.practiceMinutes} min`}
          hint={`${totals.wordsSpoken.toLocaleString()} words spoken`}
        />
        <StatTile
          label="Vocabulary"
          value={totals.vocabularySize.toLocaleString()}
          hint="distinct words you've used"
        />
        <StatTile
          label="Streak"
          value={`${totals.currentStreakDays} day${totals.currentStreakDays === 1 ? '' : 's'}`}
          hint="consecutive days practiced"
        />
      </section>

      <section className="mb-8">
        <LevelCard summary={summary} />
      </section>

      {weaknesses.length > 0 && (
        <section className="mb-8">
          <h2 className="text-foreground mb-1 text-lg font-semibold">Work on this next</h2>
          <p className="text-muted-foreground mb-4 text-sm leading-6">
            Ordered by what matters most. Anything you&apos;d fixed and have started doing again
            comes first.
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {weaknesses.slice(0, 6).map((weakness) => (
              <WeaknessCard key={`${weakness.category}-${weakness.label}`} weakness={weakness} />
            ))}
          </ul>
        </section>
      )}

      {strengths.length > 0 && (
        <section className="mb-8">
          <h2 className="text-foreground mb-4 text-lg font-semibold">What&apos;s going well</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {strengths.slice(0, 4).map((strength) => (
              <StrengthCard key={strength.label} strength={strength} />
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-foreground mb-1 text-lg font-semibold">Everything you can track</h2>
        <p className="text-muted-foreground mb-6 max-w-prose text-sm leading-6">
          Each card compares you against your own earlier sessions — never against other learners,
          and never against a target. Two numbers, because they answer different questions:{' '}
          <span className="text-foreground font-medium">since you started</span> is whether you are
          better than when you began, and{' '}
          <span className="text-foreground font-medium">in your recent sessions</span> is whether
          you are still moving or have settled where you are.
        </p>

        {PARAMETER_GROUPS.map((group) => (
          <ParameterGroupSection
            key={group.key}
            title={group.title}
            blurb={group.blurb}
            parameters={parameters.filter((parameter) => parameter.group === group.key)}
          />
        ))}
      </section>

      <TrajectoryReport parameters={parameters} />

      <SessionExplorer summary={summary} />

      {recentCorrections.length > 0 && (
        <section className="mb-8">
          <h2 className="text-foreground mb-4 text-lg font-semibold">Recent corrections</h2>
          <ul className="divide-border bg-card border-border divide-y rounded-xl border">
            {recentCorrections.map((correction, index) => (
              <li key={index} className="p-4">
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="text-muted-foreground line-through decoration-1">
                    {correction.learner_text}
                  </span>
                  <span className="text-muted-foreground text-xs">→</span>
                  <span className="text-card-foreground font-medium">
                    {correction.corrected_text}
                  </span>
                </div>
                {correction.explanation && (
                  <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                    {correction.explanation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        The honesty footer. Grammar scoring runs on a speech-to-text transcript, and Whisper
        both repairs some mistakes and invents others. A learner who sees a correction they
        know they didn't say deserves to understand why, instead of concluding the tutor is
        broken — and a learner acting on these numbers deserves to know what they rest on.
      */}
      <footer className="text-muted-foreground border-border border-t pt-6 text-xs leading-5">
        <p className="max-w-prose">
          <span className="text-foreground font-medium">How this is measured.</span> Ahmad scores
          what the speech recogniser heard, so an occasional &ldquo;mistake&rdquo; may be a
          mis-hearing rather than something you said — if one looks wrong, it probably is. Pace and
          vocabulary numbers are counted directly from your words and are exact. Pronunciation is{' '}
          <em>not</em> scored: this measures what you said, not how it sounded.
        </p>
        {dataQuality.ungradedSessions > 0 && (
          <p className="mt-2 max-w-prose">
            {dataQuality.ungradedSessions} of your {totals.sessions} sessions were too short to
            score for grammar, so they appear as gaps in the accuracy chart.
          </p>
        )}
      </footer>
    </div>
  );
}
