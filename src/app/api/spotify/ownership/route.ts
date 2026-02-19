import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { inferOwnershipFromMetadata } from "@/lib/spotify";

export const runtime = "nodejs";

const bodySchema = z.object({
  spotifyId: z.string().min(3),
  ownershipStatus: z.enum(["AUTO", "MINE", "NOT_MINE"]),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());

    const track = await prisma.spotifyTrack.findUnique({
      where: { spotifyId: body.spotifyId },
    });

    if (!track) {
      return NextResponse.json({ error: "Track not found." }, { status: 404 });
    }

    let isOwnedByYou = track.isOwnedByYou;
    let ownershipShare = track.ownershipShare;

    if (body.ownershipStatus === "AUTO") {
      const inferred = inferOwnershipFromMetadata(track.albumLabel ?? undefined, track.publisher ?? undefined);
      isOwnedByYou = inferred.isOwnedByYou;
      ownershipShare = inferred.share;
    } else if (body.ownershipStatus === "MINE") {
      isOwnedByYou = true;
      ownershipShare = 1;
    } else {
      isOwnedByYou = false;
      ownershipShare = 0.5;
    }

    const updated = await prisma.spotifyTrack.update({
      where: { spotifyId: body.spotifyId },
      data: {
        ownershipStatus: body.ownershipStatus,
        isOwnedByYou,
        ownershipShare,
      },
    });

    return NextResponse.json({ ok: true, track: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update ownership";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
