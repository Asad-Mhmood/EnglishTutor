import logging

from livekit.agents import Agent, AgentSession, JobContext
from livekit.plugins import groq

from config.settings import settings
from plugins.edge_tts import EdgeTTS
from prompts.tutor import TUTOR_SYSTEM_PROMPT

logger = logging.getLogger(__name__)


class EnglishTutor(Agent):
    """
    The tutor agent. In livekit-agents v1.x, instructions become the system
    prompt sent to the LLM on every turn — no manual ChatContext needed.
    """

    def __init__(self) -> None:
        super().__init__(instructions=TUTOR_SYSTEM_PROMPT)

    async def on_enter(self) -> None:
        """Called once when the agent joins the session. Used for the greeting."""
        await self.session.say(settings.AGENT_GREETING, allow_interruptions=True)


async def entrypoint(ctx: JobContext) -> None:
    """LiveKit job entrypoint — called once per room session."""
    logger.info("English Tutor agent starting for room: %s", ctx.room.name)

    await ctx.connect()

    # AgentSession in v1.6+ bundles Silero VAD by default — no explicit vad= needed.
    session = AgentSession(
        stt=groq.STT(model=settings.STT_MODEL),
        llm=groq.LLM(model=settings.LLM_MODEL),
        tts=EdgeTTS(voice=settings.TTS_VOICE),
    )

    await session.start(
        room=ctx.room,
        agent=EnglishTutor(),
    )
