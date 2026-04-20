# Atlas

Atlas is the **full application** (backend + frontend) built on top of the local MCP tool `visualize_trip`.

If you **only want the MCP server** to plug into Claude Desktop / Cursor / other MCP clients, use:

- `https://github.com/Aditii2112/globaltravel-mcp-server`

## Repo layout

- `api_server.py`: FastAPI backend (talks to Ollama + calls the local MCP tool)
- `server.py`: local MCP tool server (`visualize_trip`)
- `frontend/`: React + Vite UI
- `chatbot.py`: optional Streamlit demo UI

## Setup

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set in `.env`:

- `GOOGLE_MAPS_API_KEY=...`
- `OLLAMA_URL=http://localhost:11434/api/chat` (default)
- `OLLAMA_MODEL=gemma4` (default)

Run:

```bash
uvicorn api_server:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend should call the backend at `http://localhost:8000`.

## MCP server reference

This repo includes `server.py` so the app works out-of-the-box. If you want a standalone MCP server repo (for Claude Desktop etc.), see:

- `https://github.com/Aditii2112/globaltravel-mcp-server`

