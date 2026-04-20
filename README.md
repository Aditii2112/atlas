# Atlas

Atlas is the **full-stack app** (FastAPI backend + React/Vite frontend) for the GlobalTravel trip planner.

If you only want the **standalone MCP server** (for Claude Desktop / Cursor / any MCP client), use:

- `https://github.com/Aditii2112/globaltravel-mcp-server`

## What’s inside

- **Backend**: `api_server.py` (FastAPI)
  - Calls **Ollama** for LLM responses
  - Calls the **local MCP tool** `visualize_trip` by running `server.py` over stdio
- **MCP tool server**: `server.py`
- **Frontend**: `frontend/` (React + Vite)

## Prerequisites

- Python 3.10+ (recommended)
- Node 18+ (recommended)
- Ollama running locally (default: `http://localhost:11434`)
- A Google Maps API key (Directions + Static Maps + Geocoding)

## Run locally

### 1) Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Update `.env`:

- `GOOGLE_MAPS_API_KEY=...`
- `OLLAMA_URL=http://localhost:11434/api/chat`
- `OLLAMA_MODEL=gemma4`

Start the API:

```bash
uvicorn api_server:app --reload --host 127.0.0.1 --port 8000
```

Quick check:

- `GET http://localhost:8000/api/health`

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the UI (Vite default):

- `http://localhost:5173`


