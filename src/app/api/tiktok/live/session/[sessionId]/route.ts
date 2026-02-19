import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { deleteLiveSessionById } from "@/lib/tiktok-live";

export const runtime = "nodejs";
void prisma;

const paramsSchema = z.object({
  sessionId: z.string().trim().min(8),
});

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const rawParams = await context.params;
    const params = paramsSchema.parse(rawParams);
    const result = await deleteLiveSessionById(params.sessionId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete session failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
