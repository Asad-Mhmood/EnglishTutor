"""
Streaming defense against leaked tool-call syntax reaching TTS.

Groq's llama-3.3-70b-versatile does not always route a function call through the
structured `tool_calls` field on the completion. When it doesn't, it falls back to
Llama's own built-in tool-call syntax written directly into the assistant's message
content: `<function=search_web>{"query": "..."}</function>`. Nothing in the OpenAI-
compatible streaming protocol distinguishes that from ordinary reply text, so it
flows straight through AgentSession to EdgeTTS and gets read aloud verbatim — the
"technical text mid-reply" bug. The prompt already tells the model not to announce
a search in words; this catches the case where it "announces" the raw call syntax
instead.

Wired in via `AgentSession(tts_text_transforms=[strip_tool_call_leakage])` — the
same mechanism livekit uses for its own `filter_markdown`/`filter_emoji` — rather
than post-processing in the tool or the prompt, because the leak is in the model's
free-text content, not in anything code between the tool and the LLM controls.
"""

from collections.abc import AsyncGenerator, AsyncIterable

_OPEN_TAG = "<function="
_CLOSE_TAG = "</function>"


def _partial_suffix_len(buffer: str, token: str) -> int:
    """Length of the longest suffix of `buffer` that is a proper prefix of `token`."""
    for k in range(min(len(token) - 1, len(buffer)), 0, -1):
        if buffer.endswith(token[:k]):
            return k
    return 0


async def strip_tool_call_leakage(text: AsyncIterable[str]) -> AsyncGenerator[str, None]:
    """Drop any `<function=...>...</function>` block from a streamed reply.

    Holds back a partial `<function=` prefix across chunk boundaries so a tag split
    mid-stream is still caught, and drops a tag left unterminated at the end of the
    stream rather than speaking the fragment.
    """
    buffer = ""

    async for chunk in text:
        buffer += chunk

        while True:
            start = buffer.find(_OPEN_TAG)
            if start == -1:
                hold = _partial_suffix_len(buffer, _OPEN_TAG)
                safe_len = len(buffer) - hold
                if safe_len > 0:
                    yield buffer[:safe_len]
                buffer = buffer[safe_len:]
                break

            if start > 0:
                yield buffer[:start]
                buffer = buffer[start:]

            end = buffer.find(_CLOSE_TAG)
            if end == -1:
                break  # incomplete tag; wait for more chunks

            buffer = buffer[end + len(_CLOSE_TAG) :]

    # Stream ended with a dangling tag (partial prefix or an opened-but-never-closed
    # one) — drop it rather than speak a fragment. Anything else is real text that
    # simply never hit a yield point above.
    if buffer and not (_OPEN_TAG.startswith(buffer) or buffer.startswith(_OPEN_TAG)):
        yield buffer
