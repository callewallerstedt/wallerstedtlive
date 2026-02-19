import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { stopLiveTrackingByUsername } from "@/lib/tiktok-live";

export const runtime = "nodejs";
void prisma;

const stopSchema = z.object({
  username: z.string().trim().min(2),
});

export async function POST(req: Request) {
  try {
    const body = stopSchema.parse(await req.json());
    const result = stopLiveTrackingByUsername(body.username);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live stop failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
