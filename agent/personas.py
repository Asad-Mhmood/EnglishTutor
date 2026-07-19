"""
The two tutor personas, and how a session picks one.

The learner chooses on the pre-call screen: the boy character is Ahmad with a male voice, the
girl is Sara with a female voice. A personalized photo avatar picks whichever persona matches
the person in the uploaded picture (agent/avatars.py::detect_gender), so the face on screen
and the voice in the ear never disagree.
"""

from __future__ import annotations

from dataclasses import dataclass

from config.settings import settings


@dataclass(frozen=True)
class Persona:
    name: str
    voice: str  # Edge TTS voice id

    @property
    def greeting(self) -> str:
        return settings.AGENT_GREETING.replace("{name}", self.name)


MALE = Persona(name="Ahmad", voice=settings.TTS_VOICE_MALE)
FEMALE = Persona(name="Sara", voice=settings.TTS_VOICE_FEMALE)

# Keyed by the `avatar_mode` participant attribute the frontend puts in the room token
# (web/app/api/token/route.ts). "photo" is absent on purpose: its persona comes from the
# picture, not the key.
BY_CHARACTER: dict[str, Persona] = {
    "boy": MALE,
    "girl": FEMALE,
}

# Ahmad has been the tutor since before personas existed, so he is what an attribute-less
# participant (an old client, a stray SDK join) gets.
DEFAULT = MALE
