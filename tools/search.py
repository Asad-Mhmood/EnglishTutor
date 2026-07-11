"""
Web search, exposed to the LLM as a function tool.

Tavily is used rather than a raw search API because it returns a synthesized
`answer` string alongside the hits — a voice agent wants a sentence to read
aloud, not ten blue links.
"""
import logging

from livekit.agents import RunContext, function_tool
from tavily import AsyncTavilyClient
from tavily.errors import TimeoutError as TavilyTimeoutError

from config.settings import settings

logger = logging.getLogger(__name__)

# Tavily's own deadline. Past this the caller is left listening to filler speech,
# which gets awkward; better to fail and let Alex say so.
_SEARCH_TIMEOUT = 15.0

# Three hits is plenty of context for a two-sentence spoken answer.
_MAX_RESULTS = 3

# Long page extracts blow up the prompt for no gain — the answer summary carries
# most of the signal, and these are only there to back it up.
_MAX_SNIPPET_CHARS = 300

_client = AsyncTavilyClient(api_key=settings.TAVILY_API_KEY)


def _filler_source(query: str):
    """
    Build the `with_filler` callable that tells the user a search is underway.

    Fires only while the session is idle, so it never talks over the user. The
    first line names the query — the whole point is that the user knows *what*
    the pause is for. Later lines just reassure.
    """
    lines = (
        f"Let me search the web for {query}. One moment.",
        "Still searching, hang on.",
    )

    def source(step: int) -> str | None:
        return lines[step] if step < len(lines) else None

    return source


def _format(query: str, data: dict) -> str:
    """Flatten a Tavily response into something the LLM can speak from."""
    answer = (data.get("answer") or "").strip()
    results = data.get("results") or []

    if not answer and not results:
        return f"The web search for {query!r} returned no results."

    parts: list[str] = []
    if answer:
        parts.append(f"Summary: {answer}")

    for result in results[:_MAX_RESULTS]:
        title = (result.get("title") or "Untitled").strip()
        content = (result.get("content") or "").strip()[:_MAX_SNIPPET_CHARS]
        if content:
            parts.append(f"- {title}: {content}")

    return "\n".join(parts)


@function_tool
async def search_web(ctx: RunContext, query: str) -> str:
    """Search the web for current or unfamiliar information.

    Use this for facts you cannot know reliably from memory: news, current events,
    weather, prices, sports results, recent releases, or anything that may have
    changed since your training data. Do not use it for grammar, vocabulary,
    definitions, opinions, or ordinary conversation — answer those yourself.

    The user is told a search is happening automatically. Do not announce it yourself.

    Args:
        query: A short, natural search query describing what to look up.
               It is read aloud to the user, so phrase it as words, not keywords.
    """
    logger.info("Web search: %s", query)

    try:
        async with ctx.with_filler(_filler_source(query), interval=7.0, max_steps=2):
            data = await _client.search(
                query,
                search_depth="basic",
                max_results=_MAX_RESULTS,
                include_answer=True,
                timeout=_SEARCH_TIMEOUT,
            )
    # Tavily wraps httpx.TimeoutException in its own TimeoutError, which is unrelated
    # to the builtin — catching asyncio.TimeoutError here would never fire.
    except TavilyTimeoutError:
        logger.warning("Web search timed out: %s", query)
        return f"The web search for {query!r} timed out. Tell the user you couldn't reach the web."
    except Exception:
        logger.exception("Web search failed: %s", query)
        return f"The web search for {query!r} failed. Tell the user you couldn't reach the web."

    return _format(query, data)
