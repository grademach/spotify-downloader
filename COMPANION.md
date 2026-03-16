# Companion Service

A lightweight Python HTTP server that handles download requests from the Spicetify extension using yt-dlp.

## Setup

### With uv (recommended)

```bash
uv pip install -r requirements.txt
uv run python companion-service.py
```

### With pip

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python companion-service.py
```

The service runs on `http://127.0.0.1:8937`.

## Options

```
--output <dir>    Download directory (default: ~/Music)
--prefer-video    Search for official videos instead of audio-only results
```

## Running as a Background Service

### Linux (systemd)

Create `/etc/systemd/system/spotify-downloader-companion.service`:

```ini
[Unit]
Description=Spotify Downloader Companion Service
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/spotify-downloader
ExecStart=/path/to/spotify-downloader/.venv/bin/python companion-service.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable spotify-downloader-companion
sudo systemctl start spotify-downloader-companion
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.spotify-downloader.companion.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.spotify-downloader.companion</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/spotify-downloader/.venv/bin/python</string>
        <string>/path/to/spotify-downloader/companion-service.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Then:

```bash
launchctl load ~/Library/LaunchAgents/com.spotify-downloader.companion.plist
```

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task
3. Name: "Spotify Downloader Companion"
4. Trigger: At log on
5. Action: Start a program
6. Program: `C:\path\to\spotify-downloader\.venv\Scripts\python.exe`
7. Arguments: `C:\path\to\spotify-downloader\companion-service.py`
8. Check "Run with highest privileges"
