import logging
from typing import Optional
import numpy as np
import soundfile as sf
from io import BytesIO

logger = logging.getLogger(__name__)

class DummyTTS:
    """
    A minimal TTS that returns synthetic PCM (sine beep) for testing.
    Replace with a real TTS system (Coqui, Piper) in production.
    """

    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate

    def synthesize(self, text: str) -> bytes:
        # Generate 300ms beep as placeholder
        duration = 0.3
        t = np.linspace(0, duration, int(self.sample_rate * duration), False)
        tone = 0.05 * np.sin(2 * np.pi * 440 * t).astype(np.float32)
        bio = BytesIO()
        sf.write(bio, tone, self.sample_rate, format="WAV", subtype="PCM_16")
        bio.seek(0)
        return bio.read()

# Adapter factory
def get_tts_adapter(mode: str, sample_rate: int = 16000):
    # Here is where you'd choose a real TTS implementation
    # e.g., Coqui TTS, Piper, etc.
    if mode == "dummy":
        return DummyTTS(sample_rate=sample_rate)
    raise NotImplementedError(f"TTS mode {mode} not implemented.")
