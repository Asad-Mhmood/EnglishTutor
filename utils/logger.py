import logging
import sys


def configure_logging(level: int = logging.INFO) -> None:
    """Set up a clean, consistent log format for the whole application."""
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,  # override any root logger config set earlier (e.g. by livekit-agents)
    )
