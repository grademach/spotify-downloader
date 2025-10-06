async function main() {
  while (!Spicetify?.showNotification) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const COMPANION_SERVICE_URL = "http://127.0.0.1:8937";

  async function checkServiceHealth() {
    try {
      const response = await fetch(`${COMPANION_SERVICE_URL}/health`, {
        method: "GET",
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async function downloadSong(uris: string[]) {
    let uriObject = Spicetify.URI.fromString(uris[0]);
    const trackUrl = uriObject.toURL();

    const isServiceRunning = await checkServiceHealth();

    if (!isServiceRunning) {
      let downloadCommand = `spotdl ${trackUrl}`;
      await Spicetify.Platform.ClipboardAPI.copy(downloadCommand);
      Spicetify.showNotification("Companion service not running. Command copied to clipboard.", true, 3000);
      return;
    }

    try {
      Spicetify.showNotification("⏳ Starting download...", false, 2000);

      const response = await fetch(`${COMPANION_SERVICE_URL}/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: trackUrl,
        }),
      });

      const result = await response.json();

      if (result.success) {
        Spicetify.showNotification("Download completed successfully!", false, 3000);
      } else {
        Spicetify.showNotification(`Download failed: ${result.message}`, true, 5000);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      Spicetify.showNotification(`Error: ${errorMessage}`, true, 5000);
    }
  }

  function shouldDisplayContextMenu(uris: string[]) {
    let shouldDisplay = Spicetify.URI.isTrack(uris[0]);
    return shouldDisplay;
  }

  const contextMenu = new Spicetify.ContextMenu.Item(
    "Download song",
    downloadSong,
    shouldDisplayContextMenu,
    Spicetify.SVGIcons.download
  );

  contextMenu.register();
}

export default main;
