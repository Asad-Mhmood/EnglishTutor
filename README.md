# English Tutor

A real-time voice agent that acts as a conversational English tutor. You talk, it listens, and it
talks back — correcting mistakes naturally in the flow of conversation rather than stopping to
lecture. It then remembers what you got wrong, and tells you when a mistake you had fixed comes back.

The tutor persona is "Alex": patient, encouraging, and calibrated to your proficiency level. It
embeds corrections into its replies (you say *"I goed to the store"*, it answers *"Oh, you went to
the store! What did you get?"*) and always ends with a follow-up question to keep you talking.

## Try it

**<https://english-tutor-nine-green.vercel.app>** — passcode `ALEX2026`

Sign in with **any username** you like plus the passcode. There is no registration step — the first
time a username is used, it becomes yours. Then pick **Talk to Alex** and allow the microphone.
Nothing to install; it works on a phone. Alex greets you first, so if you hear the greeting,
everything downstream is working.

Use the **same username on every device** and your progress follows you: phone and laptop are one
learner, not two.

The first call of the day can take a few seconds to connect — the agent worker scales to zero when
idle and has to wake up.

## What it does

**Voice conversation.** A full speech pipeline: voice activity detection, speech-to-text, an LLM, and
text-to-speech, all on free tiers.

**Web search.** Ask about the news, the weather, a price, last night's score, and Alex looks it up
via [Tavily](https://tavily.com). It announces the search out loud first, because dead air on a voice
call is unnerving. Tell it not to search and it won't.

**Progress tracking.** Every session is analysed after the call ends, and `/progress` shows you where
you are, what to fix, and whether you are actually improving. This is the part that makes it more
than a chatbot: a general-purpose assistant has no memory of your last conversation, so it can never
tell you that the articles you had under control have started slipping again. This can, because every
mistake is stored individually and compared across sessions.

What is tracked, and what is deliberately not:

| Tracked | How |
|---|---|
| Grammar errors, by type | One LLM pass over the transcript at session end, tagged against a closed taxonomy (tenses, articles, prepositions, subject–verb agreement, …) |
| Vocabulary range | Moving-average type-token ratio, plus the share of words rarer than Zipf 3.5 measured against a real frequency corpus |
| Sentence complexity | Mean sentence length, *variability* of sentence length, and rate of subordination |
| Speech delivery | Words per minute, hesitation rate, self-correction rate |
| Conversational initiative | How often you ask a question rather than only answering |
| CEFR level (A1–C2) | Estimated per session, then smoothed across sessions by grader confidence and recency |
| Weak areas | Auto-tagged, and classified as *slipped back* / *keeps happening* / *new* |

| **Not** tracked | Why |
|---|---|
| Pronunciation | Whisper exposes no phonemes and is explicitly trained to be *robust to accents* — the signal a pronunciation score needs is the one it is built to discard. Any number here would be fabricated, and a learner would act on it. Doing it properly needs Azure Speech Pronunciation Assessment. What *is* measured is **delivery** (pace, hesitation, self-repair), which is real and is not pronunciation. |
| Reading / listening comprehension | There is no reading or listening *exercise* in the app. There is nothing to comprehend, so there is nothing to measure. |

Grammar scoring runs on a speech-to-text transcript, so it inherits Whisper's mistakes: it will miss
errors Whisper silently repaired, and can occasionally flag one Whisper invented. No prompt removes
that ceiling, so the dashboard says so where the learner can see it.

## How it works

Three deployed pieces. The agent and the website are **deployed separately** and neither redeploys
the other; the database is provisioned once and then just exists.

```
   your browser                  LiveKit Cloud
┌────────────────┐            ┌─────────────────┐
│  web/  (Next)  │            │  the agent      │
│  on Vercel     │ ── room ── │  worker         │
│                │            │                 │
│ mints the JWT  │            │ STT → LLM → TTS │
│ shows /progress│            │                 │
└───────┬────────┘            └────────┬────────┘
        │                              │
        │  reads                       │  writes, once, at session end
        │        ┌─────────────────┐   │
        └───────▶│  Neon Postgres  │◀──┘
                 └─────────────────┘
```

The frontend exists mainly to mint a room token. Joining a LiveKit room needs a JWT signed with your
API secret, and a secret can never ship to a browser — so a shareable link needs a small server-side
piece to sign one per visitor. That is the whole reason this isn't a single static HTML page.

The agent is where the voice pipeline lives, orchestrated by
[LiveKit Agents](https://docs.livekit.io/agents/):

```
mic → Silero VAD → Groq STT → Groq LLM → Edge TTS → speaker
                (whisper-large-v3-turbo)  (llama-3.3-70b)
```

Everything on that path is a free tier: Groq for STT and the LLM, Microsoft Edge neural voices for
TTS (no API key at all), Tavily for search, and Neon for the database.

**The agent writes to the database; the website only reads from it.** They never talk to each other
directly.

## Requirements

For the agent:

- Python 3.13
- A [Groq API key](https://console.groq.com) (free)
- A [Tavily API key](https://tavily.com) (free tier: 1,000 searches/month)
- A [LiveKit](https://cloud.livekit.io) project (free tier is fine) and the `lk` CLI

For the website, and only if you're changing or redeploying it:

- Node 20+ and [pnpm](https://pnpm.io) (`npm install -g pnpm`)
- A [Vercel](https://vercel.com) account (free) and the `vercel` CLI

For progress tracking:

- A Postgres database. This project uses [Neon](https://neon.tech) via the Vercel Marketplace, free
  tier. It is **optional** — without it the tutor works exactly as before and simply records nothing.

## Local setup

```bash
python -m venv .venv
.venv/Scripts/activate          # Windows
# source .venv/bin/activate     # macOS / Linux

pip install -r requirements.txt
```

Create `.env` in the project root:

```ini
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret

GROQ_API_KEY=your_groq_key
TAVILY_API_KEY=your_tavily_key

# Optional. Without it the tutor runs untracked — it does NOT fail.
PROGRESS_DATABASE_URL=postgresql://...
```

The first five are **required**: `config/settings.py` builds its `Settings()` at import time, so a
missing one raises a pydantic error before any agent code runs. Optional overrides:

| Variable | Default | What it does |
|---|---|---|
| `LLM_MODEL` | `llama-3.3-70b-versatile` | the conversational model |
| `GRADING_MODEL` | `llama-3.3-70b-versatile` | the model that grades a finished session |
| `STT_MODEL` | `whisper-large-v3-turbo` | |
| `TTS_VOICE` | `en-US-JennyNeural` | any [Edge TTS voice](https://github.com/rany2/edge-tts); `edge-tts --list-voices` |
| `AGENT_GREETING` | *(see `config/settings.py`)* | |
| `PROGRESS_DATABASE_URL` | *(unset)* | Postgres for progress tracking |

## Running locally

Console mode is the fastest feedback loop — your microphone and speakers, no LiveKit room:

```bash
python main.py console
```

Against a real room:

```bash
python main.py dev      # hot reload on file changes
python main.py start    # production worker
python main.py download-files   # pre-fetch model weights (Silero VAD)
```

### The website

```bash
cd web
pnpm install     # pnpm, NOT npm — npm resolves a newer `motion` that breaks the build
pnpm dev         # http://localhost:3000
pnpm build       # prettier + eslint + tsc + next build — exactly what Vercel runs
```

It needs its own `web/.env.local`, which is **separate from the root `.env` and not synced with it**:

```ini
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret

APP_PASSCODE=ALEX2026    # what visitors must type to start a call
DATABASE_URL=postgresql://...   # same database the agent writes to, different variable name
AGENT_NAME=              # must stay EMPTY — see below
```

**Leave `AGENT_NAME` blank.** The worker registers with no agent name, which means it auto-joins any
room the frontend creates. If you set a name here that doesn't match a worker registered under that
exact name, the page will load, the call will "connect", and Alex will simply never speak — with no
error anywhere. That is the first thing to check if the app goes silent.

### Helper scripts

```bash
python scripts/sync_taxonomy.py           # copy the error taxonomy into web/ (see below)
python scripts/sync_taxonomy.py --check   # fail if web/'s copy is stale — use in CI

python scripts/seed_demo.py               # seed a demo learner with a known 8-session history
python scripts/seed_demo.py --remove      # delete it again
```

`progress/taxonomy.json` is the single source of truth for error categories, labels, and practice
advice. The website cannot import it — Vercel deploys from `web/` and never uploads anything above it
— so it reads a **generated copy** at `web/lib/progress/taxonomy.json`. Edit the source, then run the
sync script. If they drift, the dashboard falls back to showing raw category keys.

---

# Deployment

> **Just want the commands?** → **[`DEPLOY.md`](DEPLOY.md)** is the step-by-step runbook:
> copy-pasteable commands, what to verify after each one, and the traps that have already bitten.
>
> This section is the *understanding* behind it — read it once, then work from `DEPLOY.md`.

Read this section fully before deploying anything. The system has **three deploy targets and four
secret stores**, none of which are synced, and the most common failures here are silent.

## The mental model

| Piece | Code lives in | Runs on | Deployed with | Redeploy needed when |
|---|---|---|---|---|
| **Agent** | repo root | LiveKit Cloud (`CA_e4HZqEcBFotF`) | `lk agent deploy` | Python code or agent secrets change |
| **Website** | `web/` | Vercel (`english-tutor`) | `cd web && vercel deploy --prod` | `web/` code or Vercel env change |
| **Database** | `progress/schema.sql` | Neon (`neon-violet-grass`) | `python scripts/apply_schema.py` | the schema changes |

Three rules that explain most of the confusion:

1. **The two halves are independent.** Changing the prompt does not redeploy the website. Changing
   the dashboard does not redeploy the agent. If you change both, deploy both.
2. **Both deploy from your local working directory, not from git.** There is no CI, no GitHub
   trigger, no branch that means "production". Uncommitted edits *will* ship. The live artifact may
   correspond to no commit that exists anywhere.
3. **Environment changes do not apply to deployments that already exist.** Setting a Vercel env var
   and not redeploying looks exactly like the change "didn't save".

## Secret stores — four of them, none synced

This is the part that bites people. Adding a key to `.env` makes it work locally and then fail in
production, silently as far as your terminal is concerned.

| Store | Holds | Written with | Read by |
|---|---|---|---|
| `.env` (repo root, gitignored) | everything, for local runs | edit the file | `python main.py …` on your machine |
| `web/.env.local` (gitignored) | `LIVEKIT_*`, `APP_PASSCODE`, `DATABASE_URL` | edit the file | `pnpm dev` on your machine |
| LiveKit Cloud agent secrets | `GROQ_API_KEY`, `TAVILY_API_KEY`, `PROGRESS_DATABASE_URL` | `lk agent update-secrets --secrets "K=V"` | the deployed agent |
| Vercel project env | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_PASSCODE`, `DATABASE_URL` | `vercel env add K production` | the deployed website |

Things that look wrong but are correct:

- **`LIVEKIT_*` is absent from the agent's secret list.** LiveKit Cloud injects those into the agent
  container itself. The *website* needs them (it signs the JWT); the agent does not.
- **The same database has two different variable names.** `PROGRESS_DATABASE_URL` on the agent (which
  writes) and `DATABASE_URL` on Vercel (which reads — that's the name the Neon integration sets
  automatically). Renaming either means editing `config/settings.py` or `web/lib/db.ts` to match.
- **`lk agent update-secrets` merges.** It does not wipe the keys you didn't mention. Confirm with
  `lk agent secrets list`.

## First-time setup, in order

The order matters — the database must exist before the agent is told about it.

### 1. Provision the database

```bash
cd web
vercel integration add neon
```

The first run stops and prints a `verification_uri`: you must accept the Neon marketplace terms in a
browser once, then re-run the command. When it succeeds, Vercel sets `DATABASE_URL` (and a dozen
Postgres aliases) on the project automatically, for all environments.

> ### ⚠ `vercel integration add` OVERWRITES `web/.env.local`
>
> It rewrites the file with **only** the integration's variables, silently destroying
> `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `APP_PASSCODE`. Local dev then dies
> with `Error: APP_PASSCODE is not set`.
>
> **`vercel env pull` will not repair it.** Those four are marked *sensitive* in the Vercel project,
> so the pull writes them back as empty strings — the file looks fixed and is not. Check value
> *lengths*, not key presence.
>
> **Back `web/.env.local` up before adding any integration.** To recover: `LIVEKIT_*` are in the
> repo-root `.env`, and `APP_PASSCODE` is in `ARCHITECTURE.md` §9.

### 2. Apply the schema

```bash
python scripts/apply_schema.py     # reads PROGRESS_DATABASE_URL from the repo-root .env
```

`progress/schema.sql` is idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and
guarded `UPDATE`s throughout — so **re-running it is how you migrate.** There is no version table
and no Alembic: one database, one schema file. Write new DDL so that running the file twice is a
no-op, and applying a change is just running the script again.

It creates four tables: `learners`, `sessions`, `session_errors`, `learner_vocabulary`.

### 3. Give the agent the connection string

```bash
lk agent update-secrets --secrets "PROGRESS_DATABASE_URL=postgresql://..."
```

Use the **pooled** URL here (the plain `DATABASE_URL` value). `progress/repository.py` sets
`statement_cache_size=0`, which makes asyncpg work correctly against PgBouncer.

### 4. Deploy both halves

```bash
lk agent deploy                    # from the repo root
cd web && vercel deploy --prod
```

### 5. Verify (do not skip this)

```bash
lk agent status     # want: Status = Running
lk agent logs       # want: "registered worker", no traceback
```

Then open the site, sign in with a username and the passcode, talk to Alex for a minute or two, hang
up, and open the **Dashboard**.

## Deploying a change

Day to day, it's two commands, and you only run the half you changed:

```bash
lk agent deploy                    # agent  → LiveKit Cloud
cd web && vercel deploy --prod     # web    → Vercel
```

### What `lk agent deploy` actually does

```
lk agent deploy
   │
   ├─ reads livekit.toml  → project demo-yygoau1f, agent CA_e4HZqEcBFotF
   ├─ builds Dockerfile   → python:3.13-slim, pip install -r requirements.txt
   ├─ pushes the image to LiveKit's registry
   └─ rolling update      → Building ─▶ Running   (~1–2 min observed)
```

The container runs `python main.py start`.

**`registered worker` in the logs is the real success signal — not "Deployed agent".** Because
`config/settings.py` constructs `Settings()` at *import* time, a missing secret raises before any
agent code runs. The image still builds and deploys perfectly; the container then dies on startup and
restarts forever. **A missing secret is a crashloop, not a degraded agent.** Reaching
`registered worker` with no traceback proves every required key was present.

### What `vercel deploy --prod` actually does

```
vercel deploy --prod
   │
   ├─ uploads web/ (respecting .gitignore — .env.local never leaves your machine)
   ├─ pnpm install --frozen-lockfile
   ├─ pnpm build   → prettier + eslint + tsc + next build
   ├─ injects the Vercel env vars (NOT your .env.local)
   └─ aliases → english-tutor-nine-green.vercel.app
```

The build is **strict**: a formatting violation fails it, not just a type error. Run `pnpm build`
locally first. If you get a wall of `Delete ␍` errors, a Windows checkout converted the template to
CRLF — fix with `pnpm exec prettier --write .`, not by editing the prettier config.

## Adding a new secret — the checklist

1. Add it to `.env` (local agent) and/or `web/.env.local` (local website).
2. Add it to `config/settings.py` **only if the agent needs it** — and think hard before making it
   required, because a missing required value is a production crashloop. `PROGRESS_DATABASE_URL` is
   deliberately `str | None`: a database outage must not stop people speaking English.
3. Push it to whichever store the *runtime that reads it* uses (table above).
4. **Redeploy that half.** Env changes never apply to existing deployments.
5. Confirm: `lk agent logs` → `registered worker`, or re-test the web flow end to end.

## Rotating the passcode

```bash
cd web
vercel env add APP_PASSCODE production --force
vercel deploy --prod          # REQUIRED — without this the old passcode stays live
```

Also update `web/.env.local` and `ARCHITECTURE.md` §9 so local dev and the docs don't diverge.

## Rolling back

Vercel keeps every deployment. `vercel ls english-tutor` lists them; promote an older one from the
dashboard, or `vercel rollback <url>`. Note that rolling back the *website* does not roll back the
*agent* — if a bad release spans both, roll back both.

The agent has no rollback command. Redeploy from a known-good working tree.

## Known gaps

- **No CI and no push-to-deploy.** Connecting the GitHub repo to Vercel would give the web half
  automatic deploys on push. It hasn't been done.
- **No rate limiting on `/api/login`**, so the passcode is brute-forceable given time. Fine for a
  link shared with people you know; not fine posted publicly. Closing it needs IP rate limiting,
  which needs a KV store (Vercel KV or Upstash).
- **Usernames are not passwords.** Everyone shares one passcode, so anyone who has it can sign in as
  any username and read that learner's history. Going properly public means real per-user
  credentials (Clerk, Auth.js), not a stronger cookie.
- **No custom domain.**
- **Database migrations are manual.** `progress/schema.sql` is idempotent and re-running it applies
  changes, but there is no version table and no down-migration. A destructive change is hand-written.

---

## Sharing it

Send the link and the passcode. Recipients need no account and install nothing — they pick a
username on the way in, and it becomes theirs the first time they use it.

The passcode is not decoration. `web/app/api/token/route.ts` mints a LiveKit token for whoever asks,
and each token starts a real agent session that consumes your Groq, Tavily, and LiveKit quota. The
upstream template refuses to run that route in production for exactly this reason. Sign-in replaces
that refusal: `/api/login` checks the passcode and sets an httpOnly, HMAC-signed cookie, and the
token route issues nothing without it. The passcode never reaches browser JavaScript.

That one cookie also carries **who** you are. Identity is the **username**, not the browser, so the
same username on a phone and a laptop is one learner with one history. It is not a security boundary
between people who already share the passcode: it stops a learner *forging* another's id (you cannot
sign a cookie without `LIVEKIT_API_SECRET`), and it tells the agent whose progress it is recording.
Anyone with the passcode who types your username sees your dashboard.

## Project layout

```
main.py                     entry point — see the note below
agent/tutor.py              pipeline wiring, learner identity, the shutdown hook
prompts/tutor.py            the tutor's system prompt
plugins/edge_tts.py         custom LiveKit TTS plugin for Microsoft Edge TTS
tools/search.py             the search_web function tool (Tavily)
config/settings.py          env-backed settings
Dockerfile                  what LiveKit Cloud builds
livekit.toml                which LiveKit project/agent this deploys to

progress/                   progress tracking — three strict layers
  collector.py              COLLECTION  — captures transcriptions during the live call
  metrics/                  ANALYSIS    — deterministic arithmetic, one file per metric family
  grading.py                ANALYSIS    — the one end-of-session LLM call
  scoring.py                ANALYSIS    — combines both; MIN_WORDS_FOR_GRADING lives here
  repository.py             PERSISTENCE — the only module that knows SQL
  taxonomy.json             the error taxonomy — SOURCE OF TRUTH, synced into web/
  schema.sql                the database schema

scripts/apply_schema.py     applies schema.sql to Neon — this is "migrate"
scripts/sync_taxonomy.py    copies taxonomy.json into web/
scripts/seed_demo.py        seeds a demo learner with a known history

web/                        the website (Next.js)
  app-config.ts             title, button copy, colors, which inputs are enabled

  app/page.tsx              signpost — redirects to /home or /login
  app/login/page.tsx        username + passcode; the only door in
  app/home/page.tsx         the hub — Talk to Alex, or Dashboard
  app/call/page.tsx         the voice session
  app/progress/page.tsx     the dashboard

  app/api/login/route.ts    checks the passcode, upserts the learner, signs the session cookie
  app/api/logout/route.ts   drops the cookie (the history stays)
  app/api/token/route.ts    mints the LiveKit JWT — gated, and carries the learner id
  app/api/progress/route.ts the dashboard's data, as JSON

  lib/session.ts            the passcode check, the signed session cookie, username rules
  lib/guard.ts              requireLearnerId() — the one-liner at the top of every private page
  lib/learners.ts           the only module that writes the learners table
  lib/db.ts                 the Neon handle
  lib/progress/             SQL (summary.ts) → pure analysis (analysis.ts) → types

  components/layout/        the app shell — header, nav, sign-out
  components/auth/          the login form
  components/home/          the two action cards
  components/progress/      the dashboard — rendering only
```

### A note on `main.py`

The first thing `main.py` does is install a stub module into `sys.modules` in place of
`livekit.local_inference`. That package ships a native library which calls Windows `ExitProcess()`
during initialization on some machines, killing the process outright — and because that's a
process-level exit, no `try`/`except` can catch it. Stubbing the module out means it's never loaded.
Nothing here uses local inference anyway; STT and the LLM run on Groq, and VAD comes from Silero.

The consequence is that **import order in `main.py` matters**. The stub and `load_dotenv()` must both
run before anything from `livekit` is imported. The `# noqa: E402` comments mark those deliberately
late imports.

## Extending it

**The tutor's behavior** lives entirely in `prompts/tutor.py`. It's written for speech, so it forbids
markdown, bullet points, and headers — anything the LLM emits goes straight to text-to-speech and
would be read aloud verbatim. Keep that constraint. Whether Alex searches the web is also decided
there, not in code.

**Adding a tracked metric** is one function. Write it in `progress/metrics/`, decorate it with
`@metric`, and import it in that package's `__init__.py`:

```python
@metric
def hesitation(transcript: Transcript) -> dict[str, float | int | None]:
    return {"hesitation_index": ...}
```

It reaches the database with **no migration** — unknown keys land in the `sessions.extra` JSONB
column — and can be promoted to a real column later. Two rules: the function must be pure (transcript
in, numbers out), and it must return `None`, never `0.0`, when a measurement is impossible. Zero
plots as a real data point; `None` renders as a gap, which is the truth.

**Adding an error category** means editing `progress/taxonomy.json` and running
`python scripts/sync_taxonomy.py`. It flows automatically into the grading prompt, the weak-area
list, and the practice suggestions.

**Swapping providers** means changing one line each in `agent/tutor.py`. LiveKit ships plugins for
OpenAI, Deepgram, Cartesia, ElevenLabs, and others; the `EdgeTTS` class in `plugins/edge_tts.py` is
only there because Edge TTS is free and had no official plugin.

## Troubleshooting

The common thread: **this system fails quietly.** VAD failure, TTS failure, and dispatch failure all
produce *silence* rather than an exception. When something is wrong, assume the logs know and the UI
does not.

**The page connects, the call "starts", but Alex never speaks.** `AGENT_NAME` is set to something no
worker is registered under. It must be empty, in both `web/.env.local` and Vercel. The room is
created, no worker is dispatched, and nothing reports an error anywhere.

**The agent responds to typed input but never to the microphone.** VAD is returning 0.0 for every
frame — the Windows `local_inference` stub. `_load_vad()` must pass `onnx_file_path=`.

**The agent goes silent mid-conversation.** `EdgeTTSStream._run` logs and *returns* on a synthesis
failure rather than raising, so a failed TTS call produces silence, not an error. Check
`lk agent logs`.

**The deploy "succeeded" but the agent is unreachable.** A missing secret → pydantic error at import
→ crashloop. `lk agent logs` and look for `registered worker`.

**Local dev suddenly can't find `APP_PASSCODE`.** You ran `vercel integration add`, which overwrote
`web/.env.local`. See the warning in the deployment section above.

**The passcode change "didn't save".** Vercel env vars don't apply to existing deployments. Redeploy.

**`pnpm build` fails with hundreds of `Delete ␍` errors.** A Windows checkout converted the template
to CRLF. Run `pnpm exec prettier --write .` from `web/`.

**`/progress` says "Progress tracking isn't set up".** No `DATABASE_URL` on the website. This is a
graceful degradation, not a crash — the tutor still works.

**A session happened but no progress row appeared.** Two things to check, in order: did they say at
least 30 words (below `MIN_WORDS_FOR_GRADING` the session is recorded but not graded); and is
`PROGRESS_DATABASE_URL` set on the *agent* (not just on Vercel). Signing in is now mandatory, so the
old "anonymous visitor, deliberately not tracked" cause no longer exists.

**Someone's history "disappeared" after the login screen shipped.** Progress used to be keyed to a
browser cookie; it is now keyed to a username. The schema backfills a username from each old
learner's display name, so signing in as that name (lowercased) reconnects them. If two old learners
had the same name, only the oldest kept it — the other starts fresh, which is the safe way to be
wrong about who owns a history.

**Importing anything from `progress/` kills Python with exit code 29 and no traceback.** That's the
`local_inference` `ExitProcess()` crash. `progress/__init__.py` imports the collector lazily via
`__getattr__` specifically to prevent this — don't "tidy" it into a normal import.

## Going deeper

`ARCHITECTURE.md` is the reference: system diagram, what happens when someone opens the link, the
request lifecycle, where every secret lives, a decision log explaining the non-obvious choices, and
the failure modes that produce silence instead of an error.

`CLAUDE.md` is the rules-of-the-road for editing the code.
