"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LiveDashboardState } from "@/lib/types";

type Toast = {
  type: "success" | "error" | "info";
  text: string;
};

type QuickSnapshot = {
  isLive: boolean;
  roomId?: string;
  viewerCount: number;
  likeCount: number;
  enterCount: number;
  statusCode?: number;
};

type ChartPoint = {
  label: string;
  value: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString();
}

function shortText(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function formatClock(value: Date): string {
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

function pointY(value: number, maxValue: number, height: number, padding: number): number {
  const innerHeight = height - padding * 2;
  if (maxValue <= 0) {
    return height - padding;
  }
  return height - padding - (value / maxValue) * innerHeight;
}

function StatLineChart({
  title,
  colorClass,
  points,
  valueLabel,
}: {
  title: string;
  colorClass: string;
  points: ChartPoint[];
  valueLabel?: string;
}) {
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<{ x: number; index: number } | null>(null);
  const width = 720;
  const height = 230;
  const padding = 26;
  const polyline = pointsToPolyline(points, width, height, padding);
  const maxValue = points.length ? Math.max(...points.map((point) => point.value)) : 0;
  const safeMax = Math.max(maxValue, 1);
  const innerWidth = width - padding * 2;
  const xStep = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  const scheduleHover = (nextHover: { x: number; index: number } | null) => {
    pendingHoverRef.current = nextHover;
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setHover((current) => {
        const pending = pendingHoverRef.current;
        if (current === null && pending === null) {
          return current;
        }
        if (
          current &&
          pending &&
          current.index === pending.index &&
          Math.abs(current.x - pending.x) < 0.5
        ) {
          return current;
        }
        return pending;
      });
    });
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const hoveredPoint = hover !== null ? points[hover.index] : null;
  const hoveredX = hover?.x ?? null;
  const hoveredY = hoveredPoint ? pointY(hoveredPoint.value, safeMax, height, padding) : null;

  return (
    <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm uppercase tracking-[0.2em] text-stone-400">{title}</p>
        <p className="text-xs text-stone-400">max {maxValue.toLocaleString()}</p>
      </div>
      {points.length > 0 ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-3 h-44 w-full touch-none select-none"
          style={{ touchAction: "none" }}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = ((event.clientX - rect.left) / rect.width) * width;
            const clampedX = clamp(relativeX, padding, width - padding);
            const raw = xStep > 0 ? Math.round((clampedX - padding) / xStep) : 0;
            scheduleHover({ x: clampedX, index: clamp(raw, 0, points.length - 1) });
          }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = ((event.clientX - rect.left) / rect.width) * width;
            const clampedX = clamp(relativeX, padding, width - padding);
            const raw = xStep > 0 ? Math.round((clampedX - padding) / xStep) : 0;
            scheduleHover({ x: clampedX, index: clamp(raw, 0, points.length - 1) });
          }}
          onPointerLeave={() => scheduleHover(null)}
        >
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#44403c" />
          <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#44403c" />
          <polyline fill="none" strokeWidth="3" points={polyline} className={colorClass} />
          {hoveredX !== null && hoveredY !== null ? (
            <>
              <line
                x1={hoveredX}
                y1={padding}
                x2={hoveredX}
                y2={height - padding}
                stroke="#a8a29e"
                strokeDasharray="5 4"
              />
              <circle cx={hoveredX} cy={hoveredY} r="4" fill="#f5f5f4" />
            </>
          ) : null}
        </svg>
      ) : (
        <p className="mt-3 text-sm text-stone-400">No chart points yet.</p>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-stone-500">
        <span>{points[0]?.label ?? "-"}</span>
        {hoveredPoint ? (
          <span className="rounded-full border border-stone-600 bg-stone-950 px-2 py-0.5 text-stone-300">
            {hoveredPoint.label} | {hoveredPoint.value.toLocaleString()}
            {valueLabel ? ` ${valueLabel}` : ""}
          </span>
        ) : (
          <span>hover for value</span>
        )}
        <span>{points[points.length - 1]?.label ?? "-"}</span>
      </div>
    </article>
  );
}

function EventTimelineChart({
  title,
  primaryLabel,
  primaryColorClass,
  primaryDotClass,
  primary,
  secondaryLabel,
  secondaryColorClass,
  secondaryDotClass,
  secondary,
}: {
  title: string;
  primaryLabel: string;
  primaryColorClass: string;
  primaryDotClass: string;
  primary: ChartPoint[];
  secondaryLabel: string;
  secondaryColorClass: string;
  secondaryDotClass: string;
  secondary: ChartPoint[];
}) {
  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<{ x: number; index: number } | null>(null);
  const width = 720;
  const height = 230;
  const padding = 26;
  const allValues = [...primary.map((point) => point.value), ...secondary.map((point) => point.value)];
  const maxValue = allValues.length ? Math.max(...allValues) : 0;
  const safeMax = Math.max(maxValue, 1);
  const primaryLine = pointsToPolyline(primary, width, height, padding);
  const secondaryLine = pointsToPolyline(secondary, width, height, padding);
  const pointsLength = Math.max(primary.length, secondary.length);
  const innerWidth = width - padding * 2;
  const xStep = pointsLength > 1 ? innerWidth / (pointsLength - 1) : 0;

  const scheduleHover = (nextHover: { x: number; index: number } | null) => {
    pendingHoverRef.current = nextHover;
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setHover((current) => {
        const pending = pendingHoverRef.current;
        if (current === null && pending === null) {
          return current;
        }
        if (
          current &&
          pending &&
          current.index === pending.index &&
          Math.abs(current.x - pending.x) < 0.5
        ) {
          return current;
        }
        return pending;
      });
    });
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const hoveredPrimary = hover !== null ? primary[hover.index] : null;
  const hoveredSecondary = hover !== null ? secondary[hover.index] : null;
  const hoveredX = hover?.x ?? null;
  const hoveredPrimaryY = hoveredPrimary ? pointY(hoveredPrimary.value, safeMax, height, padding) : null;
  const hoveredSecondaryY = hoveredSecondary ? pointY(hoveredSecondary.value, safeMax, height, padding) : null;
  const hoverLabel = hoveredPrimary?.label ?? hoveredSecondary?.label;

  return (
    <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm uppercase tracking-[0.2em] text-stone-400">{title}</p>
        <p className="text-xs text-stone-400">max {maxValue.toLocaleString()}</p>
      </div>
      {primary.length > 0 ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-3 h-44 w-full touch-none select-none"
          style={{ touchAction: "none" }}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = ((event.clientX - rect.left) / rect.width) * width;
            const clampedX = clamp(relativeX, padding, width - padding);
            const raw = xStep > 0 ? Math.round((clampedX - padding) / xStep) : 0;
            scheduleHover({ x: clampedX, index: clamp(raw, 0, Math.max(0, pointsLength - 1)) });
          }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = ((event.clientX - rect.left) / rect.width) * width;
            const clampedX = clamp(relativeX, padding, width - padding);
            const raw = xStep > 0 ? Math.round((clampedX - padding) / xStep) : 0;
            scheduleHover({ x: clampedX, index: clamp(raw, 0, Math.max(0, pointsLength - 1)) });
          }}
          onPointerLeave={() => scheduleHover(null)}
        >
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#44403c" />
          <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#44403c" />
          <polyline fill="none" strokeWidth="3" points={primaryLine} className={primaryColorClass} />
          <polyline fill="none" strokeWidth="3" points={secondaryLine} className={secondaryColorClass} />
          {hoveredX !== null ? (
            <line
              x1={hoveredX}
              y1={padding}
              x2={hoveredX}
              y2={height - padding}
              stroke="#a8a29e"
              strokeDasharray="5 4"
            />
          ) : null}
          {hoveredX !== null && hoveredPrimaryY !== null ? <circle cx={hoveredX} cy={hoveredPrimaryY} r="4" fill="#c4b5fd" /> : null}
          {hoveredX !== null && hoveredSecondaryY !== null ? <circle cx={hoveredX} cy={hoveredSecondaryY} r="4" fill="#f9a8d4" /> : null}
        </svg>
      ) : (
        <p className="mt-3 text-sm text-stone-400">No event points yet.</p>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-stone-500">
        <span className={`inline-block h-2 w-2 rounded-full ${primaryDotClass}`} />
        <span>{primaryLabel}</span>
        <span className={`inline-block h-2 w-2 rounded-full ${secondaryDotClass}`} />
        <span>{secondaryLabel}</span>
        {hoverLabel ? (
          <span className="ml-auto rounded-full border border-stone-600 bg-stone-950 px-2 py-0.5 text-stone-300">
            {hoverLabel} | {primaryLabel}: {(hoveredPrimary?.value ?? 0).toLocaleString()} | {secondaryLabel}:{" "}
            {(hoveredSecondary?.value ?? 0).toLocaleString()}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function LiveDashboard() {
  const [state, setState] = useState<LiveDashboardState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [quickSnapshot, setQuickSnapshot] = useState<QuickSnapshot | null>(null);
  const [liveDraft, setLiveDraft] = useState({
    username: "",
    collectChatEvents: true,
  });

  async function loadState() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/tiktok/live/state?runtime=1", { cache: "no-store" });
      const data = (await response.json()) as LiveDashboardState | { error: string };
      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Failed to load live data");
      }

      setState(data);
      setLiveDraft((prev) => ({
        ...prev,
        username: prev.username || data.config.tiktokHandle || "",
      }));
      setSelectedSessionId((prev) => prev || data.liveSessions[0]?.id || "");
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Failed to load live data" });
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshStateSilently() {
    try {
      const response = await fetch("/api/tiktok/live/state?runtime=1", { cache: "no-store" });
      const data = (await response.json()) as LiveDashboardState | { error: string };
      if (!response.ok || "error" in data) {
        return;
      }
      setState(data);
      setSelectedSessionId((prev) => prev || data.liveSessions[0]?.id || "");
    } catch {
      // ignore background refresh failures
    }
  }

  useEffect(() => {
    loadState().catch(() => undefined);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshStateSilently();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  async function runAction(action: () => Promise<void>, successMessage: string) {
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

  async function checkLiveByUsername() {
    const username = liveDraft.username.trim();
    if (!username) {
      setToast({ type: "error", text: "Enter a username for live check." });
      return;
    }

    await runAction(async () => {
      const response = await fetch("/api/tiktok/live/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = (await response.json()) as { error?: string; snapshot?: QuickSnapshot };
      if (!response.ok) {
        throw new Error(data.error ?? "Live check failed");
      }
      setQuickSnapshot(data.snapshot ?? null);
    }, "Live status fetched.");
  }

  async function trackLiveSession() {
    const username = liveDraft.username.trim();
    if (!username) {
      setToast({ type: "error", text: "Enter a username for live tracking." });
      return;
    }
    setIsBusy(true);
    setToast({ type: "info", text: "Starting live tracker..." });
    try {
      const response = await fetch("/api/tiktok/live/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          collectChatEvents: liveDraft.collectChatEvents,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        sessionId?: string;
        started?: boolean;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Live tracking failed");
      }
      if (data.sessionId) {
        setSelectedSessionId(data.sessionId);
      }
      await refreshStateSilently();
      setToast({
        type: data.started ? "success" : "info",
        text: data.message ?? (data.started ? "Live tracking started." : "Tracking already running."),
      });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Live tracking failed" });
    } finally {
      setIsBusy(false);
    }
  }

  async function stopLiveSession() {
    const username = liveDraft.username.trim();
    if (!username) {
      setToast({ type: "error", text: "Enter a username to stop tracking." });
      return;
    }

    setIsBusy(true);
    setToast({ type: "info", text: "Stopping live tracker..." });
    try {
      const response = await fetch("/api/tiktok/live/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = (await response.json()) as {
        error?: string;
        stopped?: boolean;
        sessionId?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Live stop failed");
      }
      if (data.sessionId) {
        setSelectedSessionId(data.sessionId);
      }
      await refreshStateSilently();
      setToast({ type: "success", text: data.message ?? "Stop signal sent." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Live stop failed" });
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteLiveSession(sessionId: string) {
    setIsBusy(true);
    setToast({ type: "info", text: "Deleting session..." });
    try {
      const response = await fetch(`/api/tiktok/live/session/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string; deleted?: boolean; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Delete failed");
      }

      if (selectedSessionId === sessionId) {
        setSelectedSessionId("");
      }
      await refreshStateSilently();
      setToast({ type: "success", text: data.message ?? "Session deleted." });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "Delete failed" });
    } finally {
      setIsBusy(false);
    }
  }

  const selectedSession = useMemo(() => {
    if (!state) {
      return null;
    }
    return state.liveSessions.find((session) => session.id === selectedSessionId) ?? state.liveSessions[0] ?? null;
  }, [selectedSessionId, state]);

  const chartData = useMemo(() => {
    if (!selectedSession) {
      return {
        viewerCurve: [] as ChartPoint[],
        likeCurve: [] as ChartPoint[],
        enterCurve: [] as ChartPoint[],
        messageCurve: [] as ChartPoint[],
        giftCurve: [] as ChartPoint[],
        diamondCurve: [] as ChartPoint[],
      };
    }

    const samples = [...selectedSession.samples].sort(
      (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()
    );
    const viewerCurve = samples.map((sample) => ({
      label: formatClock(new Date(sample.capturedAt)),
      value: sample.viewerCount,
    }));
    const likeCurve: ChartPoint[] = [];
    let previousLike = 0;
    let firstNonZeroSeen = false;
    for (const sample of samples) {
      const likeCount = Math.max(previousLike, sample.likeCount);
      const label = formatClock(new Date(sample.capturedAt));
      if (!firstNonZeroSeen) {
        likeCurve.push({ label, value: 0 });
        if (likeCount > 0) {
          firstNonZeroSeen = true;
        }
        previousLike = likeCount;
        continue;
      }

      likeCurve.push({
        label,
        value: Math.max(0, likeCount - previousLike),
      });
      previousLike = likeCount;
    }
    const enterCurve = samples.map((sample) => ({
      label: formatClock(new Date(sample.capturedAt)),
      value: sample.enterCount,
    }));

    const startedAtMs = new Date(selectedSession.startedAt).getTime();
    const endedAtMs = new Date(selectedSession.endedAt ?? selectedSession.startedAt).getTime();
    const spanMs = Math.max(60_000, endedAtMs - startedAtMs);
    const bucketCount = Math.max(1, Math.min(24, Math.ceil(spanMs / 60_000)));
    const bucketSizeMs = Math.ceil(spanMs / bucketCount);

    const messageBuckets = new Array<number>(bucketCount).fill(0);
    const giftBuckets = new Array<number>(bucketCount).fill(0);
    const diamondBuckets = new Array<number>(bucketCount).fill(0);

    for (const comment of selectedSession.comments) {
      const diff = Math.max(0, new Date(comment.createdAt).getTime() - startedAtMs);
      const bucket = Math.min(bucketCount - 1, Math.floor(diff / bucketSizeMs));
      messageBuckets[bucket] += 1;
    }
    for (const gift of selectedSession.gifts) {
      const diff = Math.max(0, new Date(gift.createdAt).getTime() - startedAtMs);
      const bucket = Math.min(bucketCount - 1, Math.floor(diff / bucketSizeMs));
      giftBuckets[bucket] += 1;
      diamondBuckets[bucket] += gift.diamondCount * Math.max(1, gift.repeatCount);
    }

    const labels = messageBuckets.map((_, index) => {
      const offsetMs = index * bucketSizeMs;
      const bucketTime = new Date(startedAtMs + offsetMs);
      return formatClock(bucketTime);
    });
    const messageCurve = messageBuckets.map((value, index) => ({ label: labels[index], value }));
    const giftCurve = giftBuckets.map((value, index) => ({ label: labels[index], value }));
    const diamondCurve = diamondBuckets.map((value, index) => ({ label: labels[index], value }));

    return { viewerCurve, likeCurve, enterCurve, messageCurve, giftCurve, diamondCurve };
  }, [selectedSession]);

  if (isLoading || !state) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-7xl items-center justify-center px-6 py-10 md:px-10">
        <p className="tracking-wide text-stone-300">Loading live tracker...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-10 md:px-10">
      <section className="rounded-3xl border border-stone-700 bg-stone-900 p-6">
        <p className="text-xs uppercase tracking-[0.35em] text-amber-100/70">TikTok Live Intelligence</p>
        <h1 className="mt-2 text-4xl text-stone-100">Track your live stream in real time and after-action.</h1>
        <p className="mt-2 text-sm text-stone-300">
          Run tracking while you are live to store viewer curve, likes, comment velocity, gifts, and diamonds.
        </p>
        {toast ? (
          <p
            className={`mt-3 inline-flex rounded-full px-4 py-1 text-xs ${
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

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-5">
          <h2 className="text-lg text-stone-100">Live Controls</h2>
          <p className="mt-1 text-sm text-stone-400">
            Username defaults to your saved TikTok handle. Start runs continuously until you press stop.
          </p>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <input
              value={liveDraft.username}
              onChange={(event) => setLiveDraft((prev) => ({ ...prev, username: event.target.value }))}
              placeholder="@username"
              className="rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-100"
            />
            <label className="flex items-center gap-2 rounded-lg border border-stone-600 bg-stone-950 px-3 py-2 text-sm text-stone-200">
              <input
                type="checkbox"
                checked={liveDraft.collectChatEvents}
                onChange={(event) => setLiveDraft((prev) => ({ ...prev, collectChatEvents: event.target.checked }))}
              />
              collect comments + gifts
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={trackLiveSession}
              disabled={isBusy}
              className="rounded-lg border border-amber-200/60 bg-amber-100/10 px-3 py-2 text-sm text-amber-50 disabled:opacity-50"
            >
              Start Live Tracking
            </button>
            <button
              onClick={stopLiveSession}
              disabled={isBusy}
              className="rounded-lg border border-red-300/60 bg-red-400/10 px-3 py-2 text-sm text-red-100 disabled:opacity-50"
            >
              Stop Live Tracking
            </button>
            <button
              onClick={checkLiveByUsername}
              disabled={isBusy}
              className="rounded-lg border border-stone-500 bg-stone-800 px-3 py-2 text-sm text-stone-100 disabled:opacity-50"
            >
              Check Live Now
            </button>
            <button
              onClick={() => loadState().catch(() => undefined)}
              disabled={isBusy}
              className="rounded-lg border border-stone-500 bg-stone-900 px-3 py-2 text-sm text-stone-200 disabled:opacity-50"
            >
              Refresh Data
            </button>
          </div>
          {quickSnapshot ? (
            <div className="mt-3 rounded-lg border border-stone-700 bg-stone-950 p-3 text-sm text-stone-300">
              <p>
                status: {quickSnapshot.isLive ? "LIVE" : "offline"} (code {quickSnapshot.statusCode ?? "-"})
              </p>
              <p>
                viewers: {quickSnapshot.viewerCount.toLocaleString()} | likes:{" "}
                {quickSnapshot.likeCount.toLocaleString()} | enters: {quickSnapshot.enterCount.toLocaleString()}
              </p>
              <p>room: {quickSnapshot.roomId ?? "n/a"}</p>
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl border border-stone-700 bg-stone-900 p-5">
          <h2 className="text-lg text-stone-100">Recent Sessions</h2>
          <p className="mt-1 text-sm text-stone-400">{state.liveSessions.length} sessions stored.</p>
          <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
            {state.liveSessions.length === 0 ? (
              <p className="text-sm text-stone-400">No sessions tracked yet.</p>
            ) : (
              state.liveSessions.map((session) => (
                <article
                  key={session.id}
                  className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                    selectedSession?.id === session.id
                      ? "border-amber-200/60 bg-amber-100/10 text-stone-100"
                      : "border-stone-700 bg-stone-950 text-stone-300 hover:border-stone-600"
                  }`}
                >
                  <button onClick={() => setSelectedSessionId(session.id)} className="w-full text-left">
                    <p>@{session.username}</p>
                    <p className="mt-1 text-xs text-stone-400">{formatDateTime(session.startedAt)}</p>
                    <p className="mt-1 text-xs text-stone-400">
                      peak {session.viewerCountPeak.toLocaleString()} | comments {session.totalCommentEvents} | gifts{" "}
                      {session.totalGiftEvents}
                    </p>
                    <p className="mt-1 text-xs text-amber-200">{session.endedAt ? "finished" : "tracking now"}</p>
                  </button>
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => deleteLiveSession(session.id)}
                      disabled={isBusy}
                      className="rounded border border-red-300/50 bg-red-400/10 px-2 py-1 text-xs text-red-100 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      {selectedSession ? (
        <>
          <section className="grid gap-3 md:grid-cols-5">
            <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Peak Viewers</p>
              <p className="mt-1 text-2xl text-stone-100">{selectedSession.viewerCountPeak.toLocaleString()}</p>
            </article>
            <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Avg Viewers</p>
              <p className="mt-1 text-2xl text-stone-100">{selectedSession.viewerCountAvg.toFixed(1)}</p>
            </article>
            <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Comments</p>
              <p className="mt-1 text-2xl text-stone-100">{selectedSession.totalCommentEvents.toLocaleString()}</p>
            </article>
            <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Gift Events</p>
              <p className="mt-1 text-2xl text-stone-100">{selectedSession.totalGiftEvents.toLocaleString()}</p>
            </article>
            <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Diamonds</p>
              <p className="mt-1 text-2xl text-stone-100">{selectedSession.totalGiftDiamonds.toLocaleString()}</p>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <StatLineChart title="Viewer Curve" colorClass="stroke-amber-200" points={chartData.viewerCurve} valueLabel="viewers" />
            <StatLineChart
              title="Like Velocity (New Likes / Interval)"
              colorClass="stroke-emerald-300"
              points={chartData.likeCurve}
              valueLabel="likes"
            />
            <StatLineChart title="Enter Curve" colorClass="stroke-cyan-300" points={chartData.enterCurve} valueLabel="enters" />
            <EventTimelineChart
              title="Comment vs Gift Velocity"
              primaryLabel="comments per bucket"
              primaryColorClass="stroke-indigo-300"
              primaryDotClass="bg-indigo-300"
              primary={chartData.messageCurve}
              secondaryLabel="gifts per bucket"
              secondaryColorClass="stroke-pink-300"
              secondaryDotClass="bg-pink-300"
              secondary={chartData.giftCurve}
            />
            <StatLineChart
              title="Diamond Flow Curve"
              colorClass="stroke-orange-300"
              points={chartData.diamondCurve}
              valueLabel="diamonds"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
              <h3 className="text-sm uppercase tracking-[0.2em] text-stone-400">Latest Comments</h3>
              <div className="mt-3 space-y-2">
                {selectedSession.comments.length === 0 ? (
                  <p className="text-sm text-stone-400">No comments captured in this session.</p>
                ) : (
                  [...selectedSession.comments]
                    .reverse()
                    .slice(0, 12)
                    .map((comment) => (
                      <div key={comment.id} className="rounded-lg border border-stone-700 bg-stone-950 p-2 text-sm">
                        <p className="text-xs text-stone-500">{formatDateTime(comment.createdAt)}</p>
                        <p className="text-stone-300">
                          <span className="text-stone-500">{comment.nickname ?? comment.userUniqueId ?? "viewer"}:</span>{" "}
                          {shortText(comment.comment, 140)}
                        </p>
                      </div>
                    ))
                )}
              </div>
            </article>
            <article className="rounded-xl border border-stone-700 bg-stone-900 p-4">
              <h3 className="text-sm uppercase tracking-[0.2em] text-stone-400">Latest Gifts</h3>
              <div className="mt-3 space-y-2">
                {selectedSession.gifts.length === 0 ? (
                  <p className="text-sm text-stone-400">No gifts captured in this session.</p>
                ) : (
                  [...selectedSession.gifts]
                    .reverse()
                    .slice(0, 12)
                    .map((gift) => (
                      <div key={gift.id} className="rounded-lg border border-stone-700 bg-stone-950 p-2 text-sm">
                        <p className="text-xs text-stone-500">{formatDateTime(gift.createdAt)}</p>
                        <p className="text-stone-300">
                          <span className="text-stone-500">{gift.nickname ?? gift.userUniqueId ?? "viewer"}:</span>{" "}
                          {gift.giftName ?? "gift"} x{gift.repeatCount} ({gift.diamondCount} diamonds each)
                        </p>
                      </div>
                    ))
                )}
              </div>
            </article>
          </section>
        </>
      ) : (
        <section className="rounded-xl border border-stone-700 bg-stone-900 p-6">
          <p className="text-stone-400">No session selected yet.</p>
        </section>
      )}
    </div>
  );
}
