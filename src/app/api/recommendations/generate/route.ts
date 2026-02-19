import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateConfig, resolveOpenAiApiKey } from "@/lib/config";
import { generateRecommendations } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { fetchTrendSignals } from "@/lib/trends";

export const runtime = "nodejs";

const generateSchema = z.object({
  count: z.number().int().min(1).max(12).optional(),
});

export async function POST(req: Request) {
  try {
    const body = generateSchema.parse(await req.json().catch(() => ({})));
    const config = await getOrCreateConfig();
    const count = body.count ?? 6;

    const [tiktokVideos, spotifyTracks, patterns, insights, previousRecommendations, trendSignals] = await Promise.all([
      prisma.tikTokVideo.findMany({ orderBy: [{ likes: "desc" }, { views: "desc" }], take: 40 }),
      prisma.spotifyTrack.findMany({
        orderBy: [
          { isOwnedByYou: "desc" },
          { ownershipShare: "desc" },
          { popularity: "desc" },
          { syncedAt: "desc" },
        ],
        take: 120,
      }),
      prisma.strategyPattern.findMany({ take: 40 }),
      prisma.insight.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.recommendation.findMany({
        where: {
          songSpotifyId: { not: null },
        },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { songSpotifyId: true },
      }),
      fetchTrendSignals(),
    ]);

    const recentSongUsage = previousRecommendations.reduce<Record<string, number>>((acc, row) => {
      if (!row.songSpotifyId) {
        return acc;
      }
      acc[row.songSpotifyId] = (acc[row.songSpotifyId] ?? 0) + 1;
      return acc;
    }, {});

    const drafts = await generateRecommendations({
      apiKey: resolveOpenAiApiKey(),
      objective: config.objective,
      count,
      tiktokVideos,
      spotifyTracks,
      patterns,
      insights,
      trendSignals,
      recentSongUsage,
    });

    const patternMap = new Map(patterns.map((pattern) => [pattern.key, pattern]));
    const now = new Date();

    const created = [];
    for (const [index, item] of drafts.entries()) {
      const pattern = item.patternKey ? patternMap.get(item.patternKey) : undefined;
      const patternBoost = pattern ? pattern.avgScore : 0.45;
      const finalScore = Number((0.7 * item.confidence + 0.3 * patternBoost).toFixed(4));

      const recommendation = await prisma.recommendation.create({
        data: {
          createdAt: now,
          updatedAt: now,
          rank: index + 1,
          status: "DRAFT",
          ideaTitle: item.ideaTitle,
          postFormat: item.postFormat,
          hook: item.hook,
          caption: item.caption,
          shotPlan: item.shotPlan,
          editingNotes: item.editingNotes,
          patternKey: item.patternKey,
          rationale: item.rationale,
          confidence: item.confidence,
          expectedSpotifyLift: item.expectedSpotifyLift,
          expectedViews: item.expectedViews,
          expectedSaveRate: item.expectedSaveRate,
          songSpotifyId: item.songSpotifyId,
          songName: item.songName,
          songSegmentStartSec: item.songSegmentStartSec,
          songSegmentLengthSec: item.songSegmentLengthSec,
          score: finalScore,
          promptSnapshot: {
            objective: config.objective,
            generatedAt: now.toISOString(),
            sourceCounts: {
              tiktokVideos: tiktokVideos.length,
              spotifyTracks: spotifyTracks.length,
              insights: insights.length,
            },
          },
        },
      });
      created.push(recommendation);
    }

    await prisma.syncEvent.create({
      data: {
        provider: "planner",
        status: "success",
        message: `Generated ${created.length} recommendations`,
        meta: { objective: config.objective },
      },
    });

    return NextResponse.json({ ok: true, generated: created.length, recommendations: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate recommendations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
