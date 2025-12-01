from vosk import Model, KaldiRecognizer
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class VoskSTT:
    """
    Streaming wrapper around Vosk recognizer.
    Expects PCM16LE audio at SAMPLE_RATE (e.g. 16000).
    """

    def __init__(self, model_path: str, sample_rate: int = 16000):
        self.model = Model(model_path)
        self.sample_rate = sample_rate
        self._rec = KaldiRecognizer(self.model, sample_rate)
        # set max alternatives or other params if desired

    def accept_audio(self, pcm_bytes: bytes) -> Optional[str]:
        """
        Feed a chunk of raw PCM16LE bytes.
        Returns a finalized text result string when Vosk produces a final result,
        otherwise returns None (partial result is ignored or could be returned too).
        """
        try:
            ok = self._rec.AcceptWaveform(pcm_bytes)
            if ok:
                res = json.loads(self._rec.Result())
                text = res.get("text", "").strip()
                if text:
                    logger.debug("Vosk final result: %s", text)
                    return text
            else:
                # partial = json.loads(self._rec.PartialResult())
                # return partial.get("partial", "")  # if you want partial streaming
                return None
        except Exception as e:
            logger.exception("Vosk accept_audio error: %s", e)
            return None

    def finalize(self) -> Optional[str]:
        try:
            res = json.loads(self._rec.FinalResult())
            return res.get("text", "").strip()
        except Exception:
            return None
