"""
Entry point for the English Tutor LiveKit agent.

IMPORTANT: the sys.modules stub for livekit.local_inference MUST come before
any livekit import. The bundled native .pyd in livekit-local-inference calls
Windows ExitProcess() during initialization on this system (unsupported
hardware or missing runtime). Since Python try/except cannot intercept a
process-level exit, we replace the module in sys.modules with a stub so the
native library is never loaded. We don't use any local-inference features
(we use Groq STT/LLM and Silero VAD instead).
"""
import sys
import types

_stub = types.ModuleType("livekit.local_inference")
_stub.EOT = type("EOT", (), {"predict": lambda self, pcm: 0.0})  # type: ignore[attr-defined]
_stub.VAD = type("VAD", (), {"predict": lambda self, pcm: 0.0})  # type: ignore[attr-defined]
_stub.EOT_MAX_SAMPLES = 24000  # type: ignore[attr-defined]
_stub.VAD_WINDOW_SAMPLES = 512  # type: ignore[attr-defined]
_stub.init_eot = lambda *a, **kw: None  # type: ignore[attr-defined]
_stub.init_vad = lambda *a, **kw: None  # type: ignore[attr-defined]
sys.modules["livekit.local_inference"] = _stub

from livekit.agents import WorkerOptions, cli  # noqa: E402

from agent.tutor import entrypoint  # noqa: E402
from utils.logger import configure_logging  # noqa: E402

configure_logging()

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
