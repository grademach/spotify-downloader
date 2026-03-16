async function main() {
  while (!Spicetify?.showNotification) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const COMPANION_SERVICE_URL = "http://127.0.0.1:8937";

  async function checkServiceHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${COMPANION_SERVICE_URL}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function getTrackMetadata(uri: string) {
    // Fast path: if this is the currently playing track, use local Player data
    const item = Spicetify.Player.data?.item;
    if (item?.uri === uri) {
      const meta = item.metadata ?? {};
      return {
        title: item.name,
        artist: item.artists?.map((a: any) => a.name).join(", ") ?? meta.artist_name ?? "",
        album: item.album?.name ?? meta.album_title ?? "",
        album_artist: meta.album_artist_name ?? "",
        track_number: parseInt(meta.album_track_number ?? "0") || undefined,
        total_tracks: parseInt(meta.album_track_count ?? "0") || undefined,
        disc_number: parseInt(meta.album_disc_number ?? "1") || undefined,
        duration_ms: item.duration?.milliseconds,
        art_url: meta.image_xlarge_url ?? meta.image_large_url ?? meta.image_url,
        year: meta.album_release_year,
        date: meta.album_release_year,
        spotify_url: `https://open.spotify.com/track/${uri.split(":").pop()}`,
        explicit: item.isExplicit,
      };
    }

    // For non-playing tracks, use Spicetify's internal GraphQL
    const hasDefs = !!Spicetify.GraphQL?.Definitions;
    const hasGetTrackName = !!Spicetify.GraphQL?.Definitions?.getTrackName;
    const hasQueryTrackArtists = !!Spicetify.GraphQL?.Definitions?.queryTrackArtists;

    let nameRes: any, artistsRes: any;
    try {
      nameRes = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getTrackName, { trackUri: uri, uri });
    } catch (e) {
      throw new Error(`getTrackName failed: ${JSON.stringify(e)}`);
    }
    try {
      artistsRes = await Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.queryTrackArtists, { trackUri: uri, uri, locale: "", includePrerelease: false });
    } catch (e) {
      throw new Error(`queryTrackArtists failed: ${JSON.stringify(e)}`);
    }

    const title = nameRes?.data?.trackUnion?.name ?? "";

    // Extract artist - try multiple known response shapes
    const trackUnion = artistsRes?.data?.trackUnion;
    let artist = "";
    const firstArtist = trackUnion?.firstArtist?.items ?? trackUnion?.artists?.items ?? [];
    artist = firstArtist.map((a: any) => a?.profile?.name ?? a?.name ?? "").filter(Boolean).join(", ");

    if (!title) {
      throw new Error(`Empty title. nameRes=${JSON.stringify(nameRes).slice(0,200)} artistsRes=${JSON.stringify(artistsRes).slice(0,200)}`);
    }
    if (!artist) {
      console.warn("[song-downloader] artistsRes:", JSON.stringify(artistsRes));
    }

    return {
      title,
      artist,
      spotify_url: `https://open.spotify.com/track/${uri.split(":").pop()}`,
    };
  }

  async function downloadSong(uris: string[]) {
    const isServiceRunning = await checkServiceHealth();

    if (!isServiceRunning) {
      const uriObject = Spicetify.URI.fromString(uris[0]);
      const trackUrl = uriObject.toURL();
      await Spicetify.Platform.ClipboardAPI.copy(`yt-dlp "ytsearch1:${trackUrl}" -x --audio-format mp3`);
      Spicetify.showNotification("Companion service not running. Command copied to clipboard.", true, 3000);
      return;
    }

    try {
      Spicetify.showNotification("Fetching track info...", false, 2000);

      const metadata = await getTrackMetadata(uris[0]);

      Spicetify.showNotification(`Downloading: ${metadata.artist} - ${metadata.title}...`, false, 3000);

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5 * 60 * 1000);

      const response = await fetch(`${COMPANION_SERVICE_URL}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
        signal: controller.signal,
      });

      const result = await response.json();

      if (result.success) {
        let msg = "Download completed!";
        if (result.matched) msg += ` Matched: ${result.matched}`;
        if (result.warning) msg += ` (${result.warning})`;
        Spicetify.showNotification(msg, false, 5000);
      } else {
        Spicetify.showNotification(`Download failed: ${result.message}`, true, 5000);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        Spicetify.showNotification("Download timed out after 5 minutes.", true, 5000);
      } else {
        const msg = error instanceof Error
          ? (error.message || error.stack || error.toString())
          : JSON.stringify(error);
        Spicetify.showNotification(`Error: ${msg}`, true, 5000);
        console.error("[song-downloader] Error:", error);
      }
    }
  }

  function shouldDisplayContextMenu(uris: string[]) {
    return Spicetify.URI.isTrack(uris[0]);
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
