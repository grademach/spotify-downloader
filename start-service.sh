#!/bin/bash
# Start the Spotify Downloader Companion Service

if ! command -v python3 &> /dev/null; then
    echo "Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

if ! command -v spotdl &> /dev/null; then
    echo "⚠️  spotdl is not installed."
    echo "Installing spotdl..."
    pip3 install -r requirements.txt
fi

echo "Starting Spotify Downloader Companion Service..."
python3 companion-service.py
