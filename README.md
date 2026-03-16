# Spicetify Song Downloader

A Spicetify extension that adds a "Download song" option to the right-click context menu for any track. Uses yt-dlp to download audio and embeds Spotify metadata (title, artist, album art, etc.).

## Features

- **Right-click to download** — adds "Download song" to the context menu for any track
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

The companion service handles the actual downloading. Set up Python dependencies:

```bash
uv pip install -r requirements.txt
```

Start the service:

```bash
uv run python companion-service.py
```

Downloads are saved to `~/Music` by default.

### Options

```
--output <dir>    Set the download directory (default: ~/Music)
--prefer-video    Search for official videos instead of audio-only results
```

Example:

```bash
uv run python companion-service.py --output ~/Downloads/Music --prefer-video
```

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
