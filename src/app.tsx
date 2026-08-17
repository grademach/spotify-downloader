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

  type CollectionKind = "playlist" | "album";

  type CollectionDownload = {
    kind: CollectionKind;
    uri: string;
    name: string;
    tracks: DownloadMetadata[];
    skipped: number;
  };

  function firstNonEmpty(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  function getSpotifyTrackUrl(uri: string): string {
    return `https://open.spotify.com/track/${uri.split(":").pop()}`;
  }

  function parseSpotifyUri(uri: string | undefined): Spicetify.URI | null {
    if (!uri) return null;
    try {
      return Spicetify.URI.fromString(uri);
    } catch {
      return null;
    }
  }

  function resolveContextUri(uris: string[], contextUri: string | undefined, allowedTypes: string[]): string | null {
    for (const candidate of [uris[0], contextUri]) {
      const uri = parseSpotifyUri(candidate);
      if (uri && allowedTypes.includes(uri.type)) {
        return uri.toURI();
      }
    }
    return null;
  }

  function mapArtistNames(items: any[] | undefined): string[] {
    if (!Array.isArray(items)) return [];
    return items
      .map((artist: any) => firstNonEmpty(artist?.profile?.name, artist?.name, artist?.title))
      .filter(Boolean);
  }

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
      const title = firstNonEmpty(item.name, meta.title, meta.name);
      if (!title) throw new Error("Could not fetch track title");

      return {
        title,
        artist: mapArtistNames(item.artists).join(", ") || firstNonEmpty(meta.artist_name, meta["artist_name:1"]),
        album: item.album?.name ?? meta.album_title ?? "",
        album_artist: meta.album_artist_name ?? "",
        track_number: asNumber(meta.album_track_number),
        total_tracks: asNumber(meta.album_track_count),
        disc_number: asNumber(meta.album_disc_number),
        duration_ms: item.duration?.milliseconds,
        art_url: meta.image_xlarge_url ?? meta.image_large_url ?? meta.image_url,
        year: meta.album_release_year,
        date: meta.album_release_year,
        spotify_url: getSpotifyTrackUrl(uri),
        explicit: item.isExplicit,
      };
    }

    // For non-playing tracks, use Spicetify's internal GraphQL
    if (!Spicetify.GraphQL.Definitions.getTrackName || !Spicetify.GraphQL.Definitions.queryTrackArtists) {
      throw new Error("Track GraphQL definitions are unavailable");
    }

    let nameRes: any, artistsRes: any;
    try {
      [nameRes, artistsRes] = await Promise.all([
        Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getTrackName, { trackUri: uri, uri }),
        Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.queryTrackArtists, { trackUri: uri, uri, locale: "", includePrerelease: false }),
      ]);
    } catch (e: any) {
      throw new Error(`Failed to fetch track metadata: ${e?.message ?? JSON.stringify(e)}`);
    }

    const trackUnion = artistsRes?.data?.trackUnion ?? nameRes?.data?.trackUnion;
    const title = firstNonEmpty(nameRes?.data?.trackUnion?.name, trackUnion?.name, trackUnion?.title);
    if (!title) throw new Error("Could not fetch track title");

    const firstArtist = trackUnion?.firstArtist?.items ?? trackUnion?.artists?.items ?? [];
    const artist = mapArtistNames(firstArtist).join(", ");

    return {
      title,
      artist,
      spotify_url: getSpotifyTrackUrl(uri),
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

    if (!uri || !Spicetify.URI.isTrack(uri)) {
      return null;
    }

    const title = itemV2?.name ?? itemV3?.identityTrait?.name ?? "";
    if (!title) return null;

    const artistItems = itemV2?.artists?.items ?? itemV3?.identityTrait?.contributors?.items ?? [];
    const artists = mapArtistNames(artistItems);
    const album = itemV2?.albumOfTrack;
    const albumArtists = mapArtistNames(album?.artists?.items);
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
      spotify_url: getSpotifyTrackUrl(uri),
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

  async function getPlaylistTracksFromPlatform(uri: string): Promise<CollectionDownload> {
    const playlistApi = Spicetify.Platform?.PlaylistAPI;
    if (typeof playlistApi?.getPlaylist !== "function") {
      throw new Error("Playlist APIs are unavailable");
    }

    const playlist = await playlistApi.getPlaylist(uri);
    const items = playlist?.contents?.items ?? [];
    const playlistName = firstNonEmpty(
      playlist?.name,
      playlist?.metadata?.name,
      playlist?.identity?.name,
      `Playlist ${uri.split(":").pop()}`
    );
    const trackUris: string[] = items
      .map((item: any) => item?.uri ?? item?.item?.uri ?? item?.track?.uri)
      .filter((itemUri: unknown): itemUri is string =>
        typeof itemUri === "string" && Spicetify.URI.isTrack(itemUri)
      );

    const tracks: DownloadMetadata[] = [];
    let skipped = items.length - trackUris.length;
    const concurrency = 10;

    for (let start = 0; start < trackUris.length; start += concurrency) {
      const results = await Promise.all(
        trackUris.slice(start, start + concurrency).map(async (trackUri) => {
          try {
            return await getTrackMetadata(trackUri);
          } catch {
            return null;
          }
        })
      );
      for (const result of results) {
        if (result) {
          tracks.push(result);
        } else {
          skipped += 1;
        }
      }
    }

    return { kind: "playlist", uri, name: playlistName, tracks, skipped };
  }

  async function getPlaylistTracks(uri: string): Promise<CollectionDownload> {
    const fetchPlaylistContents = Spicetify.GraphQL.Definitions.fetchPlaylistContents;
    if (!fetchPlaylistContents) {
      return getPlaylistTracksFromPlatform(uri);
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

    return { kind: "playlist", uri, name: playlistName, tracks, skipped };
  }

  function getAlbumRoot(response: any): any {
    return (
      response?.data?.albumUnion ??
      response?.data?.album ??
      response?.data?.getAlbum ??
      response?.data?.albumMetadata ??
      response?.data?.entityUnion ??
      response?.data
    );
  }

  function getAlbumName(response: any, uri: string): string {
    const album = getAlbumRoot(response);
    return firstNonEmpty(
      album?.name,
      album?.title,
      album?.metadata?.name,
      album?.identityTrait?.name,
      `Album ${uri.split(":").pop()}`
    );
  }

  function getAlbumArtists(album: any): string[] {
    const candidates = [
      mapArtistNames(album?.artists?.items),
      mapArtistNames(album?.artists),
      mapArtistNames(album?.metadata?.artists?.items),
    ];
    return candidates.find((artists) => artists.length > 0) ?? [];
  }

  function getAlbumReleaseDate(album: any): string {
    return firstNonEmpty(
      album?.date?.isoString,
      album?.releaseDate?.isoString,
      album?.releaseDate,
      album?.metadata?.releaseDate?.isoString,
      album?.metadata?.releaseDate
    );
  }

  function getAlbumArtUrl(album: any): string | undefined {
    return (
      getBestImageUrl(album?.coverArt?.sources) ??
      getBestImageUrl(album?.visualIdentityTrait?.squareCoverImage?.image?.data?.sources) ??
      getBestImageUrl(album?.metadata?.coverArt?.sources)
    );
  }

  function getAlbumTrackContainers(album: any): any[] {
    return [
      album?.tracksV2,
      album?.tracks,
      album?.trackList,
      album?.items,
      album?.data?.tracksV2,
      album?.data?.tracks,
    ].filter(Boolean);
  }

  function extractAlbumTrackItems(response: any): any[] {
    const album = getAlbumRoot(response);
    const directItems: any[] = [];
    for (const container of getAlbumTrackContainers(album)) {
      const items = container?.items ?? container;
      if (Array.isArray(items)) {
        directItems.push(...items);
      } else if (items) {
        directItems.push(items);
      }
    }

    const discItems: any[] = [];
    const discs = album?.discs?.items ?? album?.discs ?? [];
    if (Array.isArray(discs)) {
      for (const disc of discs) {
        const tracks = disc?.tracks?.items ?? disc?.tracks ?? [];
        if (Array.isArray(tracks)) discItems.push(...tracks);
      }
    }

    const uriItems = response?.data?.albumUnion?.trackUris ?? response?.data?.trackUris ?? [];
    const items = [...directItems, ...discItems, ...uriItems];
    return items.filter(Boolean);
  }

  function getAlbumTotalCount(response: any, itemCount: number): number | undefined {
    const album = getAlbumRoot(response);
    for (const container of getAlbumTrackContainers(album)) {
      const total = asNumber(
        container?.totalCount ??
          container?.total ??
          container?.pagingInfo?.totalItems ??
          container?.pagingInfo?.totalCount
      );
      if (total !== undefined) return total;
    }
    return asNumber(album?.tracks?.totalCount ?? album?.tracksV2?.totalCount) ?? (itemCount ? itemCount : undefined);
  }

  function getTrackUriFromAlbumItem(item: any): string {
    if (typeof item === "string" && Spicetify.URI.isTrack(item)) return item;
    return firstNonEmpty(
      item?.uri,
      item?.trackUri,
      item?.track?.uri,
      item?.track?.data?.uri,
      item?.trackV2?.data?.uri,
      item?.itemV2?.data?.uri,
      item?.itemV3?.data?.uri,
      item?.data?.uri
    );
  }

  function getAlbumTrackMetadata(item: any, album: any, totalTracks?: number): DownloadMetadata | null {
    const track = item?.track?.data ?? item?.track ?? item?.trackV2?.data ?? item?.itemV2?.data ?? item?.itemV3?.data ?? item?.data ?? item;
    const uri = getTrackUriFromAlbumItem(item);

    if (!uri || !Spicetify.URI.isTrack(uri)) {
      return null;
    }

    const title = firstNonEmpty(track?.name, track?.title, track?.identityTrait?.name);
    if (!title) return null;

    const artists = mapArtistNames(
      track?.artists?.items ??
        track?.artists ??
        track?.identityTrait?.contributors?.items ??
        track?.contributors?.items
    );
    const albumArtists = getAlbumArtists(album);
    const releaseDate = getAlbumReleaseDate(album);

    return {
      title,
      artist: artists.join(", "),
      album: firstNonEmpty(album?.name, album?.title, album?.identityTrait?.name),
      album_artist: albumArtists.join(", "),
      track_number: asNumber(track?.trackNumber ?? item?.trackNumber),
      total_tracks: totalTracks,
      disc_number: asNumber(track?.discNumber ?? item?.discNumber),
      duration_ms: asNumber(track?.trackDuration?.totalMilliseconds ?? track?.duration?.totalMilliseconds ?? track?.duration?.milliseconds),
      art_url: getAlbumArtUrl(album),
      year: releaseDate.slice(0, 4) || undefined,
      date: releaseDate.slice(0, 10) || undefined,
      spotify_url: getSpotifyTrackUrl(uri),
      explicit: track?.contentRating?.label === "EXPLICIT" || track?.isExplicit === true,
    };
  }

  async function requestAlbumPage(uri: string, offset: number): Promise<any> {
    const definitions = [
      Spicetify.GraphQL.Definitions.queryAlbumTracks,
      Spicetify.GraphQL.Definitions.getAlbumNameAndTracks,
      Spicetify.GraphQL.Definitions.getAlbum,
      Spicetify.GraphQL.Definitions.queryAlbumTrackUris,
    ].filter(Boolean);

    if (definitions.length === 0) {
      throw new Error("Album GraphQL definitions are unavailable");
    }

    let lastError: unknown;
    for (const definition of definitions) {
      try {
        const response = await Spicetify.GraphQL.Request(definition, {
          uri,
          albumUri: uri,
          offset,
          limit: PLAYLIST_PAGE_SIZE,
          locale: Spicetify.Locale?.getLocale?.() ?? "",
        });

        if (!response?.errors && extractAlbumTrackItems(response).length > 0) {
          return response;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error("No album tracks returned");
  }

  async function getAlbumTracks(uri: string): Promise<CollectionDownload> {
    let offset = 0;
    let totalCount: number | undefined;
    let albumName = `Album ${uri.split(":").pop()}`;
    let skipped = 0;
    const tracks: DownloadMetadata[] = [];
    const seenUris = new Set<string>();

    while (totalCount === undefined || offset < totalCount) {
      const response = await requestAlbumPage(uri, offset);
      const album = getAlbumRoot(response);
      const items = extractAlbumTrackItems(response);
      if (offset === 0) albumName = getAlbumName(response, uri);
      totalCount = getAlbumTotalCount(response, items.length);

      for (const item of items) {
        const trackUri = getTrackUriFromAlbumItem(item);
        if (trackUri && seenUris.has(trackUri)) continue;
        if (trackUri) seenUris.add(trackUri);

        let metadata = getAlbumTrackMetadata(item, album, totalCount);
        if (!metadata && trackUri) {
          try {
            metadata = await getTrackMetadata(trackUri);
            metadata.album = metadata.album || albumName;
            metadata.total_tracks = metadata.total_tracks ?? totalCount;
          } catch {
            metadata = null;
          }
        }

        if (metadata) {
          metadata.album = metadata.album || albumName;
          metadata.total_tracks = metadata.total_tracks ?? totalCount;
          tracks.push(metadata);
        } else {
          skipped += 1;
        }
      }

      if (items.length === 0 || totalCount === undefined || offset + items.length >= totalCount) break;
      offset += items.length;
    }

    return { kind: "album", uri, name: albumName, tracks, skipped };
  }

  async function downloadSong(uris: string[], _uids?: string[], contextUri?: string) {
    const trackUri = resolveContextUri(uris, contextUri, [Spicetify.URI.Type.TRACK]);
    if (!trackUri) {
      Spicetify.showNotification("Spotify Downloader could not find a track to download.", true, 5000);
      return;
    }

    const isServiceRunning = await checkServiceHealth();

    if (!isServiceRunning) {
      const uriObject = Spicetify.URI.fromString(trackUri);
      const trackUrl = uriObject.toURL();
      await Spicetify.Platform.ClipboardAPI.copy(`yt-dlp "ytsearch1:${trackUrl}" -x --audio-format mp3`);
      Spicetify.showNotification("Companion service not running. Command copied to clipboard.", true, 3000);
      return;
    }

    try {
      Spicetify.showNotification("Fetching track info...", false, 2000);

      const metadata = await getTrackMetadata(trackUri);

      const label = metadata.artist ? `${metadata.artist} - ${metadata.title}` : metadata.title;
      Spicetify.showNotification(`Downloading: ${label}...`, false, 3000);

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

  function formatFailedTracks(job: any): string {
    if (!Array.isArray(job?.failures) || job.failures.length === 0) return "";

    const names = job.failures
      .map((failure: any) => firstNonEmpty(failure?.title, failure?.message))
      .filter(Boolean)
      .slice(0, 3);

    if (names.length === 0) return "";

    const remaining = Math.max(0, (job.failed ?? names.length) - names.length);
    return ` Failed: ${names.join(", ")}${remaining ? `, +${remaining} more` : ""}.`;
  }

  async function pollCollectionJob(jobId: string, kind: CollectionKind) {
    let lastCompleted = -1;
    const label = kind === "album" ? "Album" : "Playlist";

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));

      const response = await fetch(`${COMPANION_SERVICE_URL}/download/status?job_id=${encodeURIComponent(jobId)}`);
      const result = await response.json();
      const job = result?.job;

      if (!response.ok || !job) {
        Spicetify.showNotification(`Could not fetch ${kind} download status.`, true, 5000);
        return;
      }

      if (job.status === "completed" || job.status === "completed_with_errors") {
        const failed = job.failed ? `, ${job.failed} failed` : "";
        Spicetify.showNotification(
          `${label} download finished: ${job.completed}/${job.total}${failed}.${formatFailedTracks(job)}`,
          !!job.failed,
          10000
        );
        return;
      }

      if (job.completed !== lastCompleted) {
        lastCompleted = job.completed;
        const current = job.current?.title ? ` Now: ${job.current.title}` : "";
        Spicetify.showNotification(`${label} download: ${job.completed}/${job.total}.${current}`, false, 3000);
      }
    }
  }

  async function downloadCollection(collection: CollectionDownload) {
    try {
      if (collection.tracks.length === 0) {
        Spicetify.showNotification(`No downloadable tracks found in this ${collection.kind}.`, true, 5000);
        return;
      }

      const skipped = collection.skipped ? ` (${collection.skipped} skipped)` : "";
      Spicetify.showNotification(`Queueing ${collection.tracks.length} ${collection.kind} tracks${skipped}...`, false, 4000);

      const response = await fetch(`${COMPANION_SERVICE_URL}/download/playlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlist: { uri: collection.uri, name: collection.name },
          tracks: collection.tracks,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        Spicetify.showNotification(`${collection.kind} download failed: ${result.message ?? "Unknown error"}`, true, 5000);
        return;
      }

      Spicetify.showNotification(`${collection.kind} download queued: ${result.total} tracks.`, false, 5000);
      pollCollectionJob(result.job_id, collection.kind).catch((error) => {
        const msg = error instanceof Error ? error.message : "Unknown error";
        Spicetify.showNotification(`${collection.kind} status error: ${msg}`, true, 5000);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      Spicetify.showNotification(`${collection.kind} download error: ${msg}`, true, 5000);
    }
  }

  async function downloadPlaylist(uris: string[], _uids?: string[], contextUri?: string) {
    const playlistUri = resolveContextUri(uris, contextUri, [
      Spicetify.URI.Type.PLAYLIST,
      Spicetify.URI.Type.PLAYLIST_V2,
    ]);
    if (!playlistUri) {
      Spicetify.showNotification("Spotify Downloader could not find a playlist to download.", true, 5000);
      return;
    }

    const isServiceRunning = await checkServiceHealth();
    if (!isServiceRunning) {
      Spicetify.showNotification("Companion service is required for playlist downloads.", true, 5000);
      return;
    }

    try {
      Spicetify.showNotification("Fetching playlist tracks...", false, 3000);
      await downloadCollection(await getPlaylistTracks(playlistUri));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      Spicetify.showNotification(`Playlist download error: ${msg}`, true, 5000);
    }
  }

  async function downloadAlbum(uris: string[], _uids?: string[], contextUri?: string) {
    const albumUri = resolveContextUri(uris, contextUri, [Spicetify.URI.Type.ALBUM]);
    if (!albumUri) {
      Spicetify.showNotification("Spotify Downloader could not find an album to download.", true, 5000);
      return;
    }

    const isServiceRunning = await checkServiceHealth();
    if (!isServiceRunning) {
      Spicetify.showNotification("Companion service is required for album downloads.", true, 5000);
      return;
    }

    try {
      Spicetify.showNotification("Fetching album tracks...", false, 3000);
      await downloadCollection(await getAlbumTracks(albumUri));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      Spicetify.showNotification(`Album download error: ${msg}`, true, 5000);
    }
  }

  function shouldDisplayContextMenu(uris: string[], _uids?: string[], contextUri?: string) {
    return !!resolveContextUri(uris, contextUri, [Spicetify.URI.Type.TRACK]);
  }

  function shouldDisplayPlaylistContextMenu(uris: string[], _uids?: string[], contextUri?: string) {
    return !!resolveContextUri(uris, contextUri, [
      Spicetify.URI.Type.PLAYLIST,
      Spicetify.URI.Type.PLAYLIST_V2,
    ]);
  }

  function shouldDisplayAlbumContextMenu(uris: string[], _uids?: string[], contextUri?: string) {
    return !!resolveContextUri(uris, contextUri, [Spicetify.URI.Type.ALBUM]);
  }

  const songContextMenu = new Spicetify.ContextMenu.Item(
    "Download song (SD)",
    downloadSong,
    shouldDisplayContextMenu,
    "download"
  );

  const playlistContextMenu = new Spicetify.ContextMenu.Item(
    "Download playlist (SD)",
    downloadPlaylist,
    shouldDisplayPlaylistContextMenu,
    "download"
  );

  const albumContextMenu = new Spicetify.ContextMenu.Item(
    "Download album (SD)",
    downloadAlbum,
    shouldDisplayAlbumContextMenu,
    "download"
  );

  songContextMenu.register();
  playlistContextMenu.register();
  albumContextMenu.register();
}

export default main;
