FROM python:3.11-slim

WORKDIR /app

# system deps for vosk and soundfile (libsndfile)
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential libsndfile1 ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY .env ./

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--ws", "websockets"]
