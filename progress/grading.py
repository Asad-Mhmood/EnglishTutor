"""
The LLM-judged half of the analysis: grammar errors and a CEFR estimate.

This is the only part of the pipeline that can be *wrong* rather than merely imprecise, and
it is isolated here so that a bad grading run degrades to `grading = None` while every
deterministic metric still lands. A session with no grade but real fluency numbers is a
useful data point. A crash that drops the whole session is not.

WHEN THIS RUNS, AND WHY IT MATTERS

Once, at the end of the session — not per turn. Grading per turn would put a 70B model call
in the middle of a live voice conversation, and the user would hear the latency as Alex going
quiet. The voice pipeline is the product; the tracker is not allowed to slow it down. Running
at shutdown also gives the grader the whole conversation, which is the only way it can see a
learner make the same mistake four times and count it once.

THE ACCURACY CEILING, STATED PLAINLY

The input is Whisper's transcription, not the learner's speech. Whisper punctuates on its
own, sometimes silently repairs broken grammar, and sometimes invents a word it half-heard.
So:

  - Grammar we never see, because Whisper fixed it, is under-counted.
  - Errors the learner never made, because Whisper misheard, are over-counted.

The prompt pushes hard against the second (it is told the input is ASR, told to ignore
punctuation and casing, and told to skip anything that smells like a mis-transcription), but
the ceiling is real and no prompt removes it. The dashboard says so where the learner can see
it. Building this feature on the pretence that the transcript is ground truth would produce a
tracker that is confidently, invisibly wrong — worse than none, because a learner would act
on it.
"""

from __future__ import annotations

import json
import logging

from groq import AsyncGroq

from .models import Grading, GrammarError
from .taxonomy import VALID_KEYS, prompt_reference

logger = logging.getLogger(__name__)

# Beyond this, the list stops being feedback and starts being a wall of red. The grader is
# told to prioritise, so the ones we keep are the ones it considers most worth fixing.
MAX_ERRORS = 12

# A grading call has no user waiting on it (the session is already over), but it must not
# hold the worker's shutdown open indefinitely.
TIMEOUT_SECONDS = 30.0

_SYSTEM_PROMPT = f"""
You are an ESL assessor. You will be given the transcript of one side of a spoken English \
practice conversation: only the learner's speech, with the tutor's turns removed.

CRITICAL — THE INPUT IS AUTOMATIC SPEECH RECOGNITION OUTPUT, NOT WRITING.

The learner did not type this and did not punctuate it. A speech recogniser did. Therefore:

- NEVER report punctuation, capitalisation, or spelling as an error. The learner did not \
produce any of it and cannot be responsible for it.
- If a phrase looks wrong in a way that a speech recogniser plausibly caused — a homophone, \
a mangled proper noun, a word that makes no sense in context — DO NOT report it. It is far \
worse to accuse a learner of a mistake they did not make than to miss one they did.
- Judge only what is unambiguously the learner's own grammar or word choice.

ERROR CATEGORIES — use these keys and no others:
{prompt_reference()}

RULES

- Report each distinct mistake once. If the learner makes the same error four times, that is \
one entry, using the clearest instance.
- Prioritise mistakes that impede communication or recur, over one-off slips. At most \
{MAX_ERRORS} entries; fewer is fine and an empty list is fine.
- `learner_text` must be a short verbatim quote from the transcript. `corrected_text` is that \
same fragment, fixed, changing nothing else.
- `explanation` is ONE short sentence addressed to the learner ("you"). Warm, not clinical. \
No jargon they'd have to look up.

CEFR ESTIMATE

Estimate the level this sample demonstrates, as one of A1, A2, B1, B2, C1, C2:

- A1: isolated words and memorised phrases; cannot sustain an exchange.
- A2: short simple sentences on familiar topics; frequent basic errors; no subordination.
- B1: connected speech on familiar topics; copes with the unexpected; errors do not block meaning.
- B2: fluent and spontaneous; clear detailed speech; argues a viewpoint; errors are minor.
- C1: fluent and precise; flexible; subtle shades of meaning; errors are rare.
- C2: effortless, idiomatic, precise. Reserve this for genuinely native-like command.

Judge the level from what the learner DEMONSTRATES, not from what a short sample fails to \
show. A brief conversation cannot prove C1, but it must not be scored A2 merely for being brief.

`cefr_confidence` is 0.0 to 1.0 and should be LOW when the sample is short, when the learner \
said little, or when the topic never stretched them. Be honest here — a confident wrong \
level is the most damaging thing you can output.

`summary` is one or two warm sentences for the learner's dashboard: what went well, and the \
single most useful thing to work on. Address them as "you". Never mention CEFR or this rubric.

Reply with JSON only, in exactly this shape:

{{"errors": [{{"category": "...", "learner_text": "...", "corrected_text": "...", \
"explanation": "..."}}],
 "cefr_estimate": "B1", "cefr_confidence": 0.4, "summary": "..."}}
""".strip()


def _parse(raw: str) -> Grading:
    """
    Turn the model's JSON into a Grading, discarding anything malformed.

    Every field is treated as untrusted. The model is instructed to use only taxonomy keys,
    and mostly does — but an invented category like "articles_usage" would become a new
    entry in the weak-areas chart and a line on the trend graph that can never join up with
    the real `articles` line. Dropping it is strictly better than plotting it.
    """
    data = json.loads(raw)

    errors: list[GrammarError] = []
    for item in data.get("errors") or []:
        if not isinstance(item, dict):
            continue

        category = str(item.get("category", "")).strip()
        learner_text = str(item.get("learner_text", "")).strip()
        corrected_text = str(item.get("corrected_text", "")).strip()

        if category not in VALID_KEYS:
            logger.warning("grader returned unknown category %r; dropping it", category)
            continue
        if not learner_text or not corrected_text:
            continue
        if learner_text.lower() == corrected_text.lower():
            # "Corrected" to itself. Not a mistake; the model second-guessed itself.
            continue

        explanation = str(item.get("explanation", "")).strip() or None
        errors.append(
            GrammarError(
                category=category,
                learner_text=learner_text,
                corrected_text=corrected_text,
                explanation=explanation,
            )
        )

    level = str(data.get("cefr_estimate", "")).strip().upper()
    if level not in {"A1", "A2", "B1", "B2", "C1", "C2"}:
        level = None  # type: ignore[assignment]

    try:
        confidence = float(data.get("cefr_confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    summary = str(data.get("summary", "")).strip() or None

    return Grading(
        errors=tuple(errors[:MAX_ERRORS]),
        cefr_estimate=level,
        cefr_confidence=min(max(confidence, 0.0), 1.0),
        summary=summary,
    )


async def grade(transcript_text: str, *, api_key: str, model: str) -> Grading | None:
    """
    Grade one session's learner speech. Returns None if the grader could not be reached.

    None means "we don't know", and that is stored as NULL rather than as a zero-error
    session. A failed grading run that recorded a perfect score would be a lie the learner
    could see on their chart.
    """
    client = AsyncGroq(api_key=api_key, timeout=TIMEOUT_SECONDS)

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": transcript_text},
            ],
            # Deterministic-ish: the same session re-graded should not swing B1/B2 on a coin
            # flip. Level estimates are noisy enough without sampling adding to it.
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or ""
        return _parse(content)

    except json.JSONDecodeError:
        logger.exception("grader returned unparseable JSON; session will be stored ungraded")
        return None
    except Exception:  # noqa: BLE001 — never let grading failure kill the session write
        logger.exception("grading call failed; session will be stored ungraded")
        return None
    finally:
        await client.close()
