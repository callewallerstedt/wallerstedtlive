import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { callLiveWorker, hasLiveWorkerConfigured } from "@/lib/live-worker-client";
import { stopLiveTrackingByUsernameAsync } from "@/lib/tiktok-live";

export const runtime = "nodejs";
void prisma;

const stopSchema = z.object({
  username: z.string().trim().min(2),
});

export async function POST(req: Request) {
  try {
    const body = stopSchema.parse(await req.json());

    if (hasLiveWorkerConfigured()) {
      try {
        const result = await callLiveWorker<{ ok: boolean; stopped: boolean; sessionId?: string; message: string }>(
          "/track/stop",
          { username: body.username }
        );
        return NextResponse.json(result);
      } catch {
        // Worker unreachable — fall through to direct stop
      }
    }

    const result = await stopLiveTrackingByUsernameAsync(body.username);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live stop failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
