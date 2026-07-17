'use client';

import { Fragment, useMemo } from 'react';
import { DeltaChip } from '@/components/progress/parameter-card';
import { Card } from '@/components/ui/card';
import { buildGroupReport } from '@/lib/progress/analysis';
import { formatShortDate } from '@/lib/progress/dates';
import { PARAMETER_GROUPS, formatterFor } from '@/lib/progress/parameters';
import type { GroupedParameter, ParameterSummary, SessionGroup } from '@/lib/progress/types';

/**
 * The trajectory report: the learner's history in sequential groups of sessions, one row per
 * parameter — the view that says whether each stretch of practice beat the one before, which
 * session-to-session lines are too noisy to answer.
 *
 * TABLE FIRST, BARS SECOND. The numbers are the content and are rendered as text in text
 * colours; the bar under each value is a redundant visual channel for scanning, scaled within
 * its own row. Identity and verdict never ride on colour alone — the verdict chip carries an
 * icon and a word (same rule as everywhere else on this page), and the bars are all the one
 * series colour because every row is a single measure of a single learner.
 *
 * A missing cell is "—", not an empty bar: a group where nothing could be measured is an
 * unknown, and drawing a zero-length bar would read as a zero. Same rule as the charts.
 */

/** Bar length as a share of the row's own scale. Ordinal (CEFR) rows use the fixed 6-band scale. */
function barFraction(value: number, rowMax: number, ordinal: boolean): number {
  const max = ordinal ? 6 : rowMax;
  if (max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, value / max));
}

function ValueCell({ parameter, index }: { parameter: GroupedParameter; index: number }) {
  const value = parameter.values[index];
  const format = formatterFor(parameter.key);

  if (value === null) {
    return (
      <td className="px-3 py-2.5 align-top">
        <span
          className="text-muted-foreground text-sm"
          title="Nothing in these sessions was long enough to measure"
        >
          —
        </span>
      </td>
    );
  }

  const rowMax = Math.max(...parameter.values.filter((v): v is number => v !== null));
  const fraction = barFraction(value, rowMax, parameter.ordinal);

  return (
    <td className="px-3 py-2.5 align-top">
      <div className="text-card-foreground text-sm font-medium tabular-nums">{format(value)}</div>
      <div
        className="mt-1 h-1 w-full max-w-16 rounded-full"
        style={{ background: 'var(--viz-grid)' }}
        aria-hidden
      >
        <div
          className="h-1 rounded-full"
          style={{ width: `${Math.round(fraction * 100)}%`, background: 'var(--viz-series)' }}
        />
      </div>
    </td>
  );
}

function ParameterRow({
  parameter,
  groups,
}: {
  parameter: GroupedParameter;
  groups: SessionGroup[];
}) {
  return (
    <tr className="border-border border-b last:border-b-0">
      <td className="text-card-foreground px-3 py-2.5 align-top text-sm">{parameter.label}</td>
      {groups.map((group, index) => (
        <ValueCell key={group.label} parameter={parameter} index={index} />
      ))}
      <td className="px-3 py-2.5 align-top">
        {parameter.delta ? (
          <DeltaChip delta={parameter.delta} parameterKey={parameter.key} suffix="" />
        ) : (
          <span className="text-muted-foreground text-[11px]">
            {parameter.cumulative ? 'running total' : 'not enough data'}
          </span>
        )}
      </td>
    </tr>
  );
}

export function TrajectoryReport({ parameters }: { parameters: ParameterSummary[] }) {
  const report = useMemo(() => buildGroupReport(parameters), [parameters]);

  return (
    <section className="mb-8">
      <h2 className="text-foreground mb-1 text-lg font-semibold">Your trajectory</h2>
      <p className="text-muted-foreground mb-4 max-w-prose text-sm leading-6">
        {report ? (
          <>
            Your sessions in groups of {report.groupSize}, oldest on the left. Each cell is that
            group&apos;s average, so a single unusual session can&apos;t bend the story —{' '}
            <span className="text-foreground font-medium">overall</span> compares your first group
            against your latest one with data.
          </>
        ) : (
          <>Whether each stretch of practice beat the one before it.</>
        )}
      </p>

      {report === null ? (
        <Card className="p-6">
          <p className="text-muted-foreground text-sm leading-6">
            This view groups your history into runs of five sessions and compares them — it needs
            more than five sessions before there are two groups to compare. Keep practising and it
            will fill in by itself.
          </p>
        </Card>
      ) : (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-border border-b">
                <th className="text-muted-foreground px-3 py-3 text-xs font-medium">Parameter</th>
                {report.groups.map((group) => (
                  <th key={group.label} className="px-3 py-3">
                    <div className="text-card-foreground text-xs font-semibold whitespace-nowrap">
                      Sessions {group.label}
                    </div>
                    <div className="text-muted-foreground text-[10px] font-normal whitespace-nowrap">
                      {formatShortDate(group.startDate)}
                      {group.startDate.slice(0, 10) === group.endDate.slice(0, 10)
                        ? ''
                        : ` – ${formatShortDate(group.endDate)}`}
                    </div>
                  </th>
                ))}
                <th className="text-muted-foreground px-3 py-3 text-xs font-medium">Overall</th>
              </tr>
            </thead>
            <tbody>
              {PARAMETER_GROUPS.map((group) => {
                const rows = report.parameters.filter((parameter) => parameter.group === group.key);
                if (rows.length === 0) {
                  return null;
                }
                return (
                  <Fragment key={group.key}>
                    <tr className="border-border border-b">
                      <th
                        colSpan={report.groups.length + 2}
                        className="text-muted-foreground bg-muted/40 px-3 py-2 text-left text-[11px] font-semibold tracking-wide uppercase"
                      >
                        {group.title}
                      </th>
                    </tr>
                    {rows.map((parameter) => (
                      <ParameterRow
                        key={parameter.key}
                        parameter={parameter}
                        groups={report.groups}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {report !== null && (
        <p className="text-muted-foreground mt-2 text-[11px] leading-4">
          A dash means nothing in that group was long enough to measure — it is a gap, not a zero.
          Bars are scaled within each row, for shape only; the numbers are the measurement.
        </p>
      )}
    </section>
  );
}
