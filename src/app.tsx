async function main() {
  while (!Spicetify?.showNotification) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const downloadDirectory = "C:/Users/goose/Music"

  async function downloadSong(uris: string[]) {
    let uriObject = Spicetify.URI.fromString(uris[0]);

    let downloadCommand = `spotdl ${uriObject.toURL()} --output ${downloadDirectory} & exit`

    await Spicetify.Platform.ClipboardAPI.copy(downloadCommand);
    Spicetify.showNotification("Download cmd copied to clipboard", false, 2000);
  }

  function shouldDisplayContextMenu(uris: string[]) {
    let shouldDisplay = Spicetify.URI.isTrack(uris[0]);
    return shouldDisplay;
  }

  const contextMenu = new Spicetify.ContextMenu.Item(
    "Download song",
    downloadSong,
    shouldDisplayContextMenu
  )

  contextMenu.register();
}

export default main;
