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

    # TTS — Microsoft Edge Neural voice (free, no key needed)
    TTS_VOICE: str = "en-US-JennyNeural"

    # Greeting spoken when a user joins the room
    AGENT_GREETING: str = (
        "Hi there! I'm Alex, your English tutor. "
        "Feel free to talk to me about anything — I'm here to help you practice. "
        "So, what's on your mind today?"
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
