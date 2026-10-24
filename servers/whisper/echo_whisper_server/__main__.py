from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    host = os.environ.get("ECHO_WHISPER_HOST", "127.0.0.1")
    port = int(os.environ.get("ECHO_WHISPER_PORT", "8091"))
    print(f"[echo-whisper] Loading model on first request — ECHO_WHISPER_MODEL={os.environ.get('ECHO_WHISPER_MODEL', 'base')}")
    print(f"[echo-whisper] Listening on http://{host}:{port}/v1/audio/transcriptions")
    uvicorn.run("echo_whisper_server.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
