'use client';

import { useMemo, useState } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react/dist/ssr';
import { ParameterCard } from '@/components/progress/parameter-card';
import { buildParameters, isGraded } from '@/lib/progress/analysis';
import { formatShortDate } from '@/lib/progress/dates';
import { SESSION_FILTERS, type SessionFilterKey, errorsForSessions } from '@/lib/progress/filters';
import { PARAMETER_GROUPS, formatterFor } from '@/lib/progress/parameters';
import type { ProgressSummary, SessionRow } from '@/lib/progress/types';

/**
 * The session explorer: filter the history to a window, open any single session, and see that
 * session's own numbers.
 *
 * NOTHING HERE IS A SECOND ANALYSIS. The per-session values are read straight out of the
 * already-computed parameter series (`parameters[*].points[i]` lines up with `sessions[i]`),
 * and the windowed cards re-run the SAME pure `buildParameters` over the filtered subset — so
 * this section is incapable of disagreeing with the full-history cards above it. The existing
 * sections are untouched: filtering scopes this section only, never the aggregates above,
 * which keeps "your level" meaning the same thing no matter which chip is pressed.
 *
 * A single session's numbers are noisy — the same topic effect estimateLevel documents — so
 * the detail view says so in words, and comparisons are always against the learner's own
 * typical value, never a target.
 */

/** Windowed cards need something to compare; below two sessions there is only a list. */
const MIN_WINDOW_FOR_CARDS = 2;

function FilterChips({
  active,
  onSelect,
}: {
  active: SessionFilterKey;
  onSelect: (key: SessionFilterKey) => void;
}) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Filter sessions"
    >
      {SESSION_FILTERS.map((filter) => {
        const isActive = filter.key === active;
        return (
          <button
            key={filter.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(filter.key)}
            className={
              isActive
                ? 'bg-primary text-primary-foreground rounded-full px-3.5 py-1.5 text-xs font-medium'
                : 'border-border text-muted-foreground hover:text-foreground rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors'
            }
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}

/** One parameter's value for one session, next to what is typical for this learner. */
function SessionValueTile({
  label,
  value,
  typical,
  format,
}: {
  label: string;
  value: number | null;
  typical: number | null;
  format: (value: number) => string;
}) {
  return (
    <li className="border-border rounded-lg border p-3">
      <div className="text-muted-foreground text-xs leading-4">{label}</div>
      <div className="text-card-foreground mt-1 text-lg leading-none font-semibold">
        {value !== null ? format(value) : '—'}
      </div>
      <div className="text-muted-foreground mt-1 text-[11px] leading-4">
        {value === null
          ? 'not measured — too little said'
          : typical !== null
            ? `typically ${format(typical)}`
            : ''}
      </div>
    </li>
  );
}

function SessionDetail({
  session,
  fullIndex,
  summary,
  typical,
}: {
  session: SessionRow;
  fullIndex: number;
  summary: ProgressSummary;
  typical: Map<string, number | null>;
}) {
  const corrections = summary.errors.filter((error) => error.session_id === session.id);

  // Registry parameters only: the running total is meaningless for one session, and the
  // per-mistake counts are better told by the actual corrections underneath.
  const tiles = summary.parameters.filter(
    (parameter) => parameter.group !== 'mistakes' && !parameter.cumulative
  );

  return (
    <div className="border-border border-t px-4 pt-3 pb-4">
      {session.summary && (
        <p className="text-muted-foreground mb-3 max-w-prose text-sm leading-6">
          {session.summary}
        </p>
      )}

      <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
        {tiles.map((parameter) => (
          <SessionValueTile
            key={parameter.key}
            label={parameter.label}
            value={parameter.points[fullIndex]?.value ?? null}
            typical={typical.get(parameter.key) ?? null}
            format={formatterFor(parameter.key)}
          />
        ))}
      </ul>

      {corrections.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-card-foreground mb-2 text-xs font-semibold">
            Corrections from this session
          </h4>
          <ul className="divide-border border-border divide-y rounded-lg border">
            {corrections.map((correction, index) => (
              <li key={index} className="p-3">
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
        </div>
      ) : (
        <p className="text-muted-foreground mt-4 text-xs leading-5">
          {isGraded(session)
            ? 'No corrections recorded — this session was graded clean.'
            : 'This session was too short to grade, so there is no grammar read for it.'}
        </p>
      )}

      <p className="text-muted-foreground mt-3 text-[11px] leading-4">
        One session&apos;s numbers swing with the topic — the trends above are the fairer read.
        &ldquo;Typically&rdquo; is your own average across every measured session.
      </p>
    </div>
  );
}

function SessionListItem({
  session,
  fullIndex,
  summary,
  typical,
  open,
  onToggle,
}: {
  session: SessionRow;
  fullIndex: number;
  summary: ProgressSummary;
  typical: Map<string, number | null>;
  open: boolean;
  onToggle: () => void;
}) {
  const minutes = Math.max(1, Math.round(session.duration_seconds / 60));
  const graded = isGraded(session);

  const meta = [
    `${minutes} min`,
    `${session.word_count.toLocaleString()} words`,
    graded
      ? `${session.error_count} correction${session.error_count === 1 ? '' : 's'}`
      : 'too short to grade',
  ];
  if (session.cefr_estimate) {
    meta.push(`read as ${session.cefr_estimate}`);
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 p-4 text-left transition-colors"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-card-foreground text-sm font-semibold">
              Session #{fullIndex + 1}
            </span>
            <span className="text-muted-foreground text-xs">
              {formatShortDate(session.started_at)}
            </span>
          </div>
          <div className="text-muted-foreground mt-0.5 text-[11px] leading-4">
            {meta.join(' · ')}
          </div>
        </div>
        <CaretDownIcon
          className={`text-muted-foreground size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <SessionDetail
          session={session}
          fullIndex={fullIndex}
          summary={summary}
          typical={typical}
        />
      )}
    </li>
  );
}

export function SessionExplorer({ summary }: { summary: ProgressSummary }) {
  const [filterKey, setFilterKey] = useState<SessionFilterKey>('all');
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  // Fixed at first render so the date filters cannot straddle midnight mid-interaction. The
  // default filter is 'all', which never reads it — so the server-rendered HTML never depends
  // on the clock and hydration stays deterministic.
  const [now] = useState(() => new Date());

  const filter =
    SESSION_FILTERS.find((candidate) => candidate.key === filterKey) ?? SESSION_FILTERS[0];
  const filtered = useMemo(
    () => filter.apply(summary.sessions, now),
    [filter, summary.sessions, now]
  );

  // Full-history index by session id: the session number a learner sees here must match the
  // #index on every chart axis, whatever the filter shows.
  const indexById = useMemo(
    () => new Map(summary.sessions.map((session, index) => [session.id, index])),
    [summary.sessions]
  );

  // Each parameter's mean across every measured session — the "typically" in the detail view.
  const typical = useMemo(
    () =>
      new Map(
        summary.parameters.map((parameter) => {
          const known = parameter.points
            .map((point) => point.value)
            .filter((value): value is number => value !== null);
          return [
            parameter.key,
            known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null,
          ] as const;
        })
      ),
    [summary.parameters]
  );

  // The same cards as the main dashboard, re-run over only the window. Cumulative totals are
  // excluded: "vocabulary size" restarted from zero inside a window would read as a collapse.
  const windowParameters = useMemo(() => {
    if (filterKey === 'all' || filtered.length < MIN_WINDOW_FOR_CARDS) {
      return null;
    }
    const windowErrors = errorsForSessions(summary.errors, filtered);

    // Every filter keeps a contiguous tail of the history, so the charts can keep the
    // learner's real session numbers: session #23 must be #23 on every axis on the page,
    // not #1 because a filter happens to be active.
    const offset = indexById.get(filtered[0].id) ?? 0;

    return buildParameters(filtered, windowErrors)
      .filter((parameter) => !parameter.cumulative)
      .map((parameter) => ({
        ...parameter,
        points: parameter.points.map((point) => ({
          ...point,
          sessionIndex: point.sessionIndex + offset,
        })),
      }));
  }, [filterKey, filtered, summary.errors, indexById]);

  const newestFirst = useMemo(() => [...filtered].reverse(), [filtered]);

  const windowMinutes = Math.round(
    filtered.reduce((total, session) => total + session.duration_seconds, 0) / 60
  );
  const windowWords = filtered.reduce((total, session) => total + session.word_count, 0);

  return (
    <section className="mb-8">
      <h2 className="text-foreground mb-1 text-lg font-semibold">Session by session</h2>
      <p className="text-muted-foreground mb-4 max-w-prose text-sm leading-6">
        Every session you&apos;ve had, newest first. Open one to see its own numbers next to what is
        typical for you — or narrow the view to a recent stretch.
      </p>

      <FilterChips active={filterKey} onSelect={setFilterKey} />

      {filterKey !== 'all' && (
        <p className="text-muted-foreground mb-4 text-sm">
          {filtered.length === 0
            ? 'No sessions in this range.'
            : `Showing ${filtered.length} of ${summary.sessions.length} sessions — ${windowMinutes} min, ${windowWords.toLocaleString()} words.`}
        </p>
      )}

      {newestFirst.length > 0 && (
        <ul className="divide-border bg-card border-border divide-y rounded-xl border">
          {newestFirst.map((session) => (
            <SessionListItem
              key={session.id}
              session={session}
              fullIndex={indexById.get(session.id) ?? 0}
              summary={summary}
              typical={typical}
              open={openSessionId === session.id}
              onToggle={() =>
                setOpenSessionId((current) => (current === session.id ? null : session.id))
              }
            />
          ))}
        </ul>
      )}

      {windowParameters && (
        <div className="mt-8">
          <h3 className="text-foreground mb-1 text-base font-semibold">This window at a glance</h3>
          <p className="text-muted-foreground mb-4 max-w-prose text-sm leading-6">
            The same cards as above, computed over only the {filtered.length} sessions shown here —
            so &ldquo;improved&rdquo; means improved within this window, not since you started.
          </p>

          {PARAMETER_GROUPS.map((group) => {
            const parameters = windowParameters.filter(
              (parameter) => parameter.group === group.key
            );
            if (parameters.length === 0) {
              return null;
            }
            return (
              <div key={group.key} className="mb-6">
                <h4 className="text-foreground mb-2 text-sm font-semibold">{group.title}</h4>
                <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {parameters.map((parameter) => (
                    <ParameterCard
                      key={parameter.key}
                      parameter={parameter}
                      sinceSuffix={`across these ${filtered.length} sessions`}
                      recentSuffix="in the latest of them"
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
