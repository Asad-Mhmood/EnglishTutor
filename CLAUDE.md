# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A LiveKit voice agent that acts as a conversational English tutor ("Alex"). A user joins a LiveKit
room and speaks; the agent transcribes, generates a reply, and speaks back.

## Commands

The venv lives at `.venv` (Python 3.13). `main.py` delegates to `livekit.agents.cli.run_app`, which
exposes these subcommands:

```bash
.venv/Scripts/python.exe main.py console         # run locally, mic + speakers, no LiveKit room needed
.venv/Scripts/python.exe main.py dev             # connect to LIVEKIT_URL, hot reload (--reload)
.venv/Scripts/python.exe main.py start           # production worker
.venv/Scripts/python.exe main.py download-files  # pre-fetch model files (e.g. Silero VAD weights)
```

`console` is the fastest feedback loop — it simulates a job without a real room.

There are no tests, linters, or formatters configured.

## Environment

`.env` is required and gitignored. `config/settings.py` instantiates `Settings()` at module scope, so
a missing `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GROQ_API_KEY`, or `TAVILY_API_KEY`
raises a pydantic validation error at *import* time, before any agent code runs. Everything else (`LLM_MODEL`,
`STT_MODEL`, `TTS_VOICE`, `AGENT_GREETING`) has a default and can be overridden via env.

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

### `plugins/edge_tts.py` — custom TTS adapter

Microsoft Edge TTS is free and keyless, but livekit has no plugin for it. `EdgeTTS` implements
`tts.TTS` with `streaming=False`, so each reply is synthesized as one chunk:

```
text → edge_tts.Communicate → MP3 bytes → PyAV decode + resample → PCM s16 mono 24 kHz → output_emitter
```

24 kHz matches Edge TTS's native rate, so no resampling loss. Note that `EdgeTTSStream._run` logs and
returns on synthesis failure rather than raising — a failed or empty synthesis produces **silence**,
not an error, so check logs when the agent goes quiet.
