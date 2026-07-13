# English Tutor

A real-time voice agent that acts as a conversational English tutor. You talk, it listens, and it
talks back — correcting mistakes naturally in the flow of conversation rather than stopping to
lecture.

The tutor persona is "Alex": patient, encouraging, and calibrated to your proficiency level. It
embeds corrections into its replies (you say *"I goed to the store"*, it answers *"Oh, you went to
the store! What did you get?"*) and always ends with a follow-up question to keep you talking.

## Try it

**<https://english-tutor-nine-green.vercel.app>** — passcode `ALEX2026`

Open it, enter the passcode, tap **Start talking**, and allow the microphone. Nothing to install; it
works on a phone. Alex greets you first, so if you hear the greeting, everything downstream is
working.

The first call of the day can take a few seconds to connect — the agent worker scales to zero when
idle and has to wake up.

## How it works

Two halves, deployed separately:

```
   your browser                  LiveKit Cloud
┌────────────────┐            ┌─────────────────┐
│  web/  (Next)  │            │  the agent      │
│  on Vercel     │ ── room ── │  worker         │
│                │            │                 │
│ mints the JWT  │            │ STT → LLM → TTS │
└────────────────┘            └─────────────────┘
```

The frontend exists mainly to mint a room token. Joining a LiveKit room needs a JWT signed with your
API secret, and a secret can never ship to a browser — so a shareable link needs a small server-side
piece to sign one per visitor. That is the whole reason this isn't a single static HTML page.

The agent itself is where the voice pipeline lives, orchestrated by
[LiveKit Agents](https://docs.livekit.io/agents/):

```
mic → Silero VAD → Groq STT → Groq LLM → Edge TTS → speaker
                (whisper-large-v3-turbo)  (llama-3.3-70b)
```

Voice activity detection decides when you've stopped speaking, speech-to-text transcribes it, the LLM
generates a reply, and text-to-speech voices it. Everything runs on free tiers: Groq's free API for
STT and LLM, and Microsoft Edge's neural voices for TTS, which need no API key at all.

## Web search

Alex can look things up. When you ask about something that changes — the news, the weather, a price,
last night's score — the LLM calls a `search_web` tool backed by [Tavily](https://tavily.com).

Because a search takes a few seconds and dead air is unnerving on a voice call, the agent says what
it's doing before it goes quiet: *"Let me search the web for tomorrow's weather in Lahore. One
moment."* If the search runs long, it checks back in once more.

You stay in control of when it happens:

- Ask it to look something up and it will, even if it thinks it already knows.
- Tell it not to search and it won't — it'll answer from memory and warn you that its information
  may be out of date.
- Ordinary conversation practice, grammar, and vocabulary never trigger a search.

If Tavily is unreachable or times out, Alex tells you it couldn't reach the web rather than going
silent or inventing an answer.

## Requirements

For the agent:

- Python 3.13
- A [Groq API key](https://console.groq.com) (free)
- A [Tavily API key](https://tavily.com) (free tier: 1000 searches/month)
- A [LiveKit](https://cloud.livekit.io) project — free tier is fine

For the web frontend, and only if you're changing or redeploying it:

- Node 20+ and [pnpm](https://pnpm.io) (`npm install -g pnpm`)
- A [Vercel](https://vercel.com) account (free)

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
TAVILY_API_KEY=your_tavily_key
```

These five are required — the app fails immediately on startup if any are missing. Optional
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

### The web frontend

The shareable web app lives in `web/` (Next.js, from LiveKit's `agent-starter-react` template).

```bash
cd web
pnpm install     # use pnpm, not npm — npm resolves a newer `motion` that breaks the build
pnpm dev         # http://localhost:3000
```

It needs its own `web/.env.local`:

```ini
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret

APP_PASSCODE=ALEX2026    # what visitors must type to start a call
AGENT_NAME=              # must stay EMPTY — see below
```

**Leave `AGENT_NAME` blank.** The worker registers with no agent name, which means it auto-joins any
room the frontend creates. If you set a name here that doesn't match a worker registered under that
exact name, the page will load, the call will "connect", and Alex will simply never speak — with no
error anywhere. That's the first thing to check if the app goes silent.

## Deploying

The two halves deploy independently. Changing the prompt does not redeploy the website; changing the
website does not redeploy the agent.

```bash
lk agent deploy                      # the agent  → LiveKit Cloud
cd web && vercel deploy --prod       # the website → Vercel
```

Secrets are **not** shared between them, and neither reads your local `.env` in production:

```bash
lk agent update-secrets --secrets "TAVILY_API_KEY=..."   # agent-side keys (Groq, Tavily)
cd web && vercel env add APP_PASSCODE production          # web-side keys (LiveKit creds, passcode)
```

A missing agent secret is a crashloop, not a degraded agent — `config/settings.py` validates at import
time. After `lk agent deploy`, run `lk agent logs`; reaching `registered worker` with no traceback
means every required key was present.

To change the passcode, set `APP_PASSCODE` again and redeploy — environment changes do not apply to
deployments that already exist.

## Sharing it

Send the link and the passcode. Recipients need no account and install nothing.

The passcode is not decoration. `web/app/api/token/route.ts` mints a LiveKit token for whoever asks,
and each token starts a real agent session that consumes your Groq, Tavily, and LiveKit quota. The
upstream template refuses to run that route in production for exactly this reason. The gate replaces
that refusal: `/api/unlock` checks the passcode and sets an httpOnly cookie, and the token route
issues nothing without it. The passcode never reaches browser JavaScript.

There's no rate limiting on the unlock route, so don't post the link publicly — a determined attacker
could brute-force the code. It's sized for sharing with people you know.

## Project layout

```
main.py                     entry point — see the note below
agent/tutor.py              pipeline wiring and the Agent subclass
prompts/tutor.py            the tutor's system prompt
plugins/edge_tts.py         custom LiveKit TTS plugin for Microsoft Edge TTS
tools/search.py             the search_web function tool (Tavily)
config/settings.py          env-backed settings
utils/logger.py             logging setup
Dockerfile                  what LiveKit Cloud builds
livekit.toml                which LiveKit project/agent this deploys to

web/                        the shareable frontend (Next.js)
  app-config.ts             title, button copy, colors, which inputs are enabled
  components/app/welcome-view.tsx   landing screen + the passcode form
  app/api/token/route.ts    mints the LiveKit JWT — gated, see "Sharing it"
  app/api/unlock/route.ts   checks the passcode, sets the unlock cookie
  lib/auth.ts               the passcode/cookie logic
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
would be read aloud verbatim. Keep that constraint if you edit it. Whether Alex searches the web is
also decided there, not in code: "search if asked", "don't search if told not to", and "don't search
for grammar" are all prompt rules.

Swapping providers means changing one line each in `agent/tutor.py`. LiveKit ships plugins for
OpenAI, Deepgram, Cartesia, ElevenLabs, and others; the `EdgeTTS` class in `plugins/edge_tts.py` is
only there because Edge TTS is free and had no official plugin.

The frontend's wording, colors, and which inputs are shown are all in `web/app-config.ts`. Camera and
screen share are deliberately off — Alex is voice-only, so those buttons would do nothing.

## Troubleshooting

**The page loads and connects, but Alex never speaks.** Check `AGENT_NAME` in `web/.env.local` is
empty. A non-matching agent name means the room is created, no worker is dispatched to it, and
nothing reports an error.

**The agent goes silent mid-conversation.** `EdgeTTSStream._run` logs and returns on a synthesis
failure rather than raising, so a failed TTS call produces silence, not an error. Check `lk agent
logs`.

**The agent responds to typed input but never to the microphone.** VAD isn't loading. See the
`_load_vad()` note in `CLAUDE.md` — the Windows `local_inference` stub silently makes the default VAD
return "no speech" for every frame.

**`pnpm build` fails with hundreds of `Delete ␍` errors.** A Windows checkout converted the template
to CRLF. Run `pnpm exec prettier --write .` from `web/`.

**"That passcode isn't right."** It's compared exactly, including case. If you rotated
`APP_PASSCODE`, remember an env change only takes effect on the *next* deploy.
