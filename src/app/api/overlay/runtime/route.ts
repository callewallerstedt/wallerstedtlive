import { NextResponse } from "next/server";

import { getOverlayGoalsState } from "@/lib/overlay-goals";
import { prisma } from "@/lib/prisma";
import { getStreamOverlayState } from "@/lib/stream-overlay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [state, goals, active] = await Promise.all([
      getStreamOverlayState(),
      getOverlayGoalsState(),
      prisma.tikTokLiveSession.findFirst({
        where: { endedAt: null },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          endedAt: true,
          likeCountLatest: true,
          enterCountLatest: true,
          totalGiftDiamonds: true,
          totalCommentEvents: true,
          totalGiftEvents: true,
          viewerCountPeak: true,
          viewerCountAvg: true,
          gifts: {
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              id: true,
              giftName: true,
              userUniqueId: true,
              nickname: true,
              createdAt: true,
            },
          },
          comments: {
            orderBy: { createdAt: "desc" },
            take: 30,
            select: {
              id: true,
              comment: true,
              userUniqueId: true,
              nickname: true,
              createdAt: true,
            },
          },
          samples: {
            orderBy: { capturedAt: "desc" },
            take: 1,
            select: {
              viewerCount: true,
              likeCount: true,
              enterCount: true,
              capturedAt: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json({ state, goals, session: active }, {
      headers: {
        "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown overlay runtime error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
