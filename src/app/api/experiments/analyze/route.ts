import { NextResponse } from "next/server";

import { resolveOpenAiApiKey } from "@/lib/config";
import { analyzeExperiment } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { calculateExperimentScore, updateRunningAverage } from "@/lib/scoring";
import { ExperimentMetrics } from "@/lib/types";
import { fileToDataUrl, saveUploadedFile } from "@/lib/uploads";

export const runtime = "nodejs";

function toOptionalInt(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalFloat(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const recommendationIdRaw = form.get("recommendationId");
    const recommendationId =
      typeof recommendationIdRaw === "string" && recommendationIdRaw.trim()
        ? recommendationIdRaw.trim()
        : undefined;

    const notesRaw = form.get("notes");
    const notes = typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim() : undefined;
    const metrics: ExperimentMetrics = {
      hoursSincePost: toOptionalInt(form.get("hoursSincePost")),
      views: toOptionalInt(form.get("views")),
      likes: toOptionalInt(form.get("likes")),
      comments: toOptionalInt(form.get("comments")),
      shares: toOptionalInt(form.get("shares")),
      saves: toOptionalInt(form.get("saves")),
      watchTimeSec: toOptionalFloat(form.get("watchTimeSec")),
      completionRate: toOptionalFloat(form.get("completionRate")),
      profileVisits: toOptionalInt(form.get("profileVisits")),
      linkClicks: toOptionalInt(form.get("linkClicks")),
      spotifyStreamsDelta: toOptionalInt(form.get("spotifyStreamsDelta")),
    };

    let screenshotPath: string | undefined;
    let imageDataUrl: string | undefined;
    const fileRaw = form.get("screenshot");
    if (fileRaw instanceof File && fileRaw.size > 0) {
      screenshotPath = await saveUploadedFile(fileRaw);
      imageDataUrl = await fileToDataUrl(screenshotPath);
    }

    const [recommendation, recentInsights] = await Promise.all([
      recommendationId
        ? prisma.recommendation.findUnique({ where: { id: recommendationId } })
        : Promise.resolve(null),
      prisma.insight.findMany({ orderBy: { createdAt: "desc" }, take: 14 }),
    ]);

    const baseScore = calculateExperimentScore(metrics);

    const analysis = await analyzeExperiment({
      apiKey: resolveOpenAiApiKey(),
      recommendation,
      metrics,
      notes,
      imageDataUrl,
      recentInsights,
    });

    const score = Number((0.6 * baseScore + 0.4 * analysis.score).toFixed(4));

    const report = await prisma.experimentReport.create({
      data: {
        recommendationId,
        screenshotPath,
        notes,
        hoursSincePost: metrics.hoursSincePost,
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saves: metrics.saves,
        watchTimeSec: metrics.watchTimeSec,
        completionRate: metrics.completionRate,
        profileVisits: metrics.profileVisits,
        linkClicks: metrics.linkClicks,
        spotifyStreamsDelta: metrics.spotifyStreamsDelta,
        analysisSummary: analysis.summary,
        analysisJson: analysis,
        patternKey: analysis.patternKey ?? recommendation?.patternKey ?? null,
        score,
      },
    });

    const actions = analysis.nextActions.slice(0, 4);
    if (actions.length) {
      await prisma.insight.createMany({
        data: actions.map((action) => ({
          sourceExperimentId: report.id,
          title: "Action from latest experiment",
          detail: analysis.summary,
          action,
          confidence: score,
          impactScore: analysis.spotifyLiftEstimate,
        })),
      });
    }

    if (recommendationId) {
      await prisma.recommendation.update({
        where: { id: recommendationId },
        data: { status: "TESTED", updatedAt: new Date(), score },
      });
    }

    const patternKey = analysis.patternKey ?? recommendation?.patternKey;
    if (patternKey) {
      const existing = await prisma.strategyPattern.findUnique({
        where: { key: patternKey },
      });

      if (!existing) {
        await prisma.strategyPattern.create({
          data: {
            key: patternKey,
            description: `Pattern learned from ${recommendation?.ideaTitle ?? "manual experiment"}`,
            attempts: 1,
            avgScore: score,
            avgSpotifyLift: analysis.spotifyLiftEstimate,
            avgViewRate: metrics.views ?? 0,
          },
        });
      } else {
        await prisma.strategyPattern.update({
          where: { key: patternKey },
          data: {
            attempts: existing.attempts + 1,
            avgScore: updateRunningAverage(existing.avgScore, existing.attempts, score),
            avgSpotifyLift: updateRunningAverage(
              existing.avgSpotifyLift,
              existing.attempts,
              analysis.spotifyLiftEstimate
            ),
            avgViewRate: updateRunningAverage(existing.avgViewRate, existing.attempts, metrics.views ?? 0),
          },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      reportId: report.id,
      score,
      analysis,
      screenshotPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze experiment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
