import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type StreamOverlayMode =
  | "hidden"
  | "spotify_cta"
  | "now_playing"
  | "comment"
  | "thank_you"
  | "custom";

export type StreamOverlayState = {
  mode: StreamOverlayMode;
  title: string;
  subtitle: string;
  accentColor: string;
  mediaImageUrl?: string;
  updatedAt: string;
  updatedBy: string;
};

const OVERLAY_PROVIDER = "stream_overlay";
let overlayStateCache: StreamOverlayState | null = null;

const defaultState: Omit<StreamOverlayState, "updatedAt"> = {
  mode: "hidden",
  title: "",
  subtitle: "",
  accentColor: "#f59e0b",
  mediaImageUrl: "",
  updatedBy: "system",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeMultilineText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return normalized.slice(0, maxLength);
}

function parseMode(value: unknown): StreamOverlayMode {
  const valid: StreamOverlayMode[] = ["hidden", "spotify_cta", "now_playing", "comment", "thank_you", "custom"];
  if (typeof value === "string" && valid.includes(value as StreamOverlayMode)) {
    return value as StreamOverlayMode;
  }
  return defaultState.mode;
}

function parseAccent(value: unknown): string {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-fA-F]{6}$/.test(parsed)) {
    return parsed;
  }
  return defaultState.accentColor;
}

function parseMediaImageUrl(value: unknown): string {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (!parsed) {
    return "";
  }
  if (/^https?:\/\/.+/i.test(parsed)) {
    return parsed.slice(0, 500);
  }
  return "";
}

function parseMeta(meta: Prisma.JsonValue | null | undefined): Omit<StreamOverlayState, "updatedAt"> {
  const root = asRecord(meta);
  if (!root) {
    return defaultState;
  }

  return {
    mode: parseMode(root.mode),
    title: sanitizeText(root.title, 140),
    subtitle: sanitizeMultilineText(root.subtitle, 320),
    accentColor: parseAccent(root.accentColor),
    mediaImageUrl: parseMediaImageUrl(root.mediaImageUrl),
    updatedBy: sanitizeText(root.updatedBy, 40) || "system",
  };
}

function toJson(state: Omit<StreamOverlayState, "updatedAt">): Prisma.JsonObject {
  return {
    mode: state.mode,
    title: state.title,
    subtitle: state.subtitle,
    accentColor: state.accentColor,
    mediaImageUrl: state.mediaImageUrl || "",
    updatedBy: state.updatedBy,
  };
}

export async function getStreamOverlayState(): Promise<StreamOverlayState> {
  if (overlayStateCache) {
    return overlayStateCache;
  }

  const latest = await prisma.syncEvent.findFirst({
    where: { provider: OVERLAY_PROVIDER },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    overlayStateCache = {
      ...defaultState,
      updatedAt: new Date(0).toISOString(),
    };
    return overlayStateCache;
  }

  overlayStateCache = {
    ...parseMeta(latest.meta),
    updatedAt: latest.createdAt.toISOString(),
  };
  return overlayStateCache;
}

type UpdateInput = {
  mode?: StreamOverlayMode;
  title?: string;
  subtitle?: string;
  accentColor?: string;
  mediaImageUrl?: string;
  updatedBy?: string;
};

export async function updateStreamOverlayState(input: UpdateInput): Promise<StreamOverlayState> {
  const previous = await getStreamOverlayState();

  const next: Omit<StreamOverlayState, "updatedAt"> = {
    mode: input.mode ?? previous.mode,
    title: sanitizeText(input.title ?? previous.title, 140),
    subtitle: sanitizeMultilineText(input.subtitle ?? previous.subtitle, 320),
    accentColor: parseAccent(input.accentColor ?? previous.accentColor),
    mediaImageUrl: parseMediaImageUrl(input.mediaImageUrl ?? previous.mediaImageUrl),
    updatedBy: sanitizeText(input.updatedBy ?? previous.updatedBy, 40) || "system",
  };

  if (next.mode === "hidden") {
    next.title = "";
    next.subtitle = "";
    next.mediaImageUrl = "";
  }

  const event = await prisma.syncEvent.create({
    data: {
      provider: OVERLAY_PROVIDER,
      status: "OK",
      message: `${next.mode}:${next.title || "no-title"}`,
      meta: toJson(next),
    },
  });

  overlayStateCache = {
    ...next,
    updatedAt: event.createdAt.toISOString(),
  };
  return overlayStateCache;
}
