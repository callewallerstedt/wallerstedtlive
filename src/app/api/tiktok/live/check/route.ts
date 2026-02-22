import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { fetchLiveSnapshotByUsername } from "@/lib/tiktok-live";

export const runtime = "nodejs";
void prisma;

const checkSchema = z.object({
  username: z.string().trim().min(2),
});

export async function POST(req: Request) {
  try {
    const body = checkSchema.parse(await req.json());
    const snapshot = await fetchLiveSnapshotByUsername(body.username);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live check failed";
    if (
      /parsable live state data/i.test(message) ||
      /did not include SIGI_STATE/i.test(message)
    ) {
      return NextResponse.json({
        ok: true,
        snapshot: {
          isLive: false,
          viewerCount: 0,
          likeCount: 0,
          enterCount: 0,
        },
        warning:
          "TikTok is rate-limiting or blocking this check right now. Use Start to enter polling fallback mode, then wait for samples.",
      });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
