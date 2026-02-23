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
  comments: LiveCommentCapture[];
  gifts: LiveGiftCapture[];
  fetchedAt: Date;
};

type LiveCommentCapture = {
  createdAt: Date;
  userUniqueId: string | null;
  nickname: string | null;
  comment: string;
};

type LiveGiftCapture = {
  createdAt: Date;
  userUniqueId: string | null;
  nickname: string | null;
  giftName: string | null;
  diamondCount: number;
  repeatCount: number;
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
const SERVERLESS_MIN_SAMPLE_INTERVAL_MS = (() => {
  const raw = Number(process.env.TIKTOK_SERVERLESS_MIN_SAMPLE_INTERVAL_MS ?? 4000);
  if (!Number.isFinite(raw)) {
    return 4000;
  }
  return Math.max(2000, Math.round(raw));
})();

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

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function getTikTokSignApiKey(): string | undefined {
  const explicit = process.env.TIKTOK_SIGN_API_KEY?.trim();
  if (explicit) {
    return explicit;
  }
  const legacy = process.env.EULERSTREAM_API_KEY?.trim();
  return legacy || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function extractScriptJsonById(html: string, id: string): unknown | null {
  const pattern = new RegExp(
    `<script[^>]*id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i"
  );
  const match = html.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractJsonScriptsByType(html: string): unknown[] {
  const pattern = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const parsed: unknown[] = [];
  for (const match of html.matchAll(pattern)) {
    const raw = match[1];
    if (!raw) {
      continue;
    }
    try {
      parsed.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }
  return parsed;
}

function findRecordDeep(
  input: unknown,
  predicate: (value: Record<string, unknown>) => boolean,
  depth = 0,
  seen = new Set<object>()
): Record<string, unknown> | null {
  const root = asRecord(input);
  if (!root || depth > 8) {
    return null;
  }
  if (seen.has(root)) {
    return null;
  }
  seen.add(root);
  if (predicate(root)) {
    return root;
  }
  for (const nested of Object.values(root)) {
    const found = findRecordDeep(nested, predicate, depth + 1, seen);
    if (found) {
      return found;
    }
  }
  return null;
}

function toRoomIdentifier(value: Record<string, unknown>): string | undefined {
  const candidates = [value.streamId, value.roomId, value.id_str, value.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }
  return undefined;
}

function toLiveStatusCode(value: Record<string, unknown>, fallback?: number): number {
  const status = toNumber(value.status);
  if (status > 0) {
    return status;
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }
  return 0;
}

function toLiveStats(value: Record<string, unknown>): Record<string, unknown> | null {
  const directStats = asRecord(value.liveRoomStats);
  if (directStats) {
    return directStats;
  }
  return findRecordDeep(value, (record) => {
    const hasViewer =
      Object.prototype.hasOwnProperty.call(record, "userCount") ||
      Object.prototype.hasOwnProperty.call(record, "user_count") ||
      Object.prototype.hasOwnProperty.call(record, "viewerCount");
    const hasEnter =
      Object.prototype.hasOwnProperty.call(record, "enterCount") ||
      Object.prototype.hasOwnProperty.call(record, "totalUser") ||
      Object.prototype.hasOwnProperty.call(record, "total_user");
    return hasViewer || hasEnter;
  });
}

function snapshotFromParsedLiveRoot(username: string, parsed: unknown): LiveSnapshot | null {
  const root = asRecord(parsed);
  if (!root) {
    return null;
  }

  const liveRoomRoot = asRecord(root.LiveRoom);
  const liveRoomUserInfo = asRecord(liveRoomRoot?.liveRoomUserInfo);
  const currentRoomRoot = asRecord(root.CurrentRoom);
  const liveRoom =
    asRecord(liveRoomUserInfo?.liveRoom) ??
    asRecord(liveRoomRoot?.liveRoom) ??
    asRecord(currentRoomRoot?.liveRoom) ??
    asRecord(currentRoomRoot) ??
    findRecordDeep(root, (record) => {
      const hasStatusField = Object.prototype.hasOwnProperty.call(record, "status");
      const hasRoomId = Boolean(toRoomIdentifier(record));
      const hasStats = Boolean(asRecord(record.liveRoomStats));
      return hasStatusField && (hasRoomId || hasStats);
    });

  if (!liveRoom) {
    return null;
  }

  const statusFallback = toNumber(liveRoomRoot?.liveRoomStatus);
  const status = toLiveStatusCode(liveRoom, statusFallback > 0 ? statusFallback : undefined);
  const roomId = toRoomIdentifier(liveRoom);
  const titleRaw = liveRoom.title;
  const liveRoomStats = toLiveStats(liveRoom);
  const viewerCount = Math.max(
    0,
    toNumber(liveRoomStats?.userCount ?? liveRoomStats?.user_count ?? liveRoomStats?.viewerCount)
  );
  const enterCount = Math.max(0, toNumber(liveRoomStats?.enterCount ?? liveRoomStats?.totalUser ?? liveRoomStats?.total_user));
  const likeCount = Math.max(
    0,
    toNumber(liveRoomStats?.likeCount ?? liveRoomStats?.like_count ?? liveRoomStats?.totalLikeCount)
  );
  const inferredLive = viewerCount > 0 || Boolean(roomId);

  return {
    username,
    roomId,
    title: typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : undefined,
    statusCode: status || undefined,
    isLive: status === 2 || (status === 0 && inferredLive),
    viewerCount,
    likeCount,
    enterCount,
    comments: [],
    gifts: [],
    fetchedAt: new Date(),
  };
}

function snapshotFromLooseHtmlSignals(username: string, html: string): LiveSnapshot | null {
  const statusMatch = html.match(/"status"\s*:\s*(\d+)/);
  const userCountMatch = html.match(/"userCount"\s*:\s*(\d+)/);
  const enterCountMatch = html.match(/"enterCount"\s*:\s*(\d+)/);
  const likeCountMatch = html.match(/"likeCount"\s*:\s*(\d+)/);
  const streamIdMatch = html.match(/"streamId"\s*:\s*"([^"]+)"/);
  const titleMatch = html.match(/"title"\s*:\s*"([^"]+)"/);
  const pageTitleLive = /is\s+LIVE\s+-\s+TikTok\s+LIVE/i.test(html);

  const status = statusMatch ? Number(statusMatch[1]) : pageTitleLive ? 2 : 0;
  if (!status && !pageTitleLive) {
    return null;
  }

  return {
    username,
    roomId: streamIdMatch?.[1] ? streamIdMatch[1] : undefined,
    title: titleMatch?.[1] ? titleMatch[1] : undefined,
    statusCode: status || undefined,
    isLive: status === 2 || pageTitleLive,
    viewerCount: userCountMatch ? Math.max(0, Number(userCountMatch[1])) : 0,
    likeCount: likeCountMatch ? Math.max(0, Number(likeCountMatch[1])) : 0,
    enterCount: enterCountMatch ? Math.max(0, Number(enterCountMatch[1])) : 0,
    comments: [],
    gifts: [],
    fetchedAt: new Date(),
  };
}

function isLikelyOfflineError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("offline") ||
    text.includes("live has ended") ||
    text.includes("user_not_found") ||
    text.includes("account not found")
  );
}

async function fetchLiveSnapshotFromConnector(username: string): Promise<LiveSnapshot> {
  const mod = (await import("tiktok-live-connector")) as {
    WebcastPushConnection: new (
      uniqueId: string,
      options?: Record<string, unknown>
    ) => {
      roomId?: string | number;
      roomInfo?: Record<string, unknown>;
      on: (event: string, cb: (payload: Record<string, unknown>) => void) => void;
      connect: () => Promise<Record<string, unknown>>;
      disconnect: () => Promise<void>;
    };
  };
  const signApiKey = getTikTokSignApiKey();
  const connectionOptions: Record<string, unknown> = {
    enableExtendedGiftInfo: false,
    requestPollingIntervalMs: 1200,
  };
  if (signApiKey) {
    connectionOptions.signApiKey = signApiKey;
  }
  const connection = new mod.WebcastPushConnection(username, connectionOptions);

  let roomId = "";
  let viewerCount = 0;
  let enterCount = 0;
  let likeCount = 0;
  const comments: LiveCommentCapture[] = [];
  const gifts: LiveGiftCapture[] = [];
  const maxComments = 160;
  const maxGifts = 80;

  connection.on("roomUser", (event) => {
    viewerCount = Math.max(viewerCount, toNumber(event.viewerCount));
    enterCount = Math.max(enterCount, toNumber(event.totalUser));
    const eventRoomId = typeof event.roomId === "string" ? event.roomId : String(event.roomId ?? "");
    if (eventRoomId.trim()) {
      roomId = eventRoomId.trim();
    }
  });

  connection.on("like", (event) => {
    likeCount = Math.max(likeCount, toNumber(event.totalLikeCount));
  });

  connection.on("chat", (event) => {
    if (comments.length >= maxComments) {
      return;
    }
    const user = asRecord(event.user);
    const comment = asNullableString(event.comment);
    if (!comment) {
      return;
    }
    comments.push({
      createdAt: new Date(),
      userUniqueId: asNullableString(event.uniqueId) ?? asNullableString(user?.uniqueId),
      nickname: asNullableString(event.nickname) ?? asNullableString(user?.nickname),
      comment,
    });
  });

  connection.on("gift", (event) => {
    if (gifts.length >= maxGifts) {
      return;
    }
    // Skip incomplete streak updates; keep final gift event.
    if (event.repeatEnd === false) {
      return;
    }
    const user = asRecord(event.user);
    const gift = asRecord(event.gift);
    gifts.push({
      createdAt: new Date(),
      userUniqueId: asNullableString(event.uniqueId) ?? asNullableString(user?.uniqueId),
      nickname: asNullableString(event.nickname) ?? asNullableString(user?.nickname),
      giftName: asNullableString(event.giftName) ?? asNullableString(gift?.name),
      diamondCount: Math.max(0, toNumber(event.diamondCount ?? gift?.diamondCount)),
      repeatCount: Math.max(1, toNumber(event.repeatCount)),
    });
  });

  let connected = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("TikTok connector timed out.")), 12_000);
  });

  try {
    const state = (await Promise.race([connection.connect(), timeoutPromise])) as Record<string, unknown>;
    connected = true;
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const stateRoomId = typeof state.roomId === "string" ? state.roomId : String(state.roomId ?? "");
    if (stateRoomId.trim()) {
      roomId = stateRoomId.trim();
    }
    const infoRoot = asRecord(connection.roomInfo);
    const infoData = asRecord(infoRoot?.data);
    const titleRaw = infoData?.title;
    const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : undefined;
    const infoStats = asRecord(infoData?.stats);

    viewerCount = Math.max(viewerCount, toNumber(infoStats?.user_count));
    enterCount = Math.max(enterCount, toNumber(infoStats?.total_user));
    likeCount = Math.max(likeCount, toNumber(infoStats?.like_count));

    return {
      username,
      roomId: roomId || undefined,
      title,
      statusCode: 2,
      isLive: true,
      viewerCount: Math.max(0, viewerCount),
      likeCount: Math.max(0, likeCount),
      enterCount: Math.max(0, enterCount),
      comments,
      gifts,
      fetchedAt: new Date(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TikTok connector failed.";
    if (isLikelyOfflineError(message)) {
      return {
        username,
        isLive: false,
        viewerCount: 0,
        likeCount: 0,
        enterCount: 0,
        statusCode: 0,
        comments: [],
        gifts: [],
        fetchedAt: new Date(),
      };
    }
    throw error instanceof Error ? error : new Error(message);
  } finally {
    if (connected) {
      try {
        await connection.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
  }
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
  const sigi = extractScriptJsonById(html, "SIGI_STATE");
  const sigiSnapshot = snapshotFromParsedLiveRoot(username, sigi);
  if (sigiSnapshot) {
    return sigiSnapshot;
  }

  const rehydration = extractScriptJsonById(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const rehydrationRoot = asRecord(rehydration);
  const defaultScope = asRecord(rehydrationRoot?.__DEFAULT_SCOPE__);
  const liveDetail = asRecord(defaultScope?.["webapp.live-detail"]);
  const liveDetailSnapshot = snapshotFromParsedLiveRoot(username, liveDetail);
  if (liveDetailSnapshot) {
    return liveDetailSnapshot;
  }

  const genericJsonScripts = extractJsonScriptsByType(html);
  for (const payload of genericJsonScripts) {
    const scriptSnapshot = snapshotFromParsedLiveRoot(username, payload);
    if (scriptSnapshot) {
      return scriptSnapshot;
    }
  }

  const looseSnapshot = snapshotFromLooseHtmlSignals(username, html);
  if (looseSnapshot) {
    return looseSnapshot;
  }

  throw new Error("TikTok live page did not include parsable live state data.");
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
    comments: [],
    gifts: [],
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
        await Promise.all([
          prisma.tikTokLiveSample.create({
            data: {
              sessionId,
              capturedAt,
              viewerCount,
              likeCount,
              enterCount,
            },
          }),
          prisma.tikTokLiveSession.update({
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
          }),
        ]);
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
    let webPageError = "";
    try {
      return await fetchLiveSnapshotFromWebPage(username);
    } catch (error) {
      webPageError = toErrorMessage(error, "Live page parse failed.");
    }
    const signApiKey = getTikTokSignApiKey();
    if (!signApiKey) {
      throw new Error(
        `Live snapshot failed for @${username}. Web page: ${webPageError} | Connector unavailable: set TIKTOK_SIGN_API_KEY in Vercel env.`
      );
    }
    try {
      return await fetchLiveSnapshotFromConnector(username);
    } catch (error) {
      const connectorError = toErrorMessage(error, "Connector check failed.");
      throw new Error(`Live snapshot failed for @${username}. Web page: ${webPageError} | Connector: ${connectorError}`);
    }
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
  } catch (bridgeError) {
    const bridgeMessage = toErrorMessage(bridgeError, "Python bridge check failed.");
    try {
      return await fetchLiveSnapshotFromConnector(username);
    } catch (connectorError) {
      const connectorMessage = toErrorMessage(connectorError, "Connector check failed.");
      try {
        return await fetchLiveSnapshotFromWebPage(username);
      } catch (webPageError) {
        const webPageMessage = toErrorMessage(webPageError, "Live page parse failed.");
        throw new Error(
          `Live snapshot failed for @${username}. Python: ${bridgeMessage} | Connector: ${connectorMessage} | Web page: ${webPageMessage}`
        );
      }
    }
  }
}

export async function startLiveTrackingByUsername(input: TrackLiveInput): Promise<StartTrackLiveResult> {
  const username = normalizeUsername(input.username);
  if (!username) {
    throw new Error("Username is required.");
  }
  const serverlessMode = isServerlessRuntime();

  let restartedExisting = false;
  if (input.forceRestartIfRunning) {
    const activeUsernames = Array.from(activeSessionByUsername.keys());
    for (const activeUsername of activeUsernames) {
      const stopResult = stopLiveTrackingByUsername(activeUsername);
      if (stopResult.stopped) {
        restartedExisting = true;
      }
    }

    const closedOpenSessions = await prisma.tikTokLiveSession.updateMany({
      where: {
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
        error: `Restarted by user (switched to @${username}).`,
      },
    });
    if (closedOpenSessions.count > 0) {
      restartedExisting = true;
    }
  } else {
    const existingAnySession = await prisma.tikTokLiveSession.findFirst({
      where: { endedAt: null },
      orderBy: { startedAt: "desc" },
      select: { username: true },
    });
    if (existingAnySession) {
      return {
        started: false,
        message: `Tracking is already running for @${existingAnySession.username}. Stop it first or restart with a new username.`,
      };
    }
  }

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
    throw new Error(toErrorMessage(error, "Live check failed"));
  }

  if (!snapshot.isLive) {
    throw new Error("This user appears offline right now. Start again when they are live.");
  }

  if (!serverlessMode && !getPythonInvocation()) {
    throw new Error(getPythonNotFoundMessage());
  }

  const durationRaw = Math.floor(input.durationSec);
  const durationSec = durationRaw <= 0 ? 0 : Math.max(15, Math.min(21600, durationRaw));
  const pollIntervalSec = clampSampleIntervalSec(input.pollIntervalSec, 0.5);
  const collectChatEvents = Boolean(input.collectChatEvents);
  const initialComments = snapshot.comments ?? [];
  const initialGifts = snapshot.gifts ?? [];
  const initialGiftDiamonds = initialGifts.reduce(
    (sum, gift) => sum + Math.max(0, gift.diamondCount) * Math.max(1, gift.repeatCount),
    0
  );

  const session = await prisma.tikTokLiveSession.create({
    data: {
      username,
      source: serverlessMode ? POLL_SOURCE : "tiktoklive-python-stream",
      isLive: snapshot.isLive,
      statusCode: snapshot.statusCode ?? 0,
      roomId: snapshot.roomId ?? null,
      title: snapshot.title ?? null,
      viewerCountStart: snapshot.viewerCount ?? 0,
      viewerCountPeak: snapshot.viewerCount ?? 0,
      viewerCountAvg: snapshot.viewerCount ?? 0,
      likeCountLatest: snapshot.likeCount ?? 0,
      enterCountLatest: snapshot.enterCount ?? 0,
      totalCommentEvents: initialComments.length,
      totalGiftEvents: initialGifts.length,
      totalGiftDiamonds: initialGiftDiamonds,
      warnings: null,
      error: null,
    },
  });

  await prisma.tikTokLiveSample.create({
    data: {
      sessionId: session.id,
      capturedAt: snapshot.fetchedAt ?? new Date(),
      viewerCount: snapshot.viewerCount ?? 0,
      likeCount: snapshot.likeCount ?? 0,
      enterCount: snapshot.enterCount ?? 0,
    },
  });

  if (initialComments.length > 0) {
    await prisma.tikTokLiveComment.createMany({
      data: initialComments.map((comment) => ({
        sessionId: session.id,
        createdAt: comment.createdAt,
        userUniqueId: comment.userUniqueId,
        nickname: comment.nickname,
        comment: comment.comment,
      })),
    });
  }

  if (initialGifts.length > 0) {
    await prisma.tikTokLiveGift.createMany({
      data: initialGifts.map((gift) => ({
        sessionId: session.id,
        createdAt: gift.createdAt,
        userUniqueId: gift.userUniqueId,
        nickname: gift.nickname,
        giftName: gift.giftName,
        diamondCount: gift.diamondCount,
        repeatCount: gift.repeatCount,
      })),
    });
  }

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
      totalCommentEvents: true,
      totalGiftEvents: true,
      totalGiftDiamonds: true,
      roomId: true,
      title: true,
      statusCode: true,
    },
  });

  if (!activeSession) {
    return;
  }

  const [sampleCount, latestSample] = await Promise.all([
    prisma.tikTokLiveSample.count({
      where: { sessionId: activeSession.id },
    }),
    prisma.tikTokLiveSample.findFirst({
      where: { sessionId: activeSession.id },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    }),
  ]);
  if (latestSample) {
    const elapsedMs = Date.now() - new Date(latestSample.capturedAt).getTime();
    if (elapsedMs < SERVERLESS_MIN_SAMPLE_INTERVAL_MS) {
      return;
    }
  }

  let snapshot: LiveSnapshot;
  try {
    snapshot = await fetchLiveSnapshotByUsername(activeSession.username);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live refresh failed.";
    await prisma.tikTokLiveSession.update({
      where: { id: activeSession.id },
      data: {
        error: message,
      },
    });
    return;
  }
  const nextSampleCount = sampleCount + 1;
  const avg = Number(
    ((activeSession.viewerCountAvg * sampleCount + snapshot.viewerCount) / Math.max(1, nextSampleCount)).toFixed(2)
  );
  const effectiveLikeCount = snapshot.likeCount > 0 ? snapshot.likeCount : activeSession.likeCountLatest;
  const effectiveEnterCount = Math.max(activeSession.enterCountLatest, snapshot.enterCount);
  const capturedComments = snapshot.comments ?? [];
  const capturedGifts = snapshot.gifts ?? [];
  const capturedDiamonds = capturedGifts.reduce(
    (sum, gift) => sum + Math.max(0, gift.diamondCount) * Math.max(1, gift.repeatCount),
    0
  );

  await prisma.tikTokLiveSample.create({
    data: {
      sessionId: activeSession.id,
      capturedAt: snapshot.fetchedAt,
      viewerCount: snapshot.viewerCount,
      likeCount: effectiveLikeCount,
      enterCount: effectiveEnterCount,
    },
  });

  if (capturedComments.length > 0) {
    await prisma.tikTokLiveComment.createMany({
      data: capturedComments.map((comment) => ({
        sessionId: activeSession.id,
        createdAt: comment.createdAt,
        userUniqueId: comment.userUniqueId,
        nickname: comment.nickname,
        comment: comment.comment,
      })),
    });
  }

  if (capturedGifts.length > 0) {
    await prisma.tikTokLiveGift.createMany({
      data: capturedGifts.map((gift) => ({
        sessionId: activeSession.id,
        createdAt: gift.createdAt,
        userUniqueId: gift.userUniqueId,
        nickname: gift.nickname,
        giftName: gift.giftName,
        diamondCount: gift.diamondCount,
        repeatCount: gift.repeatCount,
      })),
    });
  }

  await prisma.tikTokLiveSession.update({
    where: { id: activeSession.id },
    data: {
      isLive: snapshot.isLive,
      statusCode: snapshot.statusCode ?? activeSession.statusCode ?? null,
      roomId: snapshot.roomId ?? activeSession.roomId ?? null,
      title: snapshot.title ?? activeSession.title ?? null,
      viewerCountPeak: Math.max(activeSession.viewerCountPeak, snapshot.viewerCount),
      viewerCountAvg: avg,
      likeCountLatest: effectiveLikeCount,
      enterCountLatest: effectiveEnterCount,
      totalCommentEvents: activeSession.totalCommentEvents + capturedComments.length,
      totalGiftEvents: activeSession.totalGiftEvents + capturedGifts.length,
      totalGiftDiamonds: activeSession.totalGiftDiamonds + capturedDiamonds,
      ...(snapshot.isLive ? { error: null } : {}),
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
