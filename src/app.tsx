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
    let nameRes: any, artistsRes: any;
    try {
      [nameRes, artistsRes] = await Promise.all([
        Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getTrackName, { trackUri: uri, uri }),
        Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.queryTrackArtists, { trackUri: uri, uri, locale: "", includePrerelease: false }),
      ]);
    } catch (e: any) {
      throw new Error(`Failed to fetch track metadata: ${e?.message ?? JSON.stringify(e)}`);
    }

    const title = nameRes?.data?.trackUnion?.name ?? "";
    if (!title) throw new Error("Could not fetch track title");

    const trackUnion = artistsRes?.data?.trackUnion;
    const firstArtist = trackUnion?.firstArtist?.items ?? trackUnion?.artists?.items ?? [];
    const artist = firstArtist.map((a: any) => a?.profile?.name ?? a?.name ?? "").filter(Boolean).join(", ");

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
        const msg = error instanceof Error ? error.message : "Unknown error";
        Spicetify.showNotification(`Error: ${msg}`, true, 5000);
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
