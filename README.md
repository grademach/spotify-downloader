# Spicetify Song Downloader

An extension that makes it easy to download songs from Spotify using Spicetify and SpotDL.

## Installation

To get started, install spicetify, spotdl, clone the repository and install the dependencies:

```bash
git clone https://github.com/grademach/spotify-downloader.git
cd song-downloader
npm install
tsc
```

Copy `app.js` from `dist/app.js` to the spicetify extensions folder

Windows	`%appdata%\spicetify\Extensions\`
Linux/MacOS	`~/.config/spicetify/Extensions`

After placing the extension file into correct folder, run following command to install it:

spicetify config extensions <file name>
spicetify apply

## License

[MIT](https://choosealicense.com/licenses/mit/)
