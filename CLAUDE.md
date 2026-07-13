# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A LiveKit voice agent that acts as a conversational English tutor ("Alex"). A user joins a LiveKit
room and speaks; the agent transcribes, generates a reply, and speaks back.

**There are two separately deployed halves.** Changing one does not redeploy the other:

| | Code | Runs on | Deploy with |
|---|---|---|---|
| Agent (the voice worker) | repo root | LiveKit Cloud, agent `CA_e4HZqEcBFotF` | `lk agent deploy` |
| Frontend (the shareable link) | `web/` | Vercel, project `english-tutor` | `cd web && vercel deploy --prod` |

Live link: <https://english-tutor-nine-green.vercel.app> (passcode-gated, see `web/` below).

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

### Frontend (`web/`)

```bash
cd web
pnpm install      # NOT npm — see the pnpm note under `web/` below
pnpm dev          # localhost:3000
pnpm build        # runs prettier + eslint + tsc; this is what Vercel runs
```

## Environment

Secrets live in **three** places and they are not synced. Adding a key to `.env` alone will work
locally and then fail in production.

| Where | Holds | Set with |
|---|---|---|
| `.env` (repo root, gitignored) | everything, for local runs | edit the file |
| LiveKit Cloud agent secrets | `GROQ_API_KEY`, `TAVILY_API_KEY` | `lk agent update-secrets --secrets "K=V"` |
| Vercel project env | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_PASSCODE` | `vercel env add K production` |

LiveKit Cloud injects `LIVEKIT_*` into the agent container itself, which is why those are absent from
the agent's secret list but required by Vercel. `lk agent update-secrets` **merges**, it does not
replace.

`config/settings.py` instantiates `Settings()` at module scope, so a missing `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GROQ_API_KEY`, or `TAVILY_API_KEY` raises a pydantic
validation error at *import* time, before any agent code runs. On a deployed worker this means a
missing secret is a **crashloop**, not a degraded agent. Everything else (`LLM_MODEL`, `STT_MODEL`,
`TTS_VOICE`, `AGENT_GREETING`) has a default and can be overridden via env.

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

#### The passcode gate (`lib/auth.ts`, `app/api/unlock/route.ts`) — don't remove it

The template's token route **deliberately throws in production**:

```ts
throw new Error('THIS API ROUTE IS INSECURE. DO NOT USE THIS ROUTE IN PRODUCTION WITHOUT AN AUTHENTICATION LAYER.');
```

It hands a room token to anyone who asks, and every token starts a real agent session that burns
Groq, Tavily and LiveKit quota. Public Vercel URLs get crawled. The passcode gate is the
authentication layer that warning demands, and it is what replaced the `throw`:

1. `POST /api/unlock` compares the submitted passcode against `APP_PASSCODE` in constant time, and on
   success sets an httpOnly cookie whose value is `sha256(passcode + ":" + LIVEKIT_API_SECRET)`.
2. `POST /api/token` mints nothing without a valid cookie — it 401s.

The passcode never reaches client-side JS, and the cookie can't be forged without the API secret. The
cookie rides along automatically because `TokenSource.endpoint()` is same-origin; no header plumbing
was needed.

Rotate the passcode with `vercel env add APP_PASSCODE production --force` **and redeploy** — env
changes do not apply to existing deployments.

Known gap: `/api/unlock` has no rate limiting, so the passcode is brute-forceable given enough time.
Acceptable for a link shared with friends; if this ever goes properly public, add IP rate limiting
there (needs a KV store — Vercel KV or Upstash).

### `plugins/edge_tts.py` — custom TTS adapter

Microsoft Edge TTS is free and keyless, but livekit has no plugin for it. `EdgeTTS` implements
`tts.TTS` with `streaming=False`, so each reply is synthesized as one chunk:

```
text → edge_tts.Communicate → MP3 bytes → PyAV decode + resample → PCM s16 mono 24 kHz → output_emitter
```

24 kHz matches Edge TTS's native rate, so no resampling loss. Note that `EdgeTTSStream._run` logs and
returns on synthesis failure rather than raising — a failed or empty synthesis produces **silence**,
not an error, so check logs when the agent goes quiet.
