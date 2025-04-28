# Spicetify Song Downloader

An extension that makes it easy to download songs from Spotify using Spicetify and SpotDL.

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

Windows	`%appdata%\spicetify\Extensions\`<br>
Linux/MacOS	`~/.config/spicetify/Extensions`

After placing the extension file into the correct folder, run the following command to install it:

```bash
spicetify config extensions <file name>
spicetify apply
```

## License

[MIT](https://choosealicense.com/licenses/mit/)
