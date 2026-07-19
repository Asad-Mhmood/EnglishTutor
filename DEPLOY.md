# DEPLOY.md — the manual deploy runbook

Step-by-step, copy-pasteable. Follow it top to bottom and you cannot get the order wrong.

- `README.md` explains *what* the system is. This file is only *how to ship it*.
- `ARCHITECTURE.md` explains *why* the non-obvious parts are the way they are.

---

## 0. The three things you can deploy

They are **independent**. Deploy only the one you changed.

| # | You changed... | Then deploy | Takes |
|---|---|---|---|
| 1 | `progress/schema.sql` | the **database** | seconds |
| 2 | `web/` (any page, route, component) | the **website** | ~2 min |
| 3 | `agent/`, `prompts/`, `tools/`, `plugins/`, `config/`, `progress/*.py`, `main.py` | the **agent** | ~5–10 min |

**If you changed the schema AND code that uses it, do the database FIRST.** The agent swallows failed
inserts on purpose (a lost progress row must never kill a live voice call), so deploying code against
an old schema produces no error anywhere — just progress rows that silently never appear.

> **Both halves deploy from your LOCAL WORKING DIRECTORY, not from git.**
> Uncommitted edits **will** ship. There is no CI and no push-to-deploy. Commit first if you want
> the deployed thing to correspond to a commit that exists.

---

## 1. Before you deploy anything

```bash
cd "C:/Asad Mehmood/EnglishTutor"

git status                    # know what you are about to ship
git branch --show-current     # should be: production
```

Check you are logged in to both clouds (both are silent no-ops if you already are):

```bash
vercel whoami
lk cloud auth
```

---

## 2. Deploy the DATABASE

Only when `progress/schema.sql` changed.

```bash
cd "C:/Asad Mehmood/EnglishTutor"
python scripts/apply_schema.py
```

Expected output — that's the whole success condition:

```
applied progress\schema.sql
```

**How this works, and the rule you must not break.** There is no migration tool, no version table,
no Alembic. `schema.sql` is idempotent — every statement is `CREATE ... IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, or a guarded `UPDATE` — and **re-running the file IS the migration**.

So when you add new DDL, write it so that **running the file twice is a no-op**. If you write a bare
`ALTER TABLE ... ADD COLUMN`, the second run fails and this whole scheme stops working.

Verify it actually landed:

```bash
python -c "
import asyncio, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path('.env'))
import asyncpg

async def main():
    c = await asyncpg.connect(os.environ['PROGRESS_DATABASE_URL'], statement_cache_size=0)
    for r in await c.fetch('''
        SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name
    '''):
        print(r['table_name'])
    await c.close()

asyncio.run(main())
"
```

Expect five tables: `learner_avatars`, `learner_vocabulary`, `learners`, `session_errors`,
`sessions`.

---

## 3. Deploy the WEBSITE

```bash
cd "C:/Asad Mehmood/EnglishTutor/web"

pnpm install                  # NOT npm — see the trap below
pnpm build                    # catch type errors HERE, not on Vercel
vercel deploy --prod --yes
```

`pnpm build` runs prettier + eslint + tsc, and is **exactly what Vercel runs**. If it passes locally
it will pass there. Running it first turns a 2-minute remote failure into a 30-second local one.

### Verify (do not skip)

```bash
B=https://english-tutor-nine-green.vercel.app

curl -s -o /dev/null -w "GET /  -> %{http_code} %{redirect_url}\n" "$B/"
# want: 307 -> /login   (a signed-out visitor must be bounced to the login page)

curl -s -o /dev/null -w "POST /api/token -> %{http_code}\n" \
  -X POST "$B/api/token" -H 'Content-Type: application/json' -d '{}'
# want: 401   (if this EVER returns 200, the auth gate is broken — see the warning below)
```

Then in a browser: sign in, land on **Home**, open **Dashboard**.

> ### The token route must never be open
> `POST /api/token` mints a real LiveKit room token, and every token starts an agent session that
> burns Groq, Tavily and LiveKit quota. Public Vercel URLs get crawled by bots. The upstream template
> **refuses to run that route in production at all** — sign-in is what replaced that refusal.
> If the 401 check above ever returns 200, stop and fix it before doing anything else.

---

## 4. Deploy the AGENT

```bash
cd "C:/Asad Mehmood/EnglishTutor"
lk agent deploy
```

This uploads the repo and builds a Docker image **on LiveKit's servers**, not yours. It takes several
minutes.

> ### A timeout here does NOT mean the deploy failed
> `lk agent deploy` regularly prints:
> ```
> unable to deploy agent: Post "https://agents.livekit.cloud/build?...": context deadline exceeded
> ```
> That is the **CLI giving up on waiting**. The build was already accepted and is still running on
> LiveKit's side. **Do not immediately re-run `lk agent deploy`** — you would kick off a second,
> competing build. Run `lk agent status` instead and read the truth from there.

### Verify (do not skip)

```bash
lk agent status
```

Wait for `Status` to go `Building` → **`Running`**. Then, the only check that actually proves it:

```bash
lk agent logs
```

**You are looking for the line `registered worker`, with no traceback above it.**

That line is the real success condition, and here is why nothing else is. `config/settings.py`
constructs `Settings()` at *import* time, so a missing secret (`GROQ_API_KEY`, `TAVILY_API_KEY`, …)
raises a pydantic validation error **before any agent code runs**. On a deployed worker that is a
**crashloop**, not a degraded agent. `Status: Running` can be shown while the container is dying on
boot over and over. `registered worker` cannot.

Finally, the end-to-end test: open the site, sign in, start a call. **If you hear Ahmad's greeting,
every layer below it is working** — token, dispatch, VAD, STT, LLM and TTS all had to succeed to
produce that one sentence.

---

## 5. Full deploy, in order (first-time setup, or when everything changed)

```bash
cd "C:/Asad Mehmood/EnglishTutor"

# 1. database first — code that needs a column must never ship before the column
python scripts/apply_schema.py

# 2. agent
lk agent deploy
lk agent status                     # wait for Running
lk agent logs                       # want: registered worker

# 3. website
cd web
pnpm install
pnpm build
vercel deploy --prod --yes
```

---

## 6. Secrets — four stores, none of them synced

This is the single most common source of "it works locally and fails in production".

| Where | Holds | Set with |
|---|---|---|
| `.env` (repo root, gitignored) | everything, for local agent runs | edit the file |
| `web/.env.local` (gitignored) | `LIVEKIT_*`, `APP_PASSCODE`, `AVATAR_PASSCODE`, `DATABASE_URL`, empty `AGENT_NAME` | edit the file |
| LiveKit Cloud agent secrets | `GROQ_API_KEY`, `TAVILY_API_KEY`, `PROGRESS_DATABASE_URL`, `BITHUMAN_API_SECRET` | `lk agent update-secrets --secrets "K=V"` |
| Vercel project env | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_PASSCODE`, `AVATAR_PASSCODE`, `DATABASE_URL` | `vercel env add K production` |

**Adding a key to `.env` alone works locally and then fails in production**, and your terminal will
not tell you.

Two things worth knowing:

- The agent and the website reach the **same Neon database under different names**:
  `PROGRESS_DATABASE_URL` on the agent (which *writes*), `DATABASE_URL` on Vercel (which *reads*).
  That is deliberate — `DATABASE_URL` is the name the Neon integration sets automatically.
- `lk agent update-secrets` **merges**. It does not replace. Changing one key leaves the rest alone.

### Rotating the passcode

```bash
cd web
vercel env add APP_PASSCODE production --force
vercel deploy --prod --yes          # REQUIRED — env changes do NOT apply to existing deployments
```

**This signs everybody out**, including you. The passcode is part of the session cookie's HMAC key,
so rotating it invalidates every live session. That is the point of a rotation — not a bug.

Also update `web/.env.local` and `ARCHITECTURE.md` §9 to match, or local and deployed will disagree.

---

## 7. Rollback

**Website** — instant, and the safest thing in this document:

```bash
cd web
vercel ls                                # find the previous good deployment URL
vercel promote <deployment-url>          # re-points the live alias at it
```

**Agent** — there is no rollback command. Check out a known-good commit and redeploy:

```bash
git log --oneline -10
git checkout <good-commit>
lk agent deploy
git checkout production                  # don't forget this
```

**Database** — there is no down-migration. A destructive change has to be hand-written and undone by
hand. This is the one place to be slow and careful.

---

## 8. Traps that have already bitten, in the order they are likely to bite again

**`lk agent deploy` times out but the build is fine.** Covered in §4. Check `lk agent status`, do not
blindly retry.

**`AGENT_NAME` must stay EMPTY.** The worker registers with an empty agent name, which means
*automatic dispatch* — it joins any room created on the project. If `AGENT_NAME` is set in `web/` to
a value no worker is registered under, the page loads, sign-in works, the token issues, the room
connects — and **no agent ever joins and nothing errors anywhere**. The user just sits in silence.
This is the single most confusing failure this system can produce, and the first thing to suspect
when the page works but Ahmad never speaks.

**Use `pnpm` in `web/`, never `npm`.** The template pins `pnpm-lock.yaml`. npm ignores it and resolves
a newer `motion` whose stricter types reject the template's own code, and `pnpm build` then fails on
a type error in a file you never touched.

**`vercel integration add` DESTROYS `web/.env.local`.** It rewrites the file with only the
integration's own variables, wiping `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and
`APP_PASSCODE`.

`vercel env pull` **cannot repair it** — those four are marked *sensitive*, so the pull writes them
back as empty strings. **The file then looks fixed and is not.** Check value *lengths*, not key
presence. Recover `LIVEKIT_*` from the repo-root `.env` and the passcode from `ARCHITECTURE.md` §9.

**Back the file up before adding any integration.**

**`pnpm build` fails with hundreds of `Delete ␍` errors.** A Windows checkout rewrote the template to
CRLF. Fix with `pnpm exec prettier --write .` from `web/` — do not edit the prettier config.

**Progress rows silently stop appearing after a schema change.** The agent's `INSERT` is now failing
inside `repository.save_report`'s catch-all, which swallows it so that a lost row can never take down
a live voice call. Nothing errors. Apply the schema **before** deploying the code that needs it.

---

## 9. What is deployed where

| | |
|---|---|
| Live URL | <https://english-tutor-nine-green.vercel.app> |
| Sign-in | any username + the shared passcode (`ARCHITECTURE.md` §9) |
| Vercel project | `english-tutor` |
| LiveKit project | `demo-yygoau1f`, region `ap-south` |
| LiveKit agent | `CA_e4HZqEcBFotF` |
| Database | Neon `neon-violet-grass` |

The first call after an idle period takes a few seconds — the agent scales to zero when nobody is
using it and has to wake up. That is not a bug and not a failed deploy.
