# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- `DEPLOY.md` — the step-by-step deploy runbook. **Read it before deploying anything.**
- `README.md` — what the system is, how to run it locally, and the project layout.
- `ARCHITECTURE.md` — system diagram, request lifecycle, secret-store layout, and the decision log
  (why the non-obvious choices were made, and what not to "clean up").

## What this is

A LiveKit voice agent that acts as a conversational English tutor ("Alex"). A user joins a LiveKit
room and speaks; the agent transcribes, generates a reply, and speaks back. After the call ends, the
session is analysed and stored, and the learner can see their progress over time at `/progress`.

**Three deploy targets. The two halves are independent — changing one does not redeploy the other:**

| | Code | Runs on | Deploy with |
|---|---|---|---|
| Agent (the voice worker, and the *writer* of progress rows) | repo root | LiveKit Cloud, agent `CA_e4HZqEcBFotF` | `lk agent deploy` |
| Frontend (the shareable link, and the *reader* of progress rows) | `web/` | Vercel, project `english-tutor` | `cd web && vercel deploy --prod` |
| Database | `progress/schema.sql` | Neon, `neon-violet-grass` | `python scripts/apply_schema.py` |

Both halves deploy from your **local working directory, not from git**. Uncommitted edits will ship.

Live link: <https://english-tutor-nine-green.vercel.app> (sign-in gated, see `web/` below).

`schema.sql` is idempotent — `CREATE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `UPDATE`s
— and re-running it **is** the migration mechanism. There is no version table and no Alembic: one
database, one schema file. Write new DDL so that running the file twice is a no-op.

## Commands

### Agent (repo root)

The venv lives at `.venv` (Python 3.13). `main.py` delegates to `livekit.agents.cli.run_app`, which
exposes these subcommands:

```bash
.venv/Scripts/python.exe main.py console         # run locally, mic + speakers, no LiveKit room needed
.venv/Scripts/python.exe main.py dev             # connect to LIVEKIT_URL, hot reload (--reload)
.venv/Scripts/python.exe main.py start           # production worker
.venv/Scripts/python.exe main.py download-files  # pre-fetch model files (e.g. Silero VAD weights)
```

`console` is the fastest feedback loop — it simulates a job without a real room.

There are no tests, linters, or formatters configured for the Python side.

### Scripts (repo root)

```bash
python scripts/apply_schema.py            # apply progress/schema.sql to Neon (idempotent; this is "migrate")
python scripts/sync_taxonomy.py           # copy progress/taxonomy.json into web/
python scripts/sync_taxonomy.py --check   # non-zero exit if web/'s copy is stale
python scripts/seed_demo.py               # seed a demo learner with a known 8-session history
python scripts/seed_demo.py --remove      # delete it again
```

`seed_demo.py` writes a history whose *expected* dashboard output is documented in its docstring
(verb tenses must read "Slipped back", articles "Keeps happening", and so on). That makes it a
known-answer test for the analysis layer, not just demo data.

### Frontend (`web/`)

```bash
cd web
pnpm install      # NOT npm — see the pnpm note under `web/` below
pnpm dev          # localhost:3000
pnpm build        # runs prettier + eslint + tsc; this is what Vercel runs
```

## Environment

Secrets live in **four** places and none of them are synced. Adding a key to `.env` alone will work
locally and then fail in production, silently as far as your terminal is concerned.

| Where | Holds | Set with |
|---|---|---|
| `.env` (repo root, gitignored) | everything, for local agent runs | edit the file |
| `web/.env.local` (gitignored) | `LIVEKIT_*`, `APP_PASSCODE`, `DATABASE_URL`, empty `AGENT_NAME` | edit the file |
| LiveKit Cloud agent secrets | `GROQ_API_KEY`, `TAVILY_API_KEY`, `PROGRESS_DATABASE_URL` | `lk agent update-secrets --secrets "K=V"` |
| Vercel project env | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_PASSCODE`, `DATABASE_URL` | `vercel env add K production` |

Note the two halves reach the **same Neon database under different variable names**:
`PROGRESS_DATABASE_URL` on the agent (which writes) and `DATABASE_URL` on Vercel (which reads,
and is the name the Neon integration sets automatically). Renaming either to match the other
means renaming it in `config/settings.py` or `web/lib/db.ts` too.

LiveKit Cloud injects `LIVEKIT_*` into the agent container itself, which is why those are absent from
the agent's secret list but required by Vercel. `lk agent update-secrets` **merges**, it does not
replace.

**`vercel integration add` overwrites `web/.env.local`.** It rewrites the file with only the
integration's own variables, destroying `LIVEKIT_*` and `APP_PASSCODE`. `vercel env pull` cannot
undo it — those are marked *sensitive* and come back as empty strings, so the file looks repaired and
is not (check value lengths, not key presence). Recover `LIVEKIT_*` from the repo-root `.env` and the
passcode from `ARCHITECTURE.md` §9. Back the file up before adding an integration.

`config/settings.py` instantiates `Settings()` at module scope, so a missing `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GROQ_API_KEY`, or `TAVILY_API_KEY` raises a pydantic
validation error at *import* time, before any agent code runs. On a deployed worker this means a
missing secret is a **crashloop**, not a degraded agent. Everything else (`LLM_MODEL`, `STT_MODEL`,
`TTS_VOICE`, `AGENT_GREETING`, `GRADING_MODEL`) has a default and can be overridden via env.

`PROGRESS_DATABASE_URL` is the deliberate exception: it is optional, so that a missing or broken
database costs you progress tracking and **not the tutor**. See `progress/` below.

After deploying, `lk agent logs` reaching `registered worker` with no traceback is the proof that
every required secret was present.

## Architecture

The voice pipeline is assembled in `agent/tutor.py::entrypoint`, called once per room:

```
mic → Groq STT (whisper-large-v3-turbo) → Groq LLM (llama-3.3-70b) → EdgeTTS → speaker
```

- **VAD must be passed explicitly, via `_load_vad()`.** `AgentSession` does default to a bundled
  Silero VAD, but that default is `inference.VAD`, which imports `livekit.local_inference` — the
  module `main.py` stubs out (see below). The stub's `predict()` returns `0.0` for every frame, so
  the VAD never detects speech and the agent responds *only to typed input*, never to the mic.
  A bare `silero.VAD.load()` does not help: it delegates to `inference.VAD` too. Passing
  `onnx_file_path=` forces the onnxruntime path, which is what `_load_vad()` does. Same weights,
  different runtime.
- **The system prompt is `instructions=`.** In v1.x, `Agent(instructions=...)` is sent as the system
  prompt every turn. Don't build a `ChatContext` manually. The prompt text lives in `prompts/tutor.py`
  and is written for *voice* — it forbids markdown, lists, and headers, because everything it emits
  goes straight to TTS.
- **The greeting** is spoken from `EnglishTutor.on_enter`, not the prompt.

### `tools/search.py` — the `search_web` function tool

Registered via `Agent(tools=[search_web])`. Tavily is used over a raw search API because it returns a
synthesized `answer` string, which is what a voice reply should be built from.

- **When Tavily returns an `answer`, that is the entire tool output** — `_format` drops the raw
  result snippets on the floor. Real snippets are markdown-link soup and sometimes a raw JSON dump
  (the weather providers do this); the answer is already two clean sentences. Snippets are only
  used as a fallback when there is no answer, and `_clean()` strips links and bare URLs from them
  first. Keeping a URL out of the audio is done by never handing the LLM one, not by asking it
  nicely in the prompt.

- **The "I'm searching now" announcement is `RunContext.with_filler`, not a `session.say()` before
  the search.** `with_filler` only speaks while the session is *idle*, so it can't talk over the
  user, and it cancels cleanly when the search returns. A manual `say()` would race the reply.
  It fires at most twice (`max_steps=2`): the first line names the query, the second reassures.
- **The prompt forbids the LLM from announcing the search itself** (see the WEB SEARCH section in
  `prompts/tutor.py`). Without that, the user hears the announcement twice.
- **The tool returns error strings rather than raising.** A raised exception surfaces to the LLM as
  an opaque tool failure; a sentence like "the search timed out, tell the user" gets a graceful
  spoken reply.
- **Whether to search is decided entirely in the prompt.** "Search if asked", "don't search if told
  not to", and "don't search for grammar" are all prompt rules — there is no code-level gate.
- livekit strips the docstring's `Args:` block out of the tool description and folds it into the
  JSON-schema parameter description. Both halves reach the LLM; they just land in different fields.

### The `sys.modules` stub in `main.py` — do not move or remove

`livekit-local-inference` ships a native `.pyd` that calls Windows `ExitProcess()` during init on this
machine. A process-level exit cannot be caught by `try`/`except`, so `main.py` installs a stub module
in `sys.modules["livekit.local_inference"]` **before the first livekit import**. `load_dotenv()` must
also run before livekit-agents is imported, since it reads env at import time.

This makes import order in `main.py` load-bearing. The `# noqa: E402` comments mark the deliberate
late imports. If you add imports there, keep them below the stub.

### `web/` — the shareable frontend

Scaffolded from LiveKit's `agent-starter-react` template (`lk app create --template
agent-starter-react`). Next.js, deployed to Vercel. It exists because a LiveKit room needs a JWT
signed with `LIVEKIT_API_SECRET`, and that can never ship to a browser — so a shareable link needs a
server-side token minter. That is `app/api/token/route.ts`.

- **`AGENT_NAME` must stay empty.** The worker registers with `agent_name: ""`, which means
  *automatic dispatch* — it joins any room created on the project. If `AGENT_NAME` is set in `web/`
  and does not match a worker registered under that exact name, the frontend connects to a room, the
  agent never joins, and **nothing errors**. The user just sits in silence. This is the failure mode
  to suspect first when the page works but Alex never speaks.

- **Install with `pnpm`, not `npm`.** The template ships `pnpm-lock.yaml`. npm ignores it and resolves
  a newer `motion`, whose stricter `Easing` type rejects the template's own `ease: 'linear'` in
  `view-controller.tsx`, and `pnpm build` fails on a type error in code you never touched.

- **`.gitattributes` pins LF.** The template's prettier config enforces LF; a Windows checkout without
  that file rewrites everything to CRLF and the build dies with hundreds of `Delete ␍` errors. If a
  wall of those appears, the fix is `pnpm exec prettier --write .`, not editing the prettier config.

#### Routes

| Route | What it is |
|---|---|
| `/` | a signpost — redirects to `/home` or `/login`. Renders nothing. |
| `/login` | username + shared passcode. The only door in. |
| `/home` | the hub: two cards, **Talk to Alex** and **Dashboard**, over a thin stat strip. |
| `/call` | the voice session (the old `/`). |
| `/progress` | the dashboard. |

`/home` and `/progress` render inside `components/layout/app-shell.tsx` (header, nav, sign-out).
The shell takes an `active` tab as a **prop** rather than reading the pathname, which keeps it a
server component — a client-side `usePathname` would drag the whole header into the bundle.

#### Sign-in (`lib/session.ts`, `app/api/login/route.ts`) — don't remove it

The template's token route **deliberately throws in production**:

```ts
throw new Error('THIS API ROUTE IS INSECURE. DO NOT USE THIS ROUTE IN PRODUCTION WITHOUT AN AUTHENTICATION LAYER.');
```

It hands a room token to anyone who asks, and every token starts a real agent session that burns
Groq, Tavily and LiveKit quota. Public Vercel URLs get crawled. Sign-in is the authentication layer
that warning demands, and it is what replaced the `throw`.

**One cookie, `tutor_session`, carries both facts** — that you knew the passcode, and who you are:

```
value = learnerId + "." + HMAC-SHA256(key = APP_PASSCODE + ":" + LIVEKIT_API_SECRET, msg = learnerId)
```

1. `POST /api/login` `{username, passcode}` → constant-time passcode compare, then upsert the
   learner **by username**, then sign the cookie. It is the only place a session is ever minted.
2. `POST /api/token` mints nothing without a valid cookie — it 401s.

Consequences worth knowing before you touch it:

- **Identity is the username, not the browser.** That is what makes progress follow a learner from
  phone to laptop. The predecessor keyed identity to a per-browser cookie, so the same person on two
  devices was two learners with two disjoint histories.
- **Rotating `APP_PASSCODE` invalidates every existing session**, because the passcode is part of
  the HMAC key. That is the point of a rotation. Rotate with
  `vercel env add APP_PASSCODE production --force` **and redeploy** — env changes do not apply to
  existing deployments.
- **Usernames are not secret.** Everyone shares one passcode, so anyone holding it can sign in as
  anyone else and read their history. This is a boundary against *forgery* (you cannot mint a cookie
  for a learner without `LIVEKIT_API_SECRET`), not against a snoop. Correct for a link shared with
  friends; wrong for a public app, where the fix is real per-user credentials, not a bigger HMAC.
- The cookie rides along automatically because `TokenSource.endpoint()` is same-origin; no header
  plumbing was needed.

Known gap: `/api/login` has no rate limiting, so the passcode is brute-forceable given enough time.
If this ever goes properly public, add IP rate limiting there (needs a KV store — Vercel KV or
Upstash).

### `progress/` — progress tracking

Three layers, strict dependency order, nothing lower imports anything higher:

```
collector.py   COLLECTION   captures learner transcriptions during the live call
metrics/       ANALYSIS     deterministic arithmetic (vocabulary, complexity, delivery)
grading.py                  + one end-of-session LLM call (grammar errors, CEFR)
scoring.py                  MIN_WORDS_FOR_GRADING lives here
repository.py  PERSISTENCE  the only module that knows SQL
```

- **The deterministic metrics and the LLM grading are separate on purpose.** The metrics are
  arithmetic: they cannot hallucinate and cannot invent a mistake. Grading can. A failed
  grading run degrades to `grading = None` (stored NULL) while every metric still lands.
- **Grading runs once, at shutdown, never per turn.** A 70B call mid-conversation is audible
  as dead air. `ctx.add_shutdown_callback` in `agent/tutor.py` is where it fires.
- **`PROGRESS_DATABASE_URL` is deliberately OPTIONAL in `config/settings.py`.** Every other
  key is required, which turns a missing value into a crashloop — correct for `GROQ_API_KEY`,
  wrong here. Progress tracking is a feature *of* the tutor, not a precondition for it, and a
  Neon outage must not stop people speaking English. Do not "tidy" it into a required field.
- **`progress/__init__.py` imports `TranscriptCollector` lazily, via `__getattr__`.** This is
  load-bearing, not style. `collector.py` is the only module here that imports livekit, and on
  Windows that import chain reaches `livekit.local_inference` → `ExitProcess()` (see below).
  An eager import means `import progress.metrics` from any script kills the interpreter with
  exit code 29 and no traceback.
- **Metrics return `None`, never `0.0`, when a measurement is impossible.** A learner who said
  nothing has an *unknown* type-token ratio. Zero would plot as a real point and read as
  catastrophic regression on the trend chart.
- **The error taxonomy lives in `progress/taxonomy.json`, not in Python.** The dashboard needs
  the same labels and advice, and Vercel deploys from `web/` and cannot read files above it.
  Edit the JSON, then run `python scripts/sync_taxonomy.py` to refresh `web/`'s copy.
  `--check` mode fails if it's stale.
- **Pronunciation is not scored, and must not be faked.** Whisper exposes no phonemes and is
  explicitly trained to be robust to accents — the signal we'd need is the one it throws away.
  `metrics/fluency.py` measures *delivery* (pace, hesitation, self-repair), which is real and
  useful and is not pronunciation. Doing it properly needs Azure Speech Pronunciation
  Assessment. See the header comment in that file before adding a "pronunciation score".

Adding a new metric is one function: write it in `progress/metrics/`, decorate with `@metric`,
import it in that package's `__init__.py`. It reaches the database with no migration — unknown
keys land in the `sessions.extra` JSONB column — and can be promoted to a real column later.

Verify the analysis layer without a room, a model, or a database:
`PYTHONPATH=. .venv/Scripts/python.exe` then build a `Transcript` and call
`progress.metrics.compute_all`. Seed a known history with `python scripts/seed_demo.py`.

### `web/` progress dashboard — `/progress`

Mirrors the same three-layer split: `lib/progress/summary.ts` (SQL) → `lib/progress/analysis.ts`
(pure functions) → `components/progress/` (rendering). The page and `/api/progress` both call
`buildSummary`, so they can never disagree about a learner's level.

- **Learner identity is the username** (`learners.username`, unique). Sign-in upserts on it, so
  the same name on a phone and a laptop is the same learner with one history. See the sign-in
  section above. `lib/learners.ts` is the only module that writes the `learners` table.
- **`/api/token` puts the learner id in the participant identity** (`learner_<uuid>`). That is
  the *only* channel by which the agent learns whose progress it is recording. Since sign-in is
  mandatory, every session now has a learner — the old "connected but recorded nowhere"
  anonymous case is unreachable.
- **The per-session CEFR estimate is noisy and is never displayed raw.** `estimateLevel()`
  weights each session by grader confidence and recency. Showing the raw value would swing a
  learner A2→B2→B1 on topic alone and destroy trust in the whole dashboard.
- **Chart colours are in `styles/globals.css` as `--viz-*`, and were validated against the
  card surface, not the page.** The dark card is `oklch(0.205)` ≈ `#303030`; the standard
  critical red fails there at 2.75:1, so the dark step is lightened. Status colours always ship
  with an icon *and* a text label — colour never carries meaning alone.
- **`connectNulls={false}` in `trend-chart.tsx` is load-bearing.** A gap means "this session
  was too short to grade", not "zero errors". Bridging it would draw a confident line through
  the one point where we knew nothing.

### `plugins/edge_tts.py` — custom TTS adapter

Microsoft Edge TTS is free and keyless, but livekit has no plugin for it. `EdgeTTS` implements
`tts.TTS` with `streaming=False`, so each reply is synthesized as one chunk:

```
text → edge_tts.Communicate → MP3 bytes → PyAV decode + resample → PCM s16 mono 24 kHz → output_emitter
```

24 kHz matches Edge TTS's native rate, so no resampling loss. Note that `EdgeTTSStream._run` logs and
returns on synthesis failure rather than raising — a failed or empty synthesis produces **silence**,
not an error, so check logs when the agent goes quiet.
