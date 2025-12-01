Spoken English MVP (single-user backend)
=======================================

Overview
--------
This is a single-user MVP backend that accepts PCM16LE audio over WebSocket, transcribes
with Vosk, calls an LLM endpoint, and returns synthesized audio back over WebSocket.

Client WebSocket contract
-------------------------
Connect to ws://<host>:8000/ws/realtime

- Client sends binary frames: raw PCM16LE audio (mono), SAMPLE_RATE (default 16000), SAMPLE_WIDTH 2
  Send small chunks e.g. 3200 bytes (100ms) or 1600 bytes (50ms).

- Server will send JSON messages:
  {"type":"transcript","text":"..."}        -> when a final transcription is available
  {"type":"reply_text","text":"..."}       -> the LLM text reply
  {"type":"audio_start","format":"wav","length":<bytes>} -> WAV bytes will follow
  [binary frames]                          -> WAV file bytes in chunks
  {"type":"audio_end"}                     -> end of WAV file

- Client should buffer received WAV bytes between audio_start and audio_end and then play them.
  For progressive playback, the client can start playing when it has enough bytes of the WAV header + a bit.

Run locally (development)
-------------------------
1. Download a Vosk model (e.g., vosk-model-small-en-us-0.15) into ./models/
   https://alphacephei.com/vosk/models

2. Edit .env if needed (or set env vars)

3. Start:
   docker-compose up --build

Or run locally without Docker:
   pip install -r requirements.txt
   export VOSK_MODEL_PATH=./models/vosk-model-small-en-us-0.15
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Notes
-----
- LLM endpoint is pluggable; point LLM_URL to your model server (llama-server, etc.). The default expects
  a simple JSON response {"text": "..."}.
- Replace DummyTTS with a real TTS implementation before production.
- The code is intentionally modular: swap STT/LLM/TTS implementations without rewriting the gateway.
