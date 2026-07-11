import importlib.resources
import logging

from livekit.agents import Agent, AgentSession, JobContext
from livekit.plugins import groq, silero

from config.settings import settings
from plugins.edge_tts import EdgeTTS
from prompts.tutor import TUTOR_SYSTEM_PROMPT
from tools import search_web

logger = logging.getLogger(__name__)


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

    await session.start(
        room=ctx.room,
        agent=EnglishTutor(),
    )
