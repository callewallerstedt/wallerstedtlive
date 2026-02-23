import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
void prisma;

type SearchPayload = {
  query?: string;
  limit?: number;
};

type YouTubeSearchResult = {
  videoId: string;
  title: string;
  channelTitle: string;
  viewCountText: string | null;
  thumbnailUrl: string | null;
  url: string;
  embedUrl: string;
  query: string;
};

function extractText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  if ("simpleText" in value && typeof (value as { simpleText?: unknown }).simpleText === "string") {
    return (value as { simpleText: string }).simpleText;
  }
  if ("runs" in value && Array.isArray((value as { runs?: unknown[] }).runs)) {
    return (value as { runs: Array<{ text?: unknown }> }).runs
      .map((run) => (typeof run.text === "string" ? run.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function findVideoRenderers(node: unknown, limit: number): Record<string, unknown>[] {
  const stack: unknown[] = [node];
  let visited = 0;
  const found: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    visited += 1;
    if (visited > 120_000) {
      break;
    }

    if (
      "videoRenderer" in current &&
      current.videoRenderer &&
      typeof current.videoRenderer === "object" &&
      !Array.isArray(current.videoRenderer)
    ) {
      const renderer = current.videoRenderer as Record<string, unknown>;
      const videoId = typeof renderer.videoId === "string" ? renderer.videoId : "";
      if (videoId && !seenIds.has(videoId)) {
        seenIds.add(videoId);
        found.push(renderer);
        if (found.length >= limit) {
          break;
        }
      }
    }

    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return found;
}

function isKidLikeResult(title: string, channelTitle: string): boolean {
  const text = `${title} ${channelTitle}`.toLowerCase();
  const blocked = ["kids", "nursery", "lullaby", "cocomelon", "baby shark", "super simple songs", "little angel", "pinkfong"];
  return blocked.some((token) => text.includes(token));
}

function isTopicChannel(channelTitle: string): boolean {
  return /\s-\sTopic$/i.test(channelTitle.trim());
}

function toResult(renderer: Record<string, unknown>, query: string): YouTubeSearchResult | null {
  const videoId = typeof renderer.videoId === "string" ? renderer.videoId : "";
  if (!videoId) {
    return null;
  }

  const title = extractText(renderer.title) || "Untitled";
  const channelTitle = extractText(renderer.ownerText) || "Unknown channel";
  const viewCountText = extractText(renderer.viewCountText) || null;
  const thumbnails =
    renderer.thumbnail && typeof renderer.thumbnail === "object" && "thumbnails" in renderer.thumbnail
      ? (renderer.thumbnail as { thumbnails?: Array<{ url?: unknown }> }).thumbnails
      : [];
  const thumbnailUrl =
    Array.isArray(thumbnails) && thumbnails.length > 0
      ? (thumbnails[thumbnails.length - 1]?.url as string | undefined) ?? null
      : null;

  if (isKidLikeResult(title, channelTitle)) {
    return null;
  }

  return {
    videoId,
    title,
    channelTitle,
    viewCountText,
    thumbnailUrl,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0`,
    query,
  };
}

async function isLikelyEmbeddable(videoId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return true; // assume embeddable on timeout/error to avoid blocking everything
  }
}

async function lookupVideos(query: string, limit: number): Promise<YouTubeSearchResult[]> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`YouTube search failed (${response.status})`);
  }

  const html = await response.text();
  const marker = "var ytInitialData = ";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    return [];
  }

  const jsonStart = markerIndex + marker.length;
  const jsonEnd = html.indexOf(";</script>", jsonStart);
  if (jsonEnd < 0) {
    return [];
  }

  const payloadRaw = html.slice(jsonStart, jsonEnd);
  const initialData = JSON.parse(payloadRaw) as unknown;
  const renderers = findVideoRenderers(initialData, Math.max(limit, 8));
  const results = renderers
    .map((renderer) => toResult(renderer, query))
    .filter((result): result is YouTubeSearchResult => result !== null);

  if (results.length <= 1) {
    return results.slice(0, limit);
  }

  const embeddableFlags = await Promise.all(results.map((item) => isLikelyEmbeddable(item.videoId)));
  const embeddable: YouTubeSearchResult[] = [];
  const fallback: YouTubeSearchResult[] = [];
  results.forEach((item, index) => {
    if (embeddableFlags[index]) {
      embeddable.push(item);
    } else {
      fallback.push(item);
    }
  });

  embeddable.sort((a, b) => {
    const aScore = isTopicChannel(a.channelTitle) ? 0 : 1;
    const bScore = isTopicChannel(b.channelTitle) ? 0 : 1;
    return aScore - bScore;
  });

  return [...embeddable, ...fallback].slice(0, limit);
}

async function runSearch(query: string, rawLimit: number | null) {
  const trimmed = query.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }
  const limit = Math.min(8, Math.max(1, rawLimit ?? 5));

  try {
    const results = await lookupVideos(trimmed, limit);
    if (results.length === 0) {
      return NextResponse.json({ error: "No matching YouTube video found" }, { status: 404 });
    }
    return NextResponse.json({ results, result: results[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown YouTube search error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("query") ?? "";
  const limitParam = Number(url.searchParams.get("limit") ?? "5");
  return runSearch(query, Number.isFinite(limitParam) ? limitParam : null);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as SearchPayload;
  return runSearch(body.query ?? "", typeof body.limit === "number" ? body.limit : null);
}
