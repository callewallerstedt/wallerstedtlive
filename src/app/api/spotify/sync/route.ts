import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateConfig, updateConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { syncSpotifyCatalog } from "@/lib/spotify";

export const runtime = "nodejs";

const syncSchema = z.object({
  artistName: z.string().trim().optional(),
  artistId: z.string().trim().optional(),
});

export async function POST(req: Request) {
  try {
    const body = syncSchema.parse(await req.json().catch(() => ({})));
    const config = await getOrCreateConfig();

    const artistName = body.artistName || config.spotifyArtistName || "Wallerstedt";
    const artistId = body.artistId || config.spotifyArtistId || undefined;

    const result = await syncSpotifyCatalog({ artistName, artistId });

    let upserted = 0;
    for (const track of result.tracks) {
      const existing = await prisma.spotifyTrack.findUnique({
        where: { spotifyId: track.spotifyId },
      });

      const shouldKeepManualOwnership = existing && existing.ownershipStatus !== "AUTO";
      const nextOwnershipStatus = shouldKeepManualOwnership ? existing.ownershipStatus : "AUTO";
      const nextIsMine = shouldKeepManualOwnership ? existing.isOwnedByYou : track.autoOwnedByYou;
      const nextShare = shouldKeepManualOwnership ? existing.ownershipShare : track.autoOwnershipShare;

      await prisma.spotifyTrack.upsert({
        where: { spotifyId: track.spotifyId },
        update: {
          name: track.name,
          artistName: track.artistName,
          albumName: track.albumName,
          albumLabel: track.albumLabel,
          publisher: track.publisher,
          popularity: track.popularity,
          durationMs: track.durationMs,
          previewUrl: track.previewUrl,
          externalUrl: track.externalUrl,
          uri: track.uri,
          isrc: track.isrc,
          releaseDate: track.releaseDate,
          ownershipStatus: nextOwnershipStatus,
          isOwnedByYou: nextIsMine,
          ownershipShare: nextShare,
          syncedAt: new Date(),
        },
        create: {
          spotifyId: track.spotifyId,
          name: track.name,
          artistName: track.artistName,
          albumName: track.albumName,
          albumLabel: track.albumLabel,
          publisher: track.publisher,
          popularity: track.popularity,
          durationMs: track.durationMs,
          previewUrl: track.previewUrl,
          externalUrl: track.externalUrl,
          uri: track.uri,
          isrc: track.isrc,
          releaseDate: track.releaseDate,
          ownershipStatus: "AUTO",
          isOwnedByYou: track.autoOwnedByYou,
          ownershipShare: track.autoOwnershipShare,
        },
      });
      upserted += 1;
    }

    await updateConfig({
      spotifyArtistId: result.artistId,
      spotifyArtistName: result.artistName,
    });

    await prisma.syncEvent.create({
      data: {
        provider: "spotify",
        status: "success",
        message: `Synced ${upserted} tracks for ${result.artistName}`,
      },
    });

    return NextResponse.json({
      ok: true,
      synced: upserted,
      artistName: result.artistName,
      artistId: result.artistId,
      warnings: result.warnings,
      topTracks: result.tracks.slice(0, 8),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Spotify sync failed";
    await prisma.syncEvent.create({
      data: {
        provider: "spotify",
        status: "error",
        message,
      },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
