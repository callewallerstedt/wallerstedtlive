import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import { prisma } from "@/lib/prisma";

type LiveSnapshot = {
  username: string;
  roomId?: string;
  title?: string;
  statusCode?: number;
  isLive: boolean;
  viewerCount: number;
  likeCount: number;
  enterCount: number;
  fetchedAt: Date;
};

type TrackLiveInput = {
  username: string;
  durationSec: number;
  pollIntervalSec: number;
  collectChatEvents: boolean;
  forceRestartIfRunning?: boolean;
};

type StartTrackLiveResult = {
  sessionId?: string;
  started: boolean;
  message: string;
};

type BridgePayload = {
  ok: boolean;
  mode: "check" | "track";
  username: string;
  isLive?: boolean;
  statusCode?: number;
  roomId?: string | null;
  title?: string | null;
  viewerCount?: number;
  likeCount?: number;
  enterCount?: number;
  fetchedAt?: string;
  warnings?: string[];
  error?: string;
};

type StreamEvent = {
  type?: string;
  [key: string]: unknown;
};

type ActiveJob = {
  sessionId: string;
  username: string;
  child: ChildProcessWithoutNullStreams;
  stopReason?: string;
};

type JobState = {
  sessionId: string;
  username: string;
  isLive: boolean;
  statusCode?: number;
  roomId?: string;
  title?: string;
  sampleCount: number;
  viewerSum: number;
  viewerPeak: number;
  lastLike: number;
  lastEnter: number;
  totalComments: number;
  totalGifts: number;
  totalDiamonds: number;
  warnings: string[];
  finalized: boolean;
};

const activeJobsBySession = new Map<string, ActiveJob>();
const activeSessionByUsername = new Map<string, string>();
type PythonInvocation = { command: string; prefixArgs: string[] };
let cachedPythonInvocation: PythonInvocation | null | undefined;
const POLL_SOURCE = "tiktoklive-vercel-poll";

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "");
}

function clampSampleIntervalSec(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.max(0.2, Math.min(30, value));
  return Number(clamped.toFixed(2));
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function uniqueWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings.map((value) => value.trim()).filter(Boolean)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isServerlessRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

function getPythonNotFoundMessage(): string {
  if (process.platform === "win32") {
    return "Python was not found. Install Python and ensure `python` or `py -3` is available, or set PYTHON_PATH in .env (example: PYTHON_PATH=C:\\Python311\\python.exe).";
  }
  return "Python was not found. Install Python and ensure `python3`/`python` is available, or set PYTHON_PATH in .env.";
}

function resolvePythonInvocation(): PythonInvocation | null {
  const envPath = process.env.PYTHON_PATH?.trim();
  const candidates: PythonInvocation[] = envPath
    ? [{ command: envPath, prefixArgs: [] }]
    : process.platform === "win32"
      ? [
          { command: "python", prefixArgs: [] },
          { command: "py", prefixArgs: ["-3"] },
          { command: "python3", prefixArgs: [] },
        ]
      : [
          { command: "python3", prefixArgs: [] },
          { command: "python", prefixArgs: [] },
        ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.prefixArgs, "--version"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (probe.error?.message && /ENOENT/i.test(probe.error.message)) {
      continue;
    }
    if (probe.status === 0 || !probe.error) {
      return candidate;
    }
  }

  return null;
}

function getPythonInvocation(): PythonInvocation | null {
  if (cachedPythonInvocation !== undefined) {
    return cachedPythonInvocation;
  }
  cachedPythonInvocation = resolvePythonInvocation();
  return cachedPythonInvocation;
}

async function fetchLiveSnapshotFromWebPage(username: string): Promise<LiveSnapshot> {
  const url = `https://www.tiktok.com/@${encodeURIComponent(username)}/live`;
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`TikTok live page returned ${response.status}.`);
  }

  const html = await response.text();
  const match = html.match(/<script id="SIGI_STATE" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match?.[1]) {
    throw new Error("TikTok live page did not include SIGI_STATE.");
  }

  const parsed = JSON.parse(match[1]) as Record<string, unknown>;
  const liveRoomRoot = asRecord(parsed.LiveRoom);
  const liveRoomUserInfo = asRecord(liveRoomRoot?.liveRoomUserInfo);
  const liveRoom = asRecord(liveRoomUserInfo?.liveRoom);
  const liveRoomStats = asRecord(liveRoom?.liveRoomStats);

  const status = toNumber(liveRoom?.status);
  const isLive = status === 2;
  const viewerCount = Math.max(0, toNumber(liveRoomStats?.userCount));
  const enterCount = Math.max(0, toNumber(liveRoomStats?.enterCount));
  const roomIdRaw = liveRoom?.streamId;
  const roomId = typeof roomIdRaw === "string" && roomIdRaw.trim() ? roomIdRaw.trim() : undefined;
  const titleRaw = liveRoom?.title;
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : undefined;

  return {
    username,
    roomId,
    title,
    statusCode: status || undefined,
    isLive,
    viewerCount,
    likeCount: 0,
    enterCount,
    fetchedAt: new Date(),
  };
}

function parseJsonFromStdout(stdout: string): BridgePayload {
  const text = stdout.trim();
  if (!text) {
    throw new Error("TikTokLive bridge returned empty output.");
  }

  try {
    return JSON.parse(text) as BridgePayload;
  } catch {
    const lines = text
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      try {
        return JSON.parse(line) as BridgePayload;
      } catch {
        continue;
      }
    }
  }

  throw new Error("TikTokLive bridge output was not valid JSON.");
}

async function runTikTokLiveBridge(input: {
  mode: "check" | "track";
  username: string;
  durationSec: number;
  sampleIntervalSec: number;
  collectChat: boolean;
  maxComments: number;
  maxGifts: number;
}): Promise<BridgePayload> {
  const pythonInvocation = getPythonInvocation();
  if (!pythonInvocation) {
    throw new Error(getPythonNotFoundMessage());
  }
  const scriptPath = path.join(process.cwd(), "scripts", "tiktoklive_bridge.py");
  const args = [
    ...pythonInvocation.prefixArgs,
    scriptPath,
    "--mode",
    input.mode,
    "--username",
    input.username,
    "--duration-sec",
    String(input.durationSec),
    "--sample-interval-sec",
    String(input.sampleIntervalSec),
    "--max-comments",
    String(input.maxComments),
    "--max-gifts",
    String(input.maxGifts),
  ];
  if (input.collectChat) {
    args.push("--collect-chat");
  }

  const timeoutMs = Math.max(20_000, input.durationSec * 1000 + 25_000);

  return await new Promise<BridgePayload>((resolve, reject) => {
    const child = spawn(pythonInvocation.command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error("TikTokLive bridge timed out."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (/ENOENT/i.test(error.message)) {
        reject(new Error(getPythonNotFoundMessage()));
        return;
      }
      reject(new Error(`TikTokLive bridge process error: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return;
      }
      if (code !== 0) {
        const stderrText = stderr.trim();
        reject(
          new Error(
            stderrText
              ? `TikTokLive bridge exited ${code}: ${stderrText}`
              : `TikTokLive bridge exited ${code} without stderr.`
          )
        );
        return;
      }

      try {
        const payload = parseJsonFromStdout(stdout);
        if (!payload.ok) {
          reject(new Error(payload.error || "TikTokLive bridge returned unsuccessful response."));
          return;
        }
        resolve(payload);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("TikTokLive bridge parse failed."));
      }
    });
  });
}

function normalizeSnapshotFromBridge(username: string, payload: BridgePayload): LiveSnapshot {
  const fetchedAt = toDate(payload.fetchedAt) ?? new Date();
  return {
    username,
    roomId: typeof payload.roomId === "string" ? payload.roomId : undefined,
    title: typeof payload.title === "string" ? payload.title : undefined,
    statusCode: toNumber(payload.statusCode) || undefined,
    isLive: Boolean(payload.isLive),
    viewerCount: toNumber(payload.viewerCount),
    likeCount: toNumber(payload.likeCount),
    enterCount: toNumber(payload.enterCount),
    fetchedAt,
  };
}

function spawnTikTokLiveStream(input: {
  username: string;
  durationSec: number;
  sampleIntervalSec: number;
  collectChat: boolean;
  maxComments: number;
  maxGifts: number;
}): ChildProcessWithoutNullStreams {
  const pythonInvocation = getPythonInvocation();
  if (!pythonInvocation) {
    throw new Error(getPythonNotFoundMessage());
  }
  const scriptPath = path.join(process.cwd(), "scripts", "tiktoklive_bridge.py");
  const args = [
    ...pythonInvocation.prefixArgs,
    scriptPath,
    "--mode",
    "stream",
    "--username",
    input.username,
    "--duration-sec",
    String(input.durationSec),
    "--sample-interval-sec",
    String(input.sampleIntervalSec),
    "--max-comments",
    String(input.maxComments),
    "--max-gifts",
    String(input.maxGifts),
  ];
  if (input.collectChat) {
    args.push("--collect-chat");
  }

  return spawn(pythonInvocation.command, args, {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function parseStreamEvent(line: string): StreamEvent | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

async function applyFinalSessionUpdate(state: JobState, errorMessage: string | null): Promise<void> {
  const warningList = uniqueWarnings(state.warnings);
  const avg = state.sampleCount > 0 ? Number((state.viewerSum / state.sampleCount).toFixed(2)) : 0;
  const effectiveError = errorMessage || (!state.isLive ? "User is currently offline." : null);

  if (state.sampleCount === 0) {
    await prisma.tikTokLiveSample.create({
      data: {
        sessionId: state.sessionId,
        capturedAt: new Date(),
        viewerCount: 0,
        likeCount: state.lastLike,
        enterCount: state.lastEnter,
      },
    });
    state.sampleCount = 1;
  }

  await prisma.tikTokLiveSession.update({
    where: { id: state.sessionId },
    data: {
      endedAt: new Date(),
      isLive: state.isLive,
      statusCode: state.statusCode ?? null,
      roomId: state.roomId ?? null,
      title: state.title ?? null,
      viewerCountPeak: state.viewerPeak,
      viewerCountAvg: avg,
      likeCountLatest: state.lastLike,
      enterCountLatest: state.lastEnter,
      totalCommentEvents: state.totalComments,
      totalGiftEvents: state.totalGifts,
      totalGiftDiamonds: state.totalDiamonds,
      warnings: warningList.length ? warningList.join(" | ") : null,
      error: effectiveError,
    },
  });
}

function startStreamingJob(sessionId: string, input: TrackLiveInput): void {
  const username = normalizeUsername(input.username);
  const durationRaw = Math.floor(input.durationSec);
  const durationSec = durationRaw <= 0 ? 0 : Math.max(15, Math.min(21600, durationRaw));
  const sampleIntervalSec = clampSampleIntervalSec(input.pollIntervalSec, 0.5);
  const collectChat = Boolean(input.collectChatEvents);

  const child = spawnTikTokLiveStream({
    username,
    durationSec,
    sampleIntervalSec,
    collectChat,
    maxComments: collectChat ? 1200 : 0,
    maxGifts: collectChat ? 900 : 0,
  });

  activeJobsBySession.set(sessionId, { sessionId, username, child });
  activeSessionByUsername.set(username, sessionId);

  const state: JobState = {
    sessionId,
    username,
    isLive: false,
    statusCode: undefined,
    roomId: undefined,
    title: undefined,
    sampleCount: 0,
    viewerSum: 0,
    viewerPeak: 0,
    lastLike: 0,
    lastEnter: 0,
    totalComments: 0,
    totalGifts: 0,
    totalDiamonds: 0,
    warnings: [],
    finalized: false,
  };

  let stderr = "";
  let stdoutBuffer = "";
  let writeQueue: Promise<void> = Promise.resolve();

  const enqueue = (action: () => Promise<void>) => {
    writeQueue = writeQueue
      .then(action)
      .catch((error) => {
        state.warnings.push(error instanceof Error ? error.message : "DB write error.");
      });
  };

  const finalize = (errorMessage: string | null) => {
    if (state.finalized) {
      return;
    }
    state.finalized = true;

    enqueue(async () => {
      if (stderr.trim()) {
        state.warnings.push(stderr.trim());
      }
      await applyFinalSessionUpdate(state, errorMessage);
    });

    writeQueue.finally(() => {
      activeJobsBySession.delete(sessionId);
      if (activeSessionByUsername.get(username) === sessionId) {
        activeSessionByUsername.delete(username);
      }
    });
  };

  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    const event = parseStreamEvent(line);
    if (!event || typeof event.type !== "string") {
      return;
    }

    if (event.type === "meta") {
      const roomId = typeof event.roomId === "string" ? event.roomId : undefined;
      const title = typeof event.title === "string" ? event.title : undefined;
      const statusCode = toNumber(event.statusCode) || undefined;
      const isLive = Boolean(event.isLive);

      state.isLive = isLive;
      state.statusCode = statusCode;
      state.roomId = roomId ?? state.roomId;
      state.title = title ?? state.title;
      state.lastLike = toNumber(event.likeCount) || state.lastLike;
      state.lastEnter = toNumber(event.enterCount) || state.lastEnter;

      enqueue(async () => {
        await prisma.tikTokLiveSession.update({
          where: { id: sessionId },
          data: {
            isLive,
            statusCode: statusCode ?? null,
            roomId: state.roomId ?? null,
            title: state.title ?? null,
            likeCountLatest: state.lastLike,
            enterCountLatest: state.lastEnter,
            error: null,
          },
        });
      });
      return;
    }

    if (event.type === "sample") {
      const capturedAt = toDate(event.capturedAt) ?? new Date();
      const viewerCount = Math.max(0, toNumber(event.viewerCount));
      const likeCount = Math.max(0, toNumber(event.likeCount));
      const enterCount = Math.max(0, toNumber(event.enterCount));

      state.sampleCount += 1;
      state.viewerSum += viewerCount;
      state.viewerPeak = Math.max(state.viewerPeak, viewerCount);
      state.lastLike = likeCount;
      state.lastEnter = enterCount;
      const avg = Number((state.viewerSum / Math.max(1, state.sampleCount)).toFixed(2));

      enqueue(async () => {
        await prisma.tikTokLiveSample.create({
          data: {
            sessionId,
            capturedAt,
            viewerCount,
            likeCount,
            enterCount,
          },
        });
        await prisma.tikTokLiveSession.update({
          where: { id: sessionId },
          data: {
            viewerCountPeak: state.viewerPeak,
            viewerCountAvg: avg,
            likeCountLatest: likeCount,
            enterCountLatest: enterCount,
            totalCommentEvents: state.totalComments,
            totalGiftEvents: state.totalGifts,
            totalGiftDiamonds: state.totalDiamonds,
          },
        });
      });
      return;
    }

    if (event.type === "comment") {
      const createdAt = toDate(event.createdAt) ?? new Date();
      const comment = typeof event.comment === "string" ? event.comment.trim() : "";
      if (!comment) {
        return;
      }
      const userUniqueId = typeof event.userUniqueId === "string" ? event.userUniqueId : null;
      const nickname = typeof event.nickname === "string" ? event.nickname : null;
      state.totalComments += 1;

      enqueue(async () => {
        await prisma.tikTokLiveComment.create({
          data: {
            sessionId,
            createdAt,
            userUniqueId,
            nickname,
            comment,
          },
        });
      });
      return;
    }

    if (event.type === "gift") {
      const createdAt = toDate(event.createdAt) ?? new Date();
      const userUniqueId = typeof event.userUniqueId === "string" ? event.userUniqueId : null;
      const nickname = typeof event.nickname === "string" ? event.nickname : null;
      const giftName = typeof event.giftName === "string" ? event.giftName : null;
      const diamondCount = Math.max(0, toNumber(event.diamondCount));
      const repeatCount = Math.max(1, toNumber(event.repeatCount) || 1);

      state.totalGifts += 1;
      state.totalDiamonds += diamondCount * repeatCount;

      enqueue(async () => {
        await prisma.tikTokLiveGift.create({
          data: {
            sessionId,
            createdAt,
            userUniqueId,
            nickname,
            giftName,
            diamondCount,
            repeatCount,
          },
        });
      });
      return;
    }

    if (event.type === "end") {
      const warnings = Array.isArray(event.warnings)
        ? event.warnings.filter((value): value is string => typeof value === "string")
        : [];
      state.warnings.push(...warnings);
      if (typeof event.error === "string" && event.error.trim()) {
        finalize(event.error.trim());
      } else {
        finalize(null);
      }
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    while (true) {
      const separatorIndex = stdoutBuffer.indexOf("\n");
      if (separatorIndex < 0) {
        break;
      }
      const line = stdoutBuffer.slice(0, separatorIndex);
      stdoutBuffer = stdoutBuffer.slice(separatorIndex + 1);
      handleLine(line);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  child.on("error", (error) => {
    finalize(`TikTokLive stream process error: ${error.message}`);
  });

  child.on("close", (code) => {
    if (stdoutBuffer.trim()) {
      handleLine(stdoutBuffer);
      stdoutBuffer = "";
    }
    if (!state.finalized) {
      const active = activeJobsBySession.get(sessionId);
      if (active?.stopReason) {
        state.warnings.push(active.stopReason);
        finalize(null);
        return;
      }
      if (code === 0) {
        finalize(null);
      } else {
        finalize(`TikTokLive stream exited with code ${code ?? -1}.`);
      }
    }
  });
}

export async function fetchLiveSnapshotByUsername(rawUsername: string): Promise<LiveSnapshot> {
  const username = normalizeUsername(rawUsername);
  if (!username) {
    throw new Error("Username is required.");
  }

  if (isServerlessRuntime()) {
    return fetchLiveSnapshotFromWebPage(username);
  }

  try {
    const payload = await runTikTokLiveBridge({
      mode: "check",
      username,
      durationSec: 8,
      sampleIntervalSec: 1,
      collectChat: false,
      maxComments: 0,
      maxGifts: 0,
    });
    return normalizeSnapshotFromBridge(username, payload);
  } catch {
    return fetchLiveSnapshotFromWebPage(username);
  }
}

export async function startLiveTrackingByUsername(input: TrackLiveInput): Promise<StartTrackLiveResult> {
  const username = normalizeUsername(input.username);
  if (!username) {
    throw new Error("Username is required.");
  }
  const serverlessMode = isServerlessRuntime();

  let restartedExisting = false;
  const existingDbSession = await prisma.tikTokLiveSession.findFirst({
    where: { username, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (existingDbSession) {
    if (input.forceRestartIfRunning) {
      await prisma.tikTokLiveSession.update({
        where: { id: existingDbSession.id },
        data: { endedAt: new Date(), error: "Restarted by user." },
      });
      restartedExisting = true;
    } else {
      return {
        sessionId: existingDbSession.id,
        started: false,
        message: "Tracking is already running for this username.",
      };
    }
  }

  const existingSessionId = activeSessionByUsername.get(username);
  if (existingSessionId && activeJobsBySession.has(existingSessionId)) {
    if (input.forceRestartIfRunning) {
      stopLiveTrackingByUsername(username);
      restartedExisting = true;
    } else {
      return {
        sessionId: existingSessionId,
        started: false,
        message: "Tracking is already running for this username.",
      };
    }
  }

  let snapshot: LiveSnapshot;
  try {
    snapshot = await fetchLiveSnapshotByUsername(username);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live check failed";
    return {
      started: false,
      message,
    };
  }

  if (!snapshot.isLive) {
    return {
      started: false,
      message: "This user is offline right now. Start again when they are live.",
    };
  }

  if (!getPythonInvocation()) {
    return {
      started: false,
      message: getPythonNotFoundMessage(),
    };
  }

  const durationRaw = Math.floor(input.durationSec);
  const durationSec = durationRaw <= 0 ? 0 : Math.max(15, Math.min(21600, durationRaw));
  const pollIntervalSec = clampSampleIntervalSec(input.pollIntervalSec, 0.5);
  const collectChatEvents = Boolean(input.collectChatEvents);

  const session = await prisma.tikTokLiveSession.create({
    data: {
      username,
      source: serverlessMode ? POLL_SOURCE : "tiktoklive-python-stream",
      isLive: snapshot.isLive,
      statusCode: snapshot.statusCode ?? 0,
      roomId: snapshot.roomId ?? null,
      title: snapshot.title ?? null,
      viewerCountStart: snapshot.viewerCount,
      viewerCountPeak: snapshot.viewerCount,
      viewerCountAvg: snapshot.viewerCount,
      likeCountLatest: snapshot.likeCount,
      enterCountLatest: snapshot.enterCount,
      totalCommentEvents: 0,
      totalGiftEvents: 0,
      totalGiftDiamonds: 0,
      warnings: null,
      error: null,
    },
  });

  await prisma.tikTokLiveSample.create({
    data: {
      sessionId: session.id,
      capturedAt: snapshot.fetchedAt,
      viewerCount: snapshot.viewerCount,
      likeCount: snapshot.likeCount,
      enterCount: snapshot.enterCount,
    },
  });

  if (serverlessMode) {
    return {
      sessionId: session.id,
      started: true,
      message: restartedExisting ? "Live tracker restarted (Vercel polling mode)." : "Live tracking started (Vercel polling mode).",
    };
  }

  startStreamingJob(session.id, {
    username,
    durationSec,
    pollIntervalSec,
    collectChatEvents,
  });

  return {
    sessionId: session.id,
    started: true,
    message: restartedExisting ? "Live tracker restarted." : "Live tracking started.",
  };
}

export function stopLiveTrackingByUsername(rawUsername: string): {
  stopped: boolean;
  sessionId?: string;
  message: string;
} {
  const username = normalizeUsername(rawUsername);
  if (!username) {
    return { stopped: false, message: "Username is required." };
  }

  const sessionId = activeSessionByUsername.get(username);
  if (!sessionId) {
    return { stopped: false, message: "No active tracker found for this username." };
  }

  const active = activeJobsBySession.get(sessionId);
  if (!active) {
    activeSessionByUsername.delete(username);
    return { stopped: false, message: "No active tracker process found." };
  }

  active.stopReason = "Stopped by user.";
  // Release lock immediately so a new run can start right away.
  activeJobsBySession.delete(sessionId);
  activeSessionByUsername.delete(username);
  try {
    active.child.kill();
  } catch {
    // process may already be exiting
  }

  return {
    stopped: true,
    sessionId,
    message: "Stop signal sent to live tracker.",
  };
}

export async function stopLiveTrackingByUsernameAsync(rawUsername: string): Promise<{
  stopped: boolean;
  sessionId?: string;
  message: string;
}> {
  const immediate = stopLiveTrackingByUsername(rawUsername);
  if (immediate.stopped) {
    return immediate;
  }

  const username = normalizeUsername(rawUsername);
  if (!username) {
    return immediate;
  }

  const openSession = await prisma.tikTokLiveSession.findFirst({
    where: { username, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!openSession) {
    return immediate;
  }

  await prisma.tikTokLiveSession.update({
    where: { id: openSession.id },
    data: {
      endedAt: new Date(),
      error: "Stopped by user.",
    },
  });

  return {
    stopped: true,
    sessionId: openSession.id,
    message: "Stop signal applied to active polling session.",
  };
}

export async function refreshLiveTrackingSnapshot(rawUsername?: string): Promise<void> {
  if (!isServerlessRuntime()) {
    return;
  }

  const username = normalizeUsername(rawUsername ?? "");
  const activeSession = await prisma.tikTokLiveSession.findFirst({
    where: {
      endedAt: null,
      source: POLL_SOURCE,
      ...(username ? { username } : {}),
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      username: true,
      viewerCountPeak: true,
      viewerCountAvg: true,
      likeCountLatest: true,
      enterCountLatest: true,
      roomId: true,
      title: true,
      statusCode: true,
    },
  });

  if (!activeSession) {
    return;
  }

  const snapshot = await fetchLiveSnapshotByUsername(activeSession.username);
  const sampleCount = await prisma.tikTokLiveSample.count({
    where: { sessionId: activeSession.id },
  });
  const nextSampleCount = sampleCount + 1;
  const avg = Number(
    ((activeSession.viewerCountAvg * sampleCount + snapshot.viewerCount) / Math.max(1, nextSampleCount)).toFixed(2)
  );

  await prisma.tikTokLiveSample.create({
    data: {
      sessionId: activeSession.id,
      capturedAt: snapshot.fetchedAt,
      viewerCount: snapshot.viewerCount,
      likeCount: snapshot.likeCount,
      enterCount: snapshot.enterCount,
    },
  });

  await prisma.tikTokLiveSession.update({
    where: { id: activeSession.id },
    data: {
      isLive: snapshot.isLive,
      statusCode: snapshot.statusCode ?? activeSession.statusCode ?? null,
      roomId: snapshot.roomId ?? activeSession.roomId ?? null,
      title: snapshot.title ?? activeSession.title ?? null,
      viewerCountPeak: Math.max(activeSession.viewerCountPeak, snapshot.viewerCount),
      viewerCountAvg: avg,
      likeCountLatest: snapshot.likeCount > 0 ? snapshot.likeCount : activeSession.likeCountLatest,
      enterCountLatest: Math.max(activeSession.enterCountLatest, snapshot.enterCount),
      ...(snapshot.isLive ? {} : { endedAt: new Date(), error: "User is currently offline." }),
    },
  });
}

export async function deleteLiveSessionById(sessionId: string): Promise<{ deleted: boolean; message: string }> {
  const active = activeJobsBySession.get(sessionId);
  if (active) {
    active.stopReason = "Deleted by user.";
    activeJobsBySession.delete(sessionId);
    if (activeSessionByUsername.get(active.username) === sessionId) {
      activeSessionByUsername.delete(active.username);
    }
    try {
      active.child.kill();
    } catch {
      // ignore kill errors
    }
  }

  try {
    await prisma.tikTokLiveSession.delete({ where: { id: sessionId } });
    return { deleted: true, message: "Session deleted." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return { deleted: false, message };
  }
}
