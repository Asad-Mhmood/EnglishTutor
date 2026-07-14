'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendPoint } from '@/lib/progress/types';

/**
 * A single-series trend over sessions.
 *
 * SINGLE series, always. Two measures on one chart would need two y-scales, and a dual-axis
 * chart lets you manufacture any correlation you like by sliding one axis — it is the single
 * most misleading thing you can put on a dashboard. Two measures means two of these.
 *
 * Nulls are gaps, not zeros. `connectNulls={false}` is load-bearing: an ungraded session has
 * an *unknown* error rate, and joining the line straight across it would draw a confident
 * trend through the exact point where we knew nothing. The gap is the honest rendering.
 */

export interface TrendChartProps {
  title: string;
  /** What the number means, in plain words. Shown under the title — never make them guess. */
  caption: string;
  data: TrendPoint[];
  dataKey: keyof TrendPoint;
  /** True when going down is good (error rate, hesitations). Flips the delta's colour. */
  lowerIsBetter?: boolean;
  format?: (value: number) => string;
  domain?: [number | 'auto', number | 'auto'];
}

const AXIS_STYLE = {
  fontSize: 11,
  fill: 'var(--viz-axis)',
} as const;

function defaultFormat(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function TrendChart({
  title,
  caption,
  data,
  dataKey,
  lowerIsBetter = false,
  format = defaultFormat,
  domain = ['auto', 'auto'],
}: TrendChartProps) {
  // Every session stays in `points`, including the ones with a null value — that is what
  // renders the gap. `known` is only used to decide whether there is enough to plot at all.
  const points = data.map((point) => ({
    sessionIndex: point.sessionIndex,
    date: point.date,
    value: point[dataKey] as number | null,
  }));

  const known = points.filter((p): p is typeof p & { value: number } => p.value !== null);

  // Two points is the minimum for a line to mean anything. Below that, say so rather than
  // drawing a single dot and letting it imply a trend.
  if (known.length < 2) {
    return (
      <figure className="bg-card border-border rounded-xl border p-5">
        <figcaption className="mb-1">
          <h3 className="text-card-foreground text-sm font-semibold">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-4">{caption}</p>
        </figcaption>
        <div className="text-muted-foreground flex h-40 items-center justify-center text-center text-xs">
          {known.length === 0
            ? 'Nothing to show yet.'
            : 'One session so far — practise again to see a trend.'}
        </div>
      </figure>
    );
  }

  const first = known[0].value;
  const last = known[known.length - 1].value;
  const delta = last - first;
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const unchanged = Math.abs(delta) < 1e-9;

  return (
    <figure className="bg-card border-border rounded-xl border p-5">
      <figcaption className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-card-foreground text-sm font-semibold">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-4">{caption}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-card-foreground text-lg leading-none font-semibold">
            {format(last)}
          </div>
          {/* Words, not arrows, and not colour alone.
              An arrow would fight the line: on the accuracy chart the good direction is DOWN,
              so "↑ improving" would point the opposite way to the improving line it labels.
              The word says what happened; colour is a redundant third channel, so colourblind
              users and screen readers lose nothing. */}
          {!unchanged && (
            <div
              className="mt-1 text-[11px] leading-none font-medium"
              style={{ color: improved ? 'var(--viz-good)' : 'var(--viz-axis)' }}
            >
              {improved ? 'improving' : 'slipping'}
            </div>
          )}
        </div>
      </figcaption>

      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="sessionIndex"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: 'var(--viz-grid)' }}
              tickFormatter={(v) => `#${v}`}
            />
            <YAxis
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={44}
              domain={domain}
              tickFormatter={(v: number) => format(v)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
              contentStyle={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--popover-foreground)',
              }}
              labelFormatter={(v) => `Session ${v}`}
              formatter={(value) => [format(Number(value)), title] as [string, string]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--viz-series)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--viz-series)', strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }}
              // A gap means "we don't know", not "it was zero". Never bridge it.
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
