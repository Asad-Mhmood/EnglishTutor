from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LiveKit — required, must be in .env
    LIVEKIT_URL: str
    LIVEKIT_API_KEY: str
    LIVEKIT_API_SECRET: str

    # Groq — required, must be in .env
    GROQ_API_KEY: str

    # Tavily — required, must be in .env. Backs the agent's search_web tool.
    TAVILY_API_KEY: str

    # Postgres for progress tracking (Neon). DELIBERATELY OPTIONAL — do not "tidy" this into
    # a required field.
    #
    # Every other key above is required, which means a missing one raises a pydantic error at
    # import and the deployed worker crashloops. That is the right trade for GROQ_API_KEY: an
    # agent that cannot speak is not worth running. It is the WRONG trade here. Progress
    # tracking is a feature *of* the tutor, not a precondition for it, and making the database
    # required would turn a Neon outage into a tutor that will not start at all — trading a
    # working voice call for a chart nobody is looking at mid-outage.
    #
    # When this is None the agent runs exactly as it did before this feature existed, and
    # progress/__init__.py logs a warning per session. See ARCHITECTURE.md §5.
    PROGRESS_DATABASE_URL: str | None = None

    # LLM — llama-3.3-70b-versatile is Groq's most capable free model
    LLM_MODEL: str = "llama-3.3-70b-versatile"

    # The model that grades a finished session (progress/grading.py). Separate from LLM_MODEL
    # because the two jobs pull in opposite directions: the conversational model is chosen for
    # latency, the grader for judgement, and it runs after the call when nobody is waiting.
    # They point at the same model today; this exists so raising one doesn't slow the other.
    GRADING_MODEL: str = "llama-3.3-70b-versatile"

    # STT — whisper-large-v3-turbo: faster than v3 with comparable accuracy
    STT_MODEL: str = "whisper-large-v3-turbo"

    # TTS — Microsoft Edge Neural voices (free, no key needed). One per persona: the learner
    # picks a boy or girl tutor on the pre-call screen, and an uploaded photo avatar picks
    # whichever voice matches the person in the picture (agent/avatars.py::detect_gender).
    TTS_VOICE_MALE: str = "en-US-ChristopherNeural"
    TTS_VOICE_FEMALE: str = "en-US-JennyNeural"

    # bitHuman — backs the personalized photo avatar. OPTIONAL for the same reason as
    # PROGRESS_DATABASE_URL below: the avatar is a feature of the tutor, not a precondition
    # for it. Missing key = no photo avatars, never a crashloop.
    BITHUMAN_API_SECRET: str | None = None

    # Vision model used once per photo-avatar session to match the voice to the person in the
    # uploaded picture. Groq's only vision-capable model since Llama 4 Scout was retired
    # (June 2026). It is a preview model, so it may be swapped out under us — a failed or
    # missing model degrades to the default voice, never to a failed call.
    VISION_MODEL: str = "qwen/qwen3.6-27b"

    # Greeting spoken when a user joins the room. {name} is replaced with the persona the
    # learner picked (Ahmad or Sara) — agent/personas.py does the substitution.
    AGENT_GREETING: str = (
        "Hi there! I'm {name}, your English tutor. "
        "Feel free to talk to me about anything — I'm here to help you practice. "
        "So, what's on your mind today?"
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
