import { NextResponse } from "next/server";

import { getOrCreateConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { refreshLiveTrackingSnapshot } from "@/lib/tiktok-live";
import { LiveDashboardState } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const runtimeMode = url.searchParams.get("runtime") === "1";
    const config = await getOrCreateConfig();
    if (runtimeMode) {
      await refreshLiveTrackingSnapshot(config.tiktokHandle ?? undefined).catch(() => undefined);
    }
    const [liveSessions, latestSyncEvents, spotifyTracks] = runtimeMode
      ? await Promise.all([
          prisma.tikTokLiveSession.findMany({
            orderBy: { startedAt: "desc" },
            take: 6,
            include: {
              samples: {
                orderBy: { capturedAt: "asc" },
                take: 220,
              },
              comments: {
                orderBy: { createdAt: "asc" },
                take: 260,
              },
              gifts: {
                orderBy: { createdAt: "asc" },
                take: 260,
              },
            },
          }),
          Promise.resolve([]),
          Promise.resolve([]),
        ])
      : await Promise.all([
          prisma.tikTokLiveSession.findMany({
            orderBy: { startedAt: "desc" },
            take: 20,
            include: {
              samples: {
                orderBy: { capturedAt: "asc" },
                take: 600,
              },
              comments: {
                orderBy: { createdAt: "asc" },
                take: 800,
              },
              gifts: {
                orderBy: { createdAt: "asc" },
                take: 800,
              },
            },
          }),
          prisma.syncEvent.findMany({
            where: { provider: "tiktok" },
            orderBy: { createdAt: "desc" },
            take: 5,
          }),
          prisma.spotifyTrack.findMany({
            orderBy: [{ isOwnedByYou: "desc" }, { popularity: "desc" }, { syncedAt: "desc" }],
            take: 400,
          }),
        ]);

    const payload: LiveDashboardState = {
      config,
      latestSyncEvents,
      spotifyTracks,
      liveSessions,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown live state API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
