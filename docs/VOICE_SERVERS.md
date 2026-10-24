# ECHO voice inference servers

Node **STT** / **TTS modules** talk HTTP only. Both inference servers are **Python packages inside this repo** — install with `pip` (and `pnpm` scripts run that for you). No manual clones, C++ builds, or separate toolchains.

| Package | Command | Port | What runs |
|---------|---------|------|-----------|
| `echo-whisper-server` | `python -m echo_whisper_server` | **8091** | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — `POST /v1/audio/transcriptions` |
| `echo-fish-speech-server` | `python -m echo_fish_speech_server` | **8092** | [Fish Speech](https://speech.fish.audio/) `tools/api_server.py` (msgpack `POST /v1/tts`) |

## Whisper (STT backend)

```bash
pip install -e "servers/whisper[runtime]"
pnpm dev:server:whisper
```

| Variable | Default |
|----------|---------|
| `ECHO_WHISPER_PORT` | `8091` |
| `ECHO_WHISPER_MODEL` | `base` |
| `ECHO_WHISPER_DEVICE` | `cpu` |

## Fish Speech (TTS backend)

One-time install (clone Fish Speech + pip deps — **keep this window open until it finishes**):

```bash
pnpm install:server:fish
```

Or on Windows: `fishtts_install.bat` (writes `logs/fish-install.log`).

Start the API on **8092**:

```bash
pnpm dev:server:fish
```

The bootstrap clones [fish-speech](https://github.com/fishaudio/fish-speech) under your ECHO data dir (see below) and runs `pip install -e` there — Fish’s API server needs that source tree (`.project-root`), not a flat site-packages install. Checkpoints download on first run via **huggingface_hub**.

### Models (PyTorch checkpoints, not GGUF)

| Model | Set `ECHO_FISH_LLAMA_CHECKPOINT` | Auto HF repo |
|-------|----------------------------------|--------------|
| **S2-Pro** (default) | `checkpoints/s2-pro` | `fishaudio/s2-pro` |
| **Drama 3** | `checkpoints/drama-3` | `fishaudio/drama-3` (+ auto-fetch S2-Pro codec if needed) |

Example — Drama 3:

```powershell
$env:ECHO_FISH_LLAMA_CHECKPOINT = "checkpoints/drama-3"
pnpm dev:server:fish
```

Fish Audio documents **Linux / WSL** and large GPUs for Drama 3; S2-Pro can run on CPU. ECHO does not ship weights — only the download helper.

### Environment

| Variable | Purpose |
|----------|---------|
| `ECHO_FISH_DATA_DIR` | Checkpoint cache root (default `%LOCALAPPDATA%\ECHO\fish-speech` or `~/.local/share/echo/fish-speech`) |
| `ECHO_FISH_LLAMA_CHECKPOINT` | Checkpoint dir name under data dir (default `checkpoints/s2-pro`) |
| `ECHO_FISH_HF_REPO` | Override Hugging Face id (e.g. `fishaudio/drama-3`) |
| `ECHO_FISH_AUTO_DOWNLOAD` | `1` (default) download missing weights; `0` fail if absent |
| `ECHO_FISH_SPEECH_HOME` | Optional override if Fish Speech is not the pip `[fish]` install |
| `ECHO_FISH_HOST` / `ECHO_FISH_PORT` | Bind (default `127.0.0.1:8092`) |
| `ECHO_FISH_DECODER_CHECKPOINT` | Extra codec path when required by model |
| `ECHO_FISH_DEVICE` | e.g. `cuda:0` (launcher sets `cuda:0` when CUDA PyTorch is detected) |
| `ECHO_FISH_TORCH_CUDA` | PyTorch **wheel** tag for torch 2.8: `cu129` (default), `cu128`, `cu126` |

### CUDA 13.x driver vs PyTorch wheels

`nvidia-smi` may report **CUDA 13.2** (or 13.4). That is the **driver** capability. Fish Speech ships **PyTorch 2.8.0**, which on Windows only publishes **`cu126` / `cu128` / `cu129`** wheels — each bundles an older CUDA *runtime*, and your 13.x driver is backward compatible.

ECHO defaults to **`cu129`** (`2.8.0+cu129`). You do **not** need a `cu132` wheel for a 13.2 driver unless you upgrade to a newer PyTorch line that publishes one (and Fish Speech supports it). If GPU init fails after install, try `ECHO_FISH_TORCH_CUDA=cu128`, delete `%LOCALAPPDATA%\ECHO\fish-speech\src\fish-speech\.echo-fish-pytorch-cuda`, and restart the Fish server.
| `ECHO_FISH_API_KEY` | Optional `--api-key` for api_server |
| `ECHO_FISH_REFERENCE_ID` | Optional voice id (TTS module env) |

Health: `GET http://127.0.0.1:8092/v1/health` → `{"status":"ok"}` when Fish Speech is up.

### Cloud alternative

The TTS module **OpenRouter** provider remains for hosted speech models without local inference.
