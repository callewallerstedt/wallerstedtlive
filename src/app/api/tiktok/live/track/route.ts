import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { updateConfig } from "@/lib/config";
import { startLiveTrackingByUsername } from "@/lib/tiktok-live";

export const runtime = "nodejs";
void prisma;

const trackSchema = z.object({
  username: z.string().trim().min(2),
  durationSec: z.number().int().min(0).max(21600).optional(),
  pollIntervalSec: z.number().min(0.2).max(30).optional(),
  collectChatEvents: z.boolean().optional(),
  forceRestartIfRunning: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const body = trackSchema.parse(await req.json());
    const normalizedUsername = body.username.trim().replace(/^@/, "");
    await updateConfig({
      tiktokHandle: normalizedUsername || null,
    });
    const result = await startLiveTrackingByUsername({
      username: normalizedUsername,
      durationSec: body.durationSec ?? 0,
      pollIntervalSec: body.pollIntervalSec ?? 0.5,
      collectChatEvents: body.collectChatEvents ?? true,
      forceRestartIfRunning: body.forceRestartIfRunning ?? true,
    });

    if (!result.started) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, trackedUsername: normalizedUsername, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live tracking failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
