async function main() {
  while (!Spicetify?.showNotification) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const COMPANION_SERVICE_URL = "http://127.0.0.1:8937";
  const PLAYLIST_PAGE_SIZE = 50;
  const JOB_POLL_INTERVAL_MS = 3000;

  type DownloadMetadata = {
    title: string;
    artist: string;
    album?: string;
    album_artist?: string;
    track_number?: number;
    total_tracks?: number;
    disc_number?: number;
    duration_ms?: number;
    art_url?: string;
    year?: string;
    date?: string;
    spotify_url?: string;
    explicit?: boolean;
  };

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

  async function getTrackMetadata(uri: string): Promise<DownloadMetadata> {
    // Fast path: if this is the currently playing track, use local Player data
    const item = Spicetify.Player.data?.item;
    if (item?.uri === uri) {
      const meta: any = item.metadata ?? {};
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

  function getBestImageUrl(sources: any[] | undefined): string | undefined {
    if (!Array.isArray(sources) || sources.length === 0) return undefined;
    const sorted = [...sources].sort((a, b) => (b?.width ?? b?.maxWidth ?? 0) - (a?.width ?? a?.maxWidth ?? 0));
    return sorted[0]?.url;
  }

  function getPlaylistTrackMetadata(item: any): DownloadMetadata | null {
    const itemV2 = item?.itemV2?.data;
    const itemV3 = item?.itemV3?.data;
    const uri = itemV2?.uri ?? itemV3?.uri;

    if (!uri || !Spicetify.URI.isTrack(uri) || itemV2?.playability?.playable === false) {
      return null;
    }

    const title = itemV2?.name ?? itemV3?.identityTrait?.name ?? "";
    if (!title) return null;

    const artistItems = itemV2?.artists?.items ?? itemV3?.identityTrait?.contributors?.items ?? [];
    const artists = artistItems
      .map((artist: any) => artist?.profile?.name ?? artist?.name ?? "")
      .filter(Boolean);
    const album = itemV2?.albumOfTrack;
    const albumArtists = album?.artists?.items
      ?.map((artist: any) => artist?.profile?.name ?? "")
      .filter(Boolean);
    const releaseDate = itemV3?.identityTrait?.contentHierarchyParent?.publishingMetadataTrait?.firstPublishedAt?.isoString;
    const artUrl =
      getBestImageUrl(album?.coverArt?.sources) ??
      getBestImageUrl(itemV3?.visualIdentityTrait?.squareCoverImage?.image?.data?.sources);

    return {
      title,
      artist: artists.join(", "),
      album: album?.name ?? itemV3?.identityTrait?.contentHierarchyParent?.identityTrait?.name,
      album_artist: albumArtists?.join(", "),
      track_number: itemV2?.trackNumber,
      disc_number: itemV2?.discNumber,
      duration_ms:
        itemV2?.trackDuration?.totalMilliseconds ??
        (itemV3?.consumptionExperienceTrait?.duration?.seconds
          ? itemV3.consumptionExperienceTrait.duration.seconds * 1000
          : undefined),
      art_url: artUrl,
      year: releaseDate?.slice(0, 4),
      date: releaseDate?.slice(0, 10),
      spotify_url: `https://open.spotify.com/track/${uri.split(":").pop()}`,
      explicit: itemV2?.contentRating?.label === "EXPLICIT",
    };
  }

  function getPlaylistName(response: any, uri: string): string {
    return (
      response?.data?.playlistV2?.name ??
      response?.data?.playlistV2?.identityTrait?.name ??
      response?.data?.playlistV2?.metadata?.name ??
      `Playlist ${uri.split(":").pop()}`
    );
  }

  async function getPlaylistTracks(uri: string): Promise<{ name: string; tracks: DownloadMetadata[]; skipped: number }> {
    const fetchPlaylistContents = Spicetify.GraphQL.Definitions.fetchPlaylistContents;
    if (!fetchPlaylistContents) {
      throw new Error("Playlist GraphQL definition is unavailable");
    }

    let offset = 0;
    let totalCount: number | undefined;
    let playlistName = `Playlist ${uri.split(":").pop()}`;
    let skipped = 0;
    const tracks: DownloadMetadata[] = [];

    while (totalCount === undefined || offset < totalCount) {
      const response = await Spicetify.GraphQL.Request(fetchPlaylistContents, {
        uri,
        locale: Spicetify.Locale?.getLocale?.() ?? "",
        offset,
        limit: PLAYLIST_PAGE_SIZE,
      });

      if (response?.errors) {
        throw new Error("No playlist info returned");
      }

      const content = response?.data?.playlistV2?.content;
      const items = content?.items ?? [];
      totalCount = content?.totalCount ?? offset + items.length;
      if (offset === 0) playlistName = getPlaylistName(response, uri);

      for (const item of items) {
        const metadata = getPlaylistTrackMetadata(item);
        if (metadata) {
          tracks.push(metadata);
        } else {
          skipped += 1;
        }
      }

      if (items.length === 0) break;
      offset += items.length;
    }

    return { name: playlistName, tracks, skipped };
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

  async function pollPlaylistJob(jobId: string) {
    let lastCompleted = -1;

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));

      const response = await fetch(`${COMPANION_SERVICE_URL}/download/status?job_id=${encodeURIComponent(jobId)}`);
      const result = await response.json();
      const job = result?.job;

      if (!response.ok || !job) {
        Spicetify.showNotification("Could not fetch playlist download status.", true, 5000);
        return;
      }

      if (job.status === "completed" || job.status === "completed_with_errors") {
        const failed = job.failed ? `, ${job.failed} failed` : "";
        Spicetify.showNotification(`Playlist download finished: ${job.completed}/${job.total}${failed}.`, !!job.failed, 8000);
        return;
      }

      if (job.completed !== lastCompleted) {
        lastCompleted = job.completed;
        const current = job.current?.title ? ` Now: ${job.current.title}` : "";
        Spicetify.showNotification(`Playlist download: ${job.completed}/${job.total}.${current}`, false, 3000);
      }
    }
  }

  async function downloadPlaylist(uris: string[]) {
    const playlistUri = uris[0];
    const isServiceRunning = await checkServiceHealth();

    if (!isServiceRunning) {
      Spicetify.showNotification("Companion service is required for playlist downloads.", true, 5000);
      return;
    }

    try {
      Spicetify.showNotification("Fetching playlist tracks...", false, 3000);
      const playlist = await getPlaylistTracks(playlistUri);

      if (playlist.tracks.length === 0) {
        Spicetify.showNotification("No downloadable tracks found in this playlist.", true, 5000);
        return;
      }

      const skipped = playlist.skipped ? ` (${playlist.skipped} skipped)` : "";
      Spicetify.showNotification(`Queueing ${playlist.tracks.length} playlist tracks${skipped}...`, false, 4000);

      const response = await fetch(`${COMPANION_SERVICE_URL}/download/playlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlist: { uri: playlistUri, name: playlist.name },
          tracks: playlist.tracks,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        Spicetify.showNotification(`Playlist download failed: ${result.message ?? "Unknown error"}`, true, 5000);
        return;
      }

      Spicetify.showNotification(`Playlist download queued: ${result.total} tracks.`, false, 5000);
      pollPlaylistJob(result.job_id).catch((error) => {
        const msg = error instanceof Error ? error.message : "Unknown error";
        Spicetify.showNotification(`Playlist status error: ${msg}`, true, 5000);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      Spicetify.showNotification(`Playlist download error: ${msg}`, true, 5000);
    }
  }

  function shouldDisplayContextMenu(uris: string[]) {
    return Spicetify.URI.isTrack(uris[0]);
  }

  function shouldDisplayPlaylistContextMenu(uris: string[]) {
    if (uris.length !== 1) return false;
    const uri = Spicetify.URI.fromString(uris[0]);
    return uri.type === Spicetify.URI.Type.PLAYLIST || uri.type === Spicetify.URI.Type.PLAYLIST_V2;
  }

  const songContextMenu = new Spicetify.ContextMenu.Item(
    "Download song",
    downloadSong,
    shouldDisplayContextMenu,
    "download"
  );

  const playlistContextMenu = new Spicetify.ContextMenu.Item(
    "Download playlist",
    downloadPlaylist,
    shouldDisplayPlaylistContextMenu,
    "download"
  );

  songContextMenu.register();
  playlistContextMenu.register();
}

export default main;
