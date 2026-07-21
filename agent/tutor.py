import importlib.resources
import logging
import uuid

from livekit.agents import Agent, AgentSession, JobContext
from livekit.plugins import groq, silero

import progress
from agent import avatars, personas
from agent.text_filters import strip_tool_call_leakage
from config.settings import settings
from plugins.edge_tts import EdgeTTS
from prompts.tutor import tutor_prompt
from tools import search_web

logger = logging.getLogger(__name__)

# The web app signs a learner into the room under this identity prefix (see
# web/app/api/token/route.ts). Anything joining without it — a stray SDK client, a curl'd
# token, an older frontend build — is treated as anonymous and simply not tracked.
LEARNER_IDENTITY_PREFIX = "learner_"

# Participant attribute set by the token route: "boy" | "girl" | "photo". It rides in the
# signed room token, so a client cannot claim the photo avatar without the server having
# verified there is a photo to use.
AVATAR_MODE_ATTRIBUTE = "avatar_mode"


class EnglishTutor(Agent):
    """
    The tutor agent. In livekit-agents v1.x, instructions become the system
    prompt sent to the LLM on every turn — no manual ChatContext needed.
    """

    def __init__(self, persona: personas.Persona) -> None:
        super().__init__(instructions=tutor_prompt(persona.name), tools=[search_web])
        self._greeting = persona.greeting

    async def on_enter(self) -> None:
        """Called once when the agent joins the session. Used for the greeting."""
        await self.session.say(self._greeting, allow_interruptions=True)


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


async def _resolve_photo_session(learner_id: str | None) -> tuple[personas.Persona, bytes] | None:
    """
    Everything the photo avatar needs, gathered up front, or None to fall back to a character.

    Runs before the AgentSession is built because the persona decides the TTS voice, and the
    voice cannot change once the session exists. The photo decides the persona: a one-off
    vision call looks at who is in the picture so that the face on screen gets the matching
    voice — a male photo speaking with Sara's voice would be worse than no avatar at all.
    """
    if learner_id is None:
        return None
    if settings.BITHUMAN_API_SECRET is None:
        logger.warning("photo avatar requested but BITHUMAN_API_SECRET is not set")
        return None

    photo = await avatars.load_avatar_photo(learner_id, dsn=settings.PROGRESS_DATABASE_URL)
    if photo is None:
        logger.warning("photo avatar requested but no photo found for learner %s", learner_id)
        return None

    gender = await avatars.detect_gender(
        photo,
        groq_api_key=settings.GROQ_API_KEY,
        model=settings.VISION_MODEL,
    )
    persona = personas.FEMALE if gender == "female" else personas.MALE
    logger.info("photo avatar: detected %s, speaking as %s", gender or "unknown", persona.name)
    return persona, photo


async def _start_photo_avatar(session: AgentSession, ctx: JobContext, photo: bytes) -> bool:
    """
    Attach the bitHuman avatar to the session. Returns False on any failure — the import is
    lazy and every error is swallowed because the avatar renders the tutor's face, not its
    brain, and a bitHuman outage (or exhausted credits) must degrade to a voice-only call.
    """
    try:
        from livekit.plugins import bithuman  # noqa: PLC0415 — heavy import, avatar calls only

        avatar = bithuman.AvatarSession(
            model="expression",
            avatar_image=avatars.photo_as_base64(photo),
            api_secret=settings.BITHUMAN_API_SECRET,
        )
        await avatar.start(session, room=ctx.room)
        return True
    except Exception:  # noqa: BLE001
        logger.exception("bitHuman avatar failed to start; continuing voice-only")
        return False


async def entrypoint(ctx: JobContext) -> None:
    """LiveKit job entrypoint — called once per room session."""
    logger.info("English Tutor agent starting for room: %s", ctx.room.name)

    await ctx.connect()

    # Who is on the other end? The frontend puts the learner's id in the participant identity
    # and the avatar choice in the attributes when it mints the room token. We must ask before
    # starting the session: the collector has to be listening before the first word is spoken,
    # and the avatar choice decides the TTS voice, which is fixed at session construction.
    participant = await ctx.wait_for_participant()
    learner_id = _learner_id_from(participant.identity)
    avatar_mode = participant.attributes.get(AVATAR_MODE_ATTRIBUTE, "")

    photo: bytes | None = None
    if avatar_mode == "photo":
        resolved = await _resolve_photo_session(learner_id)
        if resolved is not None:
            persona, photo = resolved
        else:
            persona = personas.DEFAULT
    else:
        persona = personas.BY_CHARACTER.get(avatar_mode, personas.DEFAULT)

    session = AgentSession(
        stt=groq.STT(model=settings.STT_MODEL),
        llm=groq.LLM(model=settings.LLM_MODEL),
        tts=EdgeTTS(voice=persona.voice),
        vad=_load_vad(),
        # Groq's llama-3.3-70b-versatile occasionally leaks a tool call into the
        # reply text as literal `<function=...>...</function>` syntax instead of
        # the structured tool_calls field. See agent/text_filters.py.
        tts_text_transforms=[strip_tool_call_leakage],
    )

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

    # The avatar must attach BEFORE session.start: it replaces the session's audio output so
    # the speech streams through the avatar worker, which lip-syncs it and publishes both
    # tracks. Failure here just means the frontend never sees a video track and renders the
    # free animated character instead.
    if photo is not None:
        await _start_photo_avatar(session, ctx, photo)

    await session.start(
        room=ctx.room,
        agent=EnglishTutor(persona),
    )
