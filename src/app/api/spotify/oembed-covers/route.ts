import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const COVER_CACHE_TTL_MS = 60 * 60 * 1000;
const coverCacheBySpotifyId = new Map<string, { coverUrl: string; expiresAt: number }>();
const inFlightBySpotifyId = new Map<string, Promise<string | null>>();

const payloadSchema = z.object({
  tracks: z.array(z.object({
    spotifyId: z.string().trim().min(1),
    url: z.string().trim().url(),
  })).min(1).max(60),
});

function getCachedCover(spotifyId: string): string | null {
  const cached = coverCacheBySpotifyId.get(spotifyId);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    coverCacheBySpotifyId.delete(spotifyId);
    return null;
  }
  return cached.coverUrl;
}

function setCachedCover(spotifyId: string, coverUrl: string): void {
  coverCacheBySpotifyId.set(spotifyId, {
    coverUrl,
    expiresAt: Date.now() + COVER_CACHE_TTL_MS,
  });
}

async function fetchCoverFromSpotify(url: string): Promise<string | null> {
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { thumbnail_url?: unknown };
    if (typeof data.thumbnail_url === "string" && data.thumbnail_url.trim()) {
      return data.thumbnail_url;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveCover(spotifyId: string, url: string): Promise<string | null> {
  const cached = getCachedCover(spotifyId);
  if (cached) {
    return cached;
  }

  const existingInFlight = inFlightBySpotifyId.get(spotifyId);
  if (existingInFlight) {
    return existingInFlight;
  }

  const request = fetchCoverFromSpotify(url).then((coverUrl) => {
    if (coverUrl) {
      setCachedCover(spotifyId, coverUrl);
    }
    return coverUrl;
  }).finally(() => {
    inFlightBySpotifyId.delete(spotifyId);
  });

  inFlightBySpotifyId.set(spotifyId, request);
  return request;
}

export async function POST(request: Request) {
  try {
    const payload = payloadSchema.parse(await request.json());
    const covers: Record<string, string> = {};

    await Promise.all(
      payload.tracks.map(async (track) => {
        const cover = await resolveCover(track.spotifyId, track.url);
        if (cover) {
          covers[track.spotifyId] = cover;
        }
      })
    );

    return NextResponse.json({ covers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cover lookup failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
