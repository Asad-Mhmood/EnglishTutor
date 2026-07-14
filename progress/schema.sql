-- Progress-tracking schema.
--
-- Apply with:  psql "$DATABASE_URL" -f progress/schema.sql
-- Idempotent: safe to re-run.
--
-- Design notes that are not obvious from the DDL:
--
--   * Every rate column (errors_per_100_words, filler_rate, ...) is meaningless without
--     `word_count` next to it. A learner who says twelve words in a session can post a
--     perfect error rate. Always read rates alongside volume, and see `MIN_WORDS_FOR_GRADING`
--     in progress/scoring.py for the threshold below which we refuse to grade at all.
--
--   * `cefr_estimate` is the RAW per-session guess and is genuinely noisy — a single session
--     can swing A2/B2 on topic alone. Never show it directly. The dashboard shows an
--     exponentially-weighted estimate over recent sessions (see cefrTrajectory in
--     web/lib/progress/aggregate.ts). We store raw and smooth on read, so improving the
--     smoothing never requires a backfill.
--
--   * `extra` is the extension point. A new experimental metric can be written and charted
--     without a migration; promote it to a real column once it has earned one.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- learners
-- ---------------------------------------------------------------------------
-- Identity is a display name plus a signed cookie (web/lib/learner.ts). There are no
-- passwords: the shared passcode still gates the whole app, and this table only exists to
-- give one person's history a stable home. It is not an access-control boundary.
CREATE TABLE IF NOT EXISTS learners (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sessions — one row per completed practice conversation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id       uuid        NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  room_name        text        NOT NULL,
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz NOT NULL,
  duration_seconds integer     NOT NULL,

  -- Volume. Context for every rate below.
  user_turns integer NOT NULL,
  word_count integer NOT NULL,

  -- Vocabulary range.
  unique_word_count   integer NOT NULL,
  type_token_ratio    real,    -- unique/total, length-corrected; "varied vs. repetitive"
  advanced_word_ratio real,    -- share of content words with Zipf frequency < 3.5
  new_word_count      integer NOT NULL DEFAULT 0,  -- never used by this learner before

  -- Fluency and sentence complexity.
  mean_sentence_length   real,
  sentence_length_stdev  real,  -- structure VARIETY: all-short and all-long both score low
  complex_sentence_ratio real,  -- share of sentences carrying a subordinate clause
  words_per_minute       real,

  -- Speech-delivery proxies. NOT pronunciation — see progress/metrics/fluency.py.
  filler_rate          real,  -- "um", "uh", "like" per 100 words
  self_correction_rate real,  -- mid-sentence restarts per 100 words
  stt_confidence       real,  -- mean ASR confidence, when the STT reports it

  -- Engagement. A learner who only ever answers is not practising conversation.
  question_ratio real,

  -- LLM-graded (progress/grading.py). NULL when the session was too short to grade.
  error_count          integer NOT NULL DEFAULT 0,
  errors_per_100_words real,
  cefr_estimate        text,   -- raw and noisy; smooth before display
  cefr_confidence      real,
  summary              text,

  -- Extension point: new metrics land here before they earn a column.
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The dashboard's only access pattern: this learner's sessions, newest first.
CREATE INDEX IF NOT EXISTS sessions_learner_time_idx ON sessions (learner_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- session_errors — one row per mistake
-- ---------------------------------------------------------------------------
-- Stored individually rather than as per-session counts so that "you fixed articles last
-- week and they're back this week" is a query, not a re-analysis. That recurrence signal is
-- the whole reason this feature beats talking to a general chatbot, which remembers nothing.
CREATE TABLE IF NOT EXISTS session_errors (
  id             bigserial PRIMARY KEY,
  session_id     uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  learner_id     uuid NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  category       text NOT NULL,  -- must be a value from progress/taxonomy.py
  learner_text   text NOT NULL,  -- what they said
  corrected_text text NOT NULL,  -- what it should have been
  explanation    text,           -- one short sentence, learner-facing
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_errors_learner_idx ON session_errors (learner_id, category);
CREATE INDEX IF NOT EXISTS session_errors_session_idx ON session_errors (session_id);

-- ---------------------------------------------------------------------------
-- learner_vocabulary — the running set of words a learner has produced
-- ---------------------------------------------------------------------------
-- first_seen_session_id is what makes "new words this session" a cheap COUNT instead of a
-- diff against every prior session.
CREATE TABLE IF NOT EXISTS learner_vocabulary (
  learner_id            uuid    NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  word                  text    NOT NULL,  -- lowercased, content words only
  first_seen_session_id uuid    NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  times_used            integer NOT NULL DEFAULT 1,
  is_advanced           boolean NOT NULL DEFAULT false,  -- Zipf < 3.5 at first sighting
  PRIMARY KEY (learner_id, word)
);

CREATE INDEX IF NOT EXISTS learner_vocabulary_session_idx ON learner_vocabulary (first_seen_session_id);
