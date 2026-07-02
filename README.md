# Spicetify Song Downloader

A Spicetify extension that adds "Download song", "Download playlist", and "Download album" options to Spotify's right-click context menus. Uses yt-dlp to download audio and embeds Spotify metadata (title, artist, album art, etc.).

## Features

- **Right-click to download** — adds "Download song" to the context menu for any track
- **Playlist and album downloads** — queues collection tracks through the companion service with progress notifications
- **Spotify metadata** — embeds correct title, artist, album, cover art and more
- **Companion service** — automatic downloads via a lightweight Python HTTP server
- **Fallback mode** — copies a yt-dlp command to clipboard if the companion service isn't running

## Requirements

- [Spicetify](https://spicetify.app)
- [Node.js](https://nodejs.org) (for building the extension)
- [Python](https://python.org) + [uv](https://github.com/astral-sh/uv) (for the companion service)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org)

## Installation

Clone the repository and install Node dependencies:

```bash
git clone https://github.com/grademach/spotify-downloader.git
cd spotify-downloader
npm install
```

Run the install script:

```bash
bash install.sh
```

This builds the extension, copies it to the Spicetify extensions directory, and applies it.

## Companion Service

The companion service handles the actual downloading.

**With uv (recommended):**

```bash
uv pip install -r requirements.txt
uv run python companion-service.py
```

**With pip:**

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python companion-service.py
```

Downloads are saved to `~/Music` by default.

### Options

```
--output <dir>    Set the download directory (default: ~/Music)
--prefer-video    Search for official videos instead of audio-only results
--playlist-delay <seconds>
                  Optional wait between playlist/album track starts (default: 0.0)
--playlist-workers <count>
                  Concurrent workers per playlist/album job (default: 2)
--retries <count>
                  Retry failed track downloads after the first attempt (default: 2)
```

Example:

```bash
uv run python companion-service.py --output ~/Downloads/Music --prefer-video --playlist-workers 3 --retries 2
```

Playlist and album downloads are saved in a collection-specific subfolder under the configured output directory. Use `--playlist-workers 1` for serial collection downloads, `--playlist-workers 3` for faster collection downloads that seem to work fine in testing, or a positive `--playlist-delay` only if you need extra throttling.

See [COMPANION.md](COMPANION.md) for autostart setup (systemd, launchd, Task Scheduler).

### Without Companion Service

If the companion service isn't running, the extension copies a `yt-dlp` command to your clipboard when you click "Download song". Paste and run it in your terminal.

## Updating

After pulling new changes, re-run the install script:

```bash
git pull
bash install.sh
```

## License

[MIT](https://choosealicense.com/licenses/mit/)
