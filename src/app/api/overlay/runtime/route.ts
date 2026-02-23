import { NextResponse } from "next/server";

import { getOverlayGoalsState } from "@/lib/overlay-goals";
import { prisma } from "@/lib/prisma";
import { getStreamOverlayState } from "@/lib/stream-overlay";

export const runtime = "nodejs";

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
          totalGiftDiamonds: true,
          gifts: {
            orderBy: { createdAt: "desc" },
            take: 140,
            select: {
              id: true,
              giftName: true,
              userUniqueId: true,
              nickname: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json({ state, goals, session: active });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown overlay runtime error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
