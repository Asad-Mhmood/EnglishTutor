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

export interface LevelEstimate {
  band: CefrLevel | null;
  /** 1..6 on the CEFR scale, smoothed. Null until at least one session has been graded. */
  numeric: number | null;
  confidence: number;
  gradedSessions: number;
  /** True below 3 graded sessions: shown, but explicitly labelled as a first impression. */
  isProvisional: boolean;
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
  recentCorrections: ErrorRow[];
  /** Honesty surface. The UI shows this so a learner knows what the numbers rest on. */
  dataQuality: {
    gradedSessions: number;
    ungradedSessions: number;
  };
}
