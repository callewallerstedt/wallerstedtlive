import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { OverlayGoalsState } from "@/lib/types";

const GOALS_PROVIDER = "overlay_goals";
let overlayGoalsCache: OverlayGoalsState | null = null;

const defaultState: Omit<OverlayGoalsState, "updatedAt"> = {
  likeGoalTarget: 10000,
  donationGoalTarget: 2000,
  showLikeGoal: false,
  showDonationGoal: false,
  autoLikeEnabled: false,
  autoLikeEveryLikes: 1000,
  autoLikeTriggerWithin: 200,
  autoLikeTextTemplate: "We're almost at {target} likes!!",
  autoLikeSubtextTemplate: "{remaining} likes to go",
  autoLikeShowProgress: true,
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

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(1_000_000_000, Math.round(value)));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(1_000_000_000, Math.round(parsed)));
    }
  }
  return fallback;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1_000_000_000, Math.round(value)));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1_000_000_000, Math.round(parsed)));
    }
  }
  return fallback;
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function parseMeta(meta: Prisma.JsonValue | null | undefined): Omit<OverlayGoalsState, "updatedAt"> {
  const root = asRecord(meta);
  if (!root) {
    return defaultState;
  }
  return {
    likeGoalTarget: parsePositiveInt(root.likeGoalTarget, defaultState.likeGoalTarget),
    donationGoalTarget: parsePositiveInt(root.donationGoalTarget, defaultState.donationGoalTarget),
    showLikeGoal: parseBool(root.showLikeGoal, defaultState.showLikeGoal),
    showDonationGoal: parseBool(root.showDonationGoal, defaultState.showDonationGoal),
    autoLikeEnabled: parseBool(root.autoLikeEnabled, defaultState.autoLikeEnabled),
    autoLikeEveryLikes: parsePositiveInt(root.autoLikeEveryLikes, defaultState.autoLikeEveryLikes),
    autoLikeTriggerWithin: parseNonNegativeInt(root.autoLikeTriggerWithin, defaultState.autoLikeTriggerWithin),
    autoLikeTextTemplate: sanitizeText(root.autoLikeTextTemplate, 180) || defaultState.autoLikeTextTemplate,
    autoLikeSubtextTemplate: sanitizeText(root.autoLikeSubtextTemplate, 180) || defaultState.autoLikeSubtextTemplate,
    autoLikeShowProgress: parseBool(root.autoLikeShowProgress, defaultState.autoLikeShowProgress),
    updatedBy: sanitizeText(root.updatedBy, 40) || "system",
  };
}

function toJson(state: Omit<OverlayGoalsState, "updatedAt">): Prisma.JsonObject {
  return {
    likeGoalTarget: state.likeGoalTarget,
    donationGoalTarget: state.donationGoalTarget,
    showLikeGoal: state.showLikeGoal,
    showDonationGoal: state.showDonationGoal,
    autoLikeEnabled: state.autoLikeEnabled,
    autoLikeEveryLikes: state.autoLikeEveryLikes,
    autoLikeTriggerWithin: state.autoLikeTriggerWithin,
    autoLikeTextTemplate: state.autoLikeTextTemplate,
    autoLikeSubtextTemplate: state.autoLikeSubtextTemplate,
    autoLikeShowProgress: state.autoLikeShowProgress,
    updatedBy: state.updatedBy,
  };
}

export async function getOverlayGoalsState(): Promise<OverlayGoalsState> {
  if (overlayGoalsCache) {
    return overlayGoalsCache;
  }

  const latest = await prisma.syncEvent.findFirst({
    where: { provider: GOALS_PROVIDER },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    overlayGoalsCache = {
      ...defaultState,
      updatedAt: new Date(0).toISOString(),
    };
    return overlayGoalsCache;
  }

  overlayGoalsCache = {
    ...parseMeta(latest.meta),
    updatedAt: latest.createdAt.toISOString(),
  };
  return overlayGoalsCache;
}

type UpdateInput = {
  likeGoalTarget?: number;
  donationGoalTarget?: number;
  showLikeGoal?: boolean;
  showDonationGoal?: boolean;
  autoLikeEnabled?: boolean;
  autoLikeEveryLikes?: number;
  autoLikeTriggerWithin?: number;
  autoLikeTextTemplate?: string;
  autoLikeSubtextTemplate?: string;
  autoLikeShowProgress?: boolean;
  updatedBy?: string;
};

export async function updateOverlayGoalsState(input: UpdateInput): Promise<OverlayGoalsState> {
  const previous = await getOverlayGoalsState();
  const next: Omit<OverlayGoalsState, "updatedAt"> = {
    likeGoalTarget: parsePositiveInt(input.likeGoalTarget, previous.likeGoalTarget),
    donationGoalTarget: parsePositiveInt(input.donationGoalTarget, previous.donationGoalTarget),
    showLikeGoal: input.showLikeGoal ?? previous.showLikeGoal,
    showDonationGoal: input.showDonationGoal ?? previous.showDonationGoal,
    autoLikeEnabled: input.autoLikeEnabled ?? previous.autoLikeEnabled,
    autoLikeEveryLikes: parsePositiveInt(input.autoLikeEveryLikes, previous.autoLikeEveryLikes),
    autoLikeTriggerWithin: parseNonNegativeInt(input.autoLikeTriggerWithin, previous.autoLikeTriggerWithin),
    autoLikeTextTemplate: sanitizeText(input.autoLikeTextTemplate ?? previous.autoLikeTextTemplate, 180) || defaultState.autoLikeTextTemplate,
    autoLikeSubtextTemplate: sanitizeText(input.autoLikeSubtextTemplate ?? previous.autoLikeSubtextTemplate, 180) || defaultState.autoLikeSubtextTemplate,
    autoLikeShowProgress: input.autoLikeShowProgress ?? previous.autoLikeShowProgress,
    updatedBy: sanitizeText(input.updatedBy ?? previous.updatedBy, 40) || "system",
  };

  const event = await prisma.syncEvent.create({
    data: {
      provider: GOALS_PROVIDER,
      status: "OK",
      message: `likes:${next.likeGoalTarget} diamonds:${next.donationGoalTarget}`,
      meta: toJson(next),
    },
  });

  overlayGoalsCache = {
    ...next,
    updatedAt: event.createdAt.toISOString(),
  };
  return overlayGoalsCache;
}
