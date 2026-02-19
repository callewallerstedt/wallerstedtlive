"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { DashboardState } from "@/lib/types";

type Toast = {
  type: "success" | "error" | "info";
  text: string;
};

type TabKey = "strategy" | "tiktok" | "spotify" | "learning";

const initialConfig = {
  tiktokHandle: "",
  spotifyArtistName: "Wallerstedt",
  objective: "spotify_streams",
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "strategy", label: "Strategy" },
  { key: "tiktok", label: "TikTok Data" },
  { key: "spotify", label: "Spotify Data" },
  { key: "learning", label: "Learning" },
];

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString();
}

function shortText(value: string, max = 110): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

type TikTokSyncMeta = {
  source?: string;
  warnings: string[];
  profile?: {
    uniqueId?: string;
    followerCount?: number;
    followingCount?: number;
    heartCount?: number;
    videoCount?: number;
  };
};

function parseTikTokSyncMeta(meta: unknown): TikTokSyncMeta {
  const root = asRecord(meta);
  const profileRaw = asRecord(root?.profile);

  return {
    source: typeof root?.source === "string" ? root.source : undefined,
    warnings: Array.isArray(root?.warnings) ? root.warnings.filter((item): item is string => typeof item === "string") : [],
    profile: profileRaw
      ? {
          uniqueId: typeof profileRaw.uniqueId === "string" ? profileRaw.uniqueId : undefined,
          followerCount: parseNumber(profileRaw.followerCount),
          followingCount: parseNumber(profileRaw.followingCount),
          heartCount: parseNumber(profileRaw.heartCount),
          videoCount: parseNumber(profileRaw.videoCount),
        }
      : undefined,
  };
}

export function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("strategy");
  const [count, setCount] = useState(6);
  const [spotifyFilter, setSpotifyFilter] = useState("");

  const [configDraft, setConfigDraft] = useState(initialConfig);
  const [experimentDraft, setExperimentDraft] = useState({
    recommendationId: "",
    notes: "",
    hoursSincePost: "2",
    views: "",
    likes: "",
    comments: "",
    shares: "",
    saves: "",
    watchTimeSec: "",
    completionRate: "",
    profileVisits: "",
    linkClicks: "",
    spotifyStreamsDelta: "",
  });
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);

  async function loadState() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const data = (await response.json()) as DashboardState | { error: string };
      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Failed to load dashboard");
      }

      setState(data);
      setConfigDraft({
        tiktokHandle: data.config.tiktokHandle ?? "",
        spotifyArtistName: data.config.spotifyArtistName ?? "Wallerstedt",
        objective: data.config.objective ?? "spotify_streams",
      });
      setExperimentDraft((prev) => ({
        ...prev,
        recommendationId: data.recommendations.find((item) => item.status !== "ARCHIVED")?.id ?? "",
      }));
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to load dashboard" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadState().catch(() => undefined);
  }, []);

  async function runAction<T>(action: () => Promise<T>, successMessage: string) {
    setIsBusy(true);
    setToast({ type: "info", text: "Working..." });
    try {
      await action();
      await loadState();
      setToast({ type: "success", text: successMessage });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Action failed" });
    } finally {
      setIsBusy(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configDraft),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save settings");
      }
    }, "Settings updated.");
  }

  async function syncTikTok() {
    await runAction(async () => {
      const response = await fetch("/api/tiktok/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: configDraft.tiktokHandle, limit: 35 }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "TikTok sync failed");
      }
    }, "TikTok synced.");
  }

  async function syncSpotify() {
    await runAction(async () => {
      const response = await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistName: configDraft.spotifyArtistName,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Spotify sync failed");
      }
    }, "Spotify catalog synced.");
  }

  async function generateRecommendations() {
    await runAction(async () => {
      const response = await fetch("/api/recommendations/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Recommendation generation failed");
      }
    }, "Fresh recommendations generated.");
  }

  async function submitExperiment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const form = new FormData();
      Object.entries(experimentDraft).forEach(([key, value]) => {
        if (value.trim()) {
          form.append(key, value.trim());
        }
      });
      if (screenshotFile) {
        form.append("screenshot", screenshotFile);
      }

      const response = await fetch("/api/experiments/analyze", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Experiment analysis failed");
      }
    }, "Experiment added and memory updated.");
  }

  async function updateTrackOwnership(spotifyId: string, ownershipStatus: "AUTO" | "MINE" | "NOT_MINE") {
    await runAction(async () => {
      const response = await fetch("/api/spotify/ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyId, ownershipStatus }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Ownership update failed");
      }
    }, "Song ownership updated.");
  }

  const topRecommendations = useMemo(
    () => (state?.recommendations ?? []).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 6),
    [state]
  );

  const latestTikTokSync = useMemo(
    () => state?.latestSyncEvents.find((event) => event.provider === "tiktok"),
    [state?.latestSyncEvents]
  );
  const latestSpotifySync = useMemo(
    () => state?.latestSyncEvents.find((event) => event.provider === "spotify"),
    [state?.latestSyncEvents]
  );
  const latestTikTokSyncMeta = useMemo(() => parseTikTokSyncMeta(latestTikTokSync?.meta), [latestTikTokSync?.meta]);

  const filteredSpotifyTracks = useMemo(() => {
    const query = spotifyFilter.trim().toLowerCase();
    const tracks = state?.spotifyTracks ?? [];
    if (!query) {
      return tracks;
    }
    return tracks.filter((track) =>
      `${track.name} ${track.albumName ?? ""} ${track.albumLabel ?? ""} ${track.publisher ?? ""}`
        .toLowerCase()
        .includes(query)
    );
  }, [spotifyFilter, state?.spotifyTracks]);

  const spotifyMineCount = (state?.spotifyTracks ?? []).filter((track) => track.isOwnedByYou).length;
  const tiktokStats = useMemo(() => {
    const videos = state?.tiktokVideos ?? [];
    const totals = videos.reduce(
      (acc, video) => {
        acc.views += video.views;
        acc.likes += video.likes;
        acc.comments += video.comments;
        acc.shares += video.shares;
        acc.saves += video.saves;
        if (video.views > 0) {
          const interactions = video.likes + video.comments + video.shares + video.saves;
          acc.engagementRateTotal += interactions / video.views;
          acc.saveRateTotal += video.saves / video.views;
          acc.engagementRows += 1;
        }
        return acc;
      },
      {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        engagementRateTotal: 0,
        saveRateTotal: 0,
        engagementRows: 0,
      }
    );

    return {
      views: totals.views,
      likes: totals.likes,
      comments: totals.comments,
      shares: totals.shares,
      saves: totals.saves,
      avgEngagementRate:
        totals.engagementRows > 0 ? totals.engagementRateTotal / totals.engagementRows : 0,
      avgSaveRate: totals.engagementRows > 0 ? totals.saveRateTotal / totals.engagementRows : 0,
    };
  }, [state?.tiktokVideos]);

  if (isLoading || !state) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-16">
        <p className="tracking-wide text-stone-300">Loading strategist...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10 md:px-10">
      <section className="relative overflow-hidden rounded-3xl border border-stone-700/60 bg-stone-900/90 p-8">
        <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-amber-200/10 blur-3xl" />
        <div className="absolute -right-12 top-10 h-40 w-40 rounded-full bg-red-200/10 blur-3xl" />
        <p className="text-xs uppercase tracking-[0.38em] text-amber-100/60">Wallerstedt Growth Console</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold text-stone-100 md:text-5xl">
          Content strategist trained on your own results.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-stone-300">
          Goal hierarchy: Spotify streams first, TikTok distribution second. Sync data, generate ideas, then upload
          performance screenshots to update strategy memory.
        </p>
        {toast ? (
          <p
            className={`mt-4 inline-flex rounded-full px-4 py-1 text-xs tracking-wide ${
              toast.type === "error"
                ? "bg-red-300/10 text-red-200"
                : toast.type === "success"
                  ? "bg-emerald-300/10 text-emerald-200"
                  : "bg-amber-300/10 text-amber-200"
            }`}
          >
            {toast.text}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Avg Views</p>
          <p className="mt-2 text-3xl text-stone-100">{state.metrics.avgViews.toLocaleString()}</p>
        </article>
        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Avg Engagement</p>
          <p className="mt-2 text-3xl text-stone-100">{formatPercent(state.metrics.avgEngagementRate)}</p>
        </article>
        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Avg Spotify Delta</p>
          <p className="mt-2 text-3xl text-stone-100">{state.metrics.avgSpotifyDelta.toLocaleString()}</p>
        </article>
        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Tested Ideas</p>
          <p className="mt-2 text-3xl text-stone-100">{state.metrics.testedIdeas}</p>
        </article>
        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-stone-400">Active Ideas</p>
          <p className="mt-2 text-3xl text-stone-100">{state.metrics.activeRecommendations}</p>
        </article>
      </section>

      <section className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <form onSubmit={saveSettings} className="space-y-4 rounded-2xl border border-stone-700 bg-stone-900 p-6">
          <h2 className="text-xl text-stone-100">Settings and Data Sources</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-stone-300">
              TikTok handle
              <input
                value={configDraft.tiktokHandle}
                onChange={(event) => setConfigDraft((prev) => ({ ...prev, tiktokHandle: event.target.value }))}
                placeholder="@yourhandle"
                className="mt-1 w-full rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-stone-100 outline-none focus:border-amber-200/70"
              />
            </label>
            <label className="text-sm text-stone-300">
              Spotify artist name
              <input
                value={configDraft.spotifyArtistName}
                onChange={(event) =>
                  setConfigDraft((prev) => ({ ...prev, spotifyArtistName: event.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-stone-100 outline-none focus:border-amber-200/70"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-xl border border-amber-200/60 bg-amber-100/10 px-4 py-2 text-sm text-amber-50 transition hover:bg-amber-100/20 disabled:opacity-40"
          >
            Save Settings
          </button>
        </form>

        <div className="space-y-4 rounded-2xl border border-stone-700 bg-stone-900 p-6">
          <h2 className="text-xl text-stone-100">Control Panel</h2>
          <div className="grid gap-3">
            <button
              onClick={syncTikTok}
              disabled={isBusy}
              className="rounded-xl border border-stone-500 bg-stone-800 px-4 py-2 text-sm text-stone-100 transition hover:bg-stone-700 disabled:opacity-40"
            >
              Sync TikTok Page and Top Videos
            </button>
            <button
              onClick={syncSpotify}
              disabled={isBusy}
              className="rounded-xl border border-stone-500 bg-stone-800 px-4 py-2 text-sm text-stone-100 transition hover:bg-stone-700 disabled:opacity-40"
            >
              Sync Spotify Song Library
            </button>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={count}
                min={1}
                max={12}
                onChange={(event) => setCount(Number(event.target.value))}
                className="w-20 rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-stone-100"
              />
              <button
                onClick={generateRecommendations}
                disabled={isBusy}
                className="rounded-xl border border-amber-200/60 bg-amber-100/10 px-4 py-2 text-sm text-amber-50 transition hover:bg-amber-100/20 disabled:opacity-40"
              >
                Generate Optimized Ideas
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full border px-4 py-2 text-sm transition ${
              activeTab === tab.key
                ? "border-amber-200/60 bg-amber-100/20 text-amber-50"
                : "border-stone-600 bg-stone-900 text-stone-300 hover:bg-stone-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === "strategy" ? (
        <section className="grid gap-8 xl:grid-cols-[1.45fr_1fr]">
          <div className="space-y-4 rounded-2xl border border-stone-700 bg-stone-900 p-6">
            <h2 className="text-xl text-stone-100">Top Recommendations</h2>
            <div className="grid gap-4">
              {topRecommendations.length === 0 ? (
                <p className="text-sm text-stone-400">No recommendations yet. Run sync + generate.</p>
              ) : (
                topRecommendations.map((idea) => (
                  <article key={idea.id} className="rounded-xl border border-stone-700 bg-stone-950 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg text-stone-100">{idea.ideaTitle}</h3>
                      <span className="rounded-full bg-stone-800 px-2 py-0.5 text-xs text-stone-300">
                        score {(idea.score ?? 0).toFixed(2)}
                      </span>
                      <span className="rounded-full bg-stone-800 px-2 py-0.5 text-xs text-stone-300">
                        {idea.patternKey ?? "untagged"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-stone-300">
                      <strong>Hook:</strong> {idea.hook}
                    </p>
                    <p className="mt-2 text-sm text-stone-300">
                      <strong>Caption:</strong> {idea.caption}
                    </p>
                    <p className="mt-2 text-sm text-stone-400">
                      {idea.songName
                        ? `${idea.songName} at ${idea.songSegmentStartSec ?? 0}s for ${idea.songSegmentLengthSec ?? 12}s`
                        : "No specific song selected"}
                    </p>
                    <p className="mt-2 text-sm text-stone-400">{idea.shotPlan}</p>
                  </article>
                ))
              )}
            </div>
          </div>

          <form
            onSubmit={submitExperiment}
            className="space-y-3 rounded-2xl border border-stone-700 bg-stone-900 p-6"
          >
            <h2 className="text-xl text-stone-100">Upload Performance Snapshot</h2>
            <p className="text-sm text-stone-400">
              Add metrics after 2h/24h and upload screenshot. The strategist updates memory automatically.
            </p>
            <select
              value={experimentDraft.recommendationId}
              onChange={(event) =>
                setExperimentDraft((prev) => ({ ...prev, recommendationId: event.target.value }))
              }
              className="w-full rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-stone-100"
            >
              <option value="">Manual / not linked to recommendation</option>
              {state.recommendations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.ideaTitle}
                </option>
              ))}
            </select>
            <div className="grid gap-2 md:grid-cols-2">
              {[
                "hoursSincePost",
                "views",
                "likes",
                "comments",
                "shares",
                "saves",
                "watchTimeSec",
                "completionRate",
                "profileVisits",
                "linkClicks",
                "spotifyStreamsDelta",
              ].map((field) => (
                <input
                  key={field}
                  value={experimentDraft[field as keyof typeof experimentDraft]}
                  onChange={(event) =>
                    setExperimentDraft((prev) => ({
                      ...prev,
                      [field]: event.target.value,
                    }))
                  }
                  placeholder={field}
                  className="rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                />
              ))}
            </div>
            <textarea
              value={experimentDraft.notes}
              onChange={(event) => setExperimentDraft((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Notes about performance, audience comments, context..."
              className="h-28 w-full rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
            />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setScreenshotFile(event.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-300"
            />
            <button
              type="submit"
              disabled={isBusy}
              className="rounded-xl border border-amber-200/60 bg-amber-100/10 px-4 py-2 text-sm text-amber-50 transition hover:bg-amber-100/20 disabled:opacity-40"
            >
              Analyze and Update Strategy
            </button>
          </form>
        </section>
      ) : null}

      {activeTab === "tiktok" ? (
        <section className="rounded-2xl border border-stone-700 bg-stone-900 p-6">
          <h2 className="text-xl text-stone-100">TikTok Synced Videos</h2>
          <p className="mt-1 text-sm text-stone-400">{state.tiktokVideos.length} videos loaded.</p>
          {latestTikTokSync ? (
            <div
              className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
                latestTikTokSync.status === "error" || latestTikTokSync.status === "warning"
                  ? "border-amber-300/50 bg-amber-300/10 text-amber-100"
                  : "border-stone-700 bg-stone-950 text-stone-300"
              }`}
            >
              <p>{latestTikTokSync.message ?? "Latest TikTok sync event captured."}</p>
            </div>
          ) : null}
          {latestTikTokSyncMeta.source || latestTikTokSyncMeta.profile || latestTikTokSyncMeta.warnings.length ? (
            <div className="mt-3 rounded-xl border border-stone-700 bg-stone-950 p-3 text-sm text-stone-300">
              <p>source: {latestTikTokSyncMeta.source ?? "unknown"}</p>
              {latestTikTokSyncMeta.profile ? (
                <p className="mt-1 text-stone-400">
                  profile @{latestTikTokSyncMeta.profile.uniqueId ?? "?"} | followers{" "}
                  {(latestTikTokSyncMeta.profile.followerCount ?? 0).toLocaleString()} | following{" "}
                  {(latestTikTokSyncMeta.profile.followingCount ?? 0).toLocaleString()} | likes{" "}
                  {(latestTikTokSyncMeta.profile.heartCount ?? 0).toLocaleString()} | videos{" "}
                  {(latestTikTokSyncMeta.profile.videoCount ?? 0).toLocaleString()}
                </p>
              ) : null}
              {latestTikTokSyncMeta.warnings.length ? (
                <p className="mt-1 text-xs text-amber-200">
                  warnings: {latestTikTokSyncMeta.warnings.slice(0, 3).join(" | ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {state.tiktokVideos.length === 0 ? (
            <p className="mt-4 text-sm text-stone-300">
              No videos available yet. TikTok currently blocks many server-side scrapers and may return profile stats
              without post rows.
            </p>
          ) : null}
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-lg border border-stone-700 bg-stone-950 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Total Views</p>
              <p className="mt-1 text-xl text-stone-100">{tiktokStats.views.toLocaleString()}</p>
            </article>
            <article className="rounded-lg border border-stone-700 bg-stone-950 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Total Likes</p>
              <p className="mt-1 text-xl text-stone-100">{tiktokStats.likes.toLocaleString()}</p>
            </article>
            <article className="rounded-lg border border-stone-700 bg-stone-950 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Avg Engagement</p>
              <p className="mt-1 text-xl text-stone-100">{formatPercent(tiktokStats.avgEngagementRate)}</p>
            </article>
            <article className="rounded-lg border border-stone-700 bg-stone-950 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Avg Save Rate</p>
              <p className="mt-1 text-xl text-stone-100">{formatPercent(tiktokStats.avgSaveRate)}</p>
            </article>
          </div>
          <div className="mt-5 rounded-xl border border-stone-700 bg-stone-950 p-4">
            <h3 className="text-sm uppercase tracking-[0.2em] text-stone-400">Live Analytics</h3>
            <p className="mt-1 text-sm text-stone-300">
              Live stream tracking has moved to a dedicated page with curves for viewers, likes, messages, gifts, and
              diamonds.
            </p>
            <Link
              href="/live"
              className="mt-3 inline-flex rounded-lg border border-amber-200/60 bg-amber-100/10 px-3 py-2 text-sm text-amber-50"
            >
              Open Live Dashboard
            </Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm text-stone-300">
              <thead className="text-xs uppercase tracking-[0.18em] text-stone-500">
                <tr>
                  <th className="px-3 py-2">Posted</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Views</th>
                  <th className="px-3 py-2">Likes</th>
                  <th className="px-3 py-2">Comments</th>
                  <th className="px-3 py-2">Shares</th>
                  <th className="px-3 py-2">Saves</th>
                  <th className="px-3 py-2">Engagement</th>
                  <th className="px-3 py-2">Save Rate</th>
                  <th className="px-3 py-2">Music</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Link</th>
                </tr>
              </thead>
              <tbody>
                {state.tiktokVideos.map((video) => {
                  const interactions = video.likes + video.comments + video.shares + video.saves;
                  const engagementRate = video.views > 0 ? interactions / video.views : 0;
                  const saveRate = video.views > 0 ? video.saves / video.views : 0;
                  return (
                    <tr key={video.id} className="border-t border-stone-700/80">
                      <td className="px-3 py-3 text-xs text-stone-400">
                        {video.postedAt ? formatDateTime(video.postedAt) : "-"}
                      </td>
                      <td className="px-3 py-3">{shortText(video.description || "(No description)")}</td>
                      <td className="px-3 py-3">{video.views.toLocaleString()}</td>
                      <td className="px-3 py-3">{video.likes.toLocaleString()}</td>
                      <td className="px-3 py-3">{video.comments.toLocaleString()}</td>
                      <td className="px-3 py-3">{video.shares.toLocaleString()}</td>
                      <td className="px-3 py-3">{video.saves.toLocaleString()}</td>
                      <td className="px-3 py-3">{formatPercent(engagementRate)}</td>
                      <td className="px-3 py-3">{formatPercent(saveRate)}</td>
                      <td className="px-3 py-3">{shortText(video.musicTitle ?? "-", 40)}</td>
                      <td className="px-3 py-3 text-xs text-stone-400">{video.scrapedSource ?? "-"}</td>
                      <td className="px-3 py-3">
                        <a
                          href={video.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-200 hover:text-amber-100"
                        >
                          open
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "spotify" ? (
        <section className="rounded-2xl border border-stone-700 bg-stone-900 p-6">
          <h2 className="text-xl text-stone-100">Spotify Synced Catalog</h2>
          <p className="mt-1 text-sm text-stone-400">{state.spotifyTracks.length} tracks loaded.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              value={spotifyFilter}
              onChange={(event) => setSpotifyFilter(event.target.value)}
              placeholder="Search song, album, label..."
              className="rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
            />
            <span className="rounded-full bg-stone-800 px-3 py-1 text-xs text-stone-200">
              mine: {spotifyMineCount}
            </span>
            <span className="rounded-full bg-stone-800 px-3 py-1 text-xs text-stone-200">
              label/distributed: {state.spotifyTracks.length - spotifyMineCount}
            </span>
            {latestSpotifySync ? (
              <span className="rounded-full bg-stone-800 px-3 py-1 text-xs text-stone-200">
                {latestSpotifySync.message ?? "Latest Spotify sync complete"}
              </span>
            ) : null}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm text-stone-300">
              <thead className="text-xs uppercase tracking-[0.18em] text-stone-500">
                <tr>
                  <th className="px-3 py-2">Track</th>
                  <th className="px-3 py-2">Album</th>
                  <th className="px-3 py-2">Label / Publisher</th>
                  <th className="px-3 py-2">Ownership</th>
                  <th className="px-3 py-2">Share</th>
                  <th className="px-3 py-2">Popularity</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Spotify</th>
                </tr>
              </thead>
              <tbody>
                {filteredSpotifyTracks.map((track) => (
                  <tr key={track.id} className="border-t border-stone-700/80">
                    <td className="px-3 py-3">{shortText(track.name, 60)}</td>
                    <td className="px-3 py-3">{shortText(track.albumName ?? "-", 40)}</td>
                    <td className="px-3 py-3">
                      <p>{shortText(track.albumLabel ?? "-", 40)}</p>
                      <p className="text-xs text-stone-500">{shortText(track.publisher ?? "-", 42)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={track.ownershipStatus as "AUTO" | "MINE" | "NOT_MINE"}
                        onChange={(event) =>
                          updateTrackOwnership(
                            track.spotifyId,
                            event.target.value as "AUTO" | "MINE" | "NOT_MINE"
                          )
                        }
                        className="rounded border border-stone-600 bg-stone-950 px-2 py-1 text-xs text-stone-200"
                      >
                        <option value="AUTO">Auto</option>
                        <option value="MINE">Mine</option>
                        <option value="NOT_MINE">Not mine</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">{formatPercent(track.ownershipShare ?? 0.5)}</td>
                    <td className="px-3 py-3">{track.popularity ?? "-"}</td>
                    <td className="px-3 py-3">{formatDurationMs(track.durationMs)}</td>
                    <td className="px-3 py-3">
                      {track.externalUrl ? (
                        <a href={track.externalUrl} target="_blank" rel="noreferrer" className="text-amber-200">
                          open
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-stone-500">{shortText(track.uri ?? "-", 32)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "learning" ? (
        <section className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-stone-700 bg-stone-900 p-6">
            <h2 className="text-xl text-stone-100">Latest Learnings</h2>
            <div className="mt-3 space-y-3">
              {state.insights.length === 0 ? (
                <p className="text-sm text-stone-400">No learning entries yet.</p>
              ) : (
                state.insights.slice(0, 12).map((insight) => (
                  <article key={insight.id} className="rounded-xl border border-stone-700 bg-stone-950 p-3">
                    <p className="text-sm font-medium text-stone-200">{insight.title}</p>
                    <p className="mt-1 text-xs text-stone-400">{insight.detail}</p>
                    <p className="mt-2 text-sm text-amber-100">{insight.action}</p>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-700 bg-stone-900 p-6">
            <h2 className="text-xl text-stone-100">Pattern Leaderboard</h2>
            <div className="mt-3 space-y-2">
              {state.patterns.length === 0 ? (
                <p className="text-sm text-stone-400">Patterns appear after experiments.</p>
              ) : (
                state.patterns.slice(0, 15).map((pattern) => (
                  <article key={pattern.key} className="rounded-xl border border-stone-700 bg-stone-950 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-stone-200">{pattern.key}</p>
                      <p className="text-xs text-stone-400">{pattern.attempts} tests</p>
                    </div>
                    <p className="mt-1 text-xs text-stone-400">{pattern.description}</p>
                    <div className="mt-2 flex gap-4 text-xs text-stone-300">
                      <span>avg score {(pattern.avgScore ?? 0).toFixed(2)}</span>
                      <span>spotify lift {formatPercent(pattern.avgSpotifyLift ?? 0)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
