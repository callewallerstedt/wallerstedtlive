type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export type SpotifyTrackItem = {
  spotifyId: string;
  name: string;
  artistName?: string;
  albumName?: string;
  albumLabel?: string;
  publisher?: string;
  popularity?: number;
  durationMs: number;
  previewUrl?: string;
  externalUrl?: string;
  uri?: string;
  isrc?: string;
  releaseDate?: string;
  autoOwnedByYou: boolean;
  autoOwnershipShare: number;
};

type SyncSpotifyOptions = {
  artistName?: string;
  artistId?: string;
  market?: string;
};

type AlbumDetail = {
  id: string;
  name?: string;
  release_date?: string;
  label?: string;
  external_urls?: { spotify?: string };
  copyrights?: Array<{ text?: string }>;
};

const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS_API = "https://accounts.spotify.com/api/token";

function parseSpotifyCredentials() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET environment variables.");
  }
  return { clientId, clientSecret };
}

function inferOwnership(label?: string, publisher?: string): { isOwnedByYou: boolean; share: number } {
  const haystack = `${label ?? ""} ${publisher ?? ""}`.toLowerCase();
  const isMine =
    haystack.includes("wallerstedt productions") ||
    haystack.includes("wallerstedt production") ||
    haystack.includes("wallerstedt");
  return { isOwnedByYou: isMine, share: isMine ? 1 : 0.5 };
}

async function getSpotifyAccessToken(): Promise<string> {
  const { clientId, clientSecret } = parseSpotifyCredentials();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(SPOTIFY_ACCOUNTS_API, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Spotify token request failed with ${response.status}`);
  }

  const payload = (await response.json()) as SpotifyTokenResponse;
  return payload.access_token;
}

async function spotifyFetch<T>(accessToken: string, endpoint: string): Promise<T> {
  const response = await fetch(`${SPOTIFY_API}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Spotify API ${endpoint} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function resolveArtistId(
  accessToken: string,
  artistName: string | undefined,
  artistId: string | undefined,
  market: string
): Promise<{ artistId: string; artistName: string }> {
  if (artistId) {
    const artist = await spotifyFetch<{ id: string; name: string }>(accessToken, `/artists/${artistId}`);
    return { artistId: artist.id, artistName: artist.name };
  }

  if (!artistName) {
    throw new Error("Provide spotifyArtistId or spotifyArtistName in settings.");
  }

  const q = encodeURIComponent(artistName);
  const search = await spotifyFetch<{
    artists?: { items?: Array<{ id: string; name: string }> };
  }>(accessToken, `/search?q=${q}&type=artist&limit=1&market=${market}`);

  const match = search.artists?.items?.[0];
  if (!match) {
    throw new Error(`No Spotify artist found for "${artistName}"`);
  }

  return { artistId: match.id, artistName: match.name };
}

async function fetchAllArtistAlbums(
  accessToken: string,
  artistId: string,
  market: string
): Promise<Array<{ id: string; name: string }>> {
  const items: Array<{ id: string; name: string }> = [];
  let offset = 0;
  const limit = 50;

  while (offset < 250) {
    const page = await spotifyFetch<{
      items: Array<{ id: string; name: string }>;
      total: number;
    }>(
      accessToken,
      `/artists/${artistId}/albums?include_groups=album,single&limit=${limit}&offset=${offset}&market=${market}`
    );
    items.push(...page.items);
    offset += limit;
    if (items.length >= page.total || page.items.length === 0) {
      break;
    }
  }

  const deduped = new Map<string, { id: string; name: string }>();
  for (const album of items) {
    deduped.set(album.id, album);
  }
  return Array.from(deduped.values());
}

async function fetchAlbumDetailsMap(
  accessToken: string,
  albumIds: string[]
): Promise<Map<string, AlbumDetail>> {
  const map = new Map<string, AlbumDetail>();
  const uniqueIds = Array.from(new Set(albumIds.filter(Boolean)));

  for (let i = 0; i < uniqueIds.length; i += 20) {
    const chunk = uniqueIds.slice(i, i + 20);
    const ids = chunk.join(",");
    const data = await spotifyFetch<{ albums: AlbumDetail[] }>(accessToken, `/albums?ids=${ids}`);
    for (const album of data.albums) {
      if (album?.id) {
        map.set(album.id, album);
      }
    }
  }

  return map;
}

function normalizeTrack(raw: {
  id: string;
  name: string;
  popularity?: number;
  duration_ms: number;
  preview_url?: string | null;
  external_urls?: { spotify?: string };
  uri?: string;
  external_ids?: { isrc?: string };
  album?: { id?: string; name?: string; release_date?: string };
  artists?: Array<{ name: string }>;
}, albumMap: Map<string, AlbumDetail>): SpotifyTrackItem {
  const albumId = raw.album?.id;
  const albumMeta = albumId ? albumMap.get(albumId) : undefined;
  const albumLabel = albumMeta?.label;
  const publisher = albumMeta?.copyrights?.map((entry) => entry.text).filter(Boolean).join(" | ") || undefined;
  const ownership = inferOwnership(albumLabel, publisher);

  return {
    spotifyId: raw.id,
    name: raw.name,
    artistName: raw.artists?.map((artist) => artist.name).join(", "),
    albumName: raw.album?.name ?? albumMeta?.name,
    albumLabel,
    publisher,
    popularity: raw.popularity,
    durationMs: raw.duration_ms,
    previewUrl: raw.preview_url ?? undefined,
    externalUrl: raw.external_urls?.spotify ?? albumMeta?.external_urls?.spotify,
    uri: raw.uri,
    isrc: raw.external_ids?.isrc,
    releaseDate: raw.album?.release_date ?? albumMeta?.release_date,
    autoOwnedByYou: ownership.isOwnedByYou,
    autoOwnershipShare: ownership.share,
  };
}

export function inferOwnershipFromMetadata(label?: string, publisher?: string): {
  isOwnedByYou: boolean;
  share: number;
} {
  return inferOwnership(label, publisher);
}

export async function syncSpotifyCatalog(options: SyncSpotifyOptions): Promise<{
  artistId: string;
  artistName: string;
  tracks: SpotifyTrackItem[];
  warnings: string[];
}> {
  const market = options.market ?? "US";
  const accessToken = await getSpotifyAccessToken();

  const artist = await resolveArtistId(accessToken, options.artistName, options.artistId, market);

  const topTracks = await spotifyFetch<{
    tracks: Array<{
      id: string;
      name: string;
      popularity: number;
      duration_ms: number;
      preview_url?: string | null;
      external_urls?: { spotify?: string };
      uri?: string;
      external_ids?: { isrc?: string };
      album?: { id?: string; name?: string; release_date?: string };
      artists?: Array<{ name: string }>;
    }>;
  }>(accessToken, `/artists/${artist.artistId}/top-tracks?market=${market}`);

  const albums = await fetchAllArtistAlbums(accessToken, artist.artistId, market);

  const warnings: string[] = [];
  if (albums.length > 120) {
    warnings.push(`Large catalog detected (${albums.length} albums/singles). Sync may take longer.`);
  }

  const albumTracks = new Map<
    string,
    {
      id: string;
      name: string;
      duration_ms: number;
      preview_url?: string | null;
      external_urls?: { spotify?: string };
      uri?: string;
      artists?: Array<{ name: string }>;
      album?: { id?: string; name?: string; release_date?: string };
    }
  >();

  const albumIds: string[] = [];
  for (const topTrack of topTracks.tracks) {
    if (topTrack.album?.id) {
      albumIds.push(topTrack.album.id);
    }
  }

  for (const album of albums) {
    albumIds.push(album.id);
  }

  const albumMap = await fetchAlbumDetailsMap(accessToken, albumIds);

  for (const track of topTracks.tracks) {
    albumTracks.set(track.id, track);
  }

  for (const album of albums) {
    const albumTracksPage = await spotifyFetch<{
      items: Array<{
        id: string;
        name: string;
        duration_ms: number;
        preview_url?: string | null;
        external_urls?: { spotify?: string };
        uri?: string;
        artists?: Array<{ name: string }>;
      }>;
    }>(accessToken, `/albums/${album.id}/tracks?limit=50&market=${market}`);

    for (const track of albumTracksPage.items) {
      if (!albumTracks.has(track.id)) {
        albumTracks.set(track.id, {
          ...track,
          album: {
            id: album.id,
            name: album.name,
            release_date: albumMap.get(album.id)?.release_date,
          },
        });
      }
    }
  }

  const tracks = Array.from(albumTracks.values())
    .map((track) => normalizeTrack(track, albumMap))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

  return {
    artistId: artist.artistId,
    artistName: artist.artistName,
    tracks,
    warnings,
  };
}
