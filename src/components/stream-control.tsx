"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { LiveDashboardState, OverlayGoalsState, StreamOverlayMode, StreamOverlayState } from "@/lib/types";

type Toast = { type: "success" | "error" | "info"; text: string };
type OverlayUpdatePayload = { mode?: StreamOverlayMode; title?: string; subtitle?: string; accentColor?: string; mediaImageUrl?: string; updatedBy?: string };
type GoalsUpdatePayload = {
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
type YouTubeResult = { videoId: string; title: string; channelTitle: string; viewCountText: string | null; embedUrl: string };
type ChartPoint = { label: string; value: number };
type ChartPlotPoint = ChartPoint & { x: number; y: number };
type PanelId = "player" | "songs" | "donors" | "goals" | "ctas" | "custom" | "monitor";
type CtaPresetKey = "spotify" | "follow" | "share" | "request" | "support";
type CtaPresetConfig = { key: CtaPresetKey; label: string; title: string; subtitle: string; accentColor: string };

const accentByMode: Record<Exclude<StreamOverlayMode, "hidden">, string> = {
  spotify_cta: "#22c55e",
  now_playing: "#f59e0b",
  comment: "#38bdf8",
  thank_you: "#f97316",
  custom: "#a78bfa",
};

const ctaOrder: CtaPresetKey[] = ["spotify", "follow", "share", "request", "support"];

const defaultCtaPresets: CtaPresetConfig[] = [
  { key: "spotify", label: "Spotify CTA", title: "Listen on Spotify", subtitle: 'Search "{artist}" on Spotify', accentColor: "#22c55e" },
  { key: "follow", label: "Follow CTA", title: "Follow For More", subtitle: "Tap follow so you never miss the next live set.", accentColor: "#38bdf8" },
  { key: "share", label: "Share CTA", title: "Share This Live", subtitle: "Send this stream to one friend right now.", accentColor: "#f59e0b" },
  { key: "request", label: "Song Request CTA", title: "Song Requests Open", subtitle: "Drop your request in chat and I will queue it.", accentColor: "#22c55e" },
  { key: "support", label: "Support CTA", title: "Support The Music", subtitle: "Gifts and shares help keep these lives going.", accentColor: "#f97316" },
];

const DIAMOND_TO_SEK_RATE = 0.055;
const MONITOR_CHART_WIDTH = 760;
const MONITOR_CHART_HEIGHT = 190;
const MONITOR_CHART_PADDING = 20;

function defaultCtaPresetByKey(key: CtaPresetKey): CtaPresetConfig {
  const preset = defaultCtaPresets.find((item) => item.key === key);
  if (!preset) {
    throw new Error(`Missing CTA preset default for key: ${key}`);
  }
  return preset;
}

function isCtaKey(value: string): value is CtaPresetKey {
  return ctaOrder.includes(value as CtaPresetKey);
}

function safeAccent(value: string, fallback = "#22c55e"): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function normalizeCtaPreset(input: Partial<CtaPresetConfig> & { key: CtaPresetKey }): CtaPresetConfig {
  return {
    key: input.key,
    label: (input.label ?? "").trim().slice(0, 40) || `${input.key.toUpperCase()} CTA`,
    title: (input.title ?? "").trim().slice(0, 140),
    subtitle: (input.subtitle ?? "").trim().slice(0, 320),
    accentColor: safeAccent(input.accentColor ?? "#22c55e"),
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "");
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(" ").map((token) => token.trim()).filter((token) => token.length >= 2);
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseOverlayState(payload: unknown): StreamOverlayState | null {
  const root = asRecord(payload);
  const state = asRecord(root?.state);
  if (!state) {
    return null;
  }
  const mode = typeof state.mode === "string" ? state.mode : "hidden";
  if (!["hidden", "spotify_cta", "now_playing", "comment", "thank_you", "custom"].includes(mode)) {
    return null;
  }
  return {
    mode: mode as StreamOverlayMode,
    title: typeof state.title === "string" ? state.title : "",
    subtitle: typeof state.subtitle === "string" ? state.subtitle : "",
    accentColor: typeof state.accentColor === "string" ? state.accentColor : "#f59e0b",
    mediaImageUrl: typeof state.mediaImageUrl === "string" ? state.mediaImageUrl : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date(0).toISOString(),
    updatedBy: typeof state.updatedBy === "string" ? state.updatedBy : "system",
  };
}

function parseGoalTarget(value: unknown, fallback: number): number {
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

function parseGoalThreshold(value: unknown, fallback: number): number {
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

function parseOverlayGoals(payload: unknown): OverlayGoalsState | null {
  const root = asRecord(payload);
  const goals = asRecord(root?.goals);
  if (!goals) {
    return null;
  }
  return {
    likeGoalTarget: parseGoalTarget(goals.likeGoalTarget, 10000),
    donationGoalTarget: parseGoalTarget(goals.donationGoalTarget, 2000),
    showLikeGoal: Boolean(goals.showLikeGoal),
    showDonationGoal: Boolean(goals.showDonationGoal),
    autoLikeEnabled: Boolean(goals.autoLikeEnabled),
    autoLikeEveryLikes: parseGoalTarget(goals.autoLikeEveryLikes, 1000),
    autoLikeTriggerWithin: parseGoalThreshold(goals.autoLikeTriggerWithin, 200),
    autoLikeTextTemplate: typeof goals.autoLikeTextTemplate === "string" && goals.autoLikeTextTemplate.trim() ? goals.autoLikeTextTemplate.trim().slice(0, 180) : "We're almost at {target} likes!!",
    autoLikeSubtextTemplate: typeof goals.autoLikeSubtextTemplate === "string" && goals.autoLikeSubtextTemplate.trim() ? goals.autoLikeSubtextTemplate.trim().slice(0, 180) : "{remaining} likes to go",
    autoLikeShowProgress: goals.autoLikeShowProgress !== false,
    updatedAt: typeof goals.updatedAt === "string" ? goals.updatedAt : new Date(0).toISOString(),
    updatedBy: typeof goals.updatedBy === "string" ? goals.updatedBy : "system",
  };
}

function pointsToPolyline(points: ChartPoint[], width: number, height: number, padding: number): string {
  if (points.length === 0) {
    return "";
  }
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const xStep = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  return points.map((point, index) => {
    const x = padding + index * xStep;
    const y = height - padding - (point.value / maxValue) * innerHeight;
    return `${x},${y}`;
  }).join(" ");
}

function pointsToChartCoords(points: ChartPoint[], width: number, height: number, padding: number): ChartPlotPoint[] {
  if (points.length === 0) {
    return [];
  }
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const xStep = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  return points.map((point, index) => {
    const x = padding + index * xStep;
    const y = height - padding - (point.value / maxValue) * innerHeight;
    return { ...point, x, y };
  });
}

function pointsToAreaPath(points: ChartPlotPoint[], height: number, padding: number): string {
  if (points.length === 0) {
    return "";
  }
  const baseY = height - padding;
  const first = points[0];
  const last = points[points.length - 1];
  const lineSegments = points.map((point) => `L ${point.x} ${point.y}`).join(" ");
  return `M ${first.x} ${baseY} ${lineSegments} L ${last.x} ${baseY} Z`;
}

type MonitorTrendChartProps = {
  title: string;
  summary: string;
  points: ChartPoint[];
  strokeColor: string;
  gradientId: string;
  valueUnit: string;
};

function MonitorTrendChart({ title, summary, points, strokeColor, gradientId, valueUnit }: MonitorTrendChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<ChartPlotPoint | null>(null);
  const polyline = useMemo(
    () => pointsToPolyline(points, MONITOR_CHART_WIDTH, MONITOR_CHART_HEIGHT, MONITOR_CHART_PADDING),
    [points]
  );
  const chartPoints = useMemo(
    () => pointsToChartCoords(points, MONITOR_CHART_WIDTH, MONITOR_CHART_HEIGHT, MONITOR_CHART_PADDING),
    [points]
  );
  const areaPath = useMemo(
    () => pointsToAreaPath(chartPoints, MONITOR_CHART_HEIGHT, MONITOR_CHART_PADDING),
    [chartPoints]
  );
  const maxValue = useMemo(() => {
    if (points.length === 0) {
      return 0;
    }
    return Math.max(...points.map((point) => point.value));
  }, [points]);
  const gridLines = useMemo(() => {
    const max = Math.max(1, maxValue);
    return [1, 0.75, 0.5, 0.25, 0].map((ratio) => {
      const y = MONITOR_CHART_PADDING + (1 - ratio) * (MONITOR_CHART_HEIGHT - MONITOR_CHART_PADDING * 2);
      return { y, value: Math.round(max * ratio) };
    });
  }, [maxValue]);
  const activeHoveredPoint = hoveredPoint && chartPoints.some((point) => point.label === hoveredPoint.label && point.value === hoveredPoint.value)
    ? hoveredPoint
    : null;

  return (
    <article className="rounded-xl border border-stone-700 bg-stone-900/95 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">{title}</p>
          <p className="mt-1 text-sm text-stone-300">{summary}</p>
        </div>
        {activeHoveredPoint ? (
          <p className="text-right text-xs text-amber-200">
            {activeHoveredPoint.label}
            <br />
            {activeHoveredPoint.value.toLocaleString()} {valueUnit}
          </p>
        ) : (
          <p className="text-xs text-stone-500">Tap points for exact values</p>
        )}
      </div>

      {points.length === 0 ? (
        <p className="mt-4 text-sm text-stone-400">No samples yet.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-stone-700/70 bg-stone-950/70 p-2">
          <svg viewBox={`0 0 ${MONITOR_CHART_WIDTH} ${MONITOR_CHART_HEIGHT}`} className="h-[180px] w-full md:h-[220px]">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0.04" />
              </linearGradient>
            </defs>
            {gridLines.map((line) => (
              <g key={`${title}-${line.y}`}>
                <line x1={MONITOR_CHART_PADDING} y1={line.y} x2={MONITOR_CHART_WIDTH - MONITOR_CHART_PADDING} y2={line.y} stroke="#292524" strokeDasharray="4 6" />
                <text x={MONITOR_CHART_PADDING + 6} y={line.y - 4} fill="#a8a29e" fontSize="9">
                  {formatCompactNumber(line.value)}
                </text>
              </g>
            ))}
            <line x1={MONITOR_CHART_PADDING} y1={MONITOR_CHART_HEIGHT - MONITOR_CHART_PADDING} x2={MONITOR_CHART_WIDTH - MONITOR_CHART_PADDING} y2={MONITOR_CHART_HEIGHT - MONITOR_CHART_PADDING} stroke="#57534e" />
            <line x1={MONITOR_CHART_PADDING} y1={MONITOR_CHART_PADDING} x2={MONITOR_CHART_PADDING} y2={MONITOR_CHART_HEIGHT - MONITOR_CHART_PADDING} stroke="#57534e" />
            {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
            <polyline fill="none" stroke={strokeColor} strokeWidth="3" points={polyline} />
            {chartPoints.map((point, index) => (
              <circle
                key={`${title}-${point.label}-${index}`}
                cx={point.x}
                cy={point.y}
                r={8}
                fill="transparent"
                onMouseEnter={() => setHoveredPoint(point)}
                onMouseLeave={() => setHoveredPoint(null)}
                onTouchStart={() => setHoveredPoint(point)}
                onClick={() => setHoveredPoint(point)}
              >
                <title>{`${point.label}: ${point.value.toLocaleString()} ${valueUnit}`}</title>
              </circle>
            ))}
            {activeHoveredPoint ? (
              <g transform={`translate(${Math.min(615, activeHoveredPoint.x + 10)},${Math.max(20, activeHoveredPoint.y - 38)})`}>
                <rect x="0" y="0" width="138" height="40" rx="8" fill="rgba(9,9,11,0.95)" stroke="#78716c" />
                <text x="8" y="15" fill="#fde68a" fontSize="10">{activeHoveredPoint.label}</text>
                <text x="8" y="30" fill="#f5f5f4" fontSize="11">{activeHoveredPoint.value.toLocaleString()} {valueUnit}</text>
              </g>
            ) : null}
          </svg>
        </div>
      )}
    </article>
  );
}

function findTrackForComment(comment: string, tracks: LiveDashboardState["spotifyTracks"]) {
  const normalizedComment = normalizeText(comment);
  if (!normalizedComment) {
    return null;
  }
  const commentTokens = new Set(tokenize(comment));
  let best: { score: number; track: LiveDashboardState["spotifyTracks"][number] } | null = null;

  for (const track of tracks) {
    const normalizedTrack = normalizeText(track.name);
    if (!normalizedTrack) {
      continue;
    }
    let score = 0;
    const hasExactTrackMention = normalizedComment.includes(normalizedTrack);
    if (hasExactTrackMention) {
      score += 120 + Math.min(40, normalizedTrack.length);
    }
    if (normalizedTrack.includes(normalizedComment) && normalizedComment.length >= 4) {
      score += 45;
    }
    for (const token of tokenize(track.name)) {
      if (commentTokens.has(token)) {
        score += Math.min(12, token.length);
      }
    }
    if (track.isOwnedByYou && hasExactTrackMention) {
      score += 4;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { score, track };
    }
  }

  if (!best || best.score < 16) {
    return null;
  }
  return best.track;
}

function toYouTubePlayerSrc(embedUrl: string, cacheBust: number): string {
  try {
    const url = new URL(embedUrl);
    url.searchParams.set("rel", "0");
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("controls", "1");
    url.searchParams.set("enablejsapi", "1");
    if (typeof window !== "undefined") {
      url.searchParams.set("origin", window.location.origin);
    }
    url.searchParams.set("cb", cacheBust.toString());
    return url.toString();
  } catch {
    return `${embedUrl}?cb=${cacheBust}`;
  }
}

export function StreamControl() {
  const [liveState, setLiveState] = useState<LiveDashboardState | null>(null);
  const [overlayState, setOverlayState] = useState<StreamOverlayState | null>(null);
  const [overlayGoals, setOverlayGoals] = useState<OverlayGoalsState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [songFilter, setSongFilter] = useState("");
  const [testComment, setTestComment] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customSubtitle, setCustomSubtitle] = useState("");
  const [quickSnapshot, setQuickSnapshot] = useState<{ isLive: boolean; viewerCount: number; likeCount: number; enterCount: number } | null>(null);
  const [youtubeResult, setYoutubeResult] = useState<YouTubeResult | null>(null);
  const [youtubeCandidates, setYoutubeCandidates] = useState<YouTubeResult[]>([]);
  const [isResolvingYoutube, setIsResolvingYoutube] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [playerLabel, setPlayerLabel] = useState("");
  const [youtubeEmbedNonce, setYoutubeEmbedNonce] = useState(0);
  const [activePanel, setActivePanel] = useState<PanelId>("player");
  const [lastTrackedHandle, setLastTrackedHandle] = useState("");
  const [ctaPresets, setCtaPresets] = useState<CtaPresetConfig[]>(defaultCtaPresets);
  const [ctaDrafts, setCtaDrafts] = useState<Record<string, CtaPresetConfig>>(() =>
    defaultCtaPresets.reduce<Record<string, CtaPresetConfig>>((acc, preset) => {
      acc[preset.key] = preset;
      return acc;
    }, {})
  );
  const [savingCtaKey, setSavingCtaKey] = useState<CtaPresetKey | null>(null);
  const [albumCoverBySpotifyId, setAlbumCoverBySpotifyId] = useState<Record<string, string>>({});
  const [albumModalKey, setAlbumModalKey] = useState<string | null>(null);
  const [isCtaEditMode, setIsCtaEditMode] = useState(false);
  const [likeGoalInput, setLikeGoalInput] = useState("10000");
  const [donationGoalInput, setDonationGoalInput] = useState("2000");
  const [autoLikeEveryInput, setAutoLikeEveryInput] = useState("1000");
  const [autoLikeWithinInput, setAutoLikeWithinInput] = useState("200");
  const [autoLikeTextInput, setAutoLikeTextInput] = useState("We're almost at {target} likes!!");
  const [autoLikeSubtextInput, setAutoLikeSubtextInput] = useState("{remaining} likes to go");
  const [autoLikeShowProgressInput, setAutoLikeShowProgressInput] = useState(true);
  const [isSavingGoals, setIsSavingGoals] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [leftPanePercent, setLeftPanePercent] = useState(34);
  const [isResizingPanes, setIsResizingPanes] = useState(false);
  const resizeRafRef = useRef<number | null>(null);
  const pendingPanePercentRef = useRef<number | null>(null);
  const isCoverFetchInFlightRef = useRef(false);
  const isOverlayRefreshInFlightRef = useRef(false);
  const isLiveRefreshInFlightRef = useRef(false);
  const isGoalsRefreshInFlightRef = useRef(false);
  const goalsInitializedRef = useRef(false);
  const usernameInputFocusedRef = useRef(false);
  const usernameRef = useRef("");
  const lastTrackedHandleRef = useRef("");
  const isOverlayUpdatePendingRef = useRef(false);

  const youtubePlayerSrc = useMemo(() => (youtubeResult ? toYouTubePlayerSrc(youtubeResult.embedUrl, youtubeEmbedNonce) : null), [youtubeResult, youtubeEmbedNonce]);

  async function refreshLiveState(runtimeOnly = false, runtimeUsername?: string) {
    const params = new URLSearchParams();
    if (runtimeOnly) {
      params.set("runtime", "1");
      const normalizedRuntimeUsername = normalizeHandle(runtimeUsername ?? "");
      if (normalizedRuntimeUsername) {
        params.set("username", normalizedRuntimeUsername);
      }
    }
    const query = params.toString();
    const url = query ? `/api/tiktok/live/state?${query}` : "/api/tiktok/live/state";
    const response = await fetch(url, {
      cache: "no-store",
    });
    const data = (await response.json()) as LiveDashboardState | { error?: string };
    if (!response.ok || ("error" in data && typeof data.error === "string")) {
      throw new Error("error" in data && typeof data.error === "string" ? data.error : "Failed to load live state");
    }
    const parsed = data as LiveDashboardState;
    setLiveState((prev) => ({
      ...parsed,
      spotifyTracks: parsed.spotifyTracks.length > 0 ? parsed.spotifyTracks : prev?.spotifyTracks ?? [],
      latestSyncEvents: parsed.latestSyncEvents.length > 0 ? parsed.latestSyncEvents : prev?.latestSyncEvents ?? [],
    }));
    const runningSession = parsed.liveSessions.find((session) => !session.endedAt);
    const syncedHandle = normalizeHandle(runningSession?.username ?? parsed.config.tiktokHandle ?? "");
    if (syncedHandle && !lastTrackedHandleRef.current) {
      lastTrackedHandleRef.current = syncedHandle.toLowerCase();
      setLastTrackedHandle(syncedHandle.toLowerCase());
    }
    if (!usernameInputFocusedRef.current) {
      setUsername((prev) => {
        if (!syncedHandle) {
          return prev || "";
        }
        const prevNormalized = normalizeHandle(prev);
        if (prevNormalized) {
          return prev;
        }
        return syncedHandle;
      });
    }
  }

  async function refreshOverlayState() {
    if (isOverlayUpdatePendingRef.current) {
      return;
    }
    const response = await fetch("/api/overlay/state", { cache: "no-store" });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const root = asRecord(payload);
      throw new Error(typeof root?.error === "string" ? root.error : "Failed to load overlay state");
    }
    if (isOverlayUpdatePendingRef.current) {
      return;
    }
    const parsed = parseOverlayState(payload);
    if (!parsed) {
      throw new Error("Overlay state payload invalid");
    }
    setOverlayState((prev) => {
      if (!prev || !parsed) return parsed;
      const prevTs = Date.parse(prev.updatedAt);
      const nextTs = Date.parse(parsed.updatedAt);
      if (Number.isFinite(prevTs) && Number.isFinite(nextTs) && nextTs < prevTs) {
        return prev;
      }
      return parsed;
    });
  }

  async function refreshGoalsState() {
    const response = await fetch("/api/overlay/goals", { cache: "no-store" });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const root = asRecord(payload);
      throw new Error(typeof root?.error === "string" ? root.error : "Failed to load goals state");
    }
    const parsed = parseOverlayGoals(payload);
    if (!parsed) {
      throw new Error("Goals state payload invalid");
    }
    setOverlayGoals(parsed);
    if (!goalsInitializedRef.current) {
      setLikeGoalInput(String(parsed.likeGoalTarget));
      setDonationGoalInput(String(parsed.donationGoalTarget));
      setAutoLikeEveryInput(String(parsed.autoLikeEveryLikes));
      setAutoLikeWithinInput(String(parsed.autoLikeTriggerWithin));
      setAutoLikeTextInput(parsed.autoLikeTextTemplate);
      setAutoLikeSubtextInput(parsed.autoLikeSubtextTemplate);
      setAutoLikeShowProgressInput(parsed.autoLikeShowProgress);
      goalsInitializedRef.current = true;
    }
  }

  async function refreshCtaPresets() {
    const response = await fetch("/api/cta-presets", { cache: "no-store" });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const root = asRecord(payload);
      throw new Error(typeof root?.error === "string" ? root.error : "Failed to load CTA presets");
    }
    const root = asRecord(payload);
    const presetsRaw = Array.isArray(root?.presets) ? root.presets : [];
    const normalized = presetsRaw
      .map((item) => {
        const record = asRecord(item);
        if (!record) {
          return null;
        }
        const key = typeof record?.key === "string" ? record.key : "";
        if (!isCtaKey(key)) {
          return null;
        }
        return normalizeCtaPreset({
          key,
          label: typeof record.label === "string" ? record.label : undefined,
          title: typeof record.title === "string" ? record.title : undefined,
          subtitle: typeof record.subtitle === "string" ? record.subtitle : undefined,
          accentColor: typeof record.accentColor === "string" ? record.accentColor : undefined,
        });
      })
      .filter((item): item is CtaPresetConfig => item !== null);
    const ordered = ctaOrder.map((key) => normalized.find((preset) => preset.key === key)).filter((preset): preset is CtaPresetConfig => Boolean(preset));
    setCtaPresets(ordered);
    setCtaDrafts(() => {
      const next: Record<string, CtaPresetConfig> = {};
      for (const preset of ordered) {
        next[preset.key] = preset;
      }
      return next;
    });
  }

  async function updateOverlay(payload: OverlayUpdatePayload) {
    if (!overlayState) {
      throw new Error("Overlay state is not loaded yet");
    }
    const previousOverlay = overlayState;
    const optimisticOverlay: StreamOverlayState = {
      mode: payload.mode ?? previousOverlay.mode,
      title: payload.title ?? previousOverlay.title,
      subtitle: payload.subtitle ?? previousOverlay.subtitle,
      accentColor: payload.accentColor ?? previousOverlay.accentColor,
      mediaImageUrl: payload.mediaImageUrl ?? previousOverlay.mediaImageUrl,
      updatedAt: new Date().toISOString(),
      updatedBy: payload.updatedBy ?? "ipad",
    };
    setOverlayState(optimisticOverlay);
    isOverlayUpdatePendingRef.current = true;

    try {
      const response = await fetch("/api/overlay/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, updatedBy: payload.updatedBy ?? "ipad" }),
      });
      const result = (await response.json()) as unknown;
      if (!response.ok) {
        setOverlayState(previousOverlay);
        const root = asRecord(result);
        throw new Error(typeof root?.error === "string" ? root.error : "Overlay update failed");
      }
      const parsed = parseOverlayState(result);
      if (!parsed) {
        setOverlayState(previousOverlay);
        throw new Error("Overlay update payload invalid");
      }
      setOverlayState(parsed);
    } finally {
      isOverlayUpdatePendingRef.current = false;
    }
  }

  async function updateGoals(payload: GoalsUpdatePayload) {
    if (!overlayGoals) {
      throw new Error("Goals are not loaded yet");
    }
    const previousGoals = overlayGoals;
    const optimisticGoals: OverlayGoalsState = {
      ...previousGoals,
      likeGoalTarget: payload.likeGoalTarget ?? previousGoals.likeGoalTarget,
      donationGoalTarget: payload.donationGoalTarget ?? previousGoals.donationGoalTarget,
      showLikeGoal: payload.showLikeGoal ?? previousGoals.showLikeGoal,
      showDonationGoal: payload.showDonationGoal ?? previousGoals.showDonationGoal,
      autoLikeEnabled: payload.autoLikeEnabled ?? previousGoals.autoLikeEnabled,
      autoLikeEveryLikes: payload.autoLikeEveryLikes ?? previousGoals.autoLikeEveryLikes,
      autoLikeTriggerWithin: payload.autoLikeTriggerWithin ?? previousGoals.autoLikeTriggerWithin,
      autoLikeTextTemplate: payload.autoLikeTextTemplate ?? previousGoals.autoLikeTextTemplate,
      autoLikeSubtextTemplate: payload.autoLikeSubtextTemplate ?? previousGoals.autoLikeSubtextTemplate,
      autoLikeShowProgress: payload.autoLikeShowProgress ?? previousGoals.autoLikeShowProgress,
      updatedAt: new Date().toISOString(),
      updatedBy: payload.updatedBy ?? "ipad",
    };
    setOverlayGoals(optimisticGoals);

    const response = await fetch("/api/overlay/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, updatedBy: payload.updatedBy ?? "ipad" }),
    });
    const result = (await response.json()) as unknown;
    if (!response.ok) {
      setOverlayGoals(previousGoals);
      const root = asRecord(result);
      throw new Error(typeof root?.error === "string" ? root.error : "Goal update failed");
    }
    const parsed = parseOverlayGoals(result);
    if (!parsed) {
      setOverlayGoals(previousGoals);
      throw new Error("Goal update payload invalid");
    }
    setOverlayGoals(parsed);
    setLikeGoalInput(String(parsed.likeGoalTarget));
    setDonationGoalInput(String(parsed.donationGoalTarget));
    setAutoLikeEveryInput(String(parsed.autoLikeEveryLikes));
    setAutoLikeWithinInput(String(parsed.autoLikeTriggerWithin));
    setAutoLikeTextInput(parsed.autoLikeTextTemplate);
    setAutoLikeSubtextInput(parsed.autoLikeSubtextTemplate);
    setAutoLikeShowProgressInput(parsed.autoLikeShowProgress);
    goalsInitializedRef.current = true;
  }

  useEffect(() => {
    usernameRef.current = normalizeHandle(username);
  }, [username]);

  useEffect(() => {
    const normalized = normalizeHandle(lastTrackedHandle).toLowerCase();
    lastTrackedHandleRef.current = normalized;
  }, [lastTrackedHandle]);

  useEffect(() => {
    Promise.all([refreshLiveState(false), refreshOverlayState(), refreshGoalsState(), refreshCtaPresets()]).catch((error: unknown) => {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to load stream control data" });
    });
  }, []);

  useEffect(() => {
    const overlayTimer = setInterval(() => {
      if (isOverlayRefreshInFlightRef.current) {
        return;
      }
      isOverlayRefreshInFlightRef.current = true;
      refreshOverlayState().catch(() => undefined).finally(() => {
        isOverlayRefreshInFlightRef.current = false;
      });
    }, 1400);
    const liveTimer = setInterval(() => {
      if (document.hidden || isLiveRefreshInFlightRef.current) {
        return;
      }
      const runtimeHint = lastTrackedHandleRef.current || usernameRef.current || undefined;
      isLiveRefreshInFlightRef.current = true;
      refreshLiveState(true, runtimeHint).catch(() => undefined).finally(() => {
        isLiveRefreshInFlightRef.current = false;
      });
    }, 800);
    const goalsTimer = setInterval(() => {
      if (isGoalsRefreshInFlightRef.current) {
        return;
      }
      isGoalsRefreshInFlightRef.current = true;
      refreshGoalsState().catch(() => undefined).finally(() => {
        isGoalsRefreshInFlightRef.current = false;
      });
    }, 4000);
    return () => {
      clearInterval(overlayTimer);
      clearInterval(liveTimer);
      clearInterval(goalsTimer);
    };
  }, []);

  const normalizedUsername = normalizeHandle(username).toLowerCase();
  const syncedTrackedHandle = useMemo(() => {
    if (!liveState) {
      return "";
    }
    const runningSession = liveState.liveSessions.find((session) => !session.endedAt);
    return normalizeHandle(runningSession?.username ?? liveState.config.tiktokHandle ?? "").toLowerCase();
  }, [liveState]);
  const activeSession = useMemo(() => {
    if (!liveState) {
      return null;
    }
    const preferredHandle = syncedTrackedHandle || normalizedUsername;
    const preferredSessions = preferredHandle
      ? liveState.liveSessions.filter((session) => session.username.toLowerCase() === preferredHandle)
      : liveState.liveSessions;
    if (preferredSessions.length > 0) {
      return preferredSessions.find((session) => !session.endedAt) ?? preferredSessions[0];
    }
    return liveState.liveSessions.find((session) => !session.endedAt) ?? liveState.liveSessions[0] ?? null;
  }, [liveState, normalizedUsername, syncedTrackedHandle]);

  const comments = useMemo(() => {
    if (!activeSession) {
      return [];
    }
    return [...activeSession.comments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 300);
  }, [activeSession]);

  const gifts = useMemo(() => {
    if (!activeSession) {
      return [];
    }
    return [...activeSession.gifts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 60);
  }, [activeSession]);

  const filteredTracks = useMemo(() => {
    if (!liveState) {
      return [];
    }
    const query = normalizeText(songFilter);
    return [...liveState.spotifyTracks]
      .filter((track) => !query || `${track.name} ${track.artistName ?? ""} ${track.albumName ?? ""}`.toLowerCase().includes(query))
      .sort((a, b) => {
        const albumA = (a.albumName ?? "zzzzzz").toLowerCase();
        const albumB = (b.albumName ?? "zzzzzz").toLowerCase();
        const albumDiff = albumA.localeCompare(albumB);
        if (albumDiff !== 0) {
          return albumDiff;
        }
        const nameDiff = a.name.localeCompare(b.name);
        if (nameDiff !== 0) {
          return nameDiff;
        }
        return (b.popularity ?? -1) - (a.popularity ?? -1);
      })
      .slice(0, 160);
  }, [liveState, songFilter]);

  const groupedTracksByAlbum = useMemo(() => {
    const groups = new Map<string, { key: string; albumName: string; tracks: typeof filteredTracks }>();
    for (const track of filteredTracks) {
      const albumName = (track.albumName ?? "Unknown album").trim() || "Unknown album";
      const key = albumName.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { key, albumName, tracks: [] });
      }
      groups.get(key)?.tracks.push(track);
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      coverUrl:
        group.tracks.map((track) => albumCoverBySpotifyId[track.spotifyId]).find((value): value is string => Boolean(value)) ?? null,
    }));
  }, [filteredTracks, albumCoverBySpotifyId]);

  useEffect(() => {
    if (activePanel !== "songs") {
      return;
    }
    if (isCoverFetchInFlightRef.current) {
      return;
    }
    const tracksNeedingCover = groupedTracksByAlbum
      .slice(0, 60)
      .map((group) => group.tracks[0])
      .filter(
        (track): track is (typeof filteredTracks)[number] =>
          Boolean(track && track.spotifyId && !albumCoverBySpotifyId[track.spotifyId])
      )
      .slice(0, 24);

    if (tracksNeedingCover.length === 0) {
      return;
    }

    isCoverFetchInFlightRef.current = true;

    let cancelled = false;

    const payload = tracksNeedingCover.map((track) => ({
      spotifyId: track.spotifyId,
      url: track.externalUrl || `https://open.spotify.com/track/${track.spotifyId}`,
    }));

    fetch("/api/spotify/oembed-covers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks: payload }),
    })
      .then(async (response) => {
        const body = (await response.json()) as unknown;
        if (!response.ok) {
          return;
        }
        const root = asRecord(body);
        const covers = asRecord(root?.covers);
        if (!covers || cancelled) {
          return;
        }
        setAlbumCoverBySpotifyId((prev) => {
          const next = { ...prev };
          for (const [spotifyId, coverUrl] of Object.entries(covers)) {
            if (typeof coverUrl === "string" && coverUrl.trim()) {
              next[spotifyId] = coverUrl;
            }
          }
          return next;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        isCoverFetchInFlightRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [groupedTracksByAlbum, albumCoverBySpotifyId, activePanel]);

  useEffect(() => {
    if (!albumModalKey) {
      return;
    }
    if (!groupedTracksByAlbum.some((group) => group.key === albumModalKey)) {
      setAlbumModalKey(null);
    }
  }, [groupedTracksByAlbum, albumModalKey]);

  const sortedSamples = useMemo(() => {
    if (!activeSession) {
      return [] as LiveDashboardState["liveSessions"][number]["samples"];
    }
    return [...activeSession.samples].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  }, [activeSession]);

  const monitorCurves = useMemo(() => {
    if (activePanel !== "monitor" || !activeSession) {
      return {
        viewerCurve: [] as ChartPoint[],
        likeCurve: [] as ChartPoint[],
        commentCurve: [] as ChartPoint[],
        giftCurve: [] as ChartPoint[],
      };
    }

    const startMs = new Date(activeSession.startedAt).getTime();
    const endMs = activeSession.endedAt ? new Date(activeSession.endedAt).getTime() : Date.now();
    const spanMs = Math.max(60_000, endMs - startMs);
    const bucketSizeMs = 60_000;
    const bucketCount = Math.max(1, Math.min(720, Math.ceil(spanMs / bucketSizeMs)));

    const viewerBuckets = new Array<number>(bucketCount).fill(0);
    const likeBuckets = new Array<number>(bucketCount).fill(0);
    const commentBuckets = new Array<number>(bucketCount).fill(0);
    const giftBuckets = new Array<number>(bucketCount).fill(0);

    for (const sample of sortedSamples) {
      const sampleMs = new Date(sample.capturedAt).getTime();
      const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor((sampleMs - startMs) / bucketSizeMs)));
      viewerBuckets[bucket] = sample.viewerCount;
      likeBuckets[bucket] = Math.max(likeBuckets[bucket], sample.likeCount);
    }

    for (let i = 1; i < bucketCount; i += 1) {
      if (viewerBuckets[i] === 0) viewerBuckets[i] = viewerBuckets[i - 1];
      if (likeBuckets[i] === 0) likeBuckets[i] = likeBuckets[i - 1];
    }

    for (const comment of activeSession.comments) {
      const t = new Date(comment.createdAt).getTime();
      const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor((t - startMs) / bucketSizeMs)));
      commentBuckets[bucket] += 1;
    }
    for (const gift of activeSession.gifts) {
      const t = new Date(gift.createdAt).getTime();
      const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor((t - startMs) / bucketSizeMs)));
      giftBuckets[bucket] += 1;
    }

    const viewerCurve = viewerBuckets.map((value, i) => ({ label: `${i}m`, value }));
    const likeCurve = likeBuckets.map((value, i) => ({ label: `${i}m`, value }));

    let commentsRunning = 0;
    let giftsRunning = 0;
    const commentCurve = commentBuckets.map((value, i) => {
      commentsRunning += value;
      return { label: `${i}m`, value: commentsRunning };
    });
    const giftCurve = giftBuckets.map((value, i) => {
      giftsRunning += value;
      return { label: `${i}m`, value: giftsRunning };
    });

    return { viewerCurve, likeCurve, commentCurve, giftCurve };
  }, [activePanel, activeSession, sortedSamples]);

  const { viewerCurve, likeCurve, commentCurve, giftCurve } = monitorCurves;

  const viewerMax = useMemo(() => {
    if (viewerCurve.length === 0) {
      return 0;
    }
    return Math.max(...viewerCurve.map((point) => point.value));
  }, [viewerCurve]);
  const viewerMin = useMemo(() => {
    if (viewerCurve.length === 0) {
      return 0;
    }
    return Math.min(...viewerCurve.map((point) => point.value));
  }, [viewerCurve]);
  const viewerNetChange = useMemo(() => {
    if (viewerCurve.length < 2) {
      return 0;
    }
    return viewerCurve[viewerCurve.length - 1].value - viewerCurve[0].value;
  }, [viewerCurve]);

  const sessionDurationMinutes = useMemo(() => {
    if (!activeSession) {
      return 0;
    }
    const startMs = new Date(activeSession.startedAt).getTime();
    const endMs = activeSession.endedAt ? new Date(activeSession.endedAt).getTime() : Date.now();
    const minutes = (endMs - startMs) / 60000;
    return Math.max(1, minutes);
  }, [activeSession]);

  const monitorStats = useMemo(() => {
    if (!activeSession) {
      return {
        avgViewers: 0,
        peakGain: 0,
        likesPerMinute: 0,
        entersPerMinute: 0,
        commentsPerMinute: 0,
        giftsPerMinute: 0,
        diamondsPerMinute: 0,
        commentToEnterPct: 0,
        giftToEnterPct: 0,
      };
    }
    const enters = Math.max(1, activeSession.enterCountLatest);
    return {
      avgViewers: Math.round(activeSession.viewerCountAvg),
      peakGain: Math.max(0, activeSession.viewerCountPeak - activeSession.viewerCountStart),
      likesPerMinute: activeSession.likeCountLatest / sessionDurationMinutes,
      entersPerMinute: activeSession.enterCountLatest / sessionDurationMinutes,
      commentsPerMinute: activeSession.totalCommentEvents / sessionDurationMinutes,
      giftsPerMinute: activeSession.totalGiftEvents / sessionDurationMinutes,
      diamondsPerMinute: activeSession.totalGiftDiamonds / sessionDurationMinutes,
      commentToEnterPct: (activeSession.totalCommentEvents / enters) * 100,
      giftToEnterPct: (activeSession.totalGiftEvents / enters) * 100,
    };
  }, [activeSession, sessionDurationMinutes]);

  const sessionDurationLabel = useMemo(() => {
    const rounded = Math.max(0, Math.round(sessionDurationMinutes));
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }, [sessionDurationMinutes]);
  const isSessionLive = Boolean(activeSession && !activeSession.endedAt);
  const currentViewerCount = viewerCurve[viewerCurve.length - 1]?.value ?? activeSession?.viewerCountPeak ?? 0;
  const monitorPrimaryStats: Array<{ label: string; value: string; hint: string; tone?: "live" | "neutral" }> = [
    { label: "Status", value: isSessionLive ? "LIVE" : "Idle", hint: isSessionLive ? "Collecting now" : "No active session", tone: isSessionLive ? "live" : "neutral" },
    { label: "Duration", value: sessionDurationLabel, hint: "Current session length" },
    { label: "Viewers Now", value: currentViewerCount.toLocaleString(), hint: `Peak ${activeSession?.viewerCountPeak.toLocaleString() ?? "0"}` },
    { label: "Net Change", value: `${viewerNetChange >= 0 ? "+" : ""}${viewerNetChange.toLocaleString()}`, hint: "From first sample" },
  ];
  const monitorPerformanceStats: Array<{ label: string; value: string }> = [
    { label: "Start Viewers", value: activeSession?.viewerCountStart.toLocaleString() ?? "0" },
    { label: "Average Viewers", value: monitorStats.avgViewers.toLocaleString() },
    { label: "Peak Viewers", value: activeSession?.viewerCountPeak.toLocaleString() ?? "0" },
    { label: "Peak Gain", value: monitorStats.peakGain.toLocaleString() },
    { label: "Viewer Min", value: viewerMin.toLocaleString() },
    { label: "Viewer Max", value: viewerMax.toLocaleString() },
  ];
  const monitorEngagementStats: Array<{ label: string; value: string }> = [
    { label: "Likes", value: activeSession?.likeCountLatest.toLocaleString() ?? "0" },
    { label: "Likes / Min", value: monitorStats.likesPerMinute.toFixed(1) },
    { label: "Enters", value: activeSession?.enterCountLatest.toLocaleString() ?? "0" },
    { label: "Enters / Min", value: monitorStats.entersPerMinute.toFixed(1) },
    { label: "Comments", value: activeSession?.totalCommentEvents.toLocaleString() ?? "0" },
    { label: "Comments / Min", value: monitorStats.commentsPerMinute.toFixed(1) },
    { label: "Gift Events", value: activeSession?.totalGiftEvents.toLocaleString() ?? "0" },
    { label: "Gifts / Min", value: monitorStats.giftsPerMinute.toFixed(2) },
    { label: "Diamonds", value: activeSession?.totalGiftDiamonds.toLocaleString() ?? "0" },
    { label: "Diamonds / Min", value: monitorStats.diamondsPerMinute.toFixed(1) },
    { label: "Comment Rate", value: `${monitorStats.commentToEnterPct.toFixed(1)}%` },
    { label: "Gift Conversion", value: `${monitorStats.giftToEnterPct.toFixed(1)}%` },
  ];

  const currentLikeCount = activeSession?.likeCountLatest ?? 0;
  const currentDonationCount = activeSession?.totalGiftDiamonds ?? 0;
  const donationSek = currentDonationCount * DIAMOND_TO_SEK_RATE;
  const liveClockLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const likeProgressPct = useMemo(() => {
    const target = Math.max(1, overlayGoals?.likeGoalTarget ?? 1);
    return Math.min(100, (currentLikeCount / target) * 100);
  }, [overlayGoals?.likeGoalTarget, currentLikeCount]);
  const donationProgressPct = useMemo(() => {
    const target = Math.max(1, overlayGoals?.donationGoalTarget ?? 1);
    return Math.min(100, (currentDonationCount / target) * 100);
  }, [overlayGoals?.donationGoalTarget, currentDonationCount]);

  useEffect(() => {
    if (!isResizingPanes) {
      return;
    }

    function onMove(clientX: number) {
      const viewport = window.innerWidth;
      const next = Math.max(24, Math.min(55, (clientX / viewport) * 100));
      pendingPanePercentRef.current = next;
      if (resizeRafRef.current === null) {
        resizeRafRef.current = window.requestAnimationFrame(() => {
          resizeRafRef.current = null;
          if (pendingPanePercentRef.current !== null) {
            setLeftPanePercent(pendingPanePercentRef.current);
          }
        });
      }
    }

    function handleMouseMove(event: MouseEvent) {
      onMove(event.clientX);
    }

    function handleTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (touch) {
        onMove(touch.clientX);
      }
    }

    function stopResize() {
      setIsResizingPanes(false);
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      pendingPanePercentRef.current = null;
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", stopResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", stopResize);
    };
  }, [isResizingPanes]);

  const panelButtons: Array<{ id: PanelId; label: string; hint: string }> = [
    { id: "player", label: "iPad Player", hint: youtubeResult ? "ready" : "idle" },
    { id: "songs", label: "Song Picker", hint: `${filteredTracks.length} tracks` },
    { id: "donors", label: "Thank Donor", hint: `${gifts.length} gifts` },
    { id: "goals", label: "Goals", hint: overlayGoals && (overlayGoals.showLikeGoal || overlayGoals.showDonationGoal) ? "displaying" : "hidden" },
    { id: "monitor", label: "Monitor", hint: activeSession && !activeSession.endedAt ? "live" : "idle" },
    { id: "ctas", label: "CTAs", hint: `${ctaPresets.length || ctaOrder.length} presets` },
    { id: "custom", label: "Custom", hint: "manual text" },
  ];

  function handlePanelTabClick(panelId: PanelId) {
    setActivePanel(panelId);
  }

  async function startTracking(rawHandle?: string) {
    if (isBusy) {
      return;
    }
    const handle = normalizeHandle(rawHandle ?? username);
    if (!handle) {
      setToast({ type: "error", text: "Enter username first." });
      return;
    }
    setUsername(handle);
    setIsBusy(true);
    try {
      const response = await fetch("/api/tiktok/live/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: handle, collectChatEvents: true, pollIntervalSec: 0.2 }),
      });
      const data = (await response.json()) as { error?: string; message?: string; started?: boolean };
      if (!response.ok) {
        throw new Error(data.error ?? "Start failed");
      }
      lastTrackedHandleRef.current = handle.toLowerCase();
      setLastTrackedHandle(handle.toLowerCase());
      setToast({ type: data.started ? "success" : "info", text: data.message ?? "Tracking updated." });
      await refreshLiveState(false);
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Start failed" });
    } finally {
      setIsBusy(false);
    }
  }

  async function stopTracking() {
    const handle = username.trim();
    if (!handle) {
      setToast({ type: "error", text: "Enter username first." });
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch("/api/tiktok/live/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: handle }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Stop failed");
      }
      setToast({ type: "success", text: data.message ?? "Stop signal sent." });
      await refreshLiveState(false);
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Stop failed" });
    } finally {
      setIsBusy(false);
    }
  }

  async function checkLive() {
    const handle = username.trim();
    if (!handle) {
      setToast({ type: "error", text: "Enter username first." });
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch("/api/tiktok/live/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: handle }),
      });
      const data = (await response.json()) as {
        error?: string;
        warning?: string;
        snapshot?: { isLive: boolean; viewerCount: number; likeCount: number; enterCount: number };
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Check failed");
      }
      if (data.snapshot) {
        setQuickSnapshot(data.snapshot);
      }
      setToast({ type: "info", text: data.warning ?? "Live snapshot refreshed." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Check failed" });
    } finally {
      setIsBusy(false);
    }
  }

  async function resetAllTrackingData() {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Reset all tracking data? This will clear sessions, samples, comments, gifts, and saved tracking handle.");
      if (!confirmed) {
        return;
      }
    }

    setIsBusy(true);
    try {
      const response = await fetch("/api/tiktok/live/reset", {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Reset failed");
      }
      setUsername("");
      setLastTrackedHandle("");
      setQuickSnapshot(null);
      setToast({ type: "success", text: data.message ?? "Tracking data reset." });
      await refreshLiveState(false);
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Reset failed" });
    } finally {
      setIsBusy(false);
    }
  }
  async function searchYoutube(query: string, limit = 5): Promise<YouTubeResult[]> {
    const response = await fetch("/api/youtube/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    });
    const data = (await response.json()) as { error?: string; results?: YouTubeResult[] };
    if (!response.ok || !Array.isArray(data.results)) {
      throw new Error(data.error ?? "YouTube lookup failed");
    }
    return data.results;
  }

  async function playCommentOnYoutube(text: string): Promise<boolean> {
    if (!liveState) {
      return false;
    }
    const matched = findTrackForComment(text, liveState.spotifyTracks);
    const query = matched ? `${matched.name} ${matched.artistName ?? ""} official audio`.trim() : text;
    setSelectedTrackId(matched?.id ?? "");
    setIsResolvingYoutube(true);
    try {
      const matches = await searchYoutube(query, 6);
      setYoutubeCandidates(matches);
      if (!matches[0]) {
        setYoutubeResult(null);
        setPlayerLabel("No YouTube match found.");
        setToast({ type: "error", text: "No YouTube match found for this comment." });
        return false;
      }
      setYoutubeResult(matches[0]);
      setYoutubeEmbedNonce((n) => n + 1);
      setPlayerLabel(`${matches[0].title} (YouTube)`);
      return true;
    } catch (error) {
      setYoutubeResult(null);
      setYoutubeCandidates([]);
      setPlayerLabel("YouTube lookup failed.");
      setToast({ type: "error", text: error instanceof Error ? error.message : "YouTube lookup failed" });
      return false;
    } finally {
      setIsResolvingYoutube(false);
    }
  }

  async function showCommentOnOverlay(comment: { comment: string; userUniqueId: string | null }) {
    const user = comment.userUniqueId ?? "viewer";
    await updateOverlay({ mode: "comment", title: comment.comment, subtitle: `@${user}`, accentColor: accentByMode.comment });
    setToast({ type: "success", text: "Comment shown on overlay." });
  }

  async function playCommentOnly(comment: { comment: string; userUniqueId: string | null }) {
    setActivePanel("player");
    const played = await playCommentOnYoutube(comment.comment);
    if (played) {
      setToast({ type: "success", text: "YouTube loaded in player. Overlay unchanged." });
    }
  }

  function isMyOrArtistTrack(track: LiveDashboardState["spotifyTracks"][number]) {
    if (track.isOwnedByYou) {
      return true;
    }
    const targetArtist = (liveState?.config.spotifyArtistName ?? "").trim().toLowerCase();
    const trackArtist = (track.artistName ?? "").trim().toLowerCase();
    if (!targetArtist || !trackArtist) {
      return false;
    }
    return trackArtist === targetArtist || trackArtist.includes(targetArtist);
  }

  async function playTrackOnly(track: LiveDashboardState["spotifyTracks"][number]): Promise<boolean> {
    const artistName = track.artistName ?? "";
    const isOwned = isMyOrArtistTrack(track);
    const query = isOwned
      ? `${track.name} ${artistName} audio`.trim()
      : `${track.name} ${artistName} official audio`.trim();
    setSelectedTrackId(track.id);
    setIsResolvingYoutube(true);
    try {
      const matches = await searchYoutube(query, 6);
      setYoutubeCandidates(matches);
      if (!matches[0]) {
        setYoutubeResult(null);
        setPlayerLabel("No YouTube match found.");
        setToast({ type: "error", text: "No YouTube match found for this song." });
        return false;
      }
      setYoutubeResult(matches[0]);
      setYoutubeEmbedNonce((n) => n + 1);
      setPlayerLabel(`${matches[0].title} (YouTube)`);
      return true;
    } catch (error) {
      setYoutubeResult(null);
      setYoutubeCandidates([]);
      setPlayerLabel("YouTube lookup failed.");
      setToast({ type: "error", text: error instanceof Error ? error.message : "YouTube lookup failed" });
      return false;
    } finally {
      setIsResolvingYoutube(false);
    }
  }

  async function resolveTrackCoverUrl(track: LiveDashboardState["spotifyTracks"][number]): Promise<string> {
    const cached = albumCoverBySpotifyId[track.spotifyId];
    if (cached) {
      return cached;
    }
    try {
      const response = await fetch("/api/spotify/oembed-covers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: [
            {
              spotifyId: track.spotifyId,
              url: track.externalUrl || `https://open.spotify.com/track/${track.spotifyId}`,
            },
          ],
        }),
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        return "";
      }
      const root = asRecord(body);
      const covers = asRecord(root?.covers);
      const coverUrl = covers && typeof covers[track.spotifyId] === "string" ? (covers[track.spotifyId] as string).trim() : "";
      if (!coverUrl) {
        return "";
      }
      setAlbumCoverBySpotifyId((prev) => ({ ...prev, [track.spotifyId]: coverUrl }));
      return coverUrl;
    } catch {
      return "";
    }
  }

  async function showTrack(track: LiveDashboardState["spotifyTracks"][number]) {
    const artist = track.artistName?.trim() || "Wallerstedt";
    const mediaImageUrl = isMyOrArtistTrack(track) ? await resolveTrackCoverUrl(track) : "";
    await updateOverlay({
      mode: "now_playing",
      title: "Now Playing",
      subtitle: `${track.name}\n${artist}\nFind it on my Spotify!`,
      accentColor: accentByMode.now_playing,
      mediaImageUrl,
    });
    setSelectedTrackId(track.id);
    setToast({ type: "success", text: "Song shown on overlay." });
  }

  async function showTrackFromAlbumModal(track: LiveDashboardState["spotifyTracks"][number]) {
    await showTrack(track);
    setAlbumModalKey(null);
  }

  async function playTrackFromAlbumModal(track: LiveDashboardState["spotifyTracks"][number]) {
    setActivePanel("player");
    setAlbumModalKey(null);
    const played = await playTrackOnly(track);
    if (played) {
      setToast({ type: "success", text: "YouTube loaded in player. Overlay unchanged." });
    }
  }

  async function showGiftThanks(gift: { userUniqueId: string | null; nickname: string | null; giftName: string | null; repeatCount: number }) {
    const user = gift.userUniqueId || gift.nickname || "supporter";
    const giftText = gift.giftName ? gift.giftName : "gift";
    await updateOverlay({ mode: "thank_you", title: `Thank you @${user}`, subtitle: `for the ${giftText}`, accentColor: accentByMode.thank_you });
    setToast({ type: "success", text: "Donor thank-you shown." });
  }

  function resolveCtaText(template: string): string {
    const artist = liveState?.config.spotifyArtistName ?? "Wallerstedt";
    const handleRaw = normalizeHandle(username) || normalizeHandle(liveState?.config.tiktokHandle ?? "") || "artist";
    return template
      .replace(/\{artist\}/gi, artist)
      .replace(/\{handle\}/gi, `@${handleRaw}`);
  }

  function getCtaDraft(key: CtaPresetKey): CtaPresetConfig {
    return ctaDrafts[key] ?? ctaPresets.find((preset) => preset.key === key) ?? defaultCtaPresetByKey(key);
  }

  function updateCtaDraft(key: CtaPresetKey, patch: Partial<Omit<CtaPresetConfig, "key">>) {
    setCtaDrafts((prev) => {
      const current = prev[key] ?? ctaPresets.find((preset) => preset.key === key) ?? defaultCtaPresetByKey(key);
      const next: CtaPresetConfig = {
        key,
        label: patch.label !== undefined ? patch.label.slice(0, 40) : current.label,
        title: patch.title !== undefined ? patch.title.slice(0, 140) : current.title,
        subtitle: patch.subtitle !== undefined ? patch.subtitle.slice(0, 320) : current.subtitle,
        accentColor: patch.accentColor !== undefined ? patch.accentColor.slice(0, 7) : current.accentColor,
      };
      return { ...prev, [key]: next };
    });
  }

  async function saveCtaPreset(key: CtaPresetKey) {
    const draft = getCtaDraft(key);
    setSavingCtaKey(key);
    try {
      const response = await fetch("/api/cta-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: draft.key,
          label: draft.label,
          title: draft.title,
          subtitle: draft.subtitle,
          accentColor: draft.accentColor,
        }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const root = asRecord(payload);
        throw new Error(typeof root?.error === "string" ? root.error : "Failed to save CTA preset");
      }
      const root = asRecord(payload);
      const presetRaw = asRecord(root?.preset);
      if (!presetRaw) {
        throw new Error("Saved CTA preset payload invalid");
      }
      const keyRaw = typeof presetRaw?.key === "string" ? presetRaw.key : "";
      if (!isCtaKey(keyRaw)) {
        throw new Error("Saved CTA preset payload invalid");
      }
      const saved = normalizeCtaPreset({
        key: keyRaw,
        label: typeof presetRaw.label === "string" ? presetRaw.label : draft.label,
        title: typeof presetRaw.title === "string" ? presetRaw.title : draft.title,
        subtitle: typeof presetRaw.subtitle === "string" ? presetRaw.subtitle : draft.subtitle,
        accentColor: typeof presetRaw.accentColor === "string" ? presetRaw.accentColor : draft.accentColor,
      });
      setCtaPresets((prev) => {
        const next = prev.some((preset) => preset.key === saved.key) ? prev.map((preset) => (preset.key === saved.key ? saved : preset)) : [...prev, saved];
        return ctaOrder.map((ctaKey) => next.find((preset) => preset.key === ctaKey)).filter((preset): preset is CtaPresetConfig => Boolean(preset));
      });
      setCtaDrafts((prev) => ({ ...prev, [saved.key]: saved }));
      setToast({ type: "success", text: `${saved.label} saved.` });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to save CTA preset" });
    } finally {
      setSavingCtaKey(null);
    }
  }

  async function showCtaPreset(key: CtaPresetKey) {
    const draft = getCtaDraft(key);
    const mode: StreamOverlayMode = key === "spotify" ? "spotify_cta" : "custom";
    const accentFallback = defaultCtaPresetByKey(key).accentColor;
    await updateOverlay({
      mode,
      title: resolveCtaText(draft.title),
      subtitle: resolveCtaText(draft.subtitle),
      accentColor: safeAccent(draft.accentColor, accentFallback),
    });
    setToast({ type: "success", text: `${draft.label} shown.` });
  }

  async function saveGoals() {
    const likeTarget = parseGoalTarget(likeGoalInput, overlayGoals?.likeGoalTarget ?? 10000);
    const donationTarget = parseGoalTarget(donationGoalInput, overlayGoals?.donationGoalTarget ?? 2000);
    const autoEvery = parseGoalTarget(autoLikeEveryInput, overlayGoals?.autoLikeEveryLikes ?? 1000);
    const autoWithin = parseGoalThreshold(autoLikeWithinInput, overlayGoals?.autoLikeTriggerWithin ?? 200);
    const autoText = autoLikeTextInput.trim().slice(0, 180) || "We're almost at {target} likes!!";
    const autoSubtext = autoLikeSubtextInput.trim().slice(0, 180) || "{remaining} likes to go";
    setIsSavingGoals(true);
    try {
      await updateGoals({
        likeGoalTarget: likeTarget,
        donationGoalTarget: donationTarget,
        autoLikeEveryLikes: autoEvery,
        autoLikeTriggerWithin: autoWithin,
        autoLikeTextTemplate: autoText,
        autoLikeSubtextTemplate: autoSubtext,
        autoLikeShowProgress: autoLikeShowProgressInput,
      });
      setToast({ type: "success", text: "Goals saved." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to save goals" });
    } finally {
      setIsSavingGoals(false);
    }
  }

  async function toggleLikeGoal(showLikeGoal: boolean) {
    if (!overlayGoals) {
      return;
    }
    try {
      await updateGoals({ showLikeGoal, likeGoalTarget: parseGoalTarget(likeGoalInput, overlayGoals.likeGoalTarget) });
      setToast({ type: "success", text: showLikeGoal ? "Like goal shown." : "Like goal hidden." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to update like goal" });
    }
  }

  async function toggleDonationGoal(showDonationGoal: boolean) {
    if (!overlayGoals) {
      return;
    }
    try {
      await updateGoals({ showDonationGoal, donationGoalTarget: parseGoalTarget(donationGoalInput, overlayGoals.donationGoalTarget) });
      setToast({ type: "success", text: showDonationGoal ? "Donation goal shown." : "Donation goal hidden." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to update donation goal" });
    }
  }

  async function setBothGoalsVisible(visible: boolean) {
    if (!overlayGoals) {
      return;
    }
    try {
      await updateGoals({
        likeGoalTarget: parseGoalTarget(likeGoalInput, overlayGoals.likeGoalTarget),
        donationGoalTarget: parseGoalTarget(donationGoalInput, overlayGoals.donationGoalTarget),
        showLikeGoal: visible,
        showDonationGoal: visible,
      });
      setToast({ type: "success", text: visible ? "Both goals shown." : "Both goals hidden." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to update goals display" });
    }
  }

  async function toggleAutoLikeEnabled(enabled: boolean) {
    if (!overlayGoals) {
      return;
    }
    try {
      await updateGoals({
        autoLikeEnabled: enabled,
        autoLikeEveryLikes: parseGoalTarget(autoLikeEveryInput, overlayGoals.autoLikeEveryLikes),
        autoLikeTriggerWithin: parseGoalThreshold(autoLikeWithinInput, overlayGoals.autoLikeTriggerWithin),
        autoLikeTextTemplate: (autoLikeTextInput.trim() || overlayGoals.autoLikeTextTemplate).slice(0, 180),
        autoLikeSubtextTemplate: (autoLikeSubtextInput.trim() || overlayGoals.autoLikeSubtextTemplate).slice(0, 180),
        autoLikeShowProgress: autoLikeShowProgressInput,
      });
      setToast({ type: "success", text: enabled ? "Auto like goal enabled." : "Auto like goal disabled." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to update auto like goal" });
    }
  }

  async function clearOverlay() {
    await updateOverlay({ mode: "hidden", accentColor: "#f59e0b" });
    setToast({ type: "info", text: "Overlay cleared." });
  }

  async function showCustom() {
    const title = customTitle.trim();
    const subtitle = customSubtitle.trim();
    if (!title && !subtitle) {
      setToast({ type: "error", text: "Add a title or subtitle." });
      return;
    }
    await updateOverlay({ mode: "custom", title, subtitle, accentColor: accentByMode.custom });
    setToast({ type: "success", text: "Custom overlay shown." });
  }

  async function handleTestCommentShow() {
    const text = testComment.trim();
    if (!text) {
      setToast({ type: "error", text: "Enter test comment text first." });
      return;
    }
    await showCommentOnOverlay({ comment: text, userUniqueId: "test" });
  }

  async function handleTestCommentPlay() {
    const text = testComment.trim();
    if (!text) {
      setToast({ type: "error", text: "Enter test comment text first." });
      return;
    }
    await playCommentOnly({ comment: text, userUniqueId: "test" });
  }

  if (!liveState || !overlayState || !overlayGoals) {
    return <div className="flex h-[100dvh] items-center justify-center bg-stone-950 text-stone-200">Loading stream control...</div>;
  }


  return (
    <div className="min-h-[100dvh] overflow-hidden bg-stone-950 text-stone-100">
      <div className="mx-auto flex h-[100dvh] w-full max-w-[1680px] flex-col gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4">
        <div className="pointer-events-none fixed bottom-3 right-3 z-50">
          <button
            onClick={() => setIsFocusMode((prev) => !prev)}
            className="pointer-events-auto h-9 rounded-md border border-stone-500 bg-stone-900/95 px-3 py-1 text-xs text-stone-100 shadow-lg backdrop-blur"
          >
            {isFocusMode ? "Show Controls" : "Hide Controls"}
          </button>
        </div>

        <section className="rounded-xl border border-stone-700 bg-stone-900/95 px-3 py-2">
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <span className="rounded-full bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100">time {liveClockLabel}</span>
            <span className="rounded-full bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100">live {sessionDurationLabel}</span>
            <span className="rounded-full bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100">viewers {currentViewerCount.toLocaleString()}</span>
            <span className="rounded-full bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100">likes {currentLikeCount.toLocaleString()}</span>
            <span className="rounded-full bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100">diamonds {currentDonationCount.toLocaleString()}</span>
            <span className="rounded-full bg-stone-800 px-3 py-1.5 text-sm font-medium text-stone-100">~SEK {donationSek.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            {quickSnapshot ? (
              <span className="rounded-full bg-stone-800 px-2.5 py-1 text-xs text-stone-300">
                snap {quickSnapshot.isLive ? "LIVE" : "off"} v{quickSnapshot.viewerCount.toLocaleString()}
              </span>
            ) : null}
            <a href="/stream-overlay" target="_blank" rel="noreferrer" className="ml-auto rounded-lg border border-sky-300/60 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-100">
              Overlay
            </a>
          </div>

          {!isFocusMode ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                onFocus={() => {
                  usernameInputFocusedRef.current = true;
                }}
                onBlur={() => {
                  usernameInputFocusedRef.current = false;
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  event.preventDefault();
                  void startTracking();
                }}
                placeholder="@username"
                className="min-h-10 rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
              />
              <button onClick={() => void startTracking()} disabled={isBusy} className="min-h-10 rounded-lg border border-emerald-300/60 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100 disabled:opacity-50">Start</button>
              <button onClick={() => void stopTracking()} disabled={isBusy} className="min-h-10 rounded-lg border border-red-300/60 bg-red-400/10 px-3 py-2 text-xs text-red-100 disabled:opacity-50">Stop</button>
              <button onClick={() => void checkLive()} disabled={isBusy} className="min-h-10 rounded-lg border border-stone-500 bg-stone-800 px-3 py-2 text-xs text-stone-100 disabled:opacity-50">Check</button>
              <button onClick={() => void clearOverlay()} disabled={isBusy} className="min-h-10 rounded-lg border border-stone-600 bg-stone-900 px-3 py-2 text-xs text-stone-200 disabled:opacity-50">Clear</button>
              <button onClick={() => void resetAllTrackingData()} disabled={isBusy} className="min-h-10 rounded-lg border border-red-300/60 bg-red-400/10 px-3 py-2 text-xs text-red-100 disabled:opacity-50">Reset Tracking Data</button>
              <span className="rounded-full bg-stone-800 px-2.5 py-1 text-xs text-stone-200">
                tracking {syncedTrackedHandle ? `@${syncedTrackedHandle}` : "none"}
              </span>
              <span className="ml-auto text-xs text-stone-400">
                overlay: <span className="text-stone-200">{overlayState.mode}</span> | {formatDateTime(overlayState.updatedAt)}
              </span>
            </div>
          ) : null}

          {toast ? (
            <p className={`mt-2 rounded-lg px-3 py-1 text-xs ${toast.type === "error" ? "bg-red-300/10 text-red-200" : toast.type === "success" ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-200"}`}>
              {toast.text}
            </p>
          ) : null}
        </section>

        <section
          className="grid min-h-0 flex-1 gap-3"
          style={{
            gridTemplateColumns:
              typeof window !== "undefined" && window.innerWidth >= 768
                ? `${leftPanePercent}% 12px minmax(0, calc(100% - ${leftPanePercent}% - 12px))`
                : "1fr",
          }}
        >
          <aside className="min-h-0 max-h-[32dvh] rounded-2xl border border-stone-700 bg-stone-900 p-3 md:max-h-none">
            <div className="flex h-full flex-col">
              <h2 className="text-lg text-stone-100">Live Comments</h2>
              <p className="mt-1 text-sm text-stone-400">Show updates overlay only. Play starts YouTube only.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={testComment} onChange={(event) => setTestComment(event.target.value)} placeholder="Test comment text" className="min-w-[180px] flex-1 rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100" />
                <button onClick={() => void handleTestCommentShow()} className="rounded-lg border border-sky-300/60 bg-sky-400/10 px-3 py-2 text-sm text-sky-100">Show</button>
                <button onClick={() => void handleTestCommentPlay()} className="rounded-lg border border-emerald-300/60 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-100">Play</button>
              </div>

              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {comments.length === 0 ? <p className="text-sm text-stone-400">No comments captured yet.</p> : comments.map((comment) => (
                  <article key={comment.id} className="rounded-xl border border-stone-700 bg-stone-950 p-3">
                    <p className="text-base leading-relaxed text-stone-100">{comment.comment}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-stone-500">{formatDateTime(comment.createdAt)} | @{comment.userUniqueId ?? "viewer"}</p>
                      <div className="flex gap-2">
                        <button onClick={() => void showCommentOnOverlay(comment)} className="rounded border border-sky-300/60 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-100 transition hover:bg-sky-400/20">Show</button>
                        <button onClick={() => void playCommentOnly(comment)} className="rounded border border-emerald-300/60 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-300/20">Play</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </aside>

          <div className="hidden md:flex items-stretch justify-center">
            <button
              onMouseDown={() => setIsResizingPanes(true)}
              onTouchStart={() => setIsResizingPanes(true)}
              className={`w-1.5 rounded-full transition ${isResizingPanes ? "bg-amber-300/60" : "bg-stone-600/80 hover:bg-stone-500"}`}
              aria-label="Resize panels"
              title="Drag to resize panels"
            />
          </div>

          <main className="min-h-0 rounded-2xl border border-stone-700 bg-stone-900 p-3">
            <div className="flex h-full flex-col gap-3">
              <div
                className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              >
                {panelButtons.map((panel) => (
                  <button
                    key={panel.id}
                    onClick={() => handlePanelTabClick(panel.id)}
                    className={`min-h-14 min-w-[8.75rem] shrink-0 rounded-xl border px-3 py-3 text-left transition md:min-w-[9.5rem] ${activePanel === panel.id ? "border-amber-300/60 bg-amber-300/10" : "border-stone-700 bg-stone-950 hover:border-stone-500"}`}
                  >
                    <p className="text-sm font-semibold text-stone-100">{panel.label}</p>
                    <p className="mt-1 text-xs text-stone-400">{panel.hint}</p>
                  </button>
                ))}
              </div>

              <section className="relative min-h-0 flex-1 overflow-auto rounded-xl border border-stone-700 bg-stone-950/70 p-3">
                <div className={activePanel === "player" ? "flex h-full flex-col" : "absolute left-[-9999px] top-0 h-px w-px overflow-hidden opacity-0"}>
                  <div>
                    <h2 className="text-lg text-stone-100">iPad Player</h2>
                    <p className="mt-1 text-sm text-stone-300">{playerLabel || "Use Play on a comment to load YouTube."}</p>
                  </div>

                  {isResolvingYoutube ? <p className="text-xs text-amber-200">Loading YouTube...</p> : null}

                  {youtubeResult && youtubePlayerSrc ? (
                    <div className="mt-3 space-y-2">
                      <div className="aspect-video w-full max-w-[620px] overflow-hidden rounded-lg border border-stone-700 bg-black">
                        <iframe
                          key={`${youtubeResult.videoId}-${youtubeEmbedNonce}`}
                          src={youtubePlayerSrc}
                          title={youtubeResult.title}
                          loading="eager"
                          allow="autoplay; encrypted-media; picture-in-picture; web-share"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allowFullScreen
                          className="h-full w-full"
                        />
                      </div>
                      <p className="text-xs text-stone-400">{youtubeResult.title}</p>
                    </div>
                  ) : <p className="mt-3 text-sm text-stone-500">No YouTube selection yet.</p>}

                  {youtubeCandidates.length > 1 ? (
                    <article className="mt-3 min-h-0 flex-1 rounded-xl border border-stone-700 bg-stone-900/70 p-3">
                      <h3 className="text-sm font-semibold text-stone-100">YouTube Matches</h3>
                      <div className="mt-2 min-h-0 max-h-56 space-y-2 overflow-auto pr-1">
                        {youtubeCandidates.map((candidate) => (
                          <button
                            key={candidate.videoId}
                            onClick={() => {
                              setYoutubeResult(candidate);
                              setYoutubeEmbedNonce((n) => n + 1);
                              setPlayerLabel(`${candidate.title} (YouTube)`);
                                                                          }}
                            className={`w-full rounded border px-2 py-2 text-left text-xs ${youtubeResult?.videoId === candidate.videoId ? "border-red-300/60 bg-red-400/10 text-red-100" : "border-stone-700 bg-stone-950 text-stone-200"}`}
                          >
                            <p className="truncate">{candidate.title}</p>
                            <p className="mt-1 truncate text-stone-500">{candidate.channelTitle}{candidate.viewCountText ? ` | ${candidate.viewCountText}` : ""}</p>
                          </button>
                        ))}
                      </div>
                    </article>
                  ) : null}
                </div>

                {activePanel === "songs" ? (
                  <div className="flex h-full flex-col">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-lg text-stone-100">Song Picker</h2>
                      <input value={songFilter} onChange={(event) => setSongFilter(event.target.value)} placeholder="Filter songs..." className="w-52 rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100" />
                    </div>
                    <p className="mt-1 text-sm text-stone-400">Tap an album cover, pick one song, and the modal closes automatically.</p>
                    <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
                      {groupedTracksByAlbum.length === 0 ? <p className="text-sm text-stone-400">No tracks available.</p> : (
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                          {groupedTracksByAlbum.map((group) => (
                            <button
                              key={group.key}
                              onClick={() => setAlbumModalKey(group.key)}
                              className="relative overflow-hidden rounded-lg border border-stone-700 bg-stone-950 transition hover:border-stone-500"
                              aria-label={`Open album with ${group.tracks.length} songs`}
                            >
                              <div className="aspect-square w-full bg-stone-900">
                                {group.coverUrl ? (
                                  <img
                                    src={group.coverUrl}
                                    alt={group.albumName}
                                    className="h-full w-full object-cover [filter:none] [mix-blend-mode:normal]"
                                    draggable={false}
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-stone-400">
                                    {group.albumName.trim().charAt(0).toUpperCase() || "A"}
                                  </div>
                                )}
                              </div>
                              <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-stone-100">
                                {group.tracks.length}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {albumModalKey ? (
                      <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
                        <div className="flex h-full max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-stone-600 bg-stone-900 p-4 shadow-2xl">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-base font-semibold text-stone-100">Pick A Song</h3>
                            <button onClick={() => setAlbumModalKey(null)} className="rounded border border-stone-600 bg-stone-950 px-2 py-1 text-xs text-stone-200">
                              Close
                            </button>
                          </div>
                          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                            {(groupedTracksByAlbum.find((group) => group.key === albumModalKey)?.tracks ?? []).map((track) => (
                              <article
                                key={track.id}
                                className={`flex items-center justify-between gap-3 rounded border px-3 py-2 transition ${selectedTrackId === track.id ? "border-amber-200/60 bg-amber-100/10 text-amber-100" : "border-stone-700 bg-stone-950 text-stone-200"}`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold">{track.name}</p>
                                  <p className="mt-1 text-xs text-stone-500">{track.artistName ?? "Unknown artist"} | popularity {track.popularity ?? "-"} | {track.isOwnedByYou ? "mine" : "external"}</p>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                  <button
                                    onClick={() => void showTrackFromAlbumModal(track)}
                                    className="rounded border border-sky-300/60 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-100 transition hover:bg-sky-400/20"
                                  >
                                    Show
                                  </button>
                                  <button
                                    onClick={() => void playTrackFromAlbumModal(track)}
                                    className="rounded border border-emerald-300/60 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-300/20"
                                  >
                                    Play
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activePanel === "donors" ? (
                  <div className="flex h-full flex-col">
                    <h2 className="text-lg text-stone-100">Thank Donor</h2>
                    <p className="mt-1 text-sm text-stone-400">Tap a gift to show the donor thank-you overlay.</p>
                    <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                      {gifts.length === 0 ? <p className="text-sm text-stone-400">No gifts yet.</p> : gifts.map((gift) => (
                        <button key={gift.id} onClick={() => void showGiftThanks(gift)} className="w-full rounded-lg border border-stone-700 bg-stone-950 p-3 text-left text-xs text-stone-200 transition hover:border-orange-300/40">
                          <p className="text-stone-500">{formatDateTime(gift.createdAt)} | @{gift.userUniqueId ?? gift.nickname ?? "supporter"}</p>
                          <p className="mt-1 text-sm text-stone-200">{gift.giftName ?? "Gift"}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {activePanel === "goals" ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <h2 className="text-lg text-stone-100">Goals</h2>
                    <p className="mt-1 text-sm text-stone-400">Set like and donation targets, then choose what to display on the stream overlay.</p>
                    <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto pr-1">

                    <div className="grid gap-3 md:grid-cols-2">
                      <article className="rounded-xl border border-stone-700 bg-stone-900/80 p-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Like Goal</p>
                        <p className="mt-2 text-xl font-semibold text-stone-100">{currentLikeCount.toLocaleString()} / {overlayGoals.likeGoalTarget.toLocaleString()}</p>
                        <div className="mt-2 h-2 rounded-full bg-stone-800">
                          <div className="h-full rounded-full bg-pink-400 transition-all duration-500" style={{ width: `${likeProgressPct}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-stone-400">{likeProgressPct.toFixed(1)}%</p>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => void toggleLikeGoal(!overlayGoals.showLikeGoal)}
                            className={`rounded-lg border px-3 py-2 text-xs ${overlayGoals.showLikeGoal ? "border-red-300/50 bg-red-400/10 text-red-100" : "border-pink-300/50 bg-pink-400/10 text-pink-100"}`}
                          >
                            {overlayGoals.showLikeGoal ? "Hide Like Goal" : "Display Like Goal"}
                          </button>
                        </div>
                      </article>

                      <article className="rounded-xl border border-stone-700 bg-stone-900/80 p-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Donation Goal</p>
                        <p className="mt-2 text-xl font-semibold text-stone-100">{currentDonationCount.toLocaleString()} / {overlayGoals.donationGoalTarget.toLocaleString()}</p>
                        <div className="mt-2 h-2 rounded-full bg-stone-800">
                          <div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${donationProgressPct}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-stone-400">{donationProgressPct.toFixed(1)}%</p>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => void toggleDonationGoal(!overlayGoals.showDonationGoal)}
                            className={`rounded-lg border px-3 py-2 text-xs ${overlayGoals.showDonationGoal ? "border-red-300/50 bg-red-400/10 text-red-100" : "border-amber-300/50 bg-amber-400/10 text-amber-100"}`}
                          >
                            {overlayGoals.showDonationGoal ? "Hide Donation Goal" : "Display Donation Goal"}
                          </button>
                        </div>
                      </article>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="rounded-xl border border-stone-700 bg-stone-900/70 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Like Target</p>
                        <input
                          value={likeGoalInput}
                          onChange={(event) => setLikeGoalInput(event.target.value.replace(/[^\d]/g, ""))}
                          placeholder="10000"
                          className="mt-2 w-full rounded border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                        />
                      </label>
                      <label className="rounded-xl border border-stone-700 bg-stone-900/70 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Donation Target (Diamonds)</p>
                        <input
                          value={donationGoalInput}
                          onChange={(event) => setDonationGoalInput(event.target.value.replace(/[^\d]/g, ""))}
                          placeholder="2000"
                          className="mt-2 w-full rounded border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                        />
                      </label>
                    </div>

                    <article className="rounded-xl border border-stone-700 bg-stone-900/80 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Auto Like Goal</p>
                          <p className="mt-1 text-sm text-stone-300">Automatically show a like-goal card when close to the next milestone.</p>
                        </div>
                        <button
                          onClick={() => void toggleAutoLikeEnabled(!overlayGoals.autoLikeEnabled)}
                          className={`rounded-lg border px-3 py-2 text-xs ${overlayGoals.autoLikeEnabled ? "border-emerald-300/60 bg-emerald-400/10 text-emerald-100" : "border-stone-600 bg-stone-900 text-stone-200"}`}
                        >
                          {overlayGoals.autoLikeEnabled ? "Enabled" : "Disabled"}
                        </button>
                      </div>

                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <label className="rounded-lg border border-stone-700 bg-stone-900/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Every (likes)</p>
                          <input
                            value={autoLikeEveryInput}
                            onChange={(event) => setAutoLikeEveryInput(event.target.value.replace(/[^\d]/g, ""))}
                            placeholder="1000"
                            className="mt-2 w-full rounded border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                          />
                        </label>
                        <label className="rounded-lg border border-stone-700 bg-stone-900/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Trigger Within (likes)</p>
                          <input
                            value={autoLikeWithinInput}
                            onChange={(event) => setAutoLikeWithinInput(event.target.value.replace(/[^\d]/g, ""))}
                            placeholder="200"
                            className="mt-2 w-full rounded border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                          />
                        </label>
                      </div>

                      <div className="mt-2 grid gap-2">
                        <label className="rounded-lg border border-stone-700 bg-stone-900/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Main Text</p>
                          <input
                            value={autoLikeTextInput}
                            onChange={(event) => setAutoLikeTextInput(event.target.value.slice(0, 180))}
                            className="mt-2 w-full rounded border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                          />
                        </label>
                        <label className="rounded-lg border border-stone-700 bg-stone-900/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Subtext</p>
                          <input
                            value={autoLikeSubtextInput}
                            onChange={(event) => setAutoLikeSubtextInput(event.target.value.slice(0, 180))}
                            className="mt-2 w-full rounded border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                          />
                        </label>
                        <label className="flex items-center gap-2 rounded-lg border border-stone-700 bg-stone-900/70 px-3 py-2 text-sm text-stone-200">
                          <input
                            type="checkbox"
                            checked={autoLikeShowProgressInput}
                            onChange={(event) => setAutoLikeShowProgressInput(event.target.checked)}
                            className="h-4 w-4 rounded border-stone-500 bg-stone-950"
                          />
                          Show progress bar in auto card
                        </label>
                        <p className="text-xs text-stone-500">Template vars: {"{target}"}, {"{likes}"}, {"{remaining}"}</p>
                      </div>
                    </article>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void saveGoals()}
                        disabled={isSavingGoals}
                        className="rounded-lg border border-sky-300/60 bg-sky-400/10 px-4 py-2 text-sm text-sky-100 disabled:opacity-50"
                      >
                        {isSavingGoals ? "Saving..." : "Save Targets"}
                      </button>
                      <button onClick={() => void setBothGoalsVisible(true)} className="rounded-lg border border-emerald-300/60 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
                        Display Both
                      </button>
                      <button onClick={() => void setBothGoalsVisible(false)} className="rounded-lg border border-red-300/60 bg-red-400/10 px-4 py-2 text-sm text-red-100">
                        Hide Both
                      </button>
                      <p className="self-center text-xs text-stone-500">Updated {formatDateTime(overlayGoals.updatedAt)}</p>
                    </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "ctas" ? (
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-lg text-stone-100">CTAs</h2>
                      <button
                        onClick={() => setIsCtaEditMode((prev) => !prev)}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${isCtaEditMode ? "border-amber-300/60 bg-amber-300/10 text-amber-100" : "border-stone-600 bg-stone-900 text-stone-200"}`}
                      >
                        {isCtaEditMode ? "Done Editing" : "Edit Mode"}
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-stone-400">
                      {isCtaEditMode ? "Edit and save permanently. Variables: {artist}, {handle}." : "Tap any CTA card to instantly send it to overlay."}
                    </p>
                    <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto pr-1 md:grid-cols-2">
                      {ctaOrder.map((key) => {
                        const draft = getCtaDraft(key);
                        const accent = safeAccent(draft.accentColor, defaultCtaPresetByKey(key).accentColor);

                        if (!isCtaEditMode) {
                          return (
                            <button
                              key={key}
                              onClick={() => void showCtaPreset(key)}
                              className="rounded-xl border p-4 text-left transition hover:brightness-110 flex items-center gap-4"
                              style={{
                                borderColor: `${accent}99`,
                                background: `linear-gradient(135deg, ${accent}22 0%, rgba(12,12,12,0.95) 75%)`,
                              }}
                            >
                              <div className="flex flex-1 flex-col gap-2">
                                <p className="text-base font-semibold text-stone-100">{draft.label}</p>
                                <p className="text-lg leading-tight text-stone-100">{resolveCtaText(draft.title) || " "}</p>
                                <p className="text-sm text-stone-300">{resolveCtaText(draft.subtitle) || " "}</p>
                              </div>
                              {key === "spotify" && (
                                <div className="flex h-full items-center">
                                  <Image
                                    src="/spotify.png"
                                    alt="Spotify"
                                    width={80}
                                    height={80}
                                    className="h-16 w-16 object-contain"
                                  />
                                </div>
                              )}
                            </button>
                          );
                        }

                        return (
                          <article key={key} className="rounded-xl border border-stone-700 bg-stone-900/80 p-3">
                            <div className="flex items-center gap-2">
                              <input
                                value={draft.label}
                                onChange={(event) => updateCtaDraft(key, { label: event.target.value })}
                                className="flex-1 rounded border border-stone-600 bg-stone-950 px-2 py-1 text-xs text-stone-100"
                              />
                              <input
                                type="color"
                                value={accent}
                                onChange={(event) => updateCtaDraft(key, { accentColor: event.target.value })}
                                className="h-7 w-9 cursor-pointer rounded border border-stone-600 bg-stone-950 p-0.5"
                              />
                              <input
                                value={accent}
                                onChange={(event) => updateCtaDraft(key, { accentColor: event.target.value })}
                                className="w-24 rounded border border-stone-600 bg-stone-950 px-2 py-1 text-xs text-stone-100"
                              />
                            </div>
                            <input
                              value={draft.title}
                              onChange={(event) => updateCtaDraft(key, { title: event.target.value })}
                              placeholder="CTA title"
                              className="mt-2 w-full rounded border border-stone-600 bg-stone-950 px-2 py-1.5 text-sm text-stone-100"
                            />
                            <textarea
                              value={draft.subtitle}
                              onChange={(event) => updateCtaDraft(key, { subtitle: event.target.value })}
                              placeholder="CTA subtitle"
                              rows={2}
                              className="mt-2 w-full rounded border border-stone-600 bg-stone-950 px-2 py-1.5 text-sm text-stone-100"
                            />
                            <div className="mt-2 flex gap-2">
                              <button
                                onClick={() => void showCtaPreset(key)}
                                className="rounded-lg border border-emerald-300/60 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-400/20"
                              >
                                Show
                              </button>
                              <button
                                onClick={() => void saveCtaPreset(key)}
                                disabled={savingCtaKey === key}
                                className="rounded-lg border border-sky-300/60 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-100 transition hover:bg-sky-400/20 disabled:opacity-50"
                              >
                                {savingCtaKey === key ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {activePanel === "custom" ? (
                  <div className="flex h-full flex-col">
                    <h2 className="text-lg text-stone-100">Custom Overlay</h2>
                    <p className="mt-1 text-sm text-stone-400">Type a title/subtitle and show it instantly.</p>
                    <div className="mt-3 space-y-2">
                      <input value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="Title" className="w-full rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100" />
                      <textarea value={customSubtitle} onChange={(event) => setCustomSubtitle(event.target.value)} placeholder="Subtitle" rows={4} className="w-full rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100" />
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => void showCustom()} className="rounded-lg border border-violet-300/50 bg-violet-300/10 px-3 py-2 text-sm text-violet-100">Show Custom</button>
                        <button onClick={() => setActivePanel("ctas")} className="rounded-lg border border-stone-600 bg-stone-900 px-3 py-2 text-sm text-stone-200">Open CTAs</button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activePanel === "monitor" ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg text-stone-100">Live Monitor</h2>
                        <p className="mt-1 text-xs text-stone-500">iPad optimized: cleaner hierarchy, denser data, faster reads.</p>
                      </div>
                      <p className="rounded-full border border-stone-700 bg-stone-900/80 px-3 py-1 text-xs text-stone-300">{viewerCurve.length} samples</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {monitorPrimaryStats.map((item) => (
                        <article key={item.label} className={`rounded-xl border p-3 ${item.tone === "live" ? "border-emerald-300/50 bg-emerald-400/10" : "border-stone-700 bg-stone-900/90"}`}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{item.label}</p>
                          <p className={`mt-1 text-2xl font-semibold leading-none ${item.tone === "live" ? "text-emerald-100" : "text-stone-100"}`}>{item.value}</p>
                          <p className="mt-1 text-xs text-stone-400">{item.hint}</p>
                        </article>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
                      <div className="grid grid-cols-1 gap-4">
                        <MonitorTrendChart
                          title="Viewer Curve"
                          summary={`Current ${currentViewerCount.toLocaleString()} | Min ${viewerMin.toLocaleString()} | Max ${viewerMax.toLocaleString()}`}
                          points={viewerCurve}
                          strokeColor="#facc15"
                          gradientId="viewerAreaGradient"
                          valueUnit="viewers"
                        />
                        <MonitorTrendChart
                          title="Total Likes Graph"
                          summary={`Current ${activeSession?.likeCountLatest.toLocaleString() ?? "0"} total likes`}
                          points={likeCurve}
                          strokeColor="#f472b6"
                          gradientId="likesAreaGradient"
                          valueUnit="likes"
                        />
                        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                          <MonitorTrendChart
                            title="Total Comments Graph"
                            summary={`Current ${activeSession?.totalCommentEvents.toLocaleString() ?? "0"} total comments`}
                            points={commentCurve}
                            strokeColor="#60a5fa"
                            gradientId="commentsAreaGradient"
                            valueUnit="comments"
                          />
                          <MonitorTrendChart
                            title="Total Gifts Graph"
                            summary={`Current ${activeSession?.totalGiftEvents.toLocaleString() ?? "0"} total gifts`}
                            points={giftCurve}
                            strokeColor="#fb923c"
                            gradientId="giftsAreaGradient"
                            valueUnit="gifts"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4">
                        <article className="rounded-xl border border-stone-700 bg-stone-900/90 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Audience Performance</p>
                          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                            {monitorPerformanceStats.map((item) => (
                              <div key={item.label}>
                                <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500">{item.label}</p>
                                <p className="mt-0.5 text-base font-semibold text-stone-100">{item.value}</p>
                              </div>
                            ))}
                          </div>
                        </article>

                        <article className="rounded-xl border border-stone-700 bg-stone-900/90 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Engagement And Conversion</p>
                          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                            {monitorEngagementStats.map((item) => (
                              <div key={item.label}>
                                <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500">{item.label}</p>
                                <p className="mt-0.5 text-base font-semibold text-stone-100">{item.value}</p>
                              </div>
                            ))}
                          </div>
                        </article>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          </main>
        </section>
      </div>
    </div>
  );
}
