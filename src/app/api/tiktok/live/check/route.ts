import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { callLiveWorker, hasLiveWorkerConfigured } from "@/lib/live-worker-client";
import { fetchLiveSnapshotByUsername } from "@/lib/tiktok-live";

export const runtime = "nodejs";
void prisma;

const checkSchema = z.object({
  username: z.string().trim().min(2),
});

export async function POST(req: Request) {
  try {
    const body = checkSchema.parse(await req.json());

    if (hasLiveWorkerConfigured()) {
      try {
        const result = await callLiveWorker<{ ok: boolean; snapshot: unknown }>("/track/check", {
          username: body.username,
        });
        return NextResponse.json(result);
      } catch {
        // Worker unreachable — fall through to direct check
      }
    }

    const snapshot = await fetchLiveSnapshotByUsername(body.username);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live check failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
