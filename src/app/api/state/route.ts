import { NextResponse } from "next/server";

import { getOrCreateConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { DashboardState } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = await getOrCreateConfig();

    const [tiktokVideos, spotifyTracks, recommendations, experiments, insights, patterns, latestSyncEvents, liveSessions] =
      await Promise.all([
        prisma.tikTokVideo.findMany({
          orderBy: [{ postedAt: "desc" }, { scrapedAt: "desc" }],
        }),
        prisma.spotifyTrack.findMany({
          orderBy: [{ isOwnedByYou: "desc" }, { ownershipShare: "desc" }, { popularity: "desc" }, { syncedAt: "desc" }],
        }),
        prisma.recommendation.findMany({
          orderBy: [{ createdAt: "desc" }, { rank: "asc" }],
          take: 24,
        }),
        prisma.experimentReport.findMany({
          include: { recommendation: true },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        prisma.insight.findMany({
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        prisma.strategyPattern.findMany({
          orderBy: { avgScore: "desc" },
          take: 30,
        }),
        prisma.syncEvent.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.tikTokLiveSession.findMany({
          orderBy: { startedAt: "desc" },
          take: 12,
          include: {
            samples: {
              orderBy: { capturedAt: "desc" },
              take: 24,
            },
            comments: {
              orderBy: { createdAt: "desc" },
              take: 12,
            },
            gifts: {
              orderBy: { createdAt: "desc" },
              take: 12,
            },
          },
        }),
      ]);

    const testedIdeas = experiments.length;
    const avgViews = testedIdeas
      ? Math.round(experiments.reduce((acc, item) => acc + (item.views ?? 0), 0) / testedIdeas)
      : 0;
    const avgSpotifyDelta = testedIdeas
      ? Math.round(experiments.reduce((acc, item) => acc + (item.spotifyStreamsDelta ?? 0), 0) / testedIdeas)
      : 0;
    const avgEngagementRate = testedIdeas
      ? Number(
          (
            experiments.reduce((acc, item) => {
              const views = item.views ?? 0;
              if (!views) {
                return acc;
              }
              const interactions =
                (item.likes ?? 0) + (item.comments ?? 0) + (item.shares ?? 0) + (item.saves ?? 0);
              return acc + interactions / views;
            }, 0) / testedIdeas
          ).toFixed(4)
        )
      : 0;

    const activeRecommendations = recommendations.filter((item) =>
      ["DRAFT", "LIVE"].includes(item.status)
    ).length;

    const state: DashboardState = {
      config,
      tiktokVideos,
      spotifyTracks,
      recommendations,
      experiments,
      insights,
      patterns,
      latestSyncEvents,
      liveSessions,
      metrics: {
        avgViews,
        avgEngagementRate,
        avgSpotifyDelta,
        testedIdeas,
        activeRecommendations,
      },
    };

    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown state API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
