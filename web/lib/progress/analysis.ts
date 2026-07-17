import { cefrToNumber, numberToCefr } from './cefr';
import { PARAMETERS, type ParameterSpec, type SeriesContext, describerFor } from './parameters';
import taxonomy from './taxonomy.json';
import {
  type CefrLevel,
  type ErrorRow,
  type GroupReport,
  type GroupedParameter,
  type LevelEstimate,
  type ParameterDelta,
  type ParameterPoint,
  type ParameterSummary,
  type SessionGroup,
  type SessionRow,
  type Strength,
  type TrendPoint,
  type Weakness,
  type WeaknessStatus,
} from './types';

/**
 * Analysis for the dashboard: turn rows into the things a learner actually wants to know.
 *
 * Every function here is pure — rows in, summary out. No database, no React. That is what
 * lets the scoring rules be reasoned about (and changed) without touching either.
 *
 * The Python side scores a *single session*. This side scores a *history*, which is where
 * the interesting questions live: are you getting better, and has anything you fixed come
 * back? Those cannot be answered from one session, which is precisely why they cannot be
 * answered by a chatbot with no memory.
 */

interface TaxonomyEntry {
  key: string;
  label: string;
  hint: string;
  advice: string;
}

// Generated from progress/taxonomy.json by scripts/sync_taxonomy.py. Do not edit by hand.
const CATEGORIES = new Map<string, TaxonomyEntry>(
  (taxonomy.categories as TaxonomyEntry[]).map((c) => [c.key, c])
);

/** Unknown keys degrade to the raw key rather than throwing — see the sync script's note. */
function labelFor(key: string): string {
  return CATEGORIES.get(key)?.label ?? key;
}

function adviceFor(key: string): string {
  return CATEGORIES.get(key)?.advice ?? 'Keep practicing this in conversation.';
}

// ---------------------------------------------------------------------------
// CEFR
// ---------------------------------------------------------------------------

/**
 * How fast older sessions stop counting. 0.7 means the previous session carries ~70% of the
 * weight of the latest, the one before ~49%, and so on — recent work dominates without a
 * single bad day erasing months of history.
 */
const CEFR_DECAY = 0.7;

/** Below this many graded sessions the estimate is shown, but flagged as a first impression. */
const PROVISIONAL_BELOW = 3;

/**
 * A session the grader reached. An ungraded session is one we know *nothing* about, and it must
 * never be read as "no errors" — that would show every learner fixing everything on the day the
 * grader happened to time out.
 */
export function isGraded(session: SessionRow): boolean {
  return (
    session.cefr_estimate !== null ||
    session.errors_per_100_words !== null ||
    session.error_count > 0
  );
}

/**
 * Smooth the per-session CEFR guesses into one estimate.
 *
 * WHY THIS IS NOT JUST "the latest session's level".
 *
 * A single session's estimate is genuinely noisy — the same learner can read as A2 on a day
 * they discuss the weather and B2 on a day they argue about politics, because the topic, not
 * the learner, changed what they had to demonstrate. Showing that raw number would produce a
 * level that jumps around every few days, and a learner watching their level fall after a
 * good conversation would rightly conclude the whole dashboard is nonsense.
 *
 * So each session is weighted by two things: how confident the grader was (which is mostly a
 * function of how much the learner actually said), and how recent it is. The result moves
 * when the learner moves, and ignores a quiet Tuesday.
 *
 * `sessions` must be newest-first.
 */
export function estimateLevel(sessions: SessionRow[]): LevelEstimate {
  const graded = sessions.filter(
    (s): s is SessionRow & { cefr_estimate: CefrLevel } => s.cefr_estimate !== null
  );

  if (graded.length === 0) {
    return {
      band: null,
      numeric: null,
      confidence: 0,
      gradedSessions: 0,
      isProvisional: true,
    };
  }

  let weightedSum = 0;
  let weightTotal = 0;

  graded.forEach((session, index) => {
    // A floor of 0.1 on confidence: a grader that reported near-zero confidence still knows
    // more than nothing, and a weight of exactly 0 would silently drop the session.
    const confidence = Math.max(session.cefr_confidence ?? 0.5, 0.1);
    const weight = confidence * Math.pow(CEFR_DECAY, index);

    weightedSum += cefrToNumber(session.cefr_estimate) * weight;
    weightTotal += weight;
  });

  const numeric = weightedSum / weightTotal;

  // Overall confidence blends the graders' own confidence with how much evidence exists.
  // Three sessions of confident grading is a real estimate; one is a guess, however
  // confidently the model asserted it.
  const meanGraderConfidence =
    graded.reduce((sum, s) => sum + (s.cefr_confidence ?? 0.5), 0) / graded.length;
  const evidenceFactor = Math.min(graded.length / PROVISIONAL_BELOW, 1);

  return {
    band: numberToCefr(numeric),
    numeric: Number(numeric.toFixed(2)),
    confidence: Number((meanGraderConfidence * evidenceFactor).toFixed(2)),
    gradedSessions: graded.length,
    isProvisional: graded.length < PROVISIONAL_BELOW,
  };
}

// ---------------------------------------------------------------------------
// Weak areas
// ---------------------------------------------------------------------------

/** How many recent sessions the 'persistent' test looks back over. */
const PERSISTENCE_WINDOW = 5;
const PERSISTENCE_THRESHOLD = 3;

/** A category absent this many recent sessions counts as improving, not weak. */
const IMPROVED_AFTER_CLEAN_SESSIONS = 2;

/**
 * Classify every error category by what it has been doing over time.
 *
 * `sessions` must be OLDEST-first here — the ordering is the whole analysis.
 */
export function analyseWeaknesses(
  sessions: SessionRow[],
  errors: ErrorRow[]
): { weaknesses: Weakness[]; improving: Strength[] } {
  // Only graded sessions can carry evidence about errors.
  const graded = sessions.filter(isGraded);

  if (graded.length === 0) {
    return { weaknesses: [], improving: [] };
  }

  const sessionOrder = new Map(graded.map((s, index) => [s.id, index]));
  const latestIndex = graded.length - 1;

  interface Tally {
    total: number;
    sessionIndices: Set<number>;
  }
  const tallies = new Map<string, Tally>();

  for (const error of errors) {
    const index = sessionOrder.get(error.session_id);
    if (index === undefined) {
      continue;
    }
    const tally = tallies.get(error.category) ?? { total: 0, sessionIndices: new Set<number>() };
    tally.total += 1;
    tally.sessionIndices.add(index);
    tallies.set(error.category, tally);
  }

  const weaknesses: Weakness[] = [];
  const improving: Strength[] = [];

  for (const [category, tally] of tallies) {
    const indices = [...tally.sessionIndices].sort((a, b) => a - b);
    const lastSeen = indices[indices.length - 1];
    const sessionsSinceLastSeen = latestIndex - lastSeen;

    const inLatest = lastSeen === latestIndex;
    const recentCount = indices.filter((i) => i > latestIndex - PERSISTENCE_WINDOW).length;

    // Improving: it used to happen and it has stopped. Reported as a strength, because it is
    // one — and because a dashboard that only ever lists faults is one a learner stops opening.
    if (sessionsSinceLastSeen >= IMPROVED_AFTER_CLEAN_SESSIONS) {
      improving.push({
        label: labelFor(category),
        detail: `No mistakes in your last ${sessionsSinceLastSeen} sessions — this used to trip you up ${tally.total} times.`,
      });
      continue;
    }

    let status: WeaknessStatus;
    let note: string;

    // Regressed: back in the latest session after at least one clean session in between.
    // This is the single most valuable thing on the page, and it is only knowable because
    // every past mistake was stored individually rather than as a per-session count.
    const previouslyClean = !tally.sessionIndices.has(latestIndex - 1);
    const seenBefore = indices.some((i) => i < latestIndex - 1);

    if (inLatest && previouslyClean && seenBefore) {
      status = 'regressed';
      note = 'You had this under control, and it came back last session. Worth a refresher.';
    } else if (recentCount >= PERSISTENCE_THRESHOLD) {
      status = 'persistent';
      note = `Showed up in ${recentCount} of your last ${Math.min(PERSISTENCE_WINDOW, graded.length)} sessions.`;
    } else if (inLatest && indices.length === 1) {
      status = 'new';
      note = 'New this session — it may just be the topic. Worth watching.';
    } else {
      status = 'active';
      note = `${tally.total} mistakes across ${indices.length} session${indices.length === 1 ? '' : 's'}.`;
    }

    weaknesses.push({
      category,
      label: labelFor(category),
      advice: adviceFor(category),
      status,
      totalErrors: tally.total,
      sessionsAffected: indices.length,
      note,
    });
  }

  // Regressions first — they are the actionable surprise. Then by how often it happens.
  const rank: Record<WeaknessStatus, number> = {
    regressed: 0,
    persistent: 1,
    active: 2,
    new: 3,
  };
  weaknesses.sort((a, b) => rank[a.status] - rank[b.status] || b.totalErrors - a.totalErrors);

  return { weaknesses, improving };
}

// ---------------------------------------------------------------------------
// Parameters over time
// ---------------------------------------------------------------------------

/** A parameter must move more than this to be called a change rather than noise. */
const MEANINGFUL_CHANGE = 0.1;

/** Sessions averaged into the trend line, and into each end of a comparison. */
const WINDOW = 3;

/** Below this many *measured* sessions, no comparison is offered — only the raw line. */
const MIN_FOR_SINCE_START = 4;

/** Momentum needs a third window's worth of history, or it just restates "since you started". */
const MIN_FOR_MOMENTUM = 5;

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * The trend line: a rolling mean of the last few KNOWN values, ending at each measured session.
 *
 * WHY SMOOTH AT ALL. A single session's value is noisy for the same reason a single session's
 * CEFR is (see estimateLevel above): the topic changed, not the learner. A learner who discussed
 * their job on Tuesday and the weather on Wednesday will post a lower vocabulary range on
 * Wednesday having learned nothing and forgotten nothing. The raw points are still drawn — the
 * learner should see the scatter — but the line they read is this one.
 *
 * WHY IT NEVER BRIDGES A GAP. The window only ever averages values we actually have, and emits
 * null wherever the session itself was unmeasured. Averaging *across* an unknown session would
 * manufacture a value for the exact session where we knew nothing — the same lie that
 * `connectNulls={false}` exists to prevent, smuggled in through the back door.
 */
function smooth(values: (number | null)[], window = WINDOW): (number | null)[] {
  const recentKnown: number[] = [];

  return values.map((value) => {
    if (value === null) {
      return null;
    }
    recentKnown.push(value);
    if (recentKnown.length > window) {
      recentKnown.shift();
    }
    return Number((recentKnown.reduce((a, b) => a + b, 0) / recentKnown.length).toFixed(4));
  });
}

/**
 * Compare two windows of the same learner's sessions.
 *
 * Always against *their own* earlier self, never against other learners or an absolute target.
 * A B1 speaker who improves is succeeding; telling them they are below some global average is
 * discouraging and, worse, is not an action.
 */
function makeDelta(
  spec: Pick<ParameterSpec, 'goodDirection' | 'ordinal'>,
  fromValues: number[],
  toValues: number[]
): ParameterDelta | null {
  const from = mean(fromValues);
  const to = mean(toValues);

  if (from === null || to === null) {
    return null;
  }

  const windowSize = Math.min(fromValues.length, toValues.length);

  // A percentage is meaningless on an ordinal band scale, and undefined against a baseline of
  // zero (every increase from zero is an infinite one). Both fall back to "from → to".
  const usePercent = !spec.ordinal && Math.abs(from) > 1e-9;
  const change = usePercent ? (to - from) / Math.abs(from) : null;

  const rose = to - from > 1e-9;
  const fell = from - to > 1e-9;

  // "Meaningful" differs by scale: a fractional threshold where we have one, and a whole band
  // where the scale is ordinal.
  const meaningful =
    change !== null
      ? Math.abs(change) > MEANINGFUL_CHANGE
      : spec.ordinal
        ? Math.round(from) !== Math.round(to)
        : rose || fell;

  let verdict: ParameterDelta['verdict'];

  if (!meaningful) {
    verdict = 'steady';
  } else if (spec.goodDirection === null) {
    // Pace, sentence length, self-correction. The number moved; whether that is good is not
    // ours to say, and saying it anyway would be the boolean's original sin.
    verdict = 'moved';
  } else if (spec.goodDirection === 'higher') {
    verdict = rose ? 'improved' : 'slipped';
  } else {
    verdict = fell ? 'improved' : 'slipped';
  }

  return {
    from: Number(from.toFixed(4)),
    to: Number(to.toFixed(4)),
    change: change === null ? null : Number(change.toFixed(4)),
    verdict,
    windowSize,
  };
}

/** Build one parameter's full summary from its per-session series. */
function summariseSeries(
  spec: Pick<
    ParameterSpec,
    'key' | 'group' | 'label' | 'caption' | 'goodDirection' | 'cumulative' | 'ordinal'
  >,
  sessions: SessionRow[],
  values: (number | null)[]
): ParameterSummary {
  const smoothed = smooth(values);

  const points: ParameterPoint[] = sessions.map((session, index) => ({
    date: session.started_at,
    sessionIndex: index + 1,
    value: values[index],
    smoothed: smoothed[index],
  }));

  const known = values.filter((v): v is number => v !== null);

  const base = {
    key: spec.key,
    group: spec.group,
    label: spec.label,
    caption: spec.caption,
    goodDirection: spec.goodDirection,
    cumulative: spec.cumulative ?? false,
    ordinal: spec.ordinal ?? false,
    points,
    knownCount: known.length,
  };

  // A running total only ever goes up, so a percentage change on it is theatre. Charted, yes;
  // scored, no. "New words per session" is the parameter that actually tells you whether the
  // vocabulary is still growing, and it is tracked separately.
  if (spec.cumulative) {
    return {
      ...base,
      current: known.length > 0 ? known[known.length - 1] : null,
      sinceStart: null,
      recent: null,
      gate: null,
    };
  }

  const current = mean(known.slice(-WINDOW));

  if (known.length < MIN_FOR_SINCE_START) {
    const needed = MIN_FOR_SINCE_START - known.length;
    return {
      ...base,
      current,
      sinceStart: null,
      recent: null,
      // Said out loud, because an empty card with no explanation reads as a broken card.
      gate:
        known.length === 0
          ? 'No sessions long enough to measure this yet.'
          : `${needed} more session${needed === 1 ? '' : 's'} and this can be compared against where you started.`,
    };
  }

  // Adaptive windows. A fixed 3-versus-3 needs six sessions before it says anything at all, and
  // a learner four sessions in has genuinely earned an answer — so with four or five measured
  // sessions the windows narrow to two a side rather than staying silent.
  const startWindow = Math.min(WINDOW, Math.floor(known.length / 2));
  const sinceStart = makeDelta(spec, known.slice(0, startWindow), known.slice(-startWindow));

  let recent: ParameterDelta | null = null;

  if (known.length >= MIN_FOR_MOMENTUM) {
    // One short of the baseline window, so that momentum always compares a *different* pair of
    // windows than "since you started" — otherwise, at exactly six sessions, the two numbers
    // would be arithmetically identical and the page would appear to say the same thing twice.
    const momentumWindow = Math.min(WINDOW, Math.floor((known.length - 1) / 2));
    recent = makeDelta(
      spec,
      known.slice(-2 * momentumWindow, -momentumWindow),
      known.slice(-momentumWindow)
    );
  }

  return {
    ...base,
    current,
    sinceStart,
    recent,
    gate:
      recent === null
        ? `${MIN_FOR_MOMENTUM - known.length} more session${MIN_FOR_MOMENTUM - known.length === 1 ? '' : 's'} and this can also show whether you are still moving.`
        : null,
  };
}

/**
 * Every tracked parameter, with its series and its two deltas.
 *
 * TWO deltas, deliberately, because "am I improving" is two different questions and a single
 * comparison answers only one of them:
 *
 *   - SINCE YOU STARTED  — first sessions vs latest. The motivating one, and the one that was
 *                          missing entirely. It is what a learner means by "am I getting better".
 *   - RECENT             — the window before last vs the last. Whether they are still moving or
 *                          have settled at a new level. A plateau is invisible to the first.
 *
 * Both ends of both comparisons are means of several sessions. The old code compared the FIRST
 * point against the LAST point (trend-chart.tsx) — one noisy session against one noisy session,
 * which is a coin flip wearing a percentage sign.
 *
 * `sessions` must be oldest-first: the ordering is the analysis.
 */
export function buildParameters(sessions: SessionRow[], errors: ErrorRow[]): ParameterSummary[] {
  const context: SeriesContext = { cumulativeVocabulary: 0 };

  const registryParameters = PARAMETERS.map((spec) => {
    // Rebuilt per parameter, so each `read` walks the history from the same starting point.
    context.cumulativeVocabulary = 0;

    const values = sessions.map((session) => {
      context.cumulativeVocabulary += session.new_word_count;
      return spec.read(session, context);
    });

    return summariseSeries(spec, sessions, values);
  });

  return [...registryParameters, ...buildMistakeParameters(sessions, errors)];
}

/**
 * One parameter per kind of mistake, generated from the taxonomy rather than hand-listed.
 *
 * This is the thing the weakness cards cannot do: they say *that* verb tenses keep happening,
 * not whether the learner is making half as many as they were a month ago. The distinction
 * between a gap and a zero matters more here than anywhere else on the page — an ungraded
 * session is unknown, but a graded session with no verb-tense error is a genuine, earned zero,
 * and the learner deserves to see it land on the axis.
 */
function buildMistakeParameters(sessions: SessionRow[], errors: ErrorRow[]): ParameterSummary[] {
  const graded = new Set(sessions.filter(isGraded).map((s) => s.id));

  const counts = new Map<string, Map<string, number>>();

  for (const error of errors) {
    const perSession = counts.get(error.category) ?? new Map<string, number>();
    perSession.set(error.session_id, (perSession.get(error.session_id) ?? 0) + 1);
    counts.set(error.category, perSession);
  }

  return [...counts.entries()]
    .map(([category, perSession]) => {
      const values = sessions.map((session) =>
        graded.has(session.id) ? (perSession.get(session.id) ?? 0) : null
      );

      return summariseSeries(
        {
          key: `mistake:${category}`,
          group: 'mistakes',
          label: labelFor(category),
          caption: adviceFor(category),
          goodDirection: 'lower',
        },
        sessions,
        values
      );
    })
    .sort((a, b) => (b.current ?? 0) - (a.current ?? 0));
}

/**
 * The prose strengths and slipping list, derived from the parameters rather than from a second,
 * parallel list of metrics that could drift out of step with the charts. See parameters.ts.
 *
 * Only the *recent* delta feeds this. "You improved 40% since you started" belongs on the card,
 * where the number is; a strengths list is for what is happening now.
 */
export function analyseMetricTrends(parameters: ParameterSummary[]): {
  strengths: Strength[];
  slipping: Strength[];
} {
  const strengths: Strength[] = [];
  const slipping: Strength[] = [];

  for (const parameter of parameters) {
    // Mistake categories are already covered, in far more detail, by analyseWeaknesses.
    if (parameter.group === 'mistakes' || parameter.recent === null) {
      continue;
    }

    const { verdict, change, to, windowSize } = parameter.recent;

    if (verdict !== 'improved' && verdict !== 'slipped') {
      continue;
    }

    // "Improved" / "slipped", never "up" / "down". For half these parameters the good direction
    // is DOWN — fewer mistakes, fewer hesitations — so a raw "Up 29%" printed beside "4.4
    // mistakes per 100 words" reads as *more* mistakes, the exact opposite of what happened.
    // Naming the direction of travel is correct whichever way the good side points.
    const magnitude = change === null ? '' : ` ${Math.abs(Math.round(change * 100))}%`;
    const detail = `${verdict === 'improved' ? 'Improved' : 'Slipped'}${magnitude} over your last ${windowSize} sessions — now ${describerFor(parameter.key)(to)}.`;

    (verdict === 'improved' ? strengths : slipping).push({ label: parameter.label, detail });
  }

  return { strengths, slipping };
}

// ---------------------------------------------------------------------------
// The trajectory report: the history in sequential groups
// ---------------------------------------------------------------------------

/** Sessions per group. Five is enough to average out topic noise without hiding a real change. */
const GROUP_SIZE = 5;

/** More columns than this stops being scannable, so long histories widen the groups instead. */
const MAX_GROUPS = 8;

/**
 * Groups of five until five-session groups would overflow the report, then ten, and so on.
 * A learner with 200 sessions gets eight columns of twenty-five, not forty columns of five.
 */
export function pickGroupSize(sessionCount: number): number {
  let size = GROUP_SIZE;
  while (Math.ceil(sessionCount / size) > MAX_GROUPS) {
    size += GROUP_SIZE;
  }
  return size;
}

/**
 * Chunk the history into sequential groups and give every parameter a mean per group, plus a
 * first-group-versus-last-group verdict.
 *
 * WHY GROUPS AND NOT THE EXISTING TREND LINE. The smoothed line answers "which way am I
 * heading right now"; it cannot answer "was my second month better than my first", because a
 * three-session rolling window has forgotten the first month entirely. Averaging five sessions
 * against five sessions is the comparison a learner actually means by "am I improving over
 * time" — and it is the same windows-of-means logic makeDelta already applies, just with wider
 * windows.
 *
 * Derived from the already-built ParameterSummary series rather than re-reading sessions, so
 * the report and the cards are computed from literally the same numbers and cannot drift.
 *
 * Returns null below two groups: one group is a baseline, not a trajectory, and the UI says
 * so in words rather than rendering a one-column table.
 */
export function buildGroupReport(
  parameters: ParameterSummary[],
  groupSize?: number
): GroupReport | null {
  const points = parameters[0]?.points ?? [];
  const sessionCount = points.length;
  const size = groupSize ?? pickGroupSize(sessionCount);

  if (sessionCount <= size) {
    return null;
  }

  const groups: SessionGroup[] = [];
  for (let start = 0; start < sessionCount; start += size) {
    const end = Math.min(start + size, sessionCount);
    groups.push({
      label: end - start === 1 ? `${start + 1}` : `${start + 1}–${end}`,
      startIndex: start + 1,
      endIndex: end,
      sessionCount: end - start,
      startDate: points[start].date,
      endDate: points[end - 1].date,
    });
  }

  const grouped: GroupedParameter[] = parameters.map((parameter) => {
    // The known values per group. Kept as arrays because makeDelta wants both ends raw — it
    // computes the means itself and reports how many sessions went into each.
    const knownPerGroup = groups.map((group) =>
      parameter.points
        .slice(group.startIndex - 1, group.endIndex)
        .map((point) => point.value)
        .filter((value): value is number => value !== null)
    );

    const values = knownPerGroup.map((known) => {
      if (known.length === 0) {
        // Nothing in the group was measured — an unknown, never a zero. Same rule as the charts.
        return null;
      }
      if (parameter.cumulative) {
        // A running total: the value at the end of the group, not a mean of the climb.
        return known[known.length - 1];
      }
      const groupMean = mean(known);
      return groupMean === null ? null : Number(groupMean.toFixed(4));
    });

    // First group with data versus last group with data. Usually groups 1 and N; a learner
    // whose latest sessions were all too short to grade still gets a verdict from the last
    // group that carried evidence, rather than a blank.
    const measured = knownPerGroup
      .map((known, index) => ({ known, index }))
      .filter(({ known }) => known.length > 0);

    const delta =
      parameter.cumulative || measured.length < 2
        ? null
        : makeDelta(parameter, measured[0].known, measured[measured.length - 1].known);

    return {
      key: parameter.key,
      group: parameter.group,
      label: parameter.label,
      goodDirection: parameter.goodDirection,
      ordinal: parameter.ordinal,
      cumulative: parameter.cumulative,
      values,
      delta,
    };
  });

  return { groupSize: size, groups, parameters: grouped };
}

// ---------------------------------------------------------------------------
// Trends & totals
// ---------------------------------------------------------------------------

/** `sessions` must be oldest-first. */
export function buildTrend(sessions: SessionRow[]): TrendPoint[] {
  let cumulativeVocabulary = 0;

  return sessions.map((session, index) => {
    cumulativeVocabulary += session.new_word_count;

    return {
      date: session.started_at,
      sessionIndex: index + 1,
      // Nulls pass straight through. A session the grader could not reach has an *unknown*
      // error rate; plotting it as 0 would draw a triumphant dip into a chart at the exact
      // moment we knew least.
      errorsPer100Words: session.errors_per_100_words,
      lexicalVariety: session.type_token_ratio,
      meanSentenceLength: session.mean_sentence_length,
      complexSentenceRatio: session.complex_sentence_ratio,
      advancedWordRatio: session.advanced_word_ratio,
      wordsPerMinute: session.words_per_minute,
      newWords: session.new_word_count,
      cumulativeVocabulary,
      cefrNumeric: session.cefr_estimate ? cefrToNumber(session.cefr_estimate) : null,
    };
  });
}

/**
 * Consecutive days, counting back from the learner's most recent session.
 *
 * Anchored to their last session rather than to today, so opening the dashboard after a
 * two-day break shows "3 day streak (last practiced Tuesday)" rather than silently resetting
 * to zero. The UI is responsible for saying when the streak was last extended — a streak
 * count that quietly means something different depending on the day you look at it is worse
 * than no streak at all.
 */
export function currentStreakDays(sessions: SessionRow[]): number {
  if (sessions.length === 0) {
    return 0;
  }

  const days = [...new Set(sessions.map((s) => s.started_at.slice(0, 10)))].sort().reverse();

  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const previous = new Date(`${days[i - 1]}T00:00:00Z`).getTime();
    const current = new Date(`${days[i]}T00:00:00Z`).getTime();
    const gapDays = Math.round((previous - current) / 86_400_000);

    if (gapDays === 1) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
}
