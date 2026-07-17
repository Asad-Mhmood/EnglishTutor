import { cefrToNumber, numberToCefr } from './cefr';
import type { SessionRow } from './types';

/**
 * THE PARAMETER REGISTRY — the single source of truth for everything the learner can track.
 *
 * Adding a parameter here gives it, with no other code change: a series, a smoothed trend line,
 * a "since you started" delta, a "recent momentum" delta, a card, and an expandable chart.
 *
 * WHY THIS EXISTS AS ONE LIST. It used to be two. The four charts were hand-wired in
 * `dashboard.tsx` and a separate six-item `TRACKED` array in `analysis.ts` decided which
 * parameters could be called improving — and the two lists did not contain the same parameters.
 * A parameter could therefore be charted but never praised, or praised but never charted, and
 * five parameters (question ratio, self-correction, sentence variety, pace, hesitation) were
 * computed by the agent, written to Postgres, selected by the SQL, and then rendered nowhere at
 * all. One list means that cannot happen again.
 *
 * Functions live here rather than in the summary payload because a function cannot survive
 * `JSON.stringify` — `/api/progress` ships the numbers, and the client looks the formatter back
 * up by key.
 */

export type ParameterGroup =
  | 'level'
  | 'accuracy'
  | 'mistakes'
  | 'vocabulary'
  | 'sentences'
  | 'delivery'
  | 'engagement';

export const PARAMETER_GROUPS: { key: ParameterGroup; title: string; blurb: string }[] = [
  {
    key: 'level',
    title: 'Level',
    blurb: 'Where the grader placed you, session by session.',
  },
  {
    key: 'accuracy',
    title: 'Accuracy',
    blurb:
      'How often you make mistakes, measured per 100 words so talking more never counts against you.',
  },
  {
    key: 'vocabulary',
    title: 'Vocabulary',
    blurb:
      'How many words you know, how varied they are, and how far past everyday English they reach.',
  },
  {
    key: 'sentences',
    title: 'Sentences',
    blurb: 'Not "are they long" — whether you have more than one sentence shape available to you.',
  },
  {
    key: 'delivery',
    title: 'Delivery',
    blurb:
      'How you speak, not how you sound. Pronunciation is not measured here and never will be from a transcript.',
  },
  {
    key: 'engagement',
    title: 'Engagement',
    blurb: 'Whether you drive the conversation or only answer it.',
  },
  {
    key: 'mistakes',
    title: 'Mistakes by type',
    blurb:
      'Each kind of mistake over time. A gap is a session too short to grade; a zero is a session graded clean.',
  },
];

/**
 * Which way is "better".
 *
 * `null` is not laziness — it is the honest answer for three of these, and the reason the old
 * `lowerIsBetter: boolean` had to go:
 *
 *   - SPEAKING PACE. Faster is not better. A learner who goes from 95 to 190 words per minute is
 *     now gabbling, and a boolean forces us to either congratulate them or call a healthy
 *     speed-up a regression. Both are lies. We show the movement and pass no judgement.
 *   - SENTENCE LENGTH. The chart caption has always conceded that longer isn't automatically
 *     better; now the code agrees with the caption.
 *   - SELF-CORRECTION. Catching your own mistakes is a good sign — but so is not making them.
 *     The rate rising and the rate falling can each be progress, depending on the error rate
 *     beside it, so no single direction is right.
 *
 * A null-direction parameter is still tracked, still charted, still gets a percentage — it just
 * gets a neutral "up 12%" instead of a green "improved 12%".
 */
export type GoodDirection = 'higher' | 'lower' | null;

export interface SeriesContext {
  /** Running total of distinct words, accumulated across the learner's sessions in order. */
  cumulativeVocabulary: number;
}

export interface ParameterSpec {
  key: string;
  group: ParameterGroup;
  label: string;
  /** What the number means, in plain words. Shown under the label — never make them guess. */
  caption: string;
  goodDirection: GoodDirection;
  /**
   * Monotonic totals (vocabulary size). A percentage change on a running total is meaningless —
   * it only ever goes up — so these are charted and reported without a verdict.
   */
  cumulative?: boolean;
  /**
   * Ordinal scales (CEFR). "Improved 14%" on a 1-to-6 band scale means nothing to anyone, so
   * the delta is reported as "A2 → B1" instead of as a percentage.
   */
  ordinal?: boolean;
  /** Compact, for axes and the headline number. */
  format: (value: number) => string;
  /** Long-form, for the sentence "…now 4.4 mistakes per 100 words". Defaults to `format`. */
  describe?: (value: number) => string;
  /** Null means the measurement was impossible that session. It is a gap, never a zero. */
  read: (session: SessionRow, context: SeriesContext) => number | null;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const oneDecimal = (value: number) => value.toFixed(1);
const whole = (value: number) => String(Math.round(value));

export const PARAMETERS: ParameterSpec[] = [
  {
    key: 'cefr',
    group: 'level',
    label: 'Level per session',
    caption:
      'The grader’s read on each individual session. It bounces around with the topic — which is exactly why the level at the top of this page is a weighted average and not this line.',
    goodDirection: 'higher',
    ordinal: true,
    format: (value) => numberToCefr(value),
    read: (session) => (session.cefr_estimate ? cefrToNumber(session.cefr_estimate) : null),
  },

  {
    key: 'errors_per_100_words',
    group: 'accuracy',
    label: 'Grammar accuracy',
    caption: 'Mistakes per 100 words. Lower is better.',
    goodDirection: 'lower',
    format: oneDecimal,
    describe: (value) => `${value.toFixed(1)} mistakes per 100 words`,
    read: (session) => session.errors_per_100_words,
  },

  {
    key: 'cumulative_vocabulary',
    group: 'vocabulary',
    label: 'Vocabulary size',
    caption: 'Distinct words you have used, adding up across every session.',
    goodDirection: 'higher',
    cumulative: true,
    format: whole,
    describe: (value) => `${Math.round(value).toLocaleString()} distinct words`,
    read: (_session, context) => context.cumulativeVocabulary,
  },
  {
    key: 'new_word_count',
    group: 'vocabulary',
    label: 'New words per session',
    caption:
      'Words you had never used before. This is the one that flattens when you stop stretching — the total above keeps climbing regardless.',
    goodDirection: 'higher',
    format: whole,
    describe: (value) => `${Math.round(value)} new words a session`,
    read: (session) => session.new_word_count,
  },
  {
    key: 'advanced_word_ratio',
    group: 'vocabulary',
    label: 'Vocabulary range',
    caption: 'Share of your words that go beyond everyday English.',
    goodDirection: 'higher',
    format: percent,
    describe: (value) => `${Math.round(value * 100)}% beyond everyday vocabulary`,
    read: (session) => session.advanced_word_ratio,
  },
  {
    key: 'type_token_ratio',
    group: 'vocabulary',
    label: 'Word variety',
    caption:
      'Whether you reach for different words or circle the same twenty. Measured in a fixed window, so talking more does not drag it down.',
    goodDirection: 'higher',
    format: percent,
    describe: (value) => `${Math.round(value * 100)}% varied`,
    read: (session) => session.type_token_ratio,
  },

  {
    key: 'mean_sentence_length',
    group: 'sentences',
    label: 'Sentence length',
    caption:
      'Average words per sentence. Longer is not automatically better — this one is reported, not scored.',
    goodDirection: null,
    format: oneDecimal,
    describe: (value) => `${value.toFixed(1)} words a sentence`,
    read: (session) => session.mean_sentence_length,
  },
  {
    key: 'complex_sentence_ratio',
    group: 'sentences',
    label: 'Sentence complexity',
    caption:
      'Share of sentences using a clause like "because", "although" or "which". This is the move from A2 to B1, made visible.',
    goodDirection: 'higher',
    format: percent,
    describe: (value) => `${Math.round(value * 100)}% of sentences use a subordinate clause`,
    read: (session) => session.complex_sentence_ratio,
  },
  {
    key: 'sentence_length_stdev',
    group: 'sentences',
    label: 'Sentence variety',
    caption:
      'How much your sentence length varies. Nothing but eight-word sentences and nothing but twenty-five-word sentences are both monotonous, and only this notices.',
    goodDirection: 'higher',
    format: oneDecimal,
    describe: (value) => `${value.toFixed(1)} words of spread`,
    read: (session) => session.sentence_length_stdev,
  },

  {
    key: 'words_per_minute',
    group: 'delivery',
    label: 'Speaking pace',
    caption:
      'Words per minute while you were actually talking. Reported, not scored — faster is not better, and a rising line here is only good news up to a point.',
    goodDirection: null,
    format: whole,
    describe: (value) => `${Math.round(value)} words per minute`,
    read: (session) => session.words_per_minute,
  },
  {
    key: 'filler_rate',
    group: 'delivery',
    label: 'Hesitations',
    caption: '"Um", "you know", "like" — per 100 words. Lower is better.',
    goodDirection: 'lower',
    format: oneDecimal,
    describe: (value) => `${value.toFixed(1)} hesitations per 100 words`,
    read: (session) => session.filler_rate,
  },
  {
    key: 'self_correction_rate',
    group: 'delivery',
    label: 'Self-corrections',
    caption:
      'Catching your own mistake mid-sentence, per 100 words. Reported, not scored: it is a good sign that you are hearing yourself, and so is having nothing left to correct.',
    goodDirection: null,
    format: oneDecimal,
    describe: (value) => `${value.toFixed(1)} self-corrections per 100 words`,
    read: (session) => session.self_correction_rate,
  },

  {
    key: 'question_ratio',
    group: 'engagement',
    label: 'Questions you ask',
    caption:
      'Share of your turns that ask something. Ahmad ends every turn with a question, so you can hold a long conversation without ever forming one yourself — and forming questions is its own skill.',
    goodDirection: 'higher',
    format: percent,
    describe: (value) => `${Math.round(value * 100)}% of your turns ask a question`,
    read: (session) => session.question_ratio,
  },
];

export const PARAMETER_BY_KEY = new Map(PARAMETERS.map((p) => [p.key, p]));

/**
 * Formatter for a parameter that is not in the registry — the per-mistake-type parameters, which
 * are generated from the taxonomy at runtime and are all plain counts.
 */
export function formatterFor(key: string): (value: number) => string {
  return PARAMETER_BY_KEY.get(key)?.format ?? whole;
}

export function describerFor(key: string): (value: number) => string {
  const spec = PARAMETER_BY_KEY.get(key);
  if (!spec) {
    return (value) => `${Math.round(value)} a session`;
  }
  return spec.describe ?? spec.format;
}
