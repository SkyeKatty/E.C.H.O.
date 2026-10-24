from __future__ import annotations

import os
import tempfile

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from . import engine

app = FastAPI(title="ECHO Whisper Server", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", **engine.status()}


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(default="whisper-1"),
    language: str | None = Form(default=None),
) -> JSONResponse:
    _ = model
    suffix = ".wav"
    if file.filename and "." in file.filename:
        suffix = "." + file.filename.rsplit(".", 1)[-1].lower()
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name
        text = engine.transcribe_file(tmp_path, language=language or None)
    except Exception as err:
        return JSONResponse(status_code=500, content={"error": str(err)})
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    return JSONResponse(content={"text": text})
