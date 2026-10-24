# ECHO voice inference servers

Python packages only — `pip install -e` from this tree (see root `pnpm dev:server:*` scripts).

- **`whisper/`** — faster-whisper STT on port **8091**.
- **`fish/`** — Fish Audio **Fish Speech** on port **8092** (`[fish]` extra installs upstream from GitHub; weights via `huggingface_hub`).

See [docs/VOICE_SERVERS.md](../docs/VOICE_SERVERS.md).
