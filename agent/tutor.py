import importlib.resources
import logging
import uuid

from livekit.agents import Agent, AgentSession, JobContext
from livekit.plugins import groq, silero

import progress
from config.settings import settings
from plugins.edge_tts import EdgeTTS
from prompts.tutor import TUTOR_SYSTEM_PROMPT
from tools import search_web

logger = logging.getLogger(__name__)

# The web app signs a learner into the room under this identity prefix (see
# web/app/api/token/route.ts). Anything joining without it — a stray SDK client, a curl'd
# token, an older frontend build — is treated as anonymous and simply not tracked.
LEARNER_IDENTITY_PREFIX = "learner_"


class EnglishTutor(Agent):
    """
    The tutor agent. In livekit-agents v1.x, instructions become the system
    prompt sent to the LLM on every turn — no manual ChatContext needed.
    """

    def __init__(self) -> None:
        super().__init__(instructions=TUTOR_SYSTEM_PROMPT, tools=[search_web])

    async def on_enter(self) -> None:
        """Called once when the agent joins the session. Used for the greeting."""
        await self.session.say(settings.AGENT_GREETING, allow_interruptions=True)


def _load_vad() -> silero.VAD:
    """
    Load Silero VAD on the onnxruntime path.

    Both AgentSession's default VAD and a bare `silero.VAD.load()` resolve to
    `inference.VAD`, which imports `livekit.local_inference` — the module main.py
    replaces with a stub because its native .pyd calls ExitProcess() here. The stub's
    predict() returns 0.0 for every frame, so speech is never detected and the agent
    only ever responds to typed input.

    Passing onnx_file_path forces load() to skip that delegation. The path is the
    plugin's own bundled model, so this is the default weights, just a different runtime.
    """
    onnx_path = importlib.resources.files("livekit.plugins.silero.resources") / "silero_vad.onnx"
    return silero.VAD.load(onnx_file_path=str(onnx_path))


def _learner_id_from(identity: str) -> str | None:
    """
    Extract the learner's id from their LiveKit participant identity.

    Returns None for anyone who isn't a signed-in learner, which is a normal state and not an
    error: the tutor works fine untracked, it just has nothing to write a progress row
    against. The uuid check is what stops a hand-crafted identity from reaching a database
    insert as a raw string.
    """
    if not identity.startswith(LEARNER_IDENTITY_PREFIX):
        return None

    candidate = identity[len(LEARNER_IDENTITY_PREFIX) :]
    try:
        return str(uuid.UUID(candidate))
    except ValueError:
        logger.warning("participant identity %r has a malformed learner id", identity)
        return None


async def entrypoint(ctx: JobContext) -> None:
    """LiveKit job entrypoint — called once per room session."""
    logger.info("English Tutor agent starting for room: %s", ctx.room.name)

    await ctx.connect()

    session = AgentSession(
        stt=groq.STT(model=settings.STT_MODEL),
        llm=groq.LLM(model=settings.LLM_MODEL),
        tts=EdgeTTS(voice=settings.TTS_VOICE),
        vad=_load_vad(),
    )

    # Who is on the other end? The frontend puts the learner's id in the participant identity
    # when it mints the room token. We must ask before starting the session, because the
    # collector has to be listening before the first word is spoken.
    participant = await ctx.wait_for_participant()
    learner_id = _learner_id_from(participant.identity)

    collector: progress.TranscriptCollector | None = None

    if learner_id is None:
        logger.info(
            "participant %s is not a signed-in learner; running untracked",
            participant.identity,
        )
    else:
        collector = progress.TranscriptCollector(
            learner_id=learner_id,
            room_name=ctx.room.name,
        )
        collector.attach(session)

        # Analysis runs here, not during the call. A shutdown callback fires once the room is
        # closing, which is exactly when the transcript is complete and nobody is waiting on
        # latency any more — the grading call is a 70B model round trip and would be audible
        # as dead air if it ran mid-conversation.
        async def _record_progress() -> None:
            await progress.run_analysis(
                collector,
                dsn=settings.PROGRESS_DATABASE_URL,
                groq_api_key=settings.GROQ_API_KEY,
                grading_model=settings.GRADING_MODEL,
            )

        ctx.add_shutdown_callback(_record_progress)
        logger.info("tracking progress for learner %s", learner_id)

    await session.start(
        room=ctx.room,
        agent=EnglishTutor(),
    )
