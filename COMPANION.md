# Companion Service

A lightweight Python HTTP server that enables the Spicetify extension to download songs directly without manual clipboard copying.

## Setup

1. **Install Python dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

2. **Start the companion service:**

   ```bash
   python companion-service.py
   ```

3. **The service will run on `http://127.0.0.1:8937`**

## How It Works

- The companion service listens for HTTP requests from the Spicetify extension
- When you click "Download song" in Spotify, the extension sends a POST request to the service
- The service executes `spotdl` with the track URL and handles the download
- You get real-time notifications about the download status

## Fallback Mode

If the companion service is not running, the extension automatically falls back to the old behavior (copying the download command to your clipboard).

## API Endpoints

### GET /health

Health check endpoint to verify the service is running.

**Response:**

```json
{
  "status": "ok",
  "message": "Companion service is running"
}
```

### POST /download

Download a song from Spotify.

**Request:**

```json
{
  "url": "https://open.spotify.com/track/...",
  "output": "/path/to/download/directory"
}
```

**Response (Success):**

```json
{
  "success": true,
  "message": "Download completed successfully",
  "output": "spotdl output..."
}
```

**Response (Error):**

```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error..."
}
```

## Configuration

Edit the constants at the top of `companion-service.py`:

```python
PORT = 8937  # Change the port if needed
DOWNLOAD_DIR = str(Path.home() / "Music")  # Default download directory
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
ExecStart=/usr/bin/python3 /path/to/spotify-downloader/companion-service.py
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
        <string>/usr/bin/python3</string>
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
6. Program: `python.exe`
7. Arguments: `C:\path\to\spotify-downloader\companion-service.py`
8. Check "Run with highest privileges"
