"""
HTTP API for the Trip Planner UI. Mirrors chatbot.py: Ollama → MCP visualize_trip → Ollama.
Does not replace chatbot.py or server.py.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

load_dotenv()

ROOT = Path(__file__).resolve().parent

server_params = StdioServerParameters(
    command="python3",
    args=["server.py"],
    cwd=str(ROOT),
    env={**os.environ},
)

TOOLS_DEFINITION = """
You are a travel assistant. You have access to a tool called 'visualize_trip'.

RULES:
1. If the user mentions ANY places, locations, landmarks, parks, cities, or destinations, you MUST call the tool.
2. Extract EVERY SINGLE place the user mentions. Do NOT skip or summarize. Include ALL of them.
3. The first stop should be where the user says they are starting from.
4. For EVERY stop, add the city/state/country so it is unambiguous for geocoding. Examples:
   - "Napa" → "Napa Valley, California"
   - "Berkeley" → "Berkeley, California"
   - "Golden Gate Bridge" → "Golden Gate Bridge, San Francisco, California"
   - If a place seems misspelled or unclear, try your best to figure out what the user means from context and use the correct full name.
5. Respond ONLY with this JSON, nothing else — no explanation, no markdown, just the JSON:
{"tool": "visualize_trip", "stops": ["Starting Place, State", "Place B, State", ...]}
6. If the user is NOT asking about travel or places at all, reply normally as a friendly assistant (no JSON).
"""

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4")

app = FastAPI(title="Trip Planner MCP API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


async def run_mcp_tool(stops: list[str]):
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            return await session.call_tool("visualize_trip", arguments={"stops": stops})


def _ollama_chat(messages: list[dict], stream: bool = False) -> dict:
    r = requests.post(
        OLLAMA_URL,
        json={"model": OLLAMA_MODEL, "messages": messages, "stream": stream},
        timeout=300,
    )
    r.raise_for_status()
    return r.json()


def _blocks_to_payload(mcp_result) -> tuple[list[dict], str]:
    display_blocks: list[dict] = []
    tool_text_for_gemma = ""
    content = getattr(mcp_result, "content", None) or []
    for block in content:
        b_type = getattr(block, "type", None) or block.get("type")
        if b_type == "text":
            b_text = getattr(block, "text", None) or block.get("text", "")
            display_blocks.append({"type": "text", "text": b_text})
            tool_text_for_gemma += b_text + "\n"
        elif b_type == "image":
            b_data = getattr(block, "data", None) or block.get("data", "")
            display_blocks.append({"type": "image", "data": b_data, "mime": "image/png"})
    return display_blocks, tool_text_for_gemma


def _extract_tool_request(ai_response: str) -> tuple[bool, list[str]]:
    match = re.search(r"\{.*\}", ai_response, re.DOTALL)
    if not match:
        return False, []
    try:
        tool_data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return False, []
    if tool_data.get("tool") != "visualize_trip":
        return False, []
    stops = tool_data.get("stops") or []
    if not isinstance(stops, list):
        stops = []
    normalized_stops = [str(stop) for stop in stops if str(stop).strip()]
    return True, normalized_stops


async def _chat_flow(prompt: str) -> dict[str, Any]:
    try:
        resp = _ollama_chat(
            [
                {"role": "system", "content": TOOLS_DEFINITION},
                {"role": "user", "content": prompt},
            ]
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Ollama unreachable: {e}") from e

    ai_response = resp.get("message", {}).get("content", "") or ""
    should_use_tool, stops = _extract_tool_request(ai_response)

    if not should_use_tool:
        return {
            "kind": "text_only",
            "ollama_first_raw": ai_response,
            "assistant_markdown": ai_response,
        }

    try:
        mcp_result = await run_mcp_tool(stops)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MCP visualize_trip failed: {e}") from e

    mcp_blocks, tool_text_for_gemma = _blocks_to_payload(mcp_result)
    consultation_prompt = (
        f"The user wanted to visit {stops}. "
        f"The mapping tool returned this data:\n{tool_text_for_gemma}\n"
        "Based on these driving times and any warnings (skipped places), "
        "give a brief, friendly expert travel summary. Mention if the route seems long."
    )
    try:
        final_resp = _ollama_chat(
            [
                {"role": "system", "content": "You are a professional travel consultant."},
                {"role": "user", "content": consultation_prompt},
            ]
        )
    except requests.RequestException as e:
        raise HTTPException(
            status_code=502, detail=f"Ollama (second pass) unreachable: {e}"
        ) from e

    consultant_advice = final_resp.get("message", {}).get("content", "") or ""
    return {
        "kind": "mcp_flow",
        "ollama_first_raw": ai_response,
        "tool_name": "visualize_trip",
        "tool_arguments": {"stops": stops},
        "mcp_blocks": mcp_blocks,
        "consultant_advice": consultant_advice,
    }


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@app.get("/api/health")
def health():
    return {"ok": True, "model": OLLAMA_MODEL}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    prompt = (req.message or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="message is required")
    return await _chat_flow(prompt)


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    prompt = (req.message or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="message is required")

    async def event_generator():
        started = time.perf_counter()

        def with_elapsed(payload: dict[str, Any]) -> dict[str, Any]:
            payload["elapsed_ms"] = int((time.perf_counter() - started) * 1000)
            return payload

        yield _sse(
            "status",
            with_elapsed(
                {
                    "step": "thinking",
                    "message": "Gemma is reading your message.",
                }
            ),
        )
        yield _sse(
            "status",
            with_elapsed(
                {
                    "step": "tool_decision",
                    "message": "Gemma is deciding whether a route tool is needed.",
                }
            ),
        )

        try:
            resp = _ollama_chat(
                [
                    {"role": "system", "content": TOOLS_DEFINITION},
                    {"role": "user", "content": prompt},
                ]
            )
        except requests.RequestException as e:
            yield _sse(
                "error",
                with_elapsed(
                    {
                        "message": f"Ollama unreachable: {e}",
                    }
                ),
            )
            return

        ai_response = resp.get("message", {}).get("content", "") or ""
        should_use_tool, stops = _extract_tool_request(ai_response)
        if not should_use_tool:
            result = {
                "kind": "text_only",
                "ollama_first_raw": ai_response,
                "assistant_markdown": ai_response,
            }
            yield _sse(
                "status",
                with_elapsed(
                    {
                        "step": "direct_answer",
                        "message": "No map call needed. Gemma is replying directly.",
                    }
                ),
            )
            yield _sse("result", with_elapsed({"payload": result}))
            yield _sse("done", with_elapsed({"ok": True}))
            return

        yield _sse(
            "status",
            with_elapsed(
                {
                    "step": "json_extract",
                    "message": "Tool request detected. Converting trip request to JSON.",
                    "meta": {"stops": stops},
                }
            ),
        )
        yield _sse(
            "status",
            with_elapsed(
                {
                    "step": "tool_call",
                    "message": "Calling local MCP map tool.",
                }
            ),
        )
        try:
            mcp_result = await run_mcp_tool(stops)
        except Exception as e:
            yield _sse(
                "error",
                with_elapsed(
                    {
                        "message": f"MCP visualize_trip failed: {e}",
                    }
                ),
            )
            return

        mcp_blocks, tool_text_for_gemma = _blocks_to_payload(mcp_result)
        yield _sse(
            "status",
            with_elapsed(
                {
                    "step": "tool_output",
                    "message": "Map output received. Preparing summary.",
                }
            ),
        )

        consultation_prompt = (
            f"The user wanted to visit {stops}. "
            f"The mapping tool returned this data:\n{tool_text_for_gemma}\n"
            "Based on these driving times and any warnings (skipped places), "
            "give a brief, friendly expert travel summary. Mention if the route seems long."
        )
        yield _sse(
            "status",
            with_elapsed(
                {
                    "step": "consultant_pass",
                    "message": "Gemma is writing travel advice.",
                }
            ),
        )
        try:
            final_resp = _ollama_chat(
                [
                    {"role": "system", "content": "You are a professional travel consultant."},
                    {"role": "user", "content": consultation_prompt},
                ]
            )
        except requests.RequestException as e:
            yield _sse(
                "error",
                with_elapsed(
                    {
                        "message": f"Ollama (second pass) unreachable: {e}",
                    }
                ),
            )
            return

        consultant_advice = final_resp.get("message", {}).get("content", "") or ""
        result = {
            "kind": "mcp_flow",
            "ollama_first_raw": ai_response,
            "tool_name": "visualize_trip",
            "tool_arguments": {"stops": stops},
            "mcp_blocks": mcp_blocks,
            "consultant_advice": consultant_advice,
        }
        yield _sse("result", with_elapsed({"payload": result}))
        yield _sse("done", with_elapsed({"ok": True}))

    return StreamingResponse(event_generator(), media_type="text/event-stream")
