import { NextResponse } from "next/server";

import { getOrCreateConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { refreshLiveTrackingSnapshot } from "@/lib/tiktok-live";
import { LiveDashboardState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const runtimeMode = url.searchParams.get("runtime") === "1";
    const runtimeUsername = url.searchParams.get("username")?.trim().replace(/^@/, "") || undefined;
    const config = await getOrCreateConfig();
    if (runtimeMode) {
      await refreshLiveTrackingSnapshot(runtimeUsername ?? config.tiktokHandle ?? undefined).catch(() => undefined);
    }
    const [liveSessions, latestSyncEvents, spotifyTracks] = runtimeMode
      ? await Promise.all([
          prisma.tikTokLiveSession.findMany({
            orderBy: { startedAt: "desc" },
            take: 6,
            include: {
              samples: {
                orderBy: { capturedAt: "asc" },
                take: 5000,
              },
              comments: {
                orderBy: { createdAt: "asc" },
                take: 2000,
              },
              gifts: {
                orderBy: { createdAt: "asc" },
                take: 2000,
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
                orderBy: { capturedAt: "desc" },
                take: 600,
              },
              comments: {
                orderBy: { createdAt: "desc" },
                take: 800,
              },
              gifts: {
                orderBy: { createdAt: "desc" },
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

    const normalizedLiveSessions = liveSessions.map((session) => ({
      ...session,
      samples: [...session.samples].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()),
      comments: [...session.comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      gifts: [...session.gifts].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    }));

    const payload: LiveDashboardState = {
      config,
      latestSyncEvents,
      spotifyTracks,
      liveSessions: normalizedLiveSessions,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown live state API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
