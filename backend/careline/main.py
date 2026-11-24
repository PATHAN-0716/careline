import asyncio
import json
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from loguru import logger
from starlette.concurrency import run_in_threadpool

from careline.store import Store, clinic_today

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
logger.disable("pipecat")
store = Store(os.environ.get("CARELINE_DB", str(ROOT / "careline.sqlite3")))
required = ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "GOOGLE_API_KEY")


def voice_configured():
    return all(os.getenv(key, "").strip() for key in required)


@asynccontextmanager
async def lifespan(app):
    store.initialize()
    key_path = Path(store.path + ".key")
    try:
        with key_path.open("xb") as key_file:
            key_file.write(secrets.token_bytes(32))
    except FileExistsError:
        pass
    app.state.identity_key = key_path.read_bytes()
    handler = None
    if voice_configured():
        from careline.voice import handler
    try:
        yield
    finally:
        if handler is not None:
            await handler.close()


app = FastAPI(title="Careline", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("CARELINE_ORIGIN", "http://localhost:5173")],
                   allow_methods=["GET", "POST", "PATCH"], allow_headers=["Content-Type", "Last-Event-ID"])


@app.get("/api/health")
def health():
    return {"voiceConfigured": voice_configured(), "clinicDate": clinic_today().isoformat(), "timezone": "Asia/Kolkata"}


@app.get("/api/doctors")
def doctors():
    store.seed()
    return {"doctors": store.doctors(), "slots": store.slots()}


@app.get("/api/appointments")
def appointments():
    return store.appointments()


@app.get("/api/sessions")
def sessions():
    return store.sessions()


@app.get("/api/sessions/{session_id}/events")
def session_events(session_id: str):
    return store.events(session=session_id)


@app.get("/api/activity")
def activity():
    return store.events(recent=True)


@app.get("/api/events")
async def events(request: Request):
    async def stream():
        raw_cursor = request.headers.get("last-event-id", "")
        cursor = int(raw_cursor) if raw_cursor.isascii() and raw_cursor.isdigit() and len(raw_cursor) < 18 else 0
        if not cursor:
            recent = await run_in_threadpool(store.events, recent=True)
            cursor = recent[0]["id"] if recent else 0
        yield ": careline\n\n"
        while not await request.is_disconnected():
            change = store.dashboard_change
            rows = await run_in_threadpool(store.events, after=cursor)
            for row in rows:
                cursor = row["id"]
                yield f"id: {cursor}\ndata: {json.dumps(row)}\n\n"
            if len(rows) == 100:
                continue
            try:
                await asyncio.wait_for(change.wait(), timeout=15)
            except TimeoutError:
                yield ": heartbeat\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


if voice_configured():
    from careline.voice import install_voice

    install_voice(app, store)
else:
    @app.post("/api/offer")
    def voice_unavailable():
        from fastapi import HTTPException

        raise HTTPException(503, "Configure ElevenLabs and Gemini in the backend environment.")
