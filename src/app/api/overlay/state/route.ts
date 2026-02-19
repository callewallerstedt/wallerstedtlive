import { NextResponse } from "next/server";

import { getStreamOverlayState, StreamOverlayMode, updateStreamOverlayState } from "@/lib/stream-overlay";

export const runtime = "nodejs";

type UpdatePayload = {
  mode?: StreamOverlayMode;
  title?: string;
  subtitle?: string;
  accentColor?: string;
  mediaImageUrl?: string;
  updatedBy?: string;
};

export async function GET() {
  try {
    const state = await getStreamOverlayState();
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown overlay state error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UpdatePayload;
    const state = await updateStreamOverlayState({
      mode: body.mode,
      title: body.title,
      subtitle: body.subtitle,
      accentColor: body.accentColor,
      mediaImageUrl: body.mediaImageUrl,
      updatedBy: body.updatedBy,
    });
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown overlay update error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
