'use client';

import { useState } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import {
  ArrowsHorizontalIcon,
  CaretDownIcon,
  CheckCircleIcon,
  EqualsIcon,
  WarningIcon,
} from '@phosphor-icons/react/dist/ssr';
import { TrendChart } from '@/components/progress/trend-chart';
import { formatterFor } from '@/lib/progress/parameters';
import type { ParameterDelta, ParameterSummary } from '@/lib/progress/types';

/**
 * One tracked parameter: where you are now, how far you have come, and whether you are still
 * moving. Expands into the full chart.
 *
 * The three questions are answered in that order on purpose — it is the order a learner asks
 * them, and a learner who reads only the first line still gets the useful part.
 *
 * VERDICT COLOUR NEVER TRAVELS ALONE. Same rule as the weakness cards: every chip carries an
 * icon AND a word, so the meaning survives for the roughly one man in twelve who cannot reliably
 * separate the red from the green. Colour is a redundant third channel here, not the carrier.
 */

const VERDICT: Record<
  ParameterDelta['verdict'],
  { word: string; color: string; Icon: typeof WarningIcon }
> = {
  improved: { word: 'Improved', color: 'var(--viz-good)', Icon: CheckCircleIcon },
  slipped: { word: 'Slipped', color: 'var(--viz-warning)', Icon: WarningIcon },
  steady: { word: 'Holding steady', color: 'var(--viz-axis)', Icon: EqualsIcon },
  // Pace, sentence length, self-correction: the number moved, and it is not our place to call
  // that good or bad. Neutral colour, neutral word, no praise and no scolding.
  moved: { word: 'Changed', color: 'var(--viz-axis)', Icon: ArrowsHorizontalIcon },
};

function DeltaChip({
  delta,
  parameterKey,
  suffix,
}: {
  delta: ParameterDelta;
  parameterKey: string;
  suffix: string;
}) {
  const { word, color, Icon } = VERDICT[delta.verdict];
  const format = formatterFor(parameterKey);

  // A percentage where one is honest; otherwise the two ends themselves. An ordinal band scale
  // and a baseline of zero both make "improved 40%" meaningless, and the from → to form says
  // the same thing without inventing arithmetic.
  const magnitude =
    delta.verdict === 'steady'
      ? ''
      : delta.change !== null
        ? ` ${Math.abs(Math.round(delta.change * 100))}%`
        : ` — ${format(delta.from)} → ${format(delta.to)}`;

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] leading-4 font-medium">
      <Icon weight="fill" className="size-3.5 shrink-0" style={{ color }} aria-hidden />
      <span style={{ color }}>
        {word}
        {magnitude}
      </span>
      <span className="text-muted-foreground font-normal">{suffix}</span>
    </span>
  );
}

/** The sparkline. Trend only — the raw scatter belongs in the expanded chart, not in 40 pixels. */
function Sparkline({ parameter }: { parameter: ParameterSummary }) {
  if (parameter.knownCount < 2) {
    return <div className="h-10" />;
  }

  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={parameter.points} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <Line
            type="monotone"
            dataKey="smoothed"
            stroke="var(--viz-series)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ParameterCard({ parameter }: { parameter: ParameterSummary }) {
  const [expanded, setExpanded] = useState(false);
  const format = formatterFor(parameter.key);

  return (
    <li className="bg-card border-border rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-card-foreground text-sm font-semibold">{parameter.label}</h3>

          <div className="text-card-foreground mt-1.5 text-2xl leading-none font-semibold">
            {parameter.current !== null ? format(parameter.current) : '—'}
          </div>

          {/* "Now" is an average of the last three sessions, not the last session. Said out loud,
              because a learner who compares this against the final dot on the chart and finds
              they differ deserves to know why rather than to lose faith in both. */}
          <div className="text-muted-foreground mt-1 text-[11px] leading-4">
            {parameter.cumulative
              ? 'total so far'
              : parameter.knownCount > 0
                ? `average of your last ${Math.min(3, parameter.knownCount)} session${Math.min(3, parameter.knownCount) === 1 ? '' : 's'}`
                : 'not measured yet'}
          </div>
        </div>

        <Sparkline parameter={parameter} />
      </div>

      <div className="mt-3 space-y-1.5">
        {/* The headline: am I better than when I began. */}
        {parameter.sinceStart && (
          <div>
            <DeltaChip
              delta={parameter.sinceStart}
              parameterKey={parameter.key}
              suffix="since you started"
            />
          </div>
        )}

        {/* And the follow-up a learner asks the moment they believe the first: am I still moving,
            or have I settled here? A plateau is invisible to the since-you-started number, which
            keeps reporting an old victory forever. */}
        {parameter.recent && (
          <div>
            <DeltaChip
              delta={parameter.recent}
              parameterKey={parameter.key}
              suffix="in your recent sessions"
            />
          </div>
        )}

        {parameter.gate && (
          <p className="text-muted-foreground text-[11px] leading-4">{parameter.gate}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="text-muted-foreground hover:text-card-foreground mt-3 inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
      >
        {expanded ? 'Hide' : 'Show'} chart
        <CaretDownIcon
          className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="mt-3">
          <p className="text-muted-foreground mb-3 text-xs leading-5">{parameter.caption}</p>
          <TrendChart parameter={parameter} />
        </div>
      )}
    </li>
  );
}
