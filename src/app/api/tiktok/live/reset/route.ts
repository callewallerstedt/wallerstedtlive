import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { getOrCreateConfig, updateConfig } from "@/lib/config";
import { callLiveWorker, hasLiveWorkerConfigured } from "@/lib/live-worker-client";

export const runtime = "nodejs";
void prisma;

export async function POST() {
  try {
    const config = await getOrCreateConfig();

    if (hasLiveWorkerConfigured() && config.tiktokHandle) {
      try {
        await callLiveWorker<{ ok: boolean; stopped: boolean; message: string }>("/track/stop", {
          username: config.tiktokHandle,
        });
      } catch {
        // best effort stop; continue reset anyway
      }
    }

    await prisma.tikTokLiveComment.deleteMany({});
    await prisma.tikTokLiveGift.deleteMany({});
    await prisma.tikTokLiveSample.deleteMany({});
    await prisma.tikTokLiveSession.deleteMany({});

    await updateConfig({ tiktokHandle: null });

    return NextResponse.json({
      ok: true,
      message: "Tracking data reset. Cleared sessions, samples, comments, gifts, and saved handle.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live reset failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
