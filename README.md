# Spicetify Song Downloader

An extension that makes it easy to download songs from Spotify using Spicetify and SpotDL.

## Features

- 🎵 **Right-click to download**: Add "Download song" to the context menu for any track
- 🚀 **Companion service**: Automatic downloads with a lightweight Python HTTP server (optional)
- 📋 **Fallback mode**: Falls back to clipboard copy if companion service is not running
- ✅ **Real-time notifications**: Get instant feedback on download status

## Installation

To get started, install **spicetify** and **spotdl**.<br>
Then clone the repository and install the dependencies:

```bash
git clone https://github.com/grademach/spotify-downloader.git
cd spotify-downloader
npm install
npm run build-local
```

Copy `song-downloader.js` from `dist/song-downloader.js` to the spicetify extensions folder

Windows `%appdata%\spicetify\Extensions\`<br>
Linux/MacOS `~/.config/spicetify/Extensions`

After placing the extension file into the correct folder, run the following command to install it:

```bash
spicetify config extensions <file name>
spicetify apply
```

## Using the Companion Service (Recommended)

For automatic downloads without clipboard copying, set up the companion service:

1. **Install Python dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

2. **Start the companion service:**

   ```bash
   python companion-service.py
   ```

3. **Now downloads will happen automatically!** When you click "Download song", the extension will communicate with the companion service to handle the download.

**See [COMPANION.md](COMPANION.md) for detailed setup instructions, including how to run the service at startup.**

### Without Companion Service

If you don't want to run the companion service, the extension will automatically fall back to copying the download command to your clipboard. You'll need to paste and run it manually in your terminal.

## License

[MIT](https://choosealicense.com/licenses/mit/)
