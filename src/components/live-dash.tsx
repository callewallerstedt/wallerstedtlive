"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LiveDashboardState } from "@/lib/types";

type Toast = {
  type: "success" | "error" | "info";
  text: string;
};

type PlayerSource = "youtube" | "spotify";

type YouTubeResult = {
  videoId: string;
  title: string;
  channelTitle: string;
  viewCountText: string | null;
  thumbnailUrl: string | null;
  url: string;
  embedUrl: string;
  query: string;
};

type ChartPoint = {
  label: string;
  value: number;
};

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function pointsToPolyline(points: ChartPoint[], width: number, height: number, padding: number): string {
  if (points.length === 0) {
    return "";
  }
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const xStep = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  return points
    .map((point, index) => {
      const x = padding + index * xStep;
      const y = height - padding - (point.value / maxValue) * innerHeight;
      return `${x},${y}`;
    })
    .join(" ");
}

function ViewerChart({ points }: { points: ChartPoint[] }) {
  const width = 900;
  const height = 240;
  const padding = 28;
  const line = pointsToPolyline(points, width, height, padding);
  const maxValue = points.length ? Math.max(...points.map((point) => point.value)) : 0;

  return (
    <article className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-stone-100">Viewer Graph</h2>
        <p className="text-xs text-stone-400">peak {maxValue.toLocaleString()}</p>
      </div>
      {points.length === 0 ? (
        <p className="mt-3 text-sm text-stone-400">No samples yet.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-52 w-full">
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#44403c" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#44403c" />
            <polyline fill="none" stroke="#facc15" strokeWidth="3" points={line} />
          </svg>
          <div className="mt-2 flex items-center justify-between text-xs text-stone-500">
            <span>{points[0]?.label ?? "-"}</span>
            <span>{points[points.length - 1]?.label ?? "-"}</span>
          </div>
        </>
      )}
    </article>
  );
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
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
    if (normalizedComment.includes(normalizedTrack)) {
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

    const artist = track.artistName ? normalizeText(track.artistName) : "";
    if (artist && normalizedComment.includes(artist)) {
      score += 10;
    }

    // Only a slight ownership preference, and only when the track name is explicitly mentioned.
    if (track.isOwnedByYou && normalizedComment.includes(normalizedTrack)) {
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

function openExternalUrl(url: string) {
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.location.assign(url);
  }
}

export function LiveDash() {
  const [state, setState] = useState<LiveDashboardState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [username, setUsername] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState<string>("");
  const [playerSource, setPlayerSource] = useState<PlayerSource>("youtube");
  const [youtubeResult, setYoutubeResult] = useState<YouTubeResult | null>(null);
  const [youtubeCandidates, setYoutubeCandidates] = useState<YouTubeResult[]>([]);
  const [isResolvingYoutube, setIsResolvingYoutube] = useState(false);
  const [lastClickedComment, setLastClickedComment] = useState<string>("");
  const [testComment, setTestComment] = useState("");
  const commentsRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function refreshState() {
    try {
      const response = await fetch("/api/tiktok/live/state", { cache: "no-store" });
      const data = (await response.json()) as LiveDashboardState | { error: string };
      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Failed to load live dash");
      }

      setState(data);
      setUsername((prev) => prev || data.config.tiktokHandle || "");
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to load live dash" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshState();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshState();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();

  const activeSession = useMemo(() => {
    if (!state) {
      return null;
    }
    const sessions = state.liveSessions.filter(
      (session) => !normalizedUsername || session.username.toLowerCase() === normalizedUsername
    );
    if (sessions.length === 0) {
      return null;
    }
    return sessions.find((session) => !session.endedAt) ?? sessions[0];
  }, [normalizedUsername, state]);

  const comments = useMemo(() => {
    if (!activeSession) {
      return [];
    }
    return [...activeSession.comments]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-250);
  }, [activeSession]);

  const viewerCurve = useMemo(() => {
    if (!activeSession) {
      return [] as ChartPoint[];
    }
    return [...activeSession.samples]
      .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
      .slice(-300)
      .map((sample) => ({
        label: formatDateTime(sample.capturedAt),
        value: sample.viewerCount,
      }));
  }, [activeSession]);

  useEffect(() => {
    if (!commentsRef.current) {
      return;
    }
    commentsRef.current.scrollTop = commentsRef.current.scrollHeight;
  }, [activeSession?.id, comments.length]);

  const selectedTrack = useMemo(() => {
    if (!state || !selectedTrackId) {
      return null;
    }
    return state.spotifyTracks.find((track) => track.id === selectedTrackId) ?? null;
  }, [selectedTrackId, state]);

  async function startTracking() {
    const handle = username.trim();
    if (!handle) {
      setToast({ type: "error", text: "Enter username first." });
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch("/api/tiktok/live/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: handle, collectChatEvents: true }),
      });
      const data = (await response.json()) as { error?: string; message?: string; started?: boolean };
      if (!response.ok) {
        throw new Error(data.error ?? "Start failed");
      }
      setToast({
        type: data.started ? "success" : "info",
        text: data.message ?? (data.started ? "Live tracking started." : "Tracking not started."),
      });
      await refreshState();
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
      await refreshState();
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
        snapshot?: { isLive: boolean; viewerCount: number; likeCount: number; enterCount: number };
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Check failed");
      }
      if (data.snapshot) {
        setToast({
          type: "info",
          text: `Live ${data.snapshot.isLive ? "on" : "off"} | viewers ${data.snapshot.viewerCount.toLocaleString()} | likes ${data.snapshot.likeCount.toLocaleString()}`,
        });
      }
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Check failed" });
    } finally {
      setIsBusy(false);
    }
  }

  function openSpotifySearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    const url = `https://open.spotify.com/search/${encodeURIComponent(trimmed)}`;
    openExternalUrl(url);
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

  function selectYoutubeResult(result: YouTubeResult) {
    setYoutubeResult(result);
    setToast({ type: "success", text: `Playing on YouTube: ${result.title}` });
  }

  async function playOnYoutube(query: string, options?: { autoPlayFirst?: boolean }) {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setIsResolvingYoutube(true);
    try {
      const results = await searchYoutube(trimmed, 5);
      setYoutubeCandidates(results);

      if (results.length === 0) {
        setYoutubeResult(null);
        setToast({ type: "error", text: "No YouTube matches found." });
        return;
      }

      if (options?.autoPlayFirst || results.length === 1) {
        selectYoutubeResult(results[0]);
      } else {
        setYoutubeResult(null);
        setToast({ type: "info", text: "Multiple matches found. Pick one below." });
      }
    } catch (error) {
      setToast({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to play on YouTube",
      });
      throw error;
    } finally {
      setIsResolvingYoutube(false);
    }
  }

  async function playOrOpenTrack(
    track: NonNullable<ReturnType<typeof findTrackForComment>>,
    contextText: string
  ) {
    setYoutubeResult(null);
    setYoutubeCandidates([]);
    setSelectedTrackId(track.id);

    if (track.previewUrl && audioRef.current) {
      try {
        const audio = audioRef.current;
        audio.src = track.previewUrl;
        audio.load();
        await audio.play();
        setToast({ type: "success", text: `Playing preview: ${track.name}` });
        return;
      } catch {
        if (track.externalUrl) {
          openExternalUrl(track.externalUrl);
          setToast({
            type: "info",
            text: `Autoplay blocked. Opened Spotify for ${track.name}.`,
          });
          return;
        }
      }
    }

    if (track.externalUrl) {
      openExternalUrl(track.externalUrl);
      setToast({ type: "info", text: `Opened Spotify for ${track.name}.` });
      return;
    }

    openSpotifySearch(track.name);
    setToast({ type: "info", text: `No direct URL found. Opened Spotify search for "${contextText}".` });
  }

  function isExactOwnedMatch(comment: string, track: NonNullable<ReturnType<typeof findTrackForComment>>) {
    if (!track.isOwnedByYou) {
      return false;
    }
    const normalizedComment = normalizeText(comment);
    const normalizedTrack = normalizeText(track.name);
    return normalizedTrack.length >= 3 && normalizedComment.includes(normalizedTrack);
  }

  async function handleCommentClick(comment: string) {
    if (!state) {
      return;
    }

    const text = comment.trim();
    if (!text) {
      setToast({ type: "error", text: "Comment text is empty." });
      return;
    }

    setLastClickedComment(text);
    const matched = findTrackForComment(text, state.spotifyTracks);

    if (playerSource === "youtube") {
      try {
        if (matched && isExactOwnedMatch(text, matched)) {
          setSelectedTrackId(matched.id);
          const query = `${matched.name} ${matched.artistName ?? ""} official audio`.trim();
          await playOnYoutube(query, { autoPlayFirst: true });
        } else {
          if (matched) {
            setSelectedTrackId(matched.id);
            const query = `${matched.name} ${matched.artistName ?? ""}`.trim();
            await playOnYoutube(query, { autoPlayFirst: false });
          } else {
            setSelectedTrackId("");
            await playOnYoutube(text, { autoPlayFirst: false });
          }
        }
        return;
      } catch {
        if (matched) {
          await playOrOpenTrack(matched, text);
        } else {
          openSpotifySearch(text);
          setToast({
            type: "info",
            text: "YouTube failed. Opened Spotify search for that comment.",
          });
        }
        return;
      }
    }

    if (matched) {
      await playOrOpenTrack(matched, text);
      return;
    }

    openSpotifySearch(text);
    setToast({
      type: "info",
      text: "No exact local match. Opened Spotify search for that comment.",
    });
  }

  async function handleTestComment() {
    const text = testComment.trim();
    if (!text) {
      setToast({ type: "error", text: "Enter test comment text first." });
      return;
    }
    await handleCommentClick(text);
  }

  if (isLoading || !state) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-7xl items-center justify-center px-6 py-10 md:px-10">
        <p className="tracking-wide text-stone-300">Loading live dash...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-10 md:px-10">
      <section className="rounded-2xl border border-stone-700 bg-stone-900 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="@username"
            className="rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
          />
          <button
            onClick={startTracking}
            disabled={isBusy}
            className="rounded-lg border border-emerald-300/60 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100 disabled:opacity-50"
          >
            Start
          </button>
          <button
            onClick={stopTracking}
            disabled={isBusy}
            className="rounded-lg border border-red-300/60 bg-red-400/10 px-3 py-2 text-sm text-red-100 disabled:opacity-50"
          >
            Stop
          </button>
          <button
            onClick={checkLive}
            disabled={isBusy}
            className="rounded-lg border border-stone-500 bg-stone-800 px-3 py-2 text-sm text-stone-100 disabled:opacity-50"
          >
            Check
          </button>
          <span className="ml-2 text-xs uppercase tracking-[0.2em] text-stone-500">Player</span>
          <button
            onClick={() => setPlayerSource("youtube")}
            className={`rounded-lg border px-3 py-2 text-sm ${
              playerSource === "youtube"
                ? "border-red-300/60 bg-red-400/10 text-red-100"
                : "border-stone-600 bg-stone-800 text-stone-200"
            }`}
          >
            YouTube
          </button>
          <button
            onClick={() => setPlayerSource("spotify")}
            className={`rounded-lg border px-3 py-2 text-sm ${
              playerSource === "spotify"
                ? "border-emerald-300/60 bg-emerald-400/10 text-emerald-100"
                : "border-stone-600 bg-stone-800 text-stone-200"
            }`}
          >
            Spotify
          </button>
          {toast ? (
            <span
              className={`ml-1 rounded-full px-3 py-1 text-xs ${
                toast.type === "error"
                  ? "bg-red-300/10 text-red-200"
                  : toast.type === "success"
                    ? "bg-emerald-300/10 text-emerald-200"
                    : "bg-amber-300/10 text-amber-200"
              }`}
            >
              {toast.text}
            </span>
          ) : null}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Status</p>
          <p className="mt-1 text-xl text-stone-100">{activeSession && !activeSession.endedAt ? "LIVE" : "idle"}</p>
        </article>
        <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Viewers</p>
          <p className="mt-1 text-xl text-stone-100">{activeSession?.viewerCountPeak.toLocaleString() ?? "0"}</p>
        </article>
        <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Likes</p>
          <p className="mt-1 text-xl text-stone-100">{activeSession?.likeCountLatest.toLocaleString() ?? "0"}</p>
        </article>
        <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Enters</p>
          <p className="mt-1 text-xl text-stone-100">{activeSession?.enterCountLatest.toLocaleString() ?? "0"}</p>
        </article>
        <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Comments</p>
          <p className="mt-1 text-xl text-stone-100">{activeSession?.totalCommentEvents.toLocaleString() ?? "0"}</p>
        </article>
      </section>

      <ViewerChart points={viewerCurve} />

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
          <h2 className="text-lg text-stone-100">Live Comments</h2>
          <p className="mt-1 text-sm text-stone-400">
            Click a comment to auto-match and play by your selected player source.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={testComment}
              onChange={(event) => setTestComment(event.target.value)}
              placeholder="Test comment text (for example: play moonlight sonata)"
              className="min-w-[260px] flex-1 rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
            />
            <button
              onClick={() => {
                void handleTestComment();
              }}
              className="rounded-lg border border-amber-200/60 bg-amber-100/10 px-3 py-2 text-sm text-amber-100"
            >
              Try Test Comment
            </button>
          </div>
          <div ref={commentsRef} className="mt-3 max-h-[62vh] space-y-2 overflow-auto pr-1">
            {comments.length === 0 ? (
              <p className="text-sm text-stone-400">No comments yet.</p>
            ) : (
              comments.map((comment) => (
                <button
                  key={comment.id}
                  onClick={() => {
                    void handleCommentClick(comment.comment);
                  }}
                  className="w-full rounded-lg border border-stone-700 bg-stone-950 p-3 text-left text-sm text-stone-200 hover:border-amber-200/40"
                >
                  <p className="text-xs text-stone-500">
                    {formatDateTime(comment.createdAt)} | @{comment.userUniqueId ?? "viewer"}
                  </p>
                  <p className="mt-1">{comment.comment}</p>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg text-stone-100">Now Playing</h2>
            <p className="text-xs text-stone-500">source: {playerSource}</p>
          </div>

          {playerSource === "youtube" ? (
            <div className="mt-2 space-y-2">
              {isResolvingYoutube ? <p className="text-xs text-amber-200">Loading YouTube video...</p> : null}
              {youtubeResult ? (
                <>
                  <div className="aspect-video overflow-hidden rounded-lg border border-stone-700 bg-black">
                    <iframe
                      src={youtubeResult.embedUrl}
                      title={youtubeResult.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                      className="h-full w-full"
                    />
                  </div>
                  <p className="text-sm text-stone-200">{youtubeResult.title}</p>
                  <p className="text-xs text-stone-500">{youtubeResult.channelTitle}</p>
                  <a
                    href={youtubeResult.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded border border-red-300/50 bg-red-400/10 px-2 py-1 text-xs text-red-100"
                  >
                    Open on YouTube
                  </a>
                </>
              ) : (
                <p className="text-sm text-stone-400">Click a comment to play on YouTube.</p>
              )}
              {youtubeCandidates.length > 1 ? (
                <div className="mt-3 space-y-2 rounded-lg border border-stone-700 bg-stone-950 p-2">
                  <p className="text-xs uppercase tracking-[0.15em] text-stone-500">Choose Match</p>
                  <div className="space-y-1">
                    {youtubeCandidates.map((candidate) => (
                      <button
                        key={candidate.videoId}
                        onClick={() => selectYoutubeResult(candidate)}
                        className={`w-full rounded border px-2 py-2 text-left text-xs ${
                          youtubeResult?.videoId === candidate.videoId
                            ? "border-red-300/60 bg-red-400/10 text-red-100"
                            : "border-stone-700 bg-stone-900 text-stone-200"
                        }`}
                      >
                        <p className="truncate">{candidate.title}</p>
                        <p className="mt-1 truncate text-stone-500">
                          {candidate.channelTitle}
                          {candidate.viewCountText ? ` | ${candidate.viewCountText}` : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <audio ref={audioRef} controls className="w-full" />
              {selectedTrack ? (
                <div className="space-y-2">
                  <p className="text-sm text-stone-200">{selectedTrack.name}</p>
                  <p className="text-xs text-stone-500">{selectedTrack.artistName ?? "Unknown artist"}</p>
                  {selectedTrack.externalUrl ? (
                    <a
                      href={selectedTrack.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded border border-amber-200/50 bg-amber-100/10 px-2 py-1 text-xs text-amber-100"
                    >
                      Open in Spotify
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-stone-400">Click a comment to match and play a song.</p>
              )}
            </div>
          )}

          {lastClickedComment ? (
            <div className="mt-4 rounded-lg border border-stone-700 bg-stone-950 p-2">
              <p className="text-xs text-stone-500">Last clicked comment</p>
              <p className="mt-1 text-sm text-stone-300">{lastClickedComment}</p>
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );
}
