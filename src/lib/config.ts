import { AppConfig, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function getOrCreateConfig(): Promise<AppConfig> {
  const existing = await prisma.appConfig.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  return prisma.appConfig.create({
    data: {
      spotifyArtistName: "Wallerstedt",
      objective: "spotify_streams",
    },
  });
}

export async function updateConfig(
  data: Prisma.AppConfigUncheckedUpdateInput
): Promise<AppConfig> {
  const config = await getOrCreateConfig();
  return prisma.appConfig.update({
    where: { id: config.id },
    data,
  });
}

export function resolveOpenAiApiKey(): string | undefined {
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  return fromEnv || undefined;
}
