import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const CACHE_TTL_MS = 350;
let cachedOverlayPayload: { expiresAt: number; body: unknown } | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (cachedOverlayPayload && cachedOverlayPayload.expiresAt > now) {
      return NextResponse.json(cachedOverlayPayload.body);
    }

    const active = await prisma.tikTokLiveSession.findFirst({
      where: { endedAt: null },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        endedAt: true,
        likeCountLatest: true,
        totalGiftDiamonds: true,
        gifts: {
          orderBy: { createdAt: "desc" },
          take: 220,
          select: {
            id: true,
            giftName: true,
            userUniqueId: true,
            nickname: true,
            createdAt: true,
          },
        },
      },
    });

    const fallback = active
      ? null
      : await prisma.tikTokLiveSession.findFirst({
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            endedAt: true,
            likeCountLatest: true,
            totalGiftDiamonds: true,
            gifts: {
              orderBy: { createdAt: "desc" },
              take: 220,
              select: {
                id: true,
                giftName: true,
                userUniqueId: true,
                nickname: true,
                createdAt: true,
              },
            },
          },
        });

    const session = active ?? fallback;
    if (!session) {
      const body = {
        session: null,
      };
      cachedOverlayPayload = {
        expiresAt: now + CACHE_TTL_MS,
        body,
      };
      return NextResponse.json(body);
    }

    const body = {
      session,
    };
    cachedOverlayPayload = {
      expiresAt: now + CACHE_TTL_MS,
      body,
    };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown live overlay state error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
