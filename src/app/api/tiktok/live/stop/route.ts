import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { callLiveWorker, hasLiveWorkerConfigured } from "@/lib/live-worker-client";

export const runtime = "nodejs";
void prisma;

const stopSchema = z.object({
  username: z.string().trim().min(2),
});

export async function POST(req: Request) {
  try {
    const body = stopSchema.parse(await req.json());

    if (!hasLiveWorkerConfigured()) {
      return NextResponse.json(
        { error: "Live worker is not configured. Set LIVE_WORKER_URL to your laptop live server." },
        { status: 503 }
      );
    }

    const result = await callLiveWorker<{ ok: boolean; stopped: boolean; sessionId?: string; message: string }>(
      "/track/stop",
      { username: body.username }
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live stop failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
