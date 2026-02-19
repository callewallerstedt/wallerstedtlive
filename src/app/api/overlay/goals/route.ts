import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { getOverlayGoalsState, updateOverlayGoalsState } from "@/lib/overlay-goals";

export const runtime = "nodejs";
void prisma;

type UpdatePayload = {
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

export async function GET() {
  try {
    const goals = await getOverlayGoalsState();
    return NextResponse.json({ goals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown overlay goals error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UpdatePayload;
    const goals = await updateOverlayGoalsState({
      likeGoalTarget: body.likeGoalTarget,
      donationGoalTarget: body.donationGoalTarget,
      showLikeGoal: body.showLikeGoal,
      showDonationGoal: body.showDonationGoal,
      autoLikeEnabled: body.autoLikeEnabled,
      autoLikeEveryLikes: body.autoLikeEveryLikes,
      autoLikeTriggerWithin: body.autoLikeTriggerWithin,
      autoLikeTextTemplate: body.autoLikeTextTemplate,
      autoLikeSubtextTemplate: body.autoLikeSubtextTemplate,
      autoLikeShowProgress: body.autoLikeShowProgress,
      updatedBy: body.updatedBy,
    });
    return NextResponse.json({ goals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown overlay goals update error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
