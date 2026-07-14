import taxonomy from './taxonomy.json';
import {
  CEFR_LEVELS,
  type CefrLevel,
  type ErrorRow,
  type LevelEstimate,
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
  return CATEGORIES.get(key)?.advice ?? 'Keep practising this in conversation.';
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

function cefrToNumber(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level) + 1;
}

function numberToCefr(value: number): CefrLevel {
  const index = Math.round(value) - 1;
  return CEFR_LEVELS[Math.min(Math.max(index, 0), CEFR_LEVELS.length - 1)];
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
  // Only graded sessions can carry evidence about errors. An ungraded session is one we know
  // nothing about — treating it as "no errors" would make every learner look like they'd
  // fixed everything on the day the grader happened to time out.
  const graded = sessions.filter((s) => s.cefr_estimate !== null || s.error_count > 0);

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
// Metric-based strengths
// ---------------------------------------------------------------------------

/** A metric must move more than this to be called a change rather than noise. */
const MEANINGFUL_CHANGE = 0.1;

const TRACKED: {
  key: keyof SessionRow;
  label: string;
  /** True when going DOWN is the improvement (error rate, filler rate). */
  lowerIsBetter?: boolean;
  format: (value: number) => string;
}[] = [
  {
    key: 'errors_per_100_words',
    label: 'Grammar accuracy',
    lowerIsBetter: true,
    format: (v) => `${v.toFixed(1)} mistakes per 100 words`,
  },
  {
    key: 'complex_sentence_ratio',
    label: 'Sentence complexity',
    format: (v) =>
      `${Math.round(v * 100)}% of your sentences use a clause like "because" or "which"`,
  },
  {
    key: 'advanced_word_ratio',
    label: 'Vocabulary range',
    format: (v) => `${Math.round(v * 100)}% of your words are beyond everyday vocabulary`,
  },
  {
    key: 'type_token_ratio',
    label: 'Word variety',
    format: (v) => `${Math.round(v * 100)}% varied`,
  },
  {
    key: 'words_per_minute',
    label: 'Speaking pace',
    format: (v) => `${Math.round(v)} words per minute`,
  },
  {
    key: 'filler_rate',
    label: 'Fewer hesitations',
    lowerIsBetter: true,
    format: (v) => `${v.toFixed(1)} per 100 words`,
  },
];

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Compare the learner's recent sessions against their own earlier ones.
 *
 * Explicitly against *their own* baseline, never against other learners or an absolute
 * target. A B1 speaker who improves is succeeding; telling them they are below some global
 * average is both discouraging and useless, because it isn't an action.
 *
 * `sessions` must be oldest-first.
 */
export function analyseMetricTrends(sessions: SessionRow[]): {
  strengths: Strength[];
  slipping: Strength[];
} {
  const strengths: Strength[] = [];
  const slipping: Strength[] = [];

  // Six sessions minimum: three to average as "recent" and three as "before". Comparing one
  // session against one other is comparing two coin flips.
  if (sessions.length < 6) {
    return { strengths, slipping };
  }

  const recent = sessions.slice(-3);
  const earlier = sessions.slice(-6, -3);

  for (const metric of TRACKED) {
    const recentValues = recent
      .map((s) => s[metric.key])
      .filter((v): v is number => typeof v === 'number');
    const earlierValues = earlier
      .map((s) => s[metric.key])
      .filter((v): v is number => typeof v === 'number');

    const recentMean = mean(recentValues);
    const earlierMean = mean(earlierValues);

    if (recentMean === null || earlierMean === null || earlierMean === 0) {
      continue;
    }

    const change = (recentMean - earlierMean) / Math.abs(earlierMean);
    const improved = metric.lowerIsBetter
      ? change < -MEANINGFUL_CHANGE
      : change > MEANINGFUL_CHANGE;
    const worsened = metric.lowerIsBetter
      ? change > MEANINGFUL_CHANGE
      : change < -MEANINGFUL_CHANGE;

    const magnitude = `${Math.abs(Math.round(change * 100))}%`;

    // "Improved" / "slipped", never "up" / "down".
    //
    // For half these metrics the good direction is DOWN — fewer mistakes, fewer hesitations —
    // so a raw "Up 29%" printed beside "4.4 mistakes per 100 words" reads as *more* mistakes,
    // which is the exact opposite of what happened. The learner would see their best week
    // reported as a regression. Naming the direction of *travel* rather than the direction of
    // the number is correct for every metric regardless of which way its good side points.
    if (improved) {
      strengths.push({
        label: metric.label,
        detail: `Improved ${magnitude} over your last 3 sessions — now ${metric.format(recentMean)}.`,
      });
    } else if (worsened) {
      slipping.push({
        label: metric.label,
        detail: `Slipped ${magnitude} over your last 3 sessions — now ${metric.format(recentMean)}.`,
      });
    }
  }

  return { strengths, slipping };
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
 * two-day break shows "3 day streak (last practised Tuesday)" rather than silently resetting
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
