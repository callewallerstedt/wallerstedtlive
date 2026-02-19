import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateConfig, updateConfig } from "@/lib/config";

export const runtime = "nodejs";

const configSchema = z.object({
  tiktokHandle: z.string().trim().optional(),
  spotifyArtistName: z.string().trim().optional(),
  spotifyArtistId: z.string().trim().optional(),
  objective: z.string().trim().optional(),
});

export async function GET() {
  try {
    const config = await getOrCreateConfig();
    return NextResponse.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const payload = configSchema.parse(await req.json());

    const data: Record<string, unknown> = {
      objective: payload.objective || "spotify_streams",
      openAiApiKey: null,
    };

    if (payload.tiktokHandle !== undefined) {
      data.tiktokHandle = payload.tiktokHandle || null;
    }
    if (payload.spotifyArtistName !== undefined) {
      data.spotifyArtistName = payload.spotifyArtistName || null;
    }
    if (payload.spotifyArtistId !== undefined) {
      data.spotifyArtistId = payload.spotifyArtistId || null;
    }

    const config = await updateConfig({
      ...data,
    });

    return NextResponse.json({ ok: true, config });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update config";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
