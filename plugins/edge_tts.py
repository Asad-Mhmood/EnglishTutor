"""
Custom LiveKit TTS plugin backed by Microsoft Edge TTS (edge-tts).

Edge TTS is completely free and requires no API key. It uses Microsoft's
neural voices under the hood via the same service that powers Edge browser's
Read Aloud feature.

Pipeline:
  text -> edge_tts.Communicate -> MP3 bytes -> PyAV decode/resample -> PCM frames -> LiveKit
"""

import io
import logging
from typing import Optional

import av
import edge_tts
from livekit import rtc
from livekit.agents import tts
from livekit.agents.types import APIConnectOptions

logger = logging.getLogger(__name__)

# Edge TTS outputs 24 kHz audio; we keep the same sample rate to avoid quality loss.
_SAMPLE_RATE = 24_000
_NUM_CHANNELS = 1
_PCM_FORMAT = "s16"  # signed 16-bit little-endian — what LiveKit expects


class EdgeTTS(tts.TTS):
    """LiveKit TTS adapter for Microsoft Edge TTS."""

    def __init__(self, *, voice: str = "en-US-JennyNeural") -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=_SAMPLE_RATE,
            num_channels=_NUM_CHANNELS,
        )
        self._voice = voice

    def synthesize(
        self,
        text: str,
        *,
        conn_options: Optional[APIConnectOptions] = None,
    ) -> "EdgeTTSStream":
        return EdgeTTSStream(
            tts=self,
            input_text=text,
            conn_options=conn_options or APIConnectOptions(),
            voice=self._voice,
        )


class EdgeTTSStream(tts.ChunkedStream):
    """Async stream that fetches and decodes one TTS response."""

    def __init__(
        self,
        *,
        tts: EdgeTTS,
        input_text: str,
        conn_options: APIConnectOptions,
        voice: str,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._voice = voice

    async def _run(self) -> None:
        mp3_buf = bytearray()

        try:
            communicate = edge_tts.Communicate(self._input_text, self._voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    mp3_buf.extend(chunk["data"])
        except Exception:
            logger.exception("edge-tts synthesis failed for text: %.80s", self._input_text)
            return

        if not mp3_buf:
            logger.warning("edge-tts returned empty audio for text: %.80s", self._input_text)
            return

        for pcm_bytes in _decode_mp3_to_pcm(bytes(mp3_buf), self._tts.sample_rate):
            samples_per_channel = len(pcm_bytes) // 2  # 2 bytes per s16 sample
            frame = rtc.AudioFrame(
                data=pcm_bytes,
                sample_rate=self._tts.sample_rate,
                num_channels=_NUM_CHANNELS,
                samples_per_channel=samples_per_channel,
            )
            self._event_ch.send_nowait(
                tts.SynthesizedAudio(request_id=self._request_id, frame=frame)
            )


def _decode_mp3_to_pcm(mp3_data: bytes, target_sample_rate: int) -> list[bytes]:
    """Decode MP3 bytes to a list of raw PCM s16 mono byte chunks."""
    results: list[bytes] = []

    with io.BytesIO(mp3_data) as buf:
        container = av.open(buf, format="mp3")
        resampler = av.AudioResampler(
            format=_PCM_FORMAT,
            layout="mono",
            rate=target_sample_rate,
        )
        try:
            for frame in container.decode(audio=0):
                for resampled in resampler.resample(frame):
                    results.append(bytes(resampled.planes[0]))
            # Flush any remaining samples held in the resampler
            for resampled in resampler.resample(None):
                results.append(bytes(resampled.planes[0]))
        finally:
            container.close()

    return results
