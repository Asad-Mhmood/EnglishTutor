FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# ca-certificates: EdgeTTS and the Groq API are both HTTPS.
# PyAV ships manylinux wheels with FFmpeg bundled, so no ffmpeg packages are needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Don't run as root.
RUN useradd -m -u 1000 agent && chown -R agent:agent /app
USER agent

# `start` is the production worker. `dev` hot-reloads and `console` grabs a local
# mic — neither belongs in a container.
CMD ["python", "main.py", "start"]
