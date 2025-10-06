#!/usr/bin/env python3
"""
Spotify Downloader Companion Service
A lightweight HTTP server that handles download requests from the Spicetify extension.
"""

import json
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import os
from pathlib import Path

PORT = 8937
DOWNLOAD_DIR = str(Path.home() / "Music")


# Check uvx availability at startup
def check_uvx_available():
    try:
        result = subprocess.run(["uvx", "--version"], capture_output=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False


USE_UVX = check_uvx_available()
if USE_UVX:
    print("Found uvx, using it to run spotdl commands.")


class DownloadHandler(BaseHTTPRequestHandler):
    """Handle download requests from the Spicetify extension."""

    def _set_headers(self, status=200, content_type="application/json"):
        """Set common response headers."""
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self._set_headers(204)

    def do_GET(self):
        """Handle GET requests - health check."""
        if self.path == "/health":
            self._set_headers(200)
            response = {"status": "ok", "message": "Companion service is running"}
            self.wfile.write(json.dumps(response).encode())
        else:
            self._set_headers(404)
            response = {"status": "error", "message": "Not found"}
            self.wfile.write(json.dumps(response).encode())

    def do_POST(self):
        """Handle POST requests - download songs."""
        if self.path == "/download":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)

            try:
                data = json.loads(post_data.decode())
                url = data.get("url")

                if not url:
                    self._set_headers(400)
                    response = {"status": "error", "message": "Missing URL parameter"}
                    self.wfile.write(json.dumps(response).encode())
                    return

                # Execute spotdl command
                result = self._download_song(url, DOWNLOAD_DIR)

                if result["success"]:
                    self._set_headers(200)
                else:
                    self._set_headers(500)

                self.wfile.write(json.dumps(result).encode())

            except json.JSONDecodeError:
                self._set_headers(400)
                response = {"status": "error", "message": "Invalid JSON"}
                self.wfile.write(json.dumps(response).encode())
            except Exception as e:
                self._set_headers(500)
                response = {"status": "error", "message": str(e)}
                self.wfile.write(json.dumps(response).encode())
        else:
            self._set_headers(404)
            response = {"status": "error", "message": "Not found"}
            self.wfile.write(json.dumps(response).encode())

    def _download_song(self, url, output_dir):
        """Execute spotdl to download a song, using uvx if available."""
        try:
            # Ensure output directory exists
            os.makedirs(output_dir, exist_ok=True)

            cmd = ["spotdl", "download", url, "--output", output_dir]
            if USE_UVX:
                cmd.insert(0, "uvx")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,  # 1 minute timeout
            )

            if result.returncode == 0:
                return {
                    "success": True,
                    "message": "Download completed successfully",
                    "output": result.stdout,
                }
            else:
                return {
                    "success": False,
                    "message": "Download failed",
                    "error": result.stderr,
                }
        except subprocess.TimeoutExpired:
            return {"success": False, "message": "Download timed out"}
        except FileNotFoundError:
            return {
                "success": False,
                "message": "spotdl not found. Please install it with: pip install spotdl",
            }
        except Exception as e:
            return {"success": False, "message": f"Error: {str(e)}"}

    def log_message(self, format, *args):
        """Log requests with custom format."""
        print(f"[{self.log_date_time_string()}] {format % args}")


def main():
    """Start the companion service."""
    server_address = ("127.0.0.1", PORT)
    httpd = HTTPServer(server_address, DownloadHandler)

    print("╔══════════════════════════════════════════════════╗")
    print("║  Spotify Downloader Companion Service            ║")
    print("╚══════════════════════════════════════════════════╝")
    print("")
    print(f"🎵 Service running on http://127.0.0.1:{PORT}")
    print(f"📁 Default download directory: {DOWNLOAD_DIR}")
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
