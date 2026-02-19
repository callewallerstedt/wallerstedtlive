import OpenAI from "openai";
import {
  Insight,
  Recommendation,
  SpotifyTrack,
  StrategyPattern,
  TikTokVideo,
} from "@prisma/client";
import { z } from "zod";

import { ExperimentAnalysis, ExperimentMetrics, RecommendationDraft } from "@/lib/types";
import { TrendSignals } from "@/lib/trends";

const recommendationSchema = z.object({
  recommendations: z
    .array(
      z.object({
        ideaTitle: z.string().min(3),
        postFormat: z.string().min(3),
        hook: z.string().min(3),
        caption: z.string().min(1),
        shotPlan: z.string().min(3),
        editingNotes: z.string().min(3),
        patternKey: z.string().min(2),
        rationale: z.string().min(3),
        confidence: z.number().min(0).max(1),
        expectedSpotifyLift: z.number().min(0).max(1),
        expectedViews: z.number().int().min(0),
        expectedSaveRate: z.number().min(0).max(1),
        songSpotifyId: z.string().optional(),
        songName: z.string().optional(),
        songSegmentStartSec: z.number().int().min(0).optional(),
        songSegmentLengthSec: z.number().int().min(5).max(45).optional(),
      })
    )
    .min(1),
});

const analysisSchema = z.object({
  summary: z.string(),
  whatWorked: z.array(z.string()),
  whatFailed: z.array(z.string()),
  nextActions: z.array(z.string()),
  patternKey: z.string().optional(),
  score: z.number().min(0).max(1),
  spotifyLiftEstimate: z.number().min(0).max(1),
});

const SIMPLE_CAPTION_POOL = [
  "this belongs in a movie scene",
  "i can't stop playing this",
  "pause for a second",
  "stop scrolling",
  "hey, you. take a break from scrolling",
  "what does this melody remind you of?",
  "how does this make you feel?",
  "close your eyes and take a deep breath.",
  "should i finish this?",
  "it's gonna be okay...",
  "this melody feels like peace",
  "this melody reminds me of home",
];

const HOOK_POOL = [
  "stop scrolling for 9 seconds",
  "take a breath and listen",
  "this is your pause moment",
  "one melody, one minute of calm",
  "if this hits, save it",
  "what memory does this unlock?",
];

function asString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreTrackForStrategy(track: SpotifyTrack, recentSongUsage: Record<string, number>): number {
  const usagePenalty = (recentSongUsage[track.spotifyId] ?? 0) * 0.85;
  const popularityScore = (track.popularity ?? 0) / 100;
  const ownershipScore = (track.isOwnedByYou ? 1.2 : 0) + (track.ownershipShare ?? 0.5);
  return ownershipScore + popularityScore - usagePenalty;
}

function rankTracksForStrategy(
  tracks: SpotifyTrack[],
  recentSongUsage: Record<string, number>
): SpotifyTrack[] {
  return tracks
    .slice()
    .sort((a, b) => scoreTrackForStrategy(b, recentSongUsage) - scoreTrackForStrategy(a, recentSongUsage));
}

function sanitizeCaption(rawCaption: string, index: number): string {
  const cleaned = rawCaption
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 68);
  const lowered = cleaned.toLowerCase();
  const bannedPatterns = ["pov", "cinematic masterpiece", "this will make you cry", "soulmate"];

  const isSimpleEnough =
    cleaned.length >= 4 &&
    cleaned.length <= 68 &&
    cleaned.split(" ").length <= 11 &&
    !bannedPatterns.some((pattern) => lowered.includes(pattern));

  if (isSimpleEnough) {
    return cleaned;
  }
  return SIMPLE_CAPTION_POOL[index % SIMPLE_CAPTION_POOL.length];
}

function sanitizeHook(rawHook: string, index: number): string {
  const cleaned = rawHook.replace(/\s+/g, " ").trim().slice(0, 64);
  if (cleaned.length >= 6 && cleaned.split(" ").length <= 12) {
    return cleaned;
  }
  return HOOK_POOL[index % HOOK_POOL.length];
}

function normalizeShotPlan(rawShotPlan: string, startSec: number): string {
  const cleaned = rawShotPlan.replace(/\s+/g, " ").trim();
  if (cleaned.includes("1.") && cleaned.includes("2.")) {
    return cleaned;
  }

  return [
    "1. 0.0s-0.8s: candle close-up and immediate first note.",
    "2. 0.8s-4.0s: tight right-hand keys shot, no cutaways.",
    `3. 4.0s-9.0s: jump to song at ${startSec}s and show both hands.`,
    "4. 9.0s-end: wide frame + soft eye contact + final sustain.",
    "5. Pin comment with direct Spotify CTA in first 60 seconds.",
  ].join(" ");
}

function enforceSongDiversity(
  drafts: RecommendationDraft[],
  rankedTracks: SpotifyTrack[],
  recentSongUsage: Record<string, number>,
  count: number
): RecommendationDraft[] {
  if (rankedTracks.length === 0) {
    return drafts.slice(0, count).map((draft, index) => ({
      ...draft,
      caption: sanitizeCaption(draft.caption, index),
      hook: sanitizeHook(draft.hook, index),
      shotPlan: normalizeShotPlan(draft.shotPlan, draft.songSegmentStartSec ?? 12),
    }));
  }

  const trackMap = new Map(rankedTracks.map((track) => [track.spotifyId, track]));
  const usedInBatch = new Set<string>();

  return drafts.slice(0, count).map((draft, index) => {
    const selectedId = draft.songSpotifyId ?? "";
    let selectedTrack = selectedId ? trackMap.get(selectedId) : undefined;

    const shouldReplace =
      !selectedTrack ||
      usedInBatch.has(selectedTrack.spotifyId) ||
      (recentSongUsage[selectedTrack.spotifyId] ?? 0) >= 2;

    if (shouldReplace) {
      selectedTrack =
        rankedTracks.find((track) => !usedInBatch.has(track.spotifyId)) ??
        rankedTracks[index % rankedTracks.length];
    }

    if (selectedTrack) {
      usedInBatch.add(selectedTrack.spotifyId);
    }

    const songSegmentStartSec =
      draft.songSegmentStartSec ??
      Math.max(4, Math.min(45, Math.round((selectedTrack?.durationMs ?? 60_000) / 2000)));

    return {
      ...draft,
      songSpotifyId: selectedTrack?.spotifyId ?? draft.songSpotifyId,
      songName: selectedTrack?.name ?? draft.songName,
      songSegmentStartSec,
      songSegmentLengthSec: draft.songSegmentLengthSec ?? 14,
      caption: sanitizeCaption(draft.caption, index),
      hook: sanitizeHook(draft.hook, index),
      shotPlan: normalizeShotPlan(draft.shotPlan, songSegmentStartSec),
    };
  });
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output.");
  }
  const candidate = text.slice(start, end + 1);
  return JSON.parse(candidate);
}

function getClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

function modelName() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.2";
}

function heuristicsFallbackRecommendations(
  tracks: SpotifyTrack[],
  tiktokVideos: TikTokVideo[],
  count: number,
  recentSongUsage: Record<string, number>
): RecommendationDraft[] {
  const topTracks = rankTracksForStrategy(tracks, recentSongUsage).slice(0, Math.max(1, count));
  const topKeywords = tiktokVideos
    .slice(0, 12)
    .flatMap((video) => video.description.split(/\s+/))
    .map((word) => word.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((word) => word.length > 4);

  const moodToken = topKeywords.find((word) => ["night", "dark", "rain", "alone", "study", "sad"].includes(word))
    ?? "candlelit";

  const drafts = topTracks.map((track, index) => ({
    ideaTitle: `${track.name} - ${moodToken} study reel ${index + 1}`,
    postFormat: "9-15s vertical piano clip with candle focus and fast first-second hook",
    hook: HOOK_POOL[index % HOOK_POOL.length],
    caption: SIMPLE_CAPTION_POOL[index % SIMPLE_CAPTION_POOL.length],
    shotPlan:
      "Open with candle flare in first 0.8s, hard cut to keys at beat drop, add one glance to camera near 6s, end on sustain pedal closeup.",
    editingNotes:
      "Subtle film grain, desaturate by 10%, keep contrast high, text on screen for first 2 seconds only.",
    patternKey: "candle-closeup-drops",
    rationale: "Fits your dark academia visual identity and short emotional hooks that historically drive rewatches.",
    confidence: 0.62,
    expectedSpotifyLift: 0.48,
    expectedViews: 45_000 + index * 7_000,
    expectedSaveRate: 0.07,
    songSpotifyId: track.spotifyId,
    songName: track.name,
    songSegmentStartSec: 12 + index * 3,
    songSegmentLengthSec: 14,
  }));

  return enforceSongDiversity(drafts, topTracks, recentSongUsage, count);
}

function normalizeRecommendation(
  raw: unknown,
  index: number,
  tracks: SpotifyTrack[]
): RecommendationDraft | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;
  const defaultTrack = tracks[index % Math.max(1, tracks.length)];
  const rawSongId = asString(data.songSpotifyId ?? data.trackId ?? data.spotifyId, defaultTrack?.spotifyId ?? "");
  const matchedTrack =
    tracks.find((track) => track.spotifyId === rawSongId) ||
    tracks.find((track) => track.name.toLowerCase() === asString(data.songName, "").toLowerCase()) ||
    defaultTrack;
  const songName = asString(
    data.songName ?? data.song ?? data.trackName,
    matchedTrack?.name ?? `Wallerstedt track ${index + 1}`
  );
  const ideaTitle = asString(data.ideaTitle ?? data.title ?? data.headline, `${songName} dark-academia concept`);
  const postFormat = asString(
    data.postFormat ?? data.format ?? data.videoFormat,
    "Cinematic vertical piano reel with candle, 9-15 second emotional arc"
  );
  const hook = asString(
    data.hook ?? data.openingHook ?? data.introText,
    HOOK_POOL[index % HOOK_POOL.length]
  );
  const caption = asString(
    data.caption ?? data.titleCaption ?? data.postCaption,
    SIMPLE_CAPTION_POOL[index % SIMPLE_CAPTION_POOL.length]
  );
  const shotPlan = asString(
    data.shotPlan ?? data.shots ?? data.visualPlan,
    "0-1s candle flare, 1-6s right-hand closeup, 6-11s wide keys, final sustain closeup."
  );
  const editingNotes = asString(
    data.editingNotes ?? data.editing ?? data.postProduction,
    "High contrast, subtle grain, text only in first 2 seconds."
  );
  const patternKey = asString(data.patternKey ?? data.pattern ?? data.templateKey, "candle-closeup-drops");
  const rationale = asString(
    data.rationale ?? data.reasoning ?? data.why,
    "Aligns with emotional neoclassical identity and pushes song discovery behavior."
  );
  const confidence = clamp(asNumber(data.confidence, 0.62), 0, 1);
  const expectedSpotifyLift = clamp(asNumber(data.expectedSpotifyLift ?? data.spotifyLift, 0.45), 0, 1);
  const expectedViews = Math.max(0, Math.round(asNumber(data.expectedViews ?? data.viewsTarget, 45000)));
  const expectedSaveRate = clamp(asNumber(data.expectedSaveRate ?? data.saveRateTarget, 0.07), 0, 1);
  const songSegmentStartSec = Math.max(0, Math.round(asNumber(data.songSegmentStartSec ?? data.startSec, 12)));
  const songSegmentLengthSec = Math.max(
    5,
    Math.min(45, Math.round(asNumber(data.songSegmentLengthSec ?? data.segmentLengthSec, 14)))
  );

  return {
    ideaTitle,
    postFormat,
    hook,
    caption,
    shotPlan,
    editingNotes,
    patternKey,
    rationale,
    confidence,
    expectedSpotifyLift,
    expectedViews,
    expectedSaveRate,
    songSpotifyId: (matchedTrack?.spotifyId ?? rawSongId) || undefined,
    songName,
    songSegmentStartSec,
    songSegmentLengthSec,
  };
}

function parseRecommendationCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const asObject = payload as Record<string, unknown>;
    if (Array.isArray(asObject.recommendations)) {
      return asObject.recommendations;
    }
    if (Array.isArray(asObject.ideas)) {
      return asObject.ideas;
    }
  }
  return [];
}

export async function generateRecommendations(params: {
  apiKey?: string;
  objective: string;
  count: number;
  tiktokVideos: TikTokVideo[];
  spotifyTracks: SpotifyTrack[];
  patterns: StrategyPattern[];
  insights: Insight[];
  trendSignals?: TrendSignals;
  recentSongUsage: Record<string, number>;
}): Promise<RecommendationDraft[]> {
  const {
    apiKey,
    count,
    tiktokVideos,
    spotifyTracks,
    objective,
    patterns,
    insights,
    trendSignals,
    recentSongUsage,
  } = params;
  const rankedTracks = rankTracksForStrategy(spotifyTracks, recentSongUsage);

  if (!apiKey) {
    return heuristicsFallbackRecommendations(rankedTracks, tiktokVideos, count, recentSongUsage).slice(0, count);
  }

  const client = getClient(apiKey);
  const topTikTok = tiktokVideos
    .slice(0, 18)
    .map((video) => ({
      description: video.description.slice(0, 120),
      views: video.views,
      likes: video.likes,
      shares: video.shares,
      saves: video.saves,
      musicTitle: video.musicTitle,
    }));
  const tracks = rankedTracks.slice(0, 40).map((track) => ({
    spotifyId: track.spotifyId,
    name: track.name,
    popularity: track.popularity,
    durationMs: track.durationMs,
    isOwnedByYou: track.isOwnedByYou,
    ownershipShare: track.ownershipShare,
    albumLabel: track.albumLabel,
    recentUsageCount: recentSongUsage[track.spotifyId] ?? 0,
  }));
  const memory = insights.slice(0, 14).map((insight) => `${insight.title}: ${insight.action}`);
  const patternStats = patterns.map((pattern) => ({
    key: pattern.key,
    avgScore: pattern.avgScore,
    attempts: pattern.attempts,
  }));

  const prompt = [
    "You are a TikTok growth strategist for an emotional neoclassical pianist with 1M followers.",
    `Primary goal: ${objective}. Secondary: views and retention.`,
    `Generate ${count} specific post ideas optimized to increase Spotify streams.`,
    "Output strict JSON only with this shape: {\"recommendations\":[...]} and no extra text.",
    "Each idea must include a concrete hook, caption, song segment timing, and tactical rationale.",
    "Caption style rules: simple, short, direct, non-cheesy, lower-case is fine, 2-11 words.",
    "Do not use overdramatic or cringe phrasing. Avoid cliches.",
    `Allowed caption style examples: ${JSON.stringify(SIMPLE_CAPTION_POOL)}`,
    "Shot plan must be tactical and exact with clear timing and camera actions.",
    "Use patternKey labels that can be reused to track performance.",
    "If possible, prioritize songs from provided spotifyTracks with spotifyId and name.",
    "Strongly prefer songs where isOwnedByYou=true and ownershipShare is highest.",
    "Do not repeat the same song in this recommendation set unless no alternatives exist.",
    `Top TikTok history: ${JSON.stringify(topTikTok)}`,
    `Spotify tracks: ${JSON.stringify(tracks)}`,
    `Pattern memory: ${JSON.stringify(patternStats)}`,
    `Recent lessons: ${JSON.stringify(memory)}`,
    `Current TikTok trend signals: ${JSON.stringify(trendSignals ?? { topSounds: [], topHashtags: [] })}`,
  ].join("\n");

  const response = await client.responses.create({
    model: modelName(),
    input: prompt,
    reasoning: { effort: "medium" },
    max_output_tokens: 2200,
  });

  const fallback = heuristicsFallbackRecommendations(rankedTracks, tiktokVideos, count, recentSongUsage).slice(
    0,
    count
  );

  try {
    const strict = recommendationSchema.safeParse(extractJson(response.output_text ?? ""));
    if (strict.success) {
      return enforceSongDiversity(
        strict.data.recommendations.slice(0, count),
        rankedTracks,
        recentSongUsage,
        count
      );
    }
  } catch {
    // Continue to relaxed parser.
  }

  try {
    const rawPayload = extractJson(response.output_text ?? "");
    const candidates = parseRecommendationCandidates(rawPayload);
    const normalized = candidates
      .map((item, index) => normalizeRecommendation(item, index, spotifyTracks))
      .filter((item): item is RecommendationDraft => Boolean(item))
      .slice(0, count);

    return normalized.length > 0
      ? enforceSongDiversity(normalized, rankedTracks, recentSongUsage, count)
      : fallback;
  } catch {
    return fallback;
  }
}

function fallbackAnalysis(metrics: ExperimentMetrics): ExperimentAnalysis {
  const views = metrics.views ?? 0;
  const engagement =
    views > 0
      ? ((metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.shares ?? 0) + (metrics.saves ?? 0)) / views
      : 0;

  return {
    summary:
      engagement >= 0.08
        ? "Strong engagement quality. Double down on this visual/audio pattern."
        : "Reach or retention under target. Tighten hook timing in first second and simplify caption CTA.",
    whatWorked: engagement >= 0.08 ? ["Audience interaction quality was healthy."] : [],
    whatFailed:
      engagement < 0.08 ? ["Engagement per view was below target for a 1M account."] : ["No critical failure detected."],
    nextActions: [
      "Test a 7-9 second version with immediate melody hook.",
      "Pin comment with explicit Spotify CTA tied to mood.",
      "Reuse the same song section once with stronger opening visual contrast.",
    ],
    patternKey: "auto-fallback",
    score: Math.min(1, Math.max(0.2, engagement * 7)),
    spotifyLiftEstimate: metrics.spotifyStreamsDelta && metrics.spotifyStreamsDelta > 0 ? 0.55 : 0.3,
  };
}

export async function analyzeExperiment(params: {
  apiKey?: string;
  recommendation: Recommendation | null;
  metrics: ExperimentMetrics;
  notes?: string;
  imageDataUrl?: string;
  recentInsights: Insight[];
}): Promise<ExperimentAnalysis> {
  const { apiKey, recommendation, metrics, notes, imageDataUrl, recentInsights } = params;
  if (!apiKey) {
    return fallbackAnalysis(metrics);
  }

  const client = getClient(apiKey);
  const contextText = [
    recommendation
      ? `Recommendation context: ${recommendation.ideaTitle}; hook=${recommendation.hook}; caption=${recommendation.caption}; pattern=${recommendation.patternKey}`
      : "No linked recommendation provided.",
    `Current metrics: ${JSON.stringify(metrics)}`,
    `Creator notes: ${notes ?? ""}`,
    `Recent memory: ${JSON.stringify(recentInsights.slice(0, 8).map((item) => `${item.title}: ${item.action}`))}`,
    "Return strict JSON with keys: summary, whatWorked[], whatFailed[], nextActions[], patternKey, score(0-1), spotifyLiftEstimate(0-1).",
  ].join("\n");

  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" }
  > = [
    {
      type: "input_text",
      text: contextText,
    },
  ];

  if (imageDataUrl) {
    userContent.push({
      type: "input_image",
      image_url: imageDataUrl,
      detail: "auto",
    });
  }

  const response = await client.responses.create({
    model: modelName(),
    input: [
      {
        role: "user",
        content: userContent,
      },
    ],
    reasoning: { effort: "medium" },
    max_output_tokens: 1300,
  });

  return analysisSchema.parse(extractJson(response.output_text ?? ""));
}
