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
-- Identity is the USERNAME. It is what a learner types at /login, and it is the reason their
-- history follows them from phone to laptop: the same username resolves to the same row on
-- any device, which a browser cookie could never do.
--
-- `username` is the canonical form (lowercased, restricted charset — see normalizeUsername in
-- web/lib/session.ts) and is what we match on. `display_name` is the same name as the learner
-- actually typed it, and exists only to be shown back to them.
--
-- There are still no per-user passwords. The shared passcode gates the app; the username then
-- says whose locker you are opening. Anyone holding the passcode can type someone else's
-- username, so this is a boundary against mix-ups, not against a determined snoop. That is the
-- correct strength for a link shared with friends, and the wrong strength for a public app —
-- see the note in web/lib/session.ts before opening this up.
CREATE TABLE IF NOT EXISTS learners (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Added after the cookie-only era. Nullable, because the rows that predate it have no
-- username — and a NULL is exempt from the unique index, so any number of them can coexist.
ALTER TABLE learners ADD COLUMN IF NOT EXISTS username text;

-- Backfill: give each pre-username learner the username their display name implies, so that
-- someone who practiced as "Asad" before the login screen existed gets their old history back
-- by logging in as "asad" rather than silently starting from zero.
--
-- Only the OLDEST claimant of each candidate name is backfilled (rn = 1). If two people both
-- called themselves "sam", handing the name to one of them is a guess; handing it to both is
-- impossible. The losers keep username NULL and start fresh, which is the safe way to be wrong.
UPDATE learners AS l
   SET username = c.candidate
  FROM (
        SELECT id,
               left(
                 regexp_replace(
                   regexp_replace(lower(display_name), '[^a-z0-9._-]', '', 'g'),
                   '^[^a-z0-9]+', ''
                 ),
                 24
               ) AS candidate,
               row_number() OVER (
                 PARTITION BY left(
                   regexp_replace(
                     regexp_replace(lower(display_name), '[^a-z0-9._-]', '', 'g'),
                     '^[^a-z0-9]+', ''
                   ),
                   24
                 )
                 ORDER BY created_at
               ) AS rn
          FROM learners
         WHERE username IS NULL
       ) AS c
 WHERE l.id = c.id
   AND c.rn = 1
   AND length(c.candidate) >= 2
   AND NOT EXISTS (SELECT 1 FROM learners x WHERE x.username = c.candidate);

-- A plain unique index on the column, not on lower(username): the application stores the
-- canonical lowercase form, so the column IS the canonical form. This also makes the index
-- usable as an `ON CONFLICT (username)` arbiter, which is how login upserts (web/lib/learners.ts).
CREATE UNIQUE INDEX IF NOT EXISTS learners_username_key ON learners (username);

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

  -- Engagement. A learner who only ever answers is not practicing conversation.
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

-- ---------------------------------------------------------------------------
-- learner_avatars — the uploaded photo behind the personalized avatar
-- ---------------------------------------------------------------------------
-- The photo lives in Postgres rather than object storage on purpose: it is small (the web
-- client downscales to ~640px JPEG before upload), both halves already reach this database
-- under their existing credentials, and a blob store would be a fifth secret location for a
-- feature that must never be the reason the tutor breaks.
--
-- A row here is also the entitlement: the only writer is web/app/api/avatar/route.ts, which
-- checks the avatar passcode before every write. The agent therefore trusts the row's
-- existence and never sees the passcode. One row per learner — a new upload replaces the old
-- photo, it does not accumulate.
CREATE TABLE IF NOT EXISTS learner_avatars (
  learner_id   uuid PRIMARY KEY REFERENCES learners (id) ON DELETE CASCADE,
  image        bytea       NOT NULL,  -- JPEG bytes, downscaled client-side
  content_type text        NOT NULL DEFAULT 'image/jpeg',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
