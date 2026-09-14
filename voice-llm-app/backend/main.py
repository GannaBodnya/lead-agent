"""
main.py — FastAPI backend for Voice LLM Chat
Exposes a single /api/chat endpoint that proxies to the ICA A2A agent.
"""

import json
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field
from openai import AsyncOpenAI

from ica_client import call_agent_stream, call_agent, get_agent_card

# Load environment variables from .env (dev only — in prod use real env vars)
load_dotenv(override=True)

# ── Logging (structured, no sensitive data) ──────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "msg": "%(message)s"}',
)
logger = logging.getLogger(__name__)


# ── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Voice LLM API server")
    yield
    logger.info("Shutting down Voice LLM API server")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Voice LLM API", version="0.1.0", lifespan=lifespan)

# OpenAI client for TTS — key loaded from environment
_openai = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))

# CORS: only allow requests from the local Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "Accept"],
)


# ── Request / Response models ─────────────────────────────────────────────────
class Message(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=0, max_length=32_000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8_000)
    history: list[Message] = Field(default_factory=list, max_length=100)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/tts")
async def tts(request: Request):
    """
    TTS proxy for TalkingHead.js.
    TalkingHead POSTs: { "input": "<text>", "model": "tts-1", "voice": "...", "response_format": "mp3" }
    We forward to OpenAI TTS and stream the audio back.
    API key never leaves the server.
    """
    body = await request.json()
    text = body.get("input", "")
    if not text:
        raise HTTPException(status_code=400, detail="Missing 'input' field")

    model = body.get("model", "tts-1")
    voice = body.get("voice", "nova")
    response_format = body.get("response_format", "mp3")

    try:
        response = await _openai.audio.speech.create(
            model=model,
            voice=voice,
            input=text,
            response_format=response_format,
        )
        audio_bytes = response.content
        return Response(
            content=audio_bytes,
            media_type=f"audio/{response_format}",
            headers={"Cache-Control": "no-store"},
        )
    except Exception as exc:
        logger.error("TTS error: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="TTS service unavailable")


@app.get("/api/agent-card")
async def agent_card():
    """
    Proxy the ICA GET agent-card request — use this to verify your API key works.
    curl http://127.0.0.1:8000/api/agent-card
    """
    try:
        card = await get_agent_card()
        return card
    except Exception as exc:
        logger.error("Agent card fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/chat")
async def chat(body: ChatRequest, request: Request):
    """
    Send a message to the ICA A2A agent.
    Always returns a streaming SSE response — ICA only supports streaming.
    """
    logger.info("Chat request received")

    history_dicts = [m.model_dump() for m in body.history]

    async def event_stream():
        try:
            async for chunk in call_agent_stream(body.message, history_dicts):
                payload = json.dumps({"chunk": chunk})
                yield f"data: {payload}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            logger.error("Streaming error: %s — %s", type(exc).__name__, str(exc))
            err_payload = json.dumps({"error": "Agent communication failed"})
            yield f"data: {err_payload}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
