from pydantic import BaseSettings, AnyHttpUrl


class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Path to vosk model dir on disk (download and point here)
    VOSK_MODEL_PATH: str = "/models/vosk-model-small-en-us-0.15"

    # LLM HTTP endpoint (pluggable). Example: http://localhost:8080/completion
    LLM_URL: AnyHttpUrl = "http://localhost:8080/completion"

    # TTS mode: "coqui" | "pyttsx3" | "dummy"
    TTS_MODE: str = "dummy"

    # audio chunk sample rate expected from client
    SAMPLE_RATE: int = 16000
    SAMPLE_WIDTH: int = 2  # bytes per sample (PCM16 => 2)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
