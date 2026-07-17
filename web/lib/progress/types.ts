/**
 * The shape of everything the dashboard renders.
 *
 * `/api/progress` produces a ProgressSummary; the page consumes one. Keeping the contract in
 * its own module means the rendering layer never touches a database row and the analysis
 * layer never touches JSX — the same collection / analysis / rendering split the Python side
 * uses.
 */

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** A raw `sessions` row, as it comes back from Postgres. */
export interface SessionRow {
  id: string;
  started_at: string;
  duration_seconds: number;
  user_turns: number;
  word_count: number;
  unique_word_count: number;
  type_token_ratio: number | null;
  advanced_word_ratio: number | null;
  new_word_count: number;
  mean_sentence_length: number | null;
  sentence_length_stdev: number | null;
  complex_sentence_ratio: number | null;
  words_per_minute: number | null;
  filler_rate: number | null;
  self_correction_rate: number | null;
  question_ratio: number | null;
  error_count: number;
  errors_per_100_words: number | null;
  cefr_estimate: CefrLevel | null;
  cefr_confidence: number | null;
  summary: string | null;
}

export interface ErrorRow {
  session_id: string;
  category: string;
  learner_text: string;
  corrected_text: string;
  explanation: string | null;
  created_at: string;
}

/**
 * What has happened to a weak area over time. This is the feature that a general-purpose
 * chatbot structurally cannot offer: it has no memory of your last conversation, so it can
 * never tell you that a mistake you had stopped making has come back.
 */
export type WeaknessStatus =
  | 'regressed' /** was fixed, and is back. The most important thing on the page. */
  | 'persistent' /** keeps happening across sessions. The main thing to work on. */
  | 'new' /** only appeared in the latest session. Might be noise; might be a new topic. */
  | 'active'; /** happening, but without a clear pattern yet. */

export interface Weakness {
  category: string;
  label: string;
  advice: string;
  status: WeaknessStatus;
  totalErrors: number;
  sessionsAffected: number;
  /** Human-readable reason for the status. Shown verbatim — never make the user infer it. */
  note: string;
}

export interface Strength {
  label: string;
  detail: string;
}

/** One point on every trend chart. Nulls are genuine gaps and must not be drawn as zero. */
export interface TrendPoint {
  date: string;
  sessionIndex: number;
  errorsPer100Words: number | null;
  lexicalVariety: number | null;
  meanSentenceLength: number | null;
  complexSentenceRatio: number | null;
  advancedWordRatio: number | null;
  wordsPerMinute: number | null;
  newWords: number;
  cumulativeVocabulary: number;
  cefrNumeric: number | null;
}

/**
 * One session's value for one tracked parameter.
 *
 * `value` is what was actually measured. `smoothed` is the mean of the last few *known* values
 * up to and including this one — the line a learner should read, because a single session's
 * value swings on topic (see the note on estimateLevel: the same argument that stops us showing
 * a raw per-session CEFR applies to every other parameter too).
 *
 * Both are null on a session where the measurement was impossible. Smoothing must never bridge
 * a gap: averaging *across* an unknown session would invent a value for the one session where
 * we knew nothing.
 */
export interface ParameterPoint {
  date: string;
  sessionIndex: number;
  value: number | null;
  smoothed: number | null;
}

/** What happened between two windows of sessions. */
export interface ParameterDelta {
  /** Mean of the baseline window. */
  from: number;
  /** Mean of the most recent window. */
  to: number;
  /**
   * Signed fractional change against the baseline (-0.23 = down 23%).
   *
   * Null when a percentage would be a lie: an ordinal scale (CEFR), or a baseline of exactly
   * zero, where every increase is an infinite one. The UI falls back to "from → to".
   */
  change: number | null;
  /**
   * 'improved' / 'slipped' only when the parameter HAS a good direction. 'moved' is the honest
   * verdict for pace, sentence length and self-correction, where a change is real but not good
   * or bad on its own. See GoodDirection in parameters.ts.
   */
  verdict: 'improved' | 'slipped' | 'steady' | 'moved';
  /** How many sessions went into each side. Stated in the UI — a 2-session mean is not a 3. */
  windowSize: number;
}

/** Everything needed to render one parameter's card and chart. Fully serialisable. */
export interface ParameterSummary {
  key: string;
  group: string;
  label: string;
  caption: string;
  goodDirection: 'higher' | 'lower' | null;
  cumulative: boolean;
  ordinal: boolean;
  /** Mean of the last few known values — NOT the last session, which is one noisy number. */
  current: number | null;
  /** The headline: are you better than when you started, and by how much. */
  sinceStart: ParameterDelta | null;
  /** Are you still moving, or have you plateaued at your new level. */
  recent: ParameterDelta | null;
  /**
   * Why there is no delta yet, in words, e.g. "Two more sessions and this can be compared."
   * Shown verbatim: a learner with four sessions and an empty card deserves to know it is a
   * matter of evidence and not a bug.
   */
  gate: string | null;
  points: ParameterPoint[];
  knownCount: number;
}

export interface LevelEstimate {
  band: CefrLevel | null;
  /** 1..6 on the CEFR scale, smoothed. Null until at least one session has been graded. */
  numeric: number | null;
  confidence: number;
  gradedSessions: number;
  /** True below 3 graded sessions: shown, but explicitly labelled as a first impression. */
  isProvisional: boolean;
}

/**
 * One column of the trajectory report: a consecutive run of sessions, e.g. sessions 1–5.
 * `label` is the session-number range; the dates are for the caption underneath it.
 */
export interface SessionGroup {
  label: string;
  startIndex: number;
  endIndex: number;
  sessionCount: number;
  startDate: string;
  endDate: string;
}

/** One parameter's row in the trajectory report: a mean per group, and first-vs-last verdict. */
export interface GroupedParameter {
  key: string;
  group: string;
  label: string;
  goodDirection: 'higher' | 'lower' | null;
  ordinal: boolean;
  cumulative: boolean;
  /** Mean of the known values in each group. Null where nothing in the group was measured. */
  values: (number | null)[];
  /** First group vs last group. Null for cumulative parameters and where either end is empty. */
  delta: ParameterDelta | null;
}

/**
 * Session history chunked into sequential groups, one row per parameter. This is the view that
 * separates a real trajectory from session-to-session noise: a single session swings on topic,
 * but five sessions averaged against five sessions only move when the learner does.
 */
export interface GroupReport {
  groupSize: number;
  groups: SessionGroup[];
  parameters: GroupedParameter[];
}

export interface ProgressSummary {
  learner: { id: string; displayName: string };
  totals: {
    sessions: number;
    practiceMinutes: number;
    wordsSpoken: number;
    vocabularySize: number;
    currentStreakDays: number;
  };
  level: LevelEstimate;
  latestSummary: string | null;
  strengths: Strength[];
  weaknesses: Weakness[];
  trends: TrendPoint[];
  /** Every parameter the learner can track, each with its series and its two deltas. */
  parameters: ParameterSummary[];
  recentCorrections: ErrorRow[];
  /**
   * The raw history, oldest-first — the same rows every aggregate above was computed from.
   * Shipped so the session explorer can filter to a window and re-run the SAME pure analysis
   * over the subset, rather than carrying a second, parallel set of numbers that could
   * disagree with the cards. `sessions[i]` lines up with `parameters[*].points[i]`.
   */
  sessions: SessionRow[];
  /** Every stored correction, oldest-first. `recentCorrections` above is the last 15 of these. */
  errors: ErrorRow[];
  /** Honesty surface. The UI shows this so a learner knows what the numbers rest on. */
  dataQuality: {
    gradedSessions: number;
    ungradedSessions: number;
  };
}
