import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { CtaPresetKey, getCtaPresets, updateCtaPreset } from "@/lib/cta-presets";

export const runtime = "nodejs";
void prisma;

const ctaKeys: [CtaPresetKey, ...CtaPresetKey[]] = ["spotify", "follow", "share", "request", "support"];

const updateSchema = z.object({
  key: z.enum(ctaKeys),
  label: z.string().trim().max(40).optional(),
  title: z.string().trim().max(140).optional(),
  subtitle: z.string().trim().max(320).optional(),
  accentColor: z.string().trim().optional(),
});

export async function GET() {
  try {
    const presets = await getCtaPresets();
    return NextResponse.json({ presets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load CTA presets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const payload = updateSchema.parse(await req.json());
    const preset = await updateCtaPreset(payload);
    return NextResponse.json({ ok: true, preset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update CTA preset";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
