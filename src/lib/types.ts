import {
  AppConfig,
  ExperimentReport,
  Insight,
  Recommendation,
  RecommendationStatus,
  SyncEvent,
  SpotifyTrack,
  StrategyPattern,
  TikTokLiveComment,
  TikTokLiveGift,
  TikTokLiveSample,
  TikTokLiveSession,
  TikTokVideo,
} from "@prisma/client";

export type DashboardState = {
  config: AppConfig;
  tiktokVideos: TikTokVideo[];
  spotifyTracks: SpotifyTrack[];
  recommendations: Recommendation[];
  experiments: (ExperimentReport & {
    recommendation: Recommendation | null;
  })[];
  insights: Insight[];
  patterns: StrategyPattern[];
  latestSyncEvents: SyncEvent[];
  liveSessions: (TikTokLiveSession & {
    samples: TikTokLiveSample[];
    comments: TikTokLiveComment[];
    gifts: TikTokLiveGift[];
  })[];
  metrics: {
    avgViews: number;
    avgEngagementRate: number;
    avgSpotifyDelta: number;
    testedIdeas: number;
    activeRecommendations: number;
  };
};

export type LiveDashboardState = {
  config: AppConfig;
  latestSyncEvents: SyncEvent[];
  spotifyTracks: SpotifyTrack[];
  liveSessions: (TikTokLiveSession & {
    samples: TikTokLiveSample[];
    comments: TikTokLiveComment[];
    gifts: TikTokLiveGift[];
  })[];
};

export type RecommendationDraft = {
  ideaTitle: string;
  postFormat: string;
  hook: string;
  caption: string;
  shotPlan: string;
  editingNotes: string;
  patternKey: string;
  rationale: string;
  confidence: number;
  expectedSpotifyLift: number;
  expectedViews: number;
  expectedSaveRate: number;
  songSpotifyId?: string;
  songName?: string;
  songSegmentStartSec?: number;
  songSegmentLengthSec?: number;
};

export type ExperimentMetrics = {
  hoursSincePost?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  watchTimeSec?: number;
  completionRate?: number;
  profileVisits?: number;
  linkClicks?: number;
  spotifyStreamsDelta?: number;
};

export type ExperimentAnalysis = {
  summary: string;
  whatWorked: string[];
  whatFailed: string[];
  nextActions: string[];
  patternKey?: string;
  score: number;
  spotifyLiftEstimate: number;
};

export type SyncResult = {
  provider: "tiktok" | "spotify";
  count: number;
  warnings: string[];
};

export type RecommendationStatusValue = RecommendationStatus;

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

export type OverlayGoalsState = {
  likeGoalTarget: number;
  donationGoalTarget: number;
  showLikeGoal: boolean;
  showDonationGoal: boolean;
  autoLikeEnabled: boolean;
  autoLikeEveryLikes: number;
  autoLikeTriggerWithin: number;
  autoLikeTextTemplate: string;
  autoLikeSubtextTemplate: string;
  autoLikeShowProgress: boolean;
  updatedAt: string;
  updatedBy: string;
};
