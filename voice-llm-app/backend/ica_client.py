"""
ICA A2A Agent client.

The ICA A2A protocol follows the Agent-to-Agent (A2A) spec:
  POST <endpoint>        → send a task / message
  GET  <endpoint>        → retrieve the agent card (discovery)

Streaming: set Accept: text/event-stream to receive SSE chunks.

Docs reference:
  https://servicesessentials.ibm.com/agenticapps/a2a/.../agents/...
"""

import os
import json
import uuid
import httpx
from typing import AsyncIterator
from dotenv import load_dotenv

load_dotenv()

# ── Configuration (loaded from environment, never hardcoded) ─────────────────
ICA_ENDPOINT  = os.environ["ICA_A2A_ENDPOINT"]   # full A2A agent URL from ICA agent studio
ICA_API_KEY   = os.environ["ICA_API_KEY"]         # Bearer token from ICA Settings


def _build_ica_payload(message: str, message_id: str) -> dict:
    """
    Build the ICA A2A JSON-RPC payload.
    Uses method message/send per A2A protocol 0.3.0.
    """
    return {
        "jsonrpc": "2.0",
        "id": message_id,
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"type": "text", "text": message}],
            },
        },
    }


async def get_agent_card() -> dict:
    """
    GET the agent card (discovery metadata) — useful for verifying auth.
    A2A 0.3.0 serves the card at /.well-known/agent.json
    """
    headers = {
        "Authorization": f"Bearer {ICA_API_KEY}",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{ICA_ENDPOINT}/.well-known/agent.json",
            headers=headers,
        )
        if not response.is_success:
            raise httpx.HTTPStatusError(
                f"GET agent card failed {response.status_code}: {response.text}",
                request=response.request,
                response=response,
            )
        return response.json()


async def call_agent_stream(
    message: str,
    history: list[dict],
) -> AsyncIterator[str]:
    """
    Call the ICA A2A endpoint with streaming (SSE).
    SSE event shapes from ICA:
      {"type":"start","messageId":"..."}
      {"type":"text-delta","id":"...","delta":"..."}  ← actual content
      {"type":"text-end","id":"..."}
      {"type":"finish"}
    """
    import logging
    logger = logging.getLogger(__name__)

    message_id = str(uuid.uuid4())
    payload = _build_ica_payload(message, message_id)
    headers = {
        "Authorization": f"Bearer {ICA_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        async with client.stream(
            "POST",
            ICA_ENDPOINT,
            headers=headers,
            json=payload,
        ) as response:
            if not response.is_success:
                body = await response.aread()
                raise httpx.HTTPStatusError(
                    f"POST agent stream failed {response.status_code}: {body.decode()[:200]}",
                    request=response.request,
                    response=response,
                )
            logger.info("ICA stream started — reading lines")
            full_body = ""
            async for line in response.aiter_lines():
                if not line:
                    continue

                # ── SSE text-delta stream (when ICA honours Accept: text/event-stream) ──
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if data == "[DONE]":
                        logger.info("ICA stream finished [DONE]")
                        return
                    try:
                        event = json.loads(data)
                        # SSE delta format: {"type":"text-delta","delta":"..."}
                        if event.get("type") == "text-delta":
                            delta = event.get("delta", "")
                            if delta:
                                yield delta
                            continue
                        # JSON-RPC result in a single SSE line
                        text = _extract_jsonrpc_text(event)
                        if text:
                            yield text
                            return
                    except json.JSONDecodeError:
                        pass
                else:
                    # Non-SSE: accumulate raw body lines
                    full_body += line

            # ── Non-SSE JSON-RPC response (ICA returned plain JSON) ──────────────
            if full_body:
                logger.info("ICA returned non-SSE body, parsing as JSON-RPC")
                try:
                    body = json.loads(full_body)
                    text = _extract_jsonrpc_text(body)
                    if text:
                        yield text
                except json.JSONDecodeError:
                    logger.warning("ICA body is not valid JSON: %s", repr(full_body[:200]))


async def call_agent(
    message: str,
    history: list[dict],
) -> str:
    """
    Non-streaming call: collects all text-delta chunks into a full response.
    """
    full_text = []
    async for chunk in call_agent_stream(message, history):
        full_text.append(chunk)
    return "".join(full_text)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _extract_jsonrpc_text(body: dict) -> str | None:
    """
    Extract text from an ICA JSON-RPC result.
    Shape observed from ICA A2A endpoint:
      {"jsonrpc":"2.0","result":{"parts":[{"kind":"text","text":"..."}]}}
    Also handles legacy shapes with "type" instead of "kind".
    """
    try:
        parts = body["result"]["parts"]
        return "".join(
            p.get("text", "")
            for p in parts
            if p.get("kind") == "text" or p.get("type") == "text"
        )
    except (KeyError, TypeError):
        pass
    return None


def _extract_text_chunk(event: dict) -> str | None:
    """
    Extract incremental text from an A2A 0.3.0 streaming event.

    Streaming event shapes:
      TaskStatusUpdateEvent:
        { "result": { "status": { "message": { "parts": [...] } } } }
      TaskArtifactUpdateEvent:
        { "result": { "artifact": { "parts": [...] } } }
    """
    try:
        # TaskArtifactUpdateEvent — streamed content delta
        parts = event["result"]["artifact"]["parts"]
        return "".join(p.get("text", "") for p in parts if p.get("type") == "text")
    except (KeyError, TypeError):
        pass
    try:
        # TaskStatusUpdateEvent — status message
        parts = event["result"]["status"]["message"]["parts"]
        return "".join(p.get("text", "") for p in parts if p.get("type") == "text")
    except (KeyError, TypeError):
        pass
    try:
        # message/send non-streaming result
        parts = event["result"]["parts"]
        return "".join(p.get("text", "") for p in parts if p.get("type") == "text")
    except (KeyError, TypeError):
        pass
    return None


def _extract_full_text(body: dict) -> str:
    """
    Extract the final response text from a non-streaming A2A 0.3.0 response.

    message/send returns:
      { "result": { "parts": [{ "type": "text", "text": "..." }] } }
    tasks/get returns artifacts array (fallback).
    """
    try:
        # message/send direct result
        parts = body["result"]["parts"]
        return "".join(p.get("text", "") for p in parts if p.get("type") == "text")
    except (KeyError, TypeError):
        pass
    try:
        # tasks/get artifacts fallback
        artifacts = body["result"]["artifacts"]
        texts = []
        for artifact in artifacts:
            for part in artifact.get("parts", []):
                if part.get("type") == "text":
                    texts.append(part["text"])
        return "".join(texts)
    except (KeyError, TypeError):
        pass
    return str(body)
