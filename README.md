# English Tutor

A real-time voice agent that acts as a conversational English tutor. You talk, it listens, and it
talks back — correcting mistakes naturally in the flow of conversation rather than stopping to
lecture.

The tutor persona is "Alex": patient, encouraging, and calibrated to your proficiency level. It
embeds corrections into its replies (you say *"I goed to the store"*, it answers *"Oh, you went to
the store! What did you get?"*) and always ends with a follow-up question to keep you talking.

## How it works

Audio flows through a four-stage pipeline, orchestrated by [LiveKit Agents](https://docs.livekit.io/agents/):

```
mic → Silero VAD → Groq STT → Groq LLM → Edge TTS → speaker
                (whisper-large-v3-turbo)  (llama-3.3-70b)
```

Voice activity detection decides when you've stopped speaking, speech-to-text transcribes it, the LLM
generates a reply, and text-to-speech voices it. Everything runs on free tiers: Groq's free API for
STT and LLM, and Microsoft Edge's neural voices for TTS, which need no API key at all.

## Requirements

- Python 3.13
- A [Groq API key](https://console.groq.com) (free)
- A [LiveKit](https://cloud.livekit.io) project — free tier is fine

You only need LiveKit credentials to run in a real room. Local console mode still reads them from
`.env`, so fill them in either way.

## Setup

```bash
python -m venv .venv
.venv/Scripts/activate          # Windows
# source .venv/bin/activate     # macOS / Linux

pip install -r requirements.txt
```

Create a `.env` file in the project root:

```ini
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret

GROQ_API_KEY=your_groq_key
```

These four are required — the app fails immediately on startup if any are missing. Optional
overrides, with their defaults:

| Variable | Default |
|---|---|
| `LLM_MODEL` | `llama-3.3-70b-versatile` |
| `STT_MODEL` | `whisper-large-v3-turbo` |
| `TTS_VOICE` | `en-US-JennyNeural` |
| `AGENT_GREETING` | *(see `config/settings.py`)* |

Any [Edge TTS voice](https://github.com/rany2/edge-tts) works for `TTS_VOICE` — run
`edge-tts --list-voices` to see them all.

## Running

The quickest way to try it is console mode, which uses your microphone and speakers directly and
doesn't need a LiveKit room:

```bash
python main.py console
```

To run against a real LiveKit room, start the agent as a worker and join the room from any LiveKit
client:

```bash
python main.py dev      # hot reload on file changes
python main.py start    # production
```

`python main.py download-files` pre-fetches model weights (such as Silero VAD) if you'd rather not
wait for them on first run.

## Project layout

```
main.py                 entry point — see the note below
agent/tutor.py          pipeline wiring and the Agent subclass
prompts/tutor.py        the tutor's system prompt
plugins/edge_tts.py     custom LiveKit TTS plugin for Microsoft Edge TTS
config/settings.py      env-backed settings
utils/logger.py         logging setup
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

The tutor's behavior lives entirely in `prompts/tutor.py`. It's written for speech, so it forbids
markdown, bullet points, and headers — anything the LLM emits goes straight to text-to-speech and
would be read aloud verbatim. Keep that constraint if you edit it.

Swapping providers means changing one line each in `agent/tutor.py`. LiveKit ships plugins for
OpenAI, Deepgram, Cartesia, ElevenLabs, and others; the `EdgeTTS` class in `plugins/edge_tts.py` is
only there because Edge TTS is free and had no official plugin.
