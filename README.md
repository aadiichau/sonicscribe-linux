<p align="center">
  <img src="assets/icon.png" alt="SonicScribe icon" width="88" />
</p>

<h1 align="center">SonicScribe</h1>

<p align="center">
  Local speech-to-text for Linux — private, unlimited, runs on your GPU.<br/>
  <sub>Whisper · Local · Unlimited</sub>
</p>

<p align="center">
  <a href="https://github.com/aadiichau/sonicscribe-linux/releases/latest">Download latest release</a>
  ·
  <a href="https://github.com/aadiichau">@aadiichau</a>
</p>

---

Drop audio or video files and read the transcript as it's written, line by line. Built on
[faster-whisper](https://github.com/SYSTRAN/faster-whisper). Your files never leave your computer.

This is the Linux edition, rewritten from the ground up (Tauri + Rust + React) with the same design as
[Rabbit](https://github.com/aadiichau/rabbit). Looking for Windows? See
[SonicScribe for Windows](https://github.com/aadiichau/SonicScribe).

## Features

- **Local and unlimited.** No cloud, no account, no caps, no telemetry.
- **GPU accelerated.** NVIDIA CUDA through CTranslate2, with automatic CPU fallback. Memory-saving precision is
  picked for 6 GB cards.
- **Live transcript.** Lines appear while the file is processed, with position, realtime speed and a progress ruler.
- **Queue.** Drop many files or a whole folder; they run one after another. Pause, cancel and retry per file.
- **Models.** tiny → large-v3, including **large-v3-turbo** (default: near large-v3 accuracy, much faster).
  Downloaded once, on first use, with real download progress.
- **99 languages**, auto-detected or fixed. A vocabulary hint helps with names and jargon.
- **Export** TXT, TXT with timestamps, SRT, VTT and JSON — on demand, or automatically when a file finishes.
- **History** of every transcript with full-text search, rename and delete.
- **Desktop integration.** Drag and drop from your file manager, "Open with SonicScribe", desktop notifications,
  single instance.

**Formats:** MP3, WAV, M4A, FLAC, OGG, OPUS, AAC, WMA, AIFF, MP4, MKV, WEBM, MOV, AVI and more. Decoding is built
in (PyAV), so no system FFmpeg is needed.

## Install

Each [release](https://github.com/aadiichau/sonicscribe-linux/releases/latest) has:

| File | For |
|---|---|
| `sonicscribe_<version>_amd64.AppImage` | Any distro. `chmod +x` it and run; it adds itself to your app menu on first launch. |
| `sonicscribe_<version>_amd64.deb` | Debian, Ubuntu, Mint, Pop!_OS |
| `sonicscribe-<version>-1.x86_64.rpm` | Fedora, openSUSE |

Arch / CachyOS / Manjaro: use the AppImage, or build from source (below).

### First run

SonicScribe needs Python 3.9–3.14 (already installed on most distros). Open the app and press **Install engine**.
It creates a private environment in `~/.local/share/sonicscribe/venv` and installs faster-whisper — plus NVIDIA's
CUDA libraries (~1 GB) if an NVIDIA driver is present. No sudo, nothing installed system-wide.

The first transcription with each model downloads it (75 MB for tiny up to 3.1 GB for large-v3) into the usual
Hugging Face cache, `~/.cache/huggingface/hub`, shared with other Whisper tools.

## Where things are

| What | Where |
|---|---|
| Exports | `~/Documents/SonicScribe` (change in Settings) |
| Settings | `~/.config/sonicscribe/settings.json` |
| History, engine | `~/.local/share/sonicscribe/` |
| Models | `~/.cache/huggingface/hub/` |

## Build from source

Needs Node 20+, Rust (stable) and WebKitGTK 4.1.

```sh
# Arch / CachyOS
sudo pacman -S --needed nodejs npm rustup webkit2gtk-4.1 base-devel && rustup default stable
# Debian / Ubuntu
sudo apt install nodejs npm libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev
# Fedora
sudo dnf install nodejs npm webkit2gtk4.1-devel openssl-devel librsvg2-devel && sudo dnf group install c-development

git clone https://github.com/aadiichau/sonicscribe-linux.git
cd sonicscribe-linux
npm install
npm run tauri dev            # run
npm run tauri build          # AppImage / deb / rpm in src-tauri/target/release/bundle/
```

Tests: `npm test` (frontend) and `cargo test --manifest-path src-tauri/Cargo.toml` (backend).

## Something broke?

| Problem | Fix |
|---|---|
| Blank or white window (NVIDIA + Wayland) | SonicScribe already sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`. If it persists, try `GDK_BACKEND=x11 sonicscribe`. |
| Window can't be moved or resized | Settings → Behaviour → **System title bar**. |
| "CUDA libraries failed to load" | Settings → Engine → **Repair**, or set Device to CPU. |
| GPU runs out of memory | Use large-v3-turbo or medium, or close other GPU apps. |
| Install says no Python found | Install it: `sudo pacman -S python` / `sudo apt install python3 python3-venv`. |
| Model download stalls | Restart the file; partial downloads are cleaned up automatically. |

Logs: run `RUST_LOG=sonicscribe_lib=debug sonicscribe` from a terminal.

## Architecture

```
React UI (src/) ──invoke/Channel──▶ Rust (src-tauri/src/)
                                     ├─ jobs.rs     queue + engine actor
                                     ├─ worker.rs   supervises the Python process
                                     ├─ env.rs      venv setup, CUDA library paths, probe
                                     ├─ history.rs  one JSON file per transcript, searchable
                                     └─ export.rs   TXT / SRT / VTT / JSON
                                          │ JSON lines over stdin/stdout
                                          ▼
                                     engine/transcribe_worker.py  (faster-whisper; model stays loaded)
```

## License

MIT — [LICENSE](LICENSE). Built by [Aditya Chauhan](https://github.com/aadiichau).
