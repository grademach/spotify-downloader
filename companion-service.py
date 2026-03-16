#!/usr/bin/env python3
"""
Spotify Downloader Companion Service
A lightweight HTTP server that handles download requests from the Spicetify extension.
Uses yt-dlp to download audio and mutagen to embed Spotify metadata.
"""

import argparse
import json
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import os
from pathlib import Path
from urllib.request import urlopen

PORT = 8937
DOWNLOAD_DIR = str(Path.home() / "Music")
TIMEOUT = 300  # 5 minutes
PREFER_VIDEO = False  # set via --prefer-video flag


def check_dependencies():
    """Check that yt-dlp and ffmpeg are available."""
    missing = []
    checks = {"yt-dlp": ["yt-dlp", "--version"], "ffmpeg": ["ffmpeg", "-version"]}
    for name, cmd in checks.items():
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=10)
            if result.returncode != 0:
                missing.append(name)
        except FileNotFoundError:
            missing.append(name)
    return missing


class DownloadHandler(BaseHTTPRequestHandler):
    """Handle download requests from the Spicetify extension."""

    def _set_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json_response(self, status, data):
        self._set_headers(status)
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok", "message": "Companion service is running"})
        else:
            self._json_response(404, {"status": "error", "message": "Not found"})

    def do_POST(self):
        if self.path != "/download":
            self._json_response(404, {"status": "error", "message": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            data = json.loads(post_data.decode())
        except json.JSONDecodeError:
            self._json_response(400, {"status": "error", "message": "Invalid JSON"})
            return

        if not data.get("title"):
            self._json_response(400, {"status": "error", "message": "Missing title"})
            return

        try:
            result = self._download_song(data, DOWNLOAD_DIR)
            self._json_response(200 if result["success"] else 500, result)
        except Exception as e:
            self._json_response(500, {"status": "error", "message": str(e)})

    def _download_song(self, metadata, output_dir):
        """Download a song using yt-dlp and embed Spotify metadata."""
        os.makedirs(output_dir, exist_ok=True)

        title = metadata["title"]
        artist = metadata.get("artist", "")
        query = f"{artist} - {title}" if artist else title

        # Build output filename
        safe_artist = "".join(c for c in artist if c not in r'<>:"/\|?*')
        safe_title = "".join(c for c in title if c not in r'<>:"/\|?*')
        filename = f"{safe_artist} - {safe_title}" if safe_artist else safe_title
        output_template = os.path.join(output_dir, f"{filename}.%(ext)s")

        # Append search hint based on preference
        if PREFER_VIDEO:
            search_query = f"{query} official video"
        else:
            search_query = f"{query} audio"

        cmd = [
            "yt-dlp",
            f"ytsearch1:{search_query}",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "-o", output_template,
            "--no-warnings",
            "--print", "after_move:%(title)s",
        ]

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=TIMEOUT
            )
        except subprocess.TimeoutExpired:
            return {"success": False, "message": "Download timed out"}

        if result.returncode != 0:
            return {
                "success": False,
                "message": "yt-dlp download failed",
                "error": result.stderr,
            }

        matched_title = result.stdout.strip()

        # Find the downloaded file
        output_file = Path(output_dir) / f"{filename}.mp3"
        if not output_file.exists():
            candidates = list(Path(output_dir).glob(f"{filename}.*"))
            if candidates:
                output_file = candidates[0]
            else:
                return {
                    "success": False,
                    "message": "Download completed but output file not found",
                }

        # Embed Spotify metadata
        try:
            self._embed_metadata(output_file, metadata)
        except Exception as e:
            print(f"Warning: Failed to embed metadata: {e}")

        return {
            "success": True,
            "message": "Download completed successfully",
            "matched": matched_title,
            "file": str(output_file),
        }

    def _embed_metadata(self, file_path, metadata):
        """Embed Spotify metadata into the audio file using mutagen."""
        from mutagen._file import File as MutagenFile
        from mutagen.id3 import ID3
        from mutagen.id3._frames import APIC, TYER, WOAS

        encoding = file_path.suffix[1:]

        if encoding == "mp3":
            # First pass: write basic tags with EasyID3
            audio = MutagenFile(str(file_path), easy=True)
            if audio is None:
                return

            audio["title"] = metadata["title"]
            audio["artist"] = metadata["artist"]

            if metadata.get("album"):
                audio["album"] = metadata["album"]
            if metadata.get("album_artist"):
                audio["albumartist"] = metadata["album_artist"]
            if metadata.get("date"):
                audio["date"] = metadata["date"]
            if metadata.get("track_number"):
                total = metadata.get("total_tracks", "")
                audio["tracknumber"] = (
                    f"{metadata['track_number']}/{total}" if total else str(metadata["track_number"])
                )
            if metadata.get("disc_number"):
                total = metadata.get("total_discs", "")
                audio["discnumber"] = (
                    f"{metadata['disc_number']}/{total}" if total else str(metadata["disc_number"])
                )
            if metadata.get("genre"):
                audio["genre"] = metadata["genre"]

            audio.save(v2_version=3)

            # Second pass: advanced ID3 frames
            audio = ID3(str(file_path))

            if metadata.get("spotify_url"):
                audio.add(WOAS(encoding=3, url=metadata["spotify_url"]))

            if metadata.get("year"):
                audio.add(TYER(encoding=3, text=str(metadata["year"])))

            # Embed album art
            art_url = metadata.get("art_url")
            if art_url:
                try:
                    cover_data = urlopen(art_url).read()
                    if "APIC:Cover" in audio:
                        audio.pop("APIC:Cover")
                    audio["APIC"] = APIC(
                        encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover_data
                    )
                except Exception:
                    pass

            audio.save(v2_version=3)
        else:
            # Generic handler for FLAC, OGG, etc.
            audio = MutagenFile(str(file_path))
            if audio is None:
                return

            audio["title"] = metadata["title"]
            audio["artist"] = metadata["artist"]
            if metadata.get("album"):
                audio["album"] = metadata["album"]
            if metadata.get("album_artist"):
                audio["albumartist"] = metadata["album_artist"]
            if metadata.get("date"):
                audio["date"] = metadata["date"]
            if metadata.get("track_number"):
                audio["tracknumber"] = str(metadata["track_number"])
            if metadata.get("disc_number"):
                audio["discnumber"] = str(metadata["disc_number"])

            audio.save()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")


def main():
    global PREFER_VIDEO, DOWNLOAD_DIR

    parser = argparse.ArgumentParser(description="Spotify Downloader Companion Service")
    parser.add_argument("--prefer-video", action="store_true", help="Prefer official video over audio-only results")
    parser.add_argument("--output", default=DOWNLOAD_DIR, help=f"Download directory (default: {DOWNLOAD_DIR})")
    args = parser.parse_args()

    PREFER_VIDEO = args.prefer_video
    DOWNLOAD_DIR = args.output

    missing = check_dependencies()
    if missing:
        print(f"Error: Missing required dependencies: {', '.join(missing)}")
        print("Install them with:")
        if "yt-dlp" in missing:
            print("  pip install yt-dlp  (or: brew install yt-dlp)")
        if "ffmpeg" in missing:
            print("  sudo apt install ffmpeg  (or: brew install ffmpeg)")
        sys.exit(1)

    server_address = ("127.0.0.1", PORT)
    httpd = HTTPServer(server_address, DownloadHandler)

    print("╔══════════════════════════════════════════════════╗")
    print("║  Spotify Downloader Companion Service            ║")
    print("╚══════════════════════════════════════════════════╝")
    print("")
    print(f"  Service running on http://127.0.0.1:{PORT}")
    print(f"  Download directory: {DOWNLOAD_DIR}")
    print(f"  Download mode: {'video' if PREFER_VIDEO else 'audio'}")
    print("")
    print("Press Ctrl+C to stop the service")
    print("")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\nShutting down companion service...")
        httpd.shutdown()
        sys.exit(0)


if __name__ == "__main__":
    main()
