import logging
from typing import AsyncGenerator, Optional
import httpx

logger = logging.getLogger(__name__)

class LLMClient:
    """
    Minimal wrapper for a generic LLM HTTP endpoint.
    The LLM_URL is expected to accept a JSON payload like:
      { "prompt": "<text>", "stream": false }
    and respond with JSON { "text": "<reply>" }.
    You can adapt to your local model server's API.
    """

    def __init__(self, base_url: str):
        self.base_url = base_url
        self._client = httpx.AsyncClient(timeout=60.0)

    async def generate(self, prompt: str) -> str:
        payload = {"prompt": prompt, "stream": False}
        try:
            resp = await self._client.post(self.base_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict):
                return data.get("text") or data.get("reply") or ""
            return str(data)
        except Exception as e:
            logger.exception("LLM generate error: %s", e)
            return "Sorry, I couldn't process that."

    async def close(self):
        await self._client.aclose()
