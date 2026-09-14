# Voice LLM Chat — ICA A2A Agent

A voice-enabled chat application using React (frontend) and FastAPI (backend), connected to an ICA A2A agent endpoint.

## Project Structure

```
voice-llm-app/
├── backend/
│   ├── main.py          # FastAPI app — /api/health, /api/chat
│   ├── ica_client.py    # ICA A2A agent client (streaming + non-streaming)
│   ├── requirements.txt
│   └── .env.example     # Copy to .env and fill in your API key
└── frontend/
    ├── src/
    │   ├── App.jsx       # Main UI component
    │   ├── useSpeech.js  # STT (Web Speech API) + TTS (speechSynthesis) hooks
    │   ├── api.js        # SSE streaming fetch to backend
    │   ├── index.css     # Styles
    │   └── main.jsx      # React entry point
    ├── index.html
    ├── vite.config.js    # Dev proxy: /api → http://127.0.0.1:8000
    └── package.json
```

## Setup

### Backend

```bash
cd voice-llm-app/backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Copy example env and fill in your ICA API key
cp .env.example .env
# Edit .env — set ICA_API_KEY to the key from ICA Agent Studio Settings

uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend

```bash
cd voice-llm-app/frontend
npm install
npm run dev
# App runs at http://127.0.0.1:5173
```

## How It Works

1. User presses the 🎙 mic button → Web Speech API transcribes speech to text
2. Transcript is sent via `POST /api/chat` to the FastAPI backend
3. Backend calls the ICA A2A agent endpoint with `Accept: text/event-stream`
4. Response streams back token-by-token via SSE
5. Once complete, `speechSynthesis` reads the response aloud

## Authentication

Your ICA API key is loaded from the `ICA_API_KEY` environment variable.
Generate one from: **ICA Agent Studio → Settings → API Keys**
Pass it as `Authorization: Bearer <key>` (handled automatically).

## Security Notes

- API key lives only in the backend `.env` — never in the browser
- Backend binds to `127.0.0.1` only
- `.env` is in `.gitignore` — never commit it
