#!/usr/bin/env bash
set -e

# Build the extension
echo "Building extension..."
npm run build-local

# Find the Spicetify extensions directory
SPICETIFY_DIR=$(spicetify path userdata 2>/dev/null)
if [ -z "$SPICETIFY_DIR" ]; then
  echo "Error: Could not find Spicetify directory. Is spicetify installed?"
  exit 1
fi

EXTENSIONS_DIR="$SPICETIFY_DIR/Extensions"
mkdir -p "$EXTENSIONS_DIR"

# Copy the built extension
cp dist/song-downloader.js "$EXTENSIONS_DIR/song-downloader.js"
echo "Copied extension to $EXTENSIONS_DIR"

# Register extension if not already registered
if ! spicetify config extensions 2>/dev/null | grep -q "song-downloader.js"; then
  spicetify config extensions song-downloader.js
fi

# Apply
echo "Applying Spicetify..."
spicetify apply

echo ""
echo "Done! Start the companion service with:"
echo "  uv run python companion-service.py"
