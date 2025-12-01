import asyncio
import logging
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .logging_config import configure_logging
from .stt.vosk_stt import VoskSTT
from .llm.llm_client import LLMClient
from .tts.simple_tts import get_tts_adapter
from .utils import run_blocking

configure_logging()
logger = logging.getLogger("app")

app = FastAPI(title="Spoken English MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components (single-user / single-process)
stt = VoskSTT(settings.VOSK_MODEL_PATH, sample_rate=settings.SAMPLE_RATE)
llm_client = LLMClient(str(settings.LLM_URL))
tts = get_tts_adapter(settings.TTS_MODE, sample_rate=settings.SAMPLE_RATE)


@app.on_event("shutdown")
async def shutdown():
    logger.info("Shutting down: closing LLM client")
    await llm_client.close()


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})


@app.websocket("/ws/realtime")
async def websocket_realtime(ws: WebSocket):
    """
    WebSocket contract:
    - Client sends binary messages = raw PCM16LE chunks (sample rate must match settings.SAMPLE_RATE)
    - Server will transcribe (Vosk) and when a final text is available:
        - Send a JSON event message: {"type": "transcript", "text": "..."}
        - Call LLM to generate reply text
        - Synthesize reply to WAV bytes
        - Stream audio bytes back as binary frames (WAV file bytes). We send a control JSON first:
          {"type":"audio_start","format":"wav"} then binary chunks, then {"type":"audio_end"}.
    - Client should play WAV bytes it receives.
    """
    await ws.accept()
    logger.info("Client connected to /ws/realtime")

    try:
        # We'll buffer small PCM chunks and feed to Vosk
        while True:
            message = await ws.receive()
            if message is None:
                break

            if message.get("type") == "websocket.disconnect":
                break

            if "bytes" in message:
                pcm_bytes = message["bytes"]
                # Vosk is blocking; run in threadpool
                final_text = await run_blocking(stt.accept_audio, pcm_bytes)
                if final_text:
                    # Notify client of transcript
                    await ws.send_json({"type": "transcript", "text": final_text})
                    logger.info("Transcript: %s", final_text)

                    # Generate LLM reply (async)
                    reply_text = await llm_client.generate(final_text)
                    await ws.send_json({"type": "reply_text", "text": reply_text})

                    # Synthesize (blocking) -> get WAV bytes
                    wav_bytes = await run_blocking(tts.synthesize, reply_text)

                    # Send a start marker (so client knows a WAV file follows)
                    await ws.send_json({"type": "audio_start", "format": "wav", "length": len(wav_bytes)})

                    # send WAV bytes in chunks (so client can begin playback progressively)
                    chunk_size = 4096
                    pos = 0
                    while pos < len(wav_bytes):
                        chunk = wav_bytes[pos:pos+chunk_size]
                        await ws.send_bytes(chunk)
                        pos += chunk_size
                        # slight sleep to avoid starving network, adjust as needed
                        await asyncio.sleep(0.001)

                    # audio end marker
                    await ws.send_json({"type": "audio_end"})
            elif "text" in message:  # other control messages
                # This may be used in future for commands like "stop", "set_lang", etc.
                logger.debug("Received text control message: %s", message["text"])
                await ws.send_json({"type": "ack", "msg": "ok"})

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.exception("Error in realtime ws: %s", e)
        try:
            await ws.close(code=1011)
        except Exception:
            pass
