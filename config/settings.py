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

    # LLM — llama-3.3-70b-versatile is Groq's most capable free model
    LLM_MODEL: str = "llama-3.3-70b-versatile"

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
