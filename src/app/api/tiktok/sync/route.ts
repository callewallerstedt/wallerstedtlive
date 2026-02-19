import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateConfig, updateConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { scrapeTikTokProfile } from "@/lib/tiktok";

export const runtime = "nodejs";

const syncSchema = z.object({
  handle: z.string().trim().optional(),
  limit: z.number().int().min(5).max(100).optional(),
});

export async function POST(req: Request) {
  try {
    const body = syncSchema.parse(await req.json().catch(() => ({})));
    const config = await getOrCreateConfig();
    const handle = body.handle || config.tiktokHandle;
    if (!handle) {
      return NextResponse.json({ error: "Missing TikTok handle. Save it in Settings first." }, { status: 400 });
    }

    const limit = body.limit ?? 30;
    const result = await scrapeTikTokProfile(handle, limit);

    if (result.posts.length === 0) {
      const profileNote = result.profile
        ? `Profile found (${result.profile.followerCount?.toLocaleString() ?? "?"} followers, ${result.profile.videoCount ?? "?"} videos) but no post rows were retrievable.`
        : "No profile/post payload available from scraper providers.";

      const message = `TikTok sync returned 0 videos. ${profileNote}`;
      await prisma.syncEvent.create({
        data: {
          provider: "tiktok",
          status: "warning",
          message,
          meta: {
            source: result.source,
            warnings: result.warnings,
            profile: result.profile ?? null,
          },
        },
      });

      return NextResponse.json(
        {
          error: message,
          source: result.source,
          warnings: result.warnings,
          profile: result.profile ?? null,
        },
        { status: 422 }
      );
    }

    let upserted = 0;
    for (const post of result.posts) {
      await prisma.tikTokVideo.upsert({
        where: { platformId: post.platformId },
        update: {
          description: post.description,
          videoUrl: post.videoUrl,
          coverUrl: post.coverUrl,
          durationSec: post.durationSec,
          postedAt: post.postedAt,
          views: post.views,
          likes: post.likes,
          comments: post.comments,
          shares: post.shares,
          saves: post.saves,
          musicTitle: post.musicTitle,
          musicAuthor: post.musicAuthor,
          scrapedSource: result.source,
          scrapedAt: new Date(),
        },
        create: {
          platformId: post.platformId,
          description: post.description,
          videoUrl: post.videoUrl,
          coverUrl: post.coverUrl,
          durationSec: post.durationSec,
          postedAt: post.postedAt,
          views: post.views,
          likes: post.likes,
          comments: post.comments,
          shares: post.shares,
          saves: post.saves,
          musicTitle: post.musicTitle,
          musicAuthor: post.musicAuthor,
          scrapedSource: result.source,
        },
      });
      upserted += 1;
    }

    await prisma.syncEvent.create({
      data: {
        provider: "tiktok",
        status: "success",
        message: `Synced ${upserted} videos from ${result.source}`,
        meta: {
          source: result.source,
          warnings: result.warnings,
          profile: result.profile ?? null,
        },
      },
    });

    await updateConfig({ tiktokHandle: handle.replace(/^@/, "") });

    return NextResponse.json({
      ok: true,
      synced: upserted,
      source: result.source,
      warnings: result.warnings,
      profile: result.profile ?? null,
      mostLiked: [...result.posts].sort((a, b) => b.likes - a.likes).slice(0, 5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TikTok sync failed";
    await prisma.syncEvent.create({
      data: {
        provider: "tiktok",
        status: "error",
        message,
      },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
