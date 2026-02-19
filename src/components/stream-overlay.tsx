"use client";

import Image from "next/image";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { OverlayGoalsState, StreamOverlayState } from "@/lib/types";

type GoalsResponse = {
  goals: OverlayGoalsState;
};

type LiveGift = {
  id: string;
  giftName: string | null;
  userUniqueId: string | null;
  nickname: string | null;
  createdAt: string | null;
};

type LiveSession = {
  id: string;
  endedAt: string | null;
  likeCountLatest: number;
  totalGiftDiamonds: number;
  gifts: LiveGift[];
};

type LiveOverlayResponse = {
  session: LiveSession | null;
};

type OverlayRuntimeResponse = {
  state: StreamOverlayState;
  goals: OverlayGoalsState;
  session: LiveSession | null;
};

type GiftToast = {
  id: string;
  donorName: string;
  giftName: string;
};

const NOW_PLAYING_CTA = "Find it on my Spotify!";

function defaultState(): StreamOverlayState {
  return {
    mode: "hidden",
    title: "",
    subtitle: "",
    accentColor: "#f59e0b",
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system",
  };
}

function defaultGoalsState(): OverlayGoalsState {
  return {
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
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system",
  };
}

function safeAccent(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#f59e0b";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

function parseGoalTemplate(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 180);
  return normalized || fallback;
}

function parseGoals(payload: unknown): OverlayGoalsState | null {
  const root = asRecord(payload) as GoalsResponse | null;
  const goals = asRecord(root?.goals);
  if (!goals) {
    return null;
  }
  return {
    likeGoalTarget: parsePositiveInt(goals.likeGoalTarget, 10000),
    donationGoalTarget: parsePositiveInt(goals.donationGoalTarget, 2000),
    showLikeGoal: Boolean(goals.showLikeGoal),
    showDonationGoal: Boolean(goals.showDonationGoal),
    autoLikeEnabled: Boolean(goals.autoLikeEnabled),
    autoLikeEveryLikes: parsePositiveInt(goals.autoLikeEveryLikes, 1000),
    autoLikeTriggerWithin: parseNonNegativeInt(goals.autoLikeTriggerWithin, 200),
    autoLikeTextTemplate: parseGoalTemplate(goals.autoLikeTextTemplate, "We're almost at {target} likes!!"),
    autoLikeSubtextTemplate: parseGoalTemplate(goals.autoLikeSubtextTemplate, "{remaining} likes to go"),
    autoLikeShowProgress: goals.autoLikeShowProgress !== false,
    updatedAt: typeof goals.updatedAt === "string" ? goals.updatedAt : new Date(0).toISOString(),
    updatedBy: typeof goals.updatedBy === "string" ? goals.updatedBy : "system",
  };
}

function parseLiveOverlayState(payload: unknown): LiveSession | null {
  const root = asRecord(payload) as LiveOverlayResponse | null;
  const session = asRecord(root?.session);
  if (!session || typeof session.id !== "string") {
    return null;
  }
  const giftsRaw = Array.isArray(session.gifts) ? session.gifts : [];
  const gifts = giftsRaw
    .map((gift) => {
      const parsedGift = asRecord(gift);
      if (!parsedGift || typeof parsedGift.id !== "string") {
        return null;
      }
      return {
        id: parsedGift.id,
        giftName: typeof parsedGift.giftName === "string" ? parsedGift.giftName : null,
        userUniqueId: typeof parsedGift.userUniqueId === "string" ? parsedGift.userUniqueId : null,
        nickname: typeof parsedGift.nickname === "string" ? parsedGift.nickname : null,
        createdAt: typeof parsedGift.createdAt === "string" ? parsedGift.createdAt : null,
      };
    })
    .filter((gift): gift is LiveGift => gift !== null);

  return {
    id: session.id,
    endedAt: typeof session.endedAt === "string" ? session.endedAt : null,
    likeCountLatest: parseNonNegativeInt(session.likeCountLatest, 0),
    totalGiftDiamonds: parseNonNegativeInt(session.totalGiftDiamonds, 0),
    gifts,
  };
}

function parseNowPlayingSubtitle(subtitle: string) {
  const lines = subtitle
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length >= 3) {
    return {
      song: lines[0],
      artist: lines[1].replace(/^by\s+/i, "").trim(),
      cta: lines.slice(2).join(" ") || NOW_PLAYING_CTA,
    };
  }

  if (lines.length === 2) {
    if (/find it on my spotify!?/i.test(lines[1])) {
      return { song: lines[0], artist: "", cta: NOW_PLAYING_CTA };
    }
    if (lines[0].includes(" - ")) {
      const [song, ...artistParts] = lines[0].split(" - ");
      return {
        song: song.trim(),
        artist: artistParts.join(" - ").replace(/^by\s+/i, "").trim(),
        cta: lines[1] || NOW_PLAYING_CTA,
      };
    }
    return {
      song: lines[0],
      artist: lines[1].replace(/^by\s+/i, "").trim(),
      cta: NOW_PLAYING_CTA,
    };
  }

  if (lines.length === 1) {
    const oneLine = lines[0];
    if (oneLine.includes(" - ")) {
      const [song, ...artistParts] = oneLine.split(" - ");
      return {
        song: song.trim(),
        artist: artistParts.join(" - ").replace(/^by\s+/i, "").trim(),
        cta: NOW_PLAYING_CTA,
      };
    }
    const strippedCta = oneLine.replace(/find it on my spotify!?/gi, "").trim();
    return {
      song: strippedCta || oneLine,
      artist: "",
      cta: NOW_PLAYING_CTA,
    };
  }

  return { song: "", artist: "", cta: NOW_PLAYING_CTA };
}

function applyGoalTemplate(template: string, values: { target: number; likes: number; remaining: number }) {
  const formatted = {
    target: values.target.toLocaleString(),
    likes: values.likes.toLocaleString(),
    remaining: values.remaining.toLocaleString(),
  };
  return template
    .replace(/\{target\}/gi, formatted.target)
    .replace(/\{likes\}/gi, formatted.likes)
    .replace(/\{remaining\}/gi, formatted.remaining);
}

export function StreamOverlay() {
  const [state, setState] = useState<StreamOverlayState>(defaultState);
  const [goals, setGoals] = useState<OverlayGoalsState>(defaultGoalsState);
  const [currentLikeCount, setCurrentLikeCount] = useState(0);
  const [currentDonationCount, setCurrentDonationCount] = useState(0);
  const [activeGift, setActiveGift] = useState<GiftToast | null>(null);
  const [autoLikeTarget, setAutoLikeTarget] = useState<number | null>(null);
  const knownGiftIdsRef = useRef<Set<string>>(new Set());
  const bootstrappedGiftsRef = useRef(false);
  const giftQueueRef = useRef<GiftToast[]>([]);
  const giftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeGiftRef = useRef<GiftToast | null>(null);
  const autoLikeTargetRef = useRef<number | null>(null);
  const completedAutoLikeTargetsRef = useRef<Set<number>>(new Set());
  const isRuntimeRefreshInFlightRef = useRef(false);

  function showNextGiftToast() {
    if (activeGiftRef.current || giftQueueRef.current.length === 0) {
      return;
    }
    const next = giftQueueRef.current.shift();
    if (!next) {
      return;
    }
    activeGiftRef.current = next;
    setActiveGift(next);
    giftTimerRef.current = setTimeout(() => {
      activeGiftRef.current = null;
      setActiveGift(null);
      showNextGiftToast();
    }, 5200);
  }

  function applyLiveSession(activeSession: LiveSession | null) {
    if (!activeSession) {
      return;
    }

    setCurrentLikeCount((prev) => (prev === activeSession.likeCountLatest ? prev : activeSession.likeCountLatest));
    setCurrentDonationCount((prev) => (prev === activeSession.totalGiftDiamonds ? prev : activeSession.totalGiftDiamonds));

    if (!bootstrappedGiftsRef.current) {
      for (const gift of activeSession.gifts) {
        knownGiftIdsRef.current.add(gift.id);
      }
      bootstrappedGiftsRef.current = true;
      return;
    }

    const orderedGifts = [...activeSession.gifts].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aTime - bTime;
    });

    const newToasts: GiftToast[] = [];
    for (const gift of orderedGifts) {
      if (knownGiftIdsRef.current.has(gift.id)) {
        continue;
      }
      knownGiftIdsRef.current.add(gift.id);
      const giftName = gift.giftName?.trim() || "gift";
      const donorName = gift.userUniqueId?.trim() || gift.nickname?.trim() || "supporter";
      newToasts.push({
        id: gift.id,
        donorName,
        giftName,
      });
    }
    if (newToasts.length > 0) {
      giftQueueRef.current.push(...newToasts);
      showNextGiftToast();
    }
  }

  async function refreshRuntime() {
    const response = await fetch("/api/overlay/runtime", { cache: "no-store" });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      return;
    }

    const root = payload && typeof payload === "object" ? (payload as OverlayRuntimeResponse) : null;
    if (!root) {
      return;
    }

    if (root.state) {
      const nextState = root.state;
      setState((prev) => {
        if (
          prev.mode === nextState.mode &&
          prev.title === nextState.title &&
          prev.subtitle === nextState.subtitle &&
          prev.accentColor === nextState.accentColor &&
          prev.mediaImageUrl === nextState.mediaImageUrl &&
          prev.updatedAt === nextState.updatedAt &&
          prev.updatedBy === nextState.updatedBy
        ) {
          return prev;
        }
        return nextState;
      });
    }

    const parsedGoals = parseGoals({ goals: root.goals });
    if (parsedGoals) {
      setGoals((prev) => {
        if (
          prev.likeGoalTarget === parsedGoals.likeGoalTarget &&
          prev.donationGoalTarget === parsedGoals.donationGoalTarget &&
          prev.showLikeGoal === parsedGoals.showLikeGoal &&
          prev.showDonationGoal === parsedGoals.showDonationGoal &&
          prev.autoLikeEnabled === parsedGoals.autoLikeEnabled &&
          prev.autoLikeEveryLikes === parsedGoals.autoLikeEveryLikes &&
          prev.autoLikeTriggerWithin === parsedGoals.autoLikeTriggerWithin &&
          prev.autoLikeTextTemplate === parsedGoals.autoLikeTextTemplate &&
          prev.autoLikeSubtextTemplate === parsedGoals.autoLikeSubtextTemplate &&
          prev.autoLikeShowProgress === parsedGoals.autoLikeShowProgress &&
          prev.updatedAt === parsedGoals.updatedAt &&
          prev.updatedBy === parsedGoals.updatedBy
        ) {
          return prev;
        }
        return parsedGoals;
      });
    }

    const activeSession = parseLiveOverlayState({ session: root.session });
    applyLiveSession(activeSession);
  }

  useEffect(() => {
    const initial = setTimeout(() => {
      refreshRuntime().catch(() => undefined);
    }, 0);
    const runtimeTimer = setInterval(() => {
      if (document.hidden || isRuntimeRefreshInFlightRef.current) {
        return;
      }
      isRuntimeRefreshInFlightRef.current = true;
      refreshRuntime().catch(() => undefined).finally(() => {
        isRuntimeRefreshInFlightRef.current = false;
      });
    }, 700);
    return () => {
      clearTimeout(initial);
      clearInterval(runtimeTimer);
      if (giftTimerRef.current) {
        clearTimeout(giftTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!goals.autoLikeEnabled) {
      autoLikeTargetRef.current = null;
      setAutoLikeTarget(null);
      return;
    }

    const currentLikes = Math.max(0, currentLikeCount);
    const step = Math.max(1, goals.autoLikeEveryLikes);
    const within = Math.max(0, goals.autoLikeTriggerWithin);

    const activeTarget = autoLikeTargetRef.current;
    if (activeTarget !== null) {
      if (currentLikes >= activeTarget) {
        completedAutoLikeTargetsRef.current.add(activeTarget);
        autoLikeTargetRef.current = null;
        setAutoLikeTarget(null);
      } else {
        return;
      }
    }

    const nextTarget = Math.ceil(Math.max(1, currentLikes + 1) / step) * step;
    const remaining = nextTarget - currentLikes;
    if (remaining <= within && remaining > 0 && !completedAutoLikeTargetsRef.current.has(nextTarget)) {
      autoLikeTargetRef.current = nextTarget;
      setAutoLikeTarget(nextTarget);
    }
  }, [currentLikeCount, goals.autoLikeEnabled, goals.autoLikeEveryLikes, goals.autoLikeTriggerWithin]);

  const style = useMemo(() => {
    const accent = safeAccent(state.accentColor);
    return {
      "--overlay-accent": accent,
    } as CSSProperties;
  }, [state.accentColor]);

  const likeProgress = Math.min(100, (currentLikeCount / Math.max(1, goals.likeGoalTarget)) * 100);
  const donationProgress = Math.min(100, (currentDonationCount / Math.max(1, goals.donationGoalTarget)) * 100);
  const autoLikeWindow = Math.max(1, goals.autoLikeTriggerWithin);
  const autoLikeProgress = autoLikeTarget
    ? Math.min(100, Math.max(0, ((autoLikeWindow - Math.max(0, autoLikeTarget - currentLikeCount)) / autoLikeWindow) * 100))
    : 0;
  const autoLikeRemaining = autoLikeTarget ? Math.max(0, autoLikeTarget - currentLikeCount) : 0;
  const autoLikeMessage = autoLikeTarget
    ? applyGoalTemplate(goals.autoLikeTextTemplate, { target: autoLikeTarget, likes: currentLikeCount, remaining: autoLikeRemaining })
    : "";
  const autoLikeSubMessage = autoLikeTarget
    ? applyGoalTemplate(goals.autoLikeSubtextTemplate, { target: autoLikeTarget, likes: currentLikeCount, remaining: autoLikeRemaining })
    : "";
  const showAutoLikeCard = Boolean(autoLikeTarget) && goals.autoLikeEnabled;
  const showMainCard = state.mode !== "hidden";
  const showGoals = goals.showLikeGoal || goals.showDonationGoal || showAutoLikeCard;
  const hasAuxContent = Boolean(activeGift) || showGoals;
  const nowPlaying = parseNowPlayingSubtitle(state.subtitle);
  const nowPlayingArtistLabel = nowPlaying.artist ? `by ${nowPlaying.artist}` : "";

  if (!showMainCard && !hasAuxContent) {
    return <div className="min-h-screen bg-transparent" />;
  }

  return (
    <main style={style} className={`relative min-h-screen overflow-hidden ${showMainCard ? "bg-stone-950" : "bg-transparent"}`}>
      {showMainCard ? (
        <>
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-90">
            <div className="bg-orb-a absolute -left-24 top-[-110px] h-[26rem] w-[26rem] rounded-full bg-[var(--overlay-accent)]/25 blur-3xl" />
            <div className="bg-orb-b absolute -right-20 bottom-[-130px] h-[30rem] w-[30rem] rounded-full bg-cyan-300/20 blur-3xl" />
            <div className="bg-orb-c absolute left-1/2 top-[-150px] h-[20rem] w-[20rem] -translate-x-1/2 rounded-full bg-rose-300/12 blur-3xl" />
            <div className="bg-glow absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_50%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_45%)]" />
          </div>
          <section className="relative flex min-h-screen items-center justify-center p-10">
            <div
              className="w-full max-w-5xl rounded-3xl border border-white/20 bg-black/45 px-10 py-10 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-md"
            >
              {state.mode === "now_playing" ? (
                <>
                  <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
                    <div>
                      <p className="text-sm uppercase tracking-[0.24em] text-amber-100/90 md:text-base">{state.title || "Now Playing"}</p>
                      <h1 className="mt-3 max-w-5xl text-5xl leading-tight text-white md:text-7xl">
                        {nowPlaying.song || " "}
                        {nowPlayingArtistLabel ? (
                          <span className="ml-3 align-middle text-2xl font-normal text-stone-100/70 md:text-4xl">{nowPlayingArtistLabel}</span>
                        ) : null}
                      </h1>
                      <p className="mt-4 max-w-4xl text-xl font-light leading-relaxed text-stone-100/65 md:text-3xl">{nowPlaying.cta}</p>
                    </div>
                    {state.mediaImageUrl ? (
                      <div className="mx-auto w-40 md:mx-0 md:w-56">
                        <div
                          className="aspect-square rounded-2xl border border-white/20 bg-stone-900 bg-cover bg-center shadow-[0_20px_45px_rgba(0,0,0,0.45)]"
                          style={{ backgroundImage: `url(${state.mediaImageUrl})` }}
                        />
                      </div>
                    ) : null}
                  </div>
                </>
              ) : state.mode === "spotify_cta" ? (
                <>
                  <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
                    <div>
                      <h1 className="text-5xl leading-tight text-white md:text-7xl">{state.title || " "}</h1>
                      <p className="mt-5 max-w-4xl whitespace-pre-line text-2xl leading-relaxed text-stone-100 md:text-4xl">{state.subtitle || " "}</p>
                    </div>
                    <div className="mx-auto w-36 md:mx-0 md:w-48">
                      <Image
                        src="/spotify.png"
                        alt="Spotify"
                        width={192}
                        height={192}
                        className="h-auto w-full object-contain drop-shadow-[0_14px_30px_rgba(0,0,0,0.45)]"
                        priority
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h1 className="text-5xl leading-tight text-white md:text-7xl">{state.title || " "}</h1>
                  <p className="mt-5 max-w-4xl whitespace-pre-line text-2xl leading-relaxed text-stone-100 md:text-4xl">{state.subtitle || " "}</p>
                </>
              )}
            </div>
          </section>
        </>
      ) : null}

      <section className="pointer-events-none absolute inset-0 z-20 p-6">
        {activeGift ? (
          <div className="absolute inset-x-0 top-4 flex justify-center">
            <div className="gift-toast-fade w-[min(92vw,32rem)] rounded-xl bg-black/50 px-5 py-4 shadow-lg backdrop-blur-sm">
              <p className="text-base text-emerald-100/95 md:text-lg">
                Thanks <span className="font-semibold">@{activeGift.donorName}</span> for the <span className="font-semibold">{activeGift.giftName}</span>
              </p>
            </div>
          </div>
        ) : null}

        {showGoals ? (
          <div
            className={
              showMainCard
                ? "absolute bottom-6 left-1/2 flex w-full max-w-5xl -translate-x-1/2 flex-col gap-3 px-6"
                : "absolute inset-0 flex items-center justify-center p-6"
            }
          >
            <div className="flex w-full max-w-5xl flex-col gap-3">
            {showAutoLikeCard ? (
              <article className="relative overflow-hidden rounded-3xl border border-pink-300/60 bg-black/75 p-6 shadow-xl backdrop-blur-md md:p-8">
                <p className="text-2xl font-semibold tracking-wide text-pink-100 md:text-4xl">{autoLikeMessage}</p>
                <p className="mt-2 text-base text-pink-100/85 md:text-xl">{autoLikeSubMessage}</p>
                {goals.autoLikeShowProgress ? (
                  <div className="mt-3 h-4 rounded-full bg-white/15">
                    <div className="h-full rounded-full bg-pink-400 transition-all duration-300 ease-linear" style={{ width: `${autoLikeProgress}%` }} />
                  </div>
                ) : null}
              </article>
            ) : null}

            {goals.showLikeGoal && !showAutoLikeCard ? (
              <article className="relative overflow-hidden rounded-3xl border border-pink-300/50 bg-black/75 p-6 shadow-xl backdrop-blur-md md:p-8">
                <p className="text-2xl font-semibold tracking-wide text-pink-100 md:text-4xl">Let&apos;s get {goals.likeGoalTarget.toLocaleString()} likes!</p>
                <p className="mt-2 text-base text-pink-100/85 md:text-xl">{currentLikeCount.toLocaleString()} / {goals.likeGoalTarget.toLocaleString()}</p>
                <div className="mt-3 h-4 rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-pink-400 transition-all duration-300 ease-linear" style={{ width: `${likeProgress}%` }} />
                </div>
              </article>
            ) : null}

            {goals.showDonationGoal ? (
              <article className="relative overflow-hidden rounded-3xl border border-amber-300/50 bg-black/75 p-6 shadow-xl backdrop-blur-md md:p-8">
                <p className="text-2xl font-semibold tracking-wide text-amber-100 md:text-4xl">Let&apos;s get {goals.donationGoalTarget.toLocaleString()} diamonds!</p>
                <p className="mt-2 text-base text-amber-100/85 md:text-xl">{currentDonationCount.toLocaleString()} / {goals.donationGoalTarget.toLocaleString()}</p>
                <div className="mt-3 h-4 rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-amber-400 transition-all duration-300 ease-linear" style={{ width: `${donationProgress}%` }} />
                </div>
              </article>
            ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <style jsx>{`
        .bg-orb-a {
          animation: orbFloatA 12s ease-in-out infinite alternate;
        }
        .bg-orb-b {
          animation: orbFloatB 15s ease-in-out infinite alternate;
        }
        .bg-orb-c {
          animation: orbFloatC 18s ease-in-out infinite alternate;
        }
        .bg-glow {
          animation: glowPulse 9s ease-in-out infinite;
        }
        .gift-toast-fade {
          animation: giftToastInOut 5s ease forwards;
        }
        @keyframes orbFloatA {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(40px, -24px, 0);
          }
        }
        @keyframes orbFloatB {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(-34px, 22px, 0);
          }
        }
        @keyframes orbFloatC {
          0% {
            transform: translate3d(-50%, 0, 0);
          }
          100% {
            transform: translate3d(calc(-50% + 16px), 20px, 0);
          }
        }
        @keyframes glowPulse {
          0% {
            opacity: 0.55;
          }
          50% {
            opacity: 0.85;
          }
          100% {
            opacity: 0.55;
          }
        }
        @keyframes giftToastInOut {
          0% {
            opacity: 0;
            transform: translate(-50%, -8px);
          }
          10% {
            opacity: 1;
            transform: translate(-50%, 0);
          }
          80% {
            opacity: 1;
            transform: translate(-50%, 0);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -6px);
          }
        }
      `}</style>
    </main>
  );
}
