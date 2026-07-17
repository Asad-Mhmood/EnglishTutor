# Architecture & Deployment

Reference for how this system actually fits together and how it gets shipped. This file deliberately
covers what the **code does not tell you**: which pieces live where, what talks to what, why certain
choices were made over the obvious alternative, and the failure modes that produce *silence* instead
of an error.

For day-to-day commands see `README.md`. For rules when editing the code see `CLAUDE.md`.

---

## 1. The system in one picture

Two separately deployed halves. Neither one redeploys the other.

```
        ┌──────────────────────────────────────────┐
        │  BROWSER  (phone or laptop, any network) │
        └──────────────────────┬───────────────────┘
                               │  1. HTTPS: load page, sign in (username + passcode)
                               │  3. WebRTC: audio in / audio out
              ┌────────────────┴──────────────────┐
              │                                   │
   ┌──────────▼────────────┐        ┌─────────────▼──────────────┐
   │  VERCEL               │        │  LIVEKIT CLOUD             │
   │  project: english-    │        │  project: demo-yygoau1f    │
   │           tutor       │        │  region:  ap-south         │
   │                       │        │                            │
   │  Next.js app (web/)   │        │  ┌──────── SFU / room ───┐ │
   │   /api/login          │        │  │  media routing        │ │
   │   /api/token  ────────┼── 2. ──┼─▶│                       │ │
   │                       │  JWT   │  └───────────┬───────────┘ │
   │  Holds:               │        │              │ 4. auto-    │
   │   LIVEKIT_API_KEY     │        │              │    dispatch │
   │   LIVEKIT_API_SECRET  │        │  ┌───────────▼───────────┐ │
   │   APP_PASSCODE        │        │  │  AGENT WORKER         │ │
   └───────────────────────┘        │  │  CA_e4HZqEcBFotF      │ │
                                    │  │  (our Dockerfile)     │ │
                                    │  │                       │ │
                                    │  │  Holds:               │ │
                                    │  │   GROQ_API_KEY        │ │
                                    │  │   TAVILY_API_KEY      │ │
                                    │  └───────┬───────────────┘ │
                                    └──────────┼─────────────────┘
                                               │ 5. outbound HTTPS
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                      Groq API            Tavily API          Edge TTS
                   (STT + LLM)            (web search)        (keyless)
```

**The key structural fact:** the browser never holds a credential. Vercel signs a short-lived room
token; LiveKit Cloud runs the agent; the agent alone holds the Groq and Tavily keys. Compromising the
frontend does not expose the AI provider keys, and compromising the agent does not expose the ability
to mint room tokens.

---

## 2. Why there is a web app at all

The most common wrong assumption about this project is that the frontend could be a single static
HTML file on any web host. It cannot.

Joining a LiveKit room requires a **JWT signed with `LIVEKIT_API_SECRET`**. Anything shipped to a
browser is readable by every visitor, so the secret cannot live there. Signing must happen on a
server. That server-side signing endpoint — `web/app/api/token/route.ts` — is the entire reason a
Next.js app exists here. Everything else in `web/` is presentation wrapped around it.

This is also why the frontend, not the agent, holds the LiveKit credentials: it is the thing that
signs. The agent gets its LiveKit connection injected by LiveKit Cloud automatically, which is why
`LIVEKIT_*` does **not** appear in the agent's secret list.

---

## 3. What happens when someone opens the link

```
  visitor                 Vercel                    LiveKit Cloud            agent worker
     │                      │                            │                        │
     │ GET /                │                            │                        │
     │─────────────────────▶│ no session → 307 /login    │                        │
     │◀─────────────────────│                            │                        │
     │                      │                            │                        │
     │ POST /api/login      │                            │                        │
     │  {username,passcode} │                            │                        │
     │─────────────────────▶│ 1. constant-time compare   │                        │
     │                      │    vs APP_PASSCODE         │                        │
     │                      │ 2. upsert learner BY       │                        │
     │                      │    USERNAME (Neon)         │                        │
     │                      │ 3. HMAC-sign the id        │                        │
     │  Set-Cookie:         │                            │                        │
     │  tutor_session =     │                            │                        │
     │   <id>.<hmac>        │                            │                        │
     │  (httpOnly, 30d)     │                            │                        │
     │◀─────────────────────│                            │                        │
     │                      │                            │                        │
     │ GET /home → /call    │                            │                        │
     │                      │                            │                        │
     │ POST /api/token      │                            │                        │
     │  (cookie rides along │                            │                        │
     │   automatically)     │                            │                        │
     │─────────────────────▶│ no valid cookie → 401      │                        │
     │                      │ valid → sign JWT (15m TTL) │                        │
     │                      │ identity = learner_<uuid>  │                        │
     │  {participantToken,  │                            │                        │
     │   serverUrl, room}   │                            │                        │
     │◀─────────────────────│                            │                        │
     │                                                   │                        │
     │ WebRTC connect with JWT                           │                        │
     │──────────────────────────────────────────────────▶│                        │
     │                                                   │ room created           │
     │                                                   │ ─── dispatch ─────────▶│
     │                                                   │                        │ on_enter():
     │                            greeting audio         │                        │ speaks greeting
     │◀──────────────────────────────────────────────────┼────────────────────────│
     │                                                   │                        │
     │ ══════════ live audio both directions ════════════│════════════════════════│
```

**The learner id in the participant identity is the only channel to the agent.** Everything the
agent later writes to the progress tables hangs off that one string; `agent/tutor.py::_learner_id_from`
parses it back out of `learner_<uuid>`. There is no other place the two halves exchange identity.

**Dispatch is implicit and this matters.** The worker registers with an *empty* agent name, which puts
LiveKit in automatic-dispatch mode: any room created on the project gets a worker. Nothing in the
frontend names the agent. If someone sets `AGENT_NAME` in `web/.env.local` to a value that no worker
is registered under, every step above still succeeds — page loads, sign-in accepts, token issues,
room connects — and then **no agent ever joins and nothing raises an error**. The user sits in
silence. This is the single most confusing failure this system can produce.

---

## 4. Inside the agent (one room = one `entrypoint()`)

```
   mic audio
      │
      ▼
   Silero VAD ─────── "user stopped talking"
      │                 (onnxruntime build — see §7)
      ▼
   Groq STT  (whisper-large-v3-turbo)
      │
      ▼
   Groq LLM  (llama-3.3-70b-versatile)  ◀──── system prompt: prompts/tutor.py
      │                                        (re-sent every turn)
      ├── may call tool: search_web ──▶ Tavily ──▶ synthesized answer
      │                                 (meanwhile: with_filler speaks
      │                                  "Let me search the web for…")
      ▼
   Edge TTS  (en-US-JennyNeural, keyless)
      │
      ▼
   MP3 → PyAV decode → PCM s16 mono 24 kHz
      │
      ▼
   speaker
```

Everything on this path is a free tier: Groq for STT and LLM, Tavily at 1,000 searches/month, and
Edge TTS which needs no key at all.

---

## 5. Deployment pipeline

> **`README.md` is the runbook** — copy-pasteable commands, first-time setup in order, the rotation
> and rollback procedures. This section is the *model*: what the pipeline is, why it's shaped this
> way, and where it lies to you. Read this to understand it; read the README to operate it.

### Three targets, two of them deployable

```
   repo root ──── lk agent deploy ─────────────────▶  LiveKit Cloud   (the writer)
   web/      ──── vercel deploy --prod ────────────▶  Vercel          (the reader)
   progress/schema.sql ── scripts/apply_schema.py ─▶  Neon Postgres   (out of band)
```

The database is **not** part of either deploy. Nothing in `lk agent deploy` or `vercel deploy` runs a
migration, checks the schema, or notices that it's out of date. `progress/schema.sql` is applied by
`python scripts/apply_schema.py`; it is idempotent throughout (`CREATE ... IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, guarded `UPDATE`s), which is *why* re-running it is a safe migration and
why there is no version table. New DDL must preserve that property.

A schema change is a manual, out-of-band step you must remember to do **before** deploying the code
that depends on it — otherwise the agent will happily run and fail every insert into the shutdown
callback's swallowed exception handler, and the only symptom is progress rows that never appear.

### Both halves build from your working tree, not from git

There is no CI, no GitHub trigger, no branch that represents production. Consequences worth
internalising:

- Uncommitted local edits **will** ship if you deploy.
- The deployed artifact may correspond to no commit that exists anywhere.
- A teammate cloning the repo cannot reproduce what is live without your working tree.
- The two halves can silently drift to different versions of the same change, because deploying one
  does not deploy the other.

Connecting the repo to GitHub would give push-to-deploy on Vercel. That has not been done.

### Agent deploy, step by step

```
lk agent deploy
   │
   ├─ reads livekit.toml  → project demo-yygoau1f, agent CA_e4HZqEcBFotF
   ├─ builds Dockerfile   → python:3.13-slim, pip install -r requirements.txt
   ├─ pushes image to LiveKit's registry
   └─ rolling update      → status: Updating ─▶ Running   (~10s observed)
```

The container runs `python main.py start`. Verify with:

```bash
lk agent status     # want: Status = Running, replicas non-zero
lk agent logs       # want: "registered worker", no traceback
```

**`registered worker` is the real success signal, not "Deployed agent".** `config/settings.py`
constructs `Settings()` at import time, so any missing secret raises a pydantic error *before* the
agent code runs. The image still builds and deploys fine; the container then dies on startup. A
missing secret is a **crashloop, not a degraded agent**. Reaching `registered worker` proves every
required key was present.

### Web deploy, step by step

```
vercel deploy --prod
   │
   ├─ uploads web/ (respecting .gitignore — .env.local never leaves your machine)
   ├─ pnpm install --frozen-lockfile
   ├─ pnpm build   → prettier + eslint + tsc + next build
   ├─ injects Vercel env vars (NOT your .env.local)
   └─ aliases → english-tutor-nine-green.vercel.app
```

The build is strict: a formatting violation fails it, not just a type error. Run `pnpm build` locally
before deploying.

### Secrets: four stores, none of them synced

This is the part that bites people. Adding a key to `.env` makes it work locally and then fail in
production, silently as far as your terminal is concerned.

| Store | Contains | How to write it | Read by |
|---|---|---|---|
| `.env` (repo root, gitignored) | everything | edit the file | local `main.py` runs only |
| `web/.env.local` (gitignored) | `LIVEKIT_*`, `APP_PASSCODE`, `DATABASE_URL`, empty `AGENT_NAME` | edit the file | local `pnpm dev` only |
| LiveKit Cloud agent secrets | `GROQ_API_KEY`, `TAVILY_API_KEY`, `PROGRESS_DATABASE_URL` | `lk agent update-secrets --secrets "K=V"` | the deployed agent |
| Vercel project env | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_PASSCODE`, `DATABASE_URL` | `vercel env add K production` | the deployed web app |

The agent and the web app reach the **same Neon database under different names** —
`PROGRESS_DATABASE_URL` on the agent (the writer) and `DATABASE_URL` on Vercel (the reader,
and the name the Neon integration provisions automatically). The agent writes progress rows at
the end of each session; the web app only ever reads them. They never talk to each other directly.

Use the **pooled** URL for the agent and the **unpooled** one for DDL. Neon's default `DATABASE_URL`
points at PgBouncer in transaction-pooling mode, which cannot support the prepared statements asyncpg
caches by default — hence `statement_cache_size=0` in `progress/repository.py`. Without it you get
`prepared statement "__asyncpg_stmt_1__" does not exist`, intermittently, under concurrency.

Notes learned the hard way:

- `lk agent update-secrets` **merges**; it does not wipe the others. Verify with `lk agent secrets list`.
- LiveKit Cloud injects `LIVEKIT_*` into the agent container itself. That is why those keys are absent
  from the agent's secret list yet mandatory on Vercel.
- **Vercel env changes do not affect existing deployments.** Rotating `APP_PASSCODE` requires a
  redeploy to take effect. This is not obvious and looks like the change "didn't save".
- **`vercel integration add` overwrites `web/.env.local`** with only the integration's variables,
  destroying the LiveKit keys and the passcode. `vercel env pull` cannot restore them: they are marked
  *sensitive* and come back as empty strings, so the file looks repaired and is not. See §9.

### Adding a new secret — the checklist

1. Add it to `.env` (local agent) and/or `web/.env.local` (local website).
2. Add it to `config/settings.py` as a required field **only if the agent needs it** — remember this
   turns a missing value into a production crashloop. Think about whether the feature it powers is a
   precondition for the tutor or merely a feature *of* it; `PROGRESS_DATABASE_URL` is optional for
   exactly that reason.
3. Push it to whichever store the *runtime that reads it* uses (table above).
4. Redeploy that half. **Env changes never apply to existing deployments.**
5. Confirm: `lk agent logs` → `registered worker`, or re-test the web flow.

### Changing the database schema — the checklist

There is no migration tool, so the ordering is on you:

1. Edit `progress/schema.sql`. Keep it idempotent.
2. Apply it against the **unpooled** URL: `psql "$DATABASE_URL_UNPOOLED" -f progress/schema.sql`.
3. *Then* deploy the code that depends on it. The reverse order gives you an agent whose inserts fail
   inside a swallowed exception handler — no crash, no error in the UI, just progress rows that never
   appear.
4. If the new column is only a metric, you probably don't need any of this: unknown metric keys land
   in the `sessions.extra` JSONB column automatically. Promote to a real column later.

---

## 6. The passcode gate — why it exists, and don't delete it

`app/api/token/route.ts` shipped from LiveKit's template with a hard refusal to run in production:

```ts
throw new Error('THIS API ROUTE IS INSECURE. DO NOT USE THIS ROUTE IN PRODUCTION WITHOUT AN AUTHENTICATION LAYER.');
```

That was not paranoia. The route mints a room token for **anyone who asks**, and every token starts a
real agent session consuming Groq, Tavily, and LiveKit quota. Public Vercel URLs get crawled. Left
open, a bot can drain all three free tiers.

Sign-in is the authentication layer that warning demanded:

```
POST /api/login   ──▶  1. constant-time compare against APP_PASSCODE
   {username,           ✗ → 401  (checked FIRST — before the username is even
    passcode}                     looked at, so the error messages cannot be used
                                  to probe which usernames exist)
                       2. upsert learners ON CONFLICT (username)
                       3. Set-Cookie: tutor_session =
                             <learnerId> "." HMAC-SHA256(
                                 key = APP_PASSCODE + ":" + LIVEKIT_API_SECRET,
                                 msg = learnerId)
                             httpOnly, sameSite=lax, secure, 30d

POST /api/token   ──▶  recompute the HMAC server-side, compare
                       ✗ → 401, no token
                       ✓ → sign the LiveKit JWT, identity = learner_<uuid>
```

One cookie carries two facts — *you passed the passcode* and *you are this learner* — because they
were always issued together and expired apart. The previous design had a separate unlock cookie and
learner cookie, which made "authenticated but anonymous" and "identified but locked out" both
representable, and both meaningless.

Properties this buys:

- The passcode never reaches client-side JavaScript.
- The cookie cannot be forged without `LIVEKIT_API_SECRET`, which never leaves the server.
- **Rotating `APP_PASSCODE` invalidates every live session**, because the passcode is part of the
  HMAC key. A rotation that left existing sessions running would not be a rotation.
- No session table: the signature *is* the state.
- `TokenSource.endpoint()` is same-origin, so the cookie is attached automatically. No SDK
  modification, no custom headers.

**Residual risks, accepted deliberately:**

- `/api/login` has no rate limiting, so the passcode is brute-forceable given time. Fine for a link
  shared with people you know and *not* fine for a link posted publicly. Closing it means IP rate
  limiting, which needs a KV store (Vercel KV or Upstash).
- **A username is an identifier, not a credential.** Everyone shares one passcode, so anyone holding
  it can sign in as anyone else and read their dashboard. This design authenticates *the group* and
  merely distinguishes *the members*. Going public means real per-user credentials — at that point
  the shared passcode is the weak link, and no amount of cookie hardening compensates.

---

## 7. Decision log — where we did *not* take the obvious path

These are the choices most likely to be "cleaned up" by someone who doesn't know why they're there.

| Decision | Obvious alternative | Why we didn't |
|---|---|---|
| **Stub `livekit.local_inference` in `main.py`** | just import it | Its native `.pyd` calls Windows `ExitProcess()` during init on this machine. A process-level exit **cannot be caught** by `try`/`except`. The stub must be installed before the first livekit import — import order in `main.py` is load-bearing. Windows-only; stubbing it on Linux would needlessly disable end-of-turn detection. |
| **VAD loaded via `onnx_file_path=`** | `silero.VAD.load()` | The bare call delegates to `inference.VAD`, which imports the stubbed module above. The stub's `predict()` returns `0.0` forever, so speech is *never* detected — the agent responds only to typed input and appears deaf to the mic, with no error. Passing the onnx path forces the onnxruntime runtime. Same weights. |
| **Tavily for search** | raw Google/Bing API | Tavily returns a synthesized `answer` string. A voice reply should be built from a sentence, not from ten blue links. |
| **Search announcement via `RunContext.with_filler`** | `session.say()` before searching | `with_filler` only speaks while the session is *idle*, so it cannot talk over the user, and it cancels cleanly when the search returns. A manual `say()` races the reply. |
| **Tool returns error *strings*** | raise on failure | A raised exception surfaces to the LLM as an opaque tool failure. A sentence like *"the search timed out, tell the user"* produces a graceful spoken reply instead. |
| **Tavily's `answer` is the whole tool output** | also pass the raw snippets | Real snippets are markdown-link soup and sometimes raw JSON (weather providers). Feeding those to a TTS pipeline invites reading URLs aloud. Snippets are a fallback only, and get stripped of links first. Keeping a URL out of the audio is done by never handing the LLM one. |
| **Whether to search is decided in the prompt** | a code-level gate | "Search if asked", "don't search if told not to", "never for grammar" are all prompt rules. There is no code path that blocks a search. |
| **`pnpm` in `web/`, never `npm`** | npm | The template pins `pnpm-lock.yaml`. npm ignores it and resolves a newer `motion` whose stricter `Easing` type rejects the template's own `ease: 'linear'`. The build then fails on a type error in code you never touched. |
| **`.gitattributes` forcing LF in `web/`** | leave it | The template's prettier config enforces LF and the build runs prettier. A Windows checkout converts everything to CRLF → hundreds of `Delete ␍` errors. |
| **Camera + screen share disabled in the UI** | leave the template defaults | Ahmad is voice-only and has no vision. Those buttons would do nothing, and offering them to a non-technical user is a trap. |
| **`PROGRESS_DATABASE_URL` optional, every other secret required** | make it required like the rest | A required secret is a crashloop when missing (§5). That is the right trade for `GROQ_API_KEY` — an agent that cannot speak is worthless. It is the wrong trade for the database: it would turn a Neon outage into a tutor that refuses to start, trading a working voice call for a chart nobody can look at during an outage anyway. |
| **Session grading runs at shutdown, not per turn** | grade each turn as it arrives | Grading is a 70B call. In the middle of a voice conversation the user hears it as Ahmad going silent. At shutdown nobody is waiting, and the grader gets the *whole* conversation — the only way it can see the same mistake made four times and count it once. |
| **Deterministic metrics kept separate from LLM grading** | one LLM call produces everything | Arithmetic on a transcript cannot hallucinate; an LLM can. Keeping them apart means a failed or unreachable grader degrades to `NULL` while word count, pace, and complexity still land. A single call would lose the whole session to one bad response. |
| **Pronunciation is NOT scored** | score it from the STT | Whisper exposes no phonemes and is *explicitly trained to be robust to accents* — the signal pronunciation assessment needs is precisely the one it is designed to discard. A number here would be fabricated, and a learner would act on it. Delivery proxies (pace, hesitation, self-repair) are measured instead and labelled as such. Real phoneme scoring needs Azure Speech Pronunciation Assessment. |
| **Reading/listening comprehension not tracked** | add the metric | There is no reading or listening *exercise* in the app. There is nothing to comprehend and therefore nothing to measure. The metric would be an invented number attached to an activity that does not exist. |
| **Errors stored one row each, not as per-session counts** | store a count per category | "You fixed articles last week and they're back this week" is then a *query* rather than a re-analysis. That recurrence signal is the single thing a general chatbot structurally cannot offer, because it remembers nothing between conversations. It is the reason this feature exists. |
| **CEFR smoothed over sessions before display** | show the latest session's estimate | A single session's estimate genuinely swings A2↔B2 on topic alone — the learner didn't change, the conversation did. A level that lurches after a good chat teaches the learner the dashboard is nonsense. Raw values are stored; smoothing happens on read, so improving the smoothing never needs a backfill. |
| **Metrics return `None`, never `0.0`, when unmeasurable** | default to zero | Zero plots as a real data point. A learner who said twelve words would show a triumphant dip in the error-rate chart at the exact moment we knew least about them. `NULL` renders as a gap, which is the truth. |
| **Taxonomy in JSON, not in Python** | keep the dataclasses | The dashboard needs the same labels and advice, and Vercel deploys from `web/` and cannot read files above it. One JSON file plus `scripts/sync_taxonomy.py` beats two hand-maintained lists that drift. |
| **Identity keyed to a USERNAME, not to the browser** | keep the per-browser cookie (it needed no login screen) | Progress that lives in a cookie is progress that does not exist on your other phone. The same person on a laptop and a phone was two learners with two disjoint histories, and neither one was right. A username costs a login screen and buys the thing the feature is *for* — a history that is yours, wherever you open it. |
| **One session cookie, not an unlock cookie + a learner cookie** | keep them separate; they authenticate different things | They were always issued together and always expired apart, which made "authenticated but anonymous" and "identified but locked out" both representable and both meaningless. Folding the passcode into the HMAC key means one signature proves both facts — and makes rotating the passcode actually revoke live sessions, which two independent cookies could not. |
| **Passcode checked *before* the username is validated** | validate the input first, it's cheaper | Validating the username first leaks which usernames exist, through the difference between "no such user" and "wrong passcode" — to someone who does not have the passcode at all. The cheap check goes second on purpose. |
| **`AppShell` takes an `active` tab as a prop** | read `usePathname()` in the header | `usePathname` is a client hook, and using it would drag the entire header — nav, learner chip, sign-out — into the client bundle to answer a question the page already knows the answer to. The page states which tab it is; the header stays a server component. |
| **Sign-out clears the cookie and deletes nothing** | also clear the learner's local data | There is no local data to clear, and that is the point. The history lives in Postgres keyed by username, so signing out is genuinely reversible: sign back in, anywhere, and it is all there. |

---

## 8. Failure modes that look like nothing is wrong

Ranked by how much time they can waste.

| Symptom | Cause | Check |
|---|---|---|
| Page connects, call "starts", **Ahmad never speaks** | `AGENT_NAME` set in `web/` but no worker registered under that name → room created, nobody dispatched, no error anywhere | `AGENT_NAME` must be empty in `web/.env.local` and Vercel |
| Agent **deaf to the mic**, but answers typed input | VAD returning 0.0 for every frame (the `local_inference` stub) | `_load_vad()` must pass `onnx_file_path=` |
| Agent goes **silent mid-conversation** | `EdgeTTSStream._run` logs and *returns* on synthesis failure rather than raising — a failed TTS produces silence, not an error | `lk agent logs` |
| Deploy "succeeded", agent unreachable | missing secret → pydantic error at import → crashloop | `lk agent logs` for `registered worker` |
| Passcode change "didn't save" | Vercel env vars don't apply to existing deployments | redeploy after `vercel env add` |
| Everyone gets HTTP 500 on connect | the template's production `throw` in the token route is back | the session gate in `lib/session.ts` must be wired in |
| Local dev suddenly can't find `APP_PASSCODE` | `vercel integration add` overwrote `web/.env.local` — and `vercel env pull` "fixes" it with empty strings, because those keys are *sensitive* | check value **lengths** in `web/.env.local`, not key presence; recover from the repo-root `.env` and §9 |
| **Everyone is signed out at once**, and no one can sign back in with the old passcode | expected: `APP_PASSCODE` is part of the session HMAC key, so rotating it invalidates every cookie | not a bug — announce the new passcode |
| Conversation happened, **no progress row appeared** | said < 30 words (`MIN_WORDS_FOR_GRADING`), or `PROGRESS_DATABASE_URL` is set on Vercel but not on the *agent* | `lk agent logs` — `run_analysis` logs which of these it took |
| A learner's history **vanished** after the login screen shipped | identity moved from a browser cookie to a username. `schema.sql` backfills a username from each old learner's display name, but only for the **oldest** claimant of a duplicated name | sign in as the old display name, lowercased; check `SELECT username, display_name FROM learners` |
| Progress rows stop appearing after a schema change | the agent's `INSERT` now fails, inside `repository.save_report`'s catch-all — which swallows it so a lost row can't take down a worker | apply `progress/schema.sql` **before** deploying the code that needs it |
| `import progress.metrics` kills Python, **exit code 29, no traceback** | the `local_inference` `ExitProcess()` crash again — reached via `collector.py` | `progress/__init__.py` must import `TranscriptCollector` lazily via `__getattr__` |
| Dashboard shows raw keys like `verb_tense` instead of "Verb tenses" | `web/lib/progress/taxonomy.json` is stale | `python scripts/sync_taxonomy.py` |

The common thread: **this system fails quietly.** VAD failure, TTS failure, and dispatch failure all
produce silence rather than an exception. When something is wrong, assume the logs know and the UI
does not.

---

## 9. Current deployment (as of 2026-07-14)

| | |
|---|---|
| Live URL | <https://english-tutor-nine-green.vercel.app> |
| Sign-in | any username + passcode `ALEX2026`. Rotate via `vercel env add APP_PASSCODE production --force`, then redeploy — note this **signs everyone out**, because the passcode is part of the session HMAC key (§6) |
| LiveKit project | `demo-yygoau1f`, region `ap-south` (India West) |
| LiveKit agent | `CA_e4HZqEcBFotF` |
| Vercel project | `english-tutor` |
| Agent resources | 2000m CPU / 4 GB, 1 replica |
| Database | Neon `neon-violet-grass` (Vercel Marketplace), `ep-square-hat-atfqc9xa`, us-east-1 |
| Schema | `python scripts/apply_schema.py`; 4 tables, idempotent, no version table |

### A trap when adding a Vercel integration

`vercel integration add <name>` **overwrites `web/.env.local`** with only that integration's
variables. Adding Neon wiped `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and
`APP_PASSCODE` from it, and local dev then dies with `Error: APP_PASSCODE is not set`.

`vercel env pull` does **not** repair it: those four are marked *sensitive* in the Vercel
project, so the pull writes them back as empty strings. The file looks fixed and is not —
verify value *lengths*, not key presence. Recover `LIVEKIT_*` from the repo-root `.env` and the
passcode from the table above. Back the file up before adding another integration.

First connection after an idle period can take a few seconds — worker replicas were observed at 0
shortly after deploy and 1 while warm, so expect a cold start on the first call of the day.

### Not yet done

- **Nothing is committed to git.** All three deploys went from the local working tree. This is the
  biggest operational risk in the project: what is live corresponds to no commit anywhere.
- **No CI, no push-to-deploy.** Connecting the GitHub repo to Vercel would give the web half
  automatic deploys and remove the "deployed from an uncommitted tree" problem for that half.
- **No database migration tool.** `progress/schema.sql` is idempotent and re-running it *is* the
  migration. A destructive change (dropping or retyping a column) has to be hand-written, and nothing
  verifies that the deployed code and the live schema agree.
- **No rate limiting on `/api/login`** (see §6), so the passcode is brute-forceable given time.
- **Usernames are identifiers, not credentials** (see §6). Anyone with the shared passcode can sign
  in as anyone else. Real per-user auth is the fix, and it is a real fix, not a hardening pass.
- **No custom domain.**
- **Pronunciation is not scored** and cannot be with the current STT — see the header of
  `progress/metrics/fluency.py`. Azure Speech Pronunciation Assessment is the route if it's wanted.
- **A demo learner is seeded in the production database** (`Demo learner (seeded)`, 8 fake sessions).
  It is unreachable without its signed cookie, so it is invisible to real users. Remove with
  `python scripts/seed_demo.py --remove`.
