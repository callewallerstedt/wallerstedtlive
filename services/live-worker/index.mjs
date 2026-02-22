import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const PORT = Number(process.env.LIVE_WORKER_PORT || 8787);
const API_TOKEN = (process.env.LIVE_WORKER_API_TOKEN || "").trim();
const PYTHON_PATH = (process.env.PYTHON_PATH || "python").trim();
const ROOT_DIR = process.cwd();
const BRIDGE_PATH = path.join(ROOT_DIR, "scripts", "tiktoklive_bridge.py");
const BASE_DB_URL = process.env.LIVE_DATABASE_POSTGRES_URL || process.env.DATABASE_URL;

if (!BASE_DB_URL) {
  throw new Error("Missing LIVE_DATABASE_POSTGRES_URL or DATABASE_URL for live worker");
}

const DB_URL = BASE_DB_URL.includes("?")
  ? `${BASE_DB_URL}&connection_limit=1&pool_timeout=5&pgbouncer=true&prepare_threshold=0`
  : `${BASE_DB_URL}?connection_limit=1&pool_timeout=5&pgbouncer=true&prepare_threshold=0`;

const prisma = new PrismaClient({
  datasources: { db: { url: DB_URL } },
  log: ["warn", "error"],
});

const activeJobsBySession = new Map();
const activeSessionByUsername = new Map();

const json = (res, code, payload) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
};

function normalizeUsername(raw) {
  return String(raw || "").trim().replace(/^@/, "");
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clampSampleIntervalSec(value, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  return Number(Math.max(0.2, Math.min(30, value)).toFixed(2));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function isAuthorized(req) {
  if (!API_TOKEN) return true;
  const auth = (req.headers["authorization"] || "").toString();
  return auth === `Bearer ${API_TOKEN}`;
}

function spawnBridge(mode, args) {
  const fullArgs = [
    BRIDGE_PATH,
    "--mode",
    mode,
    "--username",
    args.username,
    "--duration-sec",
    String(args.durationSec),
    "--sample-interval-sec",
    String(args.sampleIntervalSec),
    "--max-comments",
    String(args.maxComments),
    "--max-gifts",
    String(args.maxGifts),
  ];
  if (args.collectChat) fullArgs.push("--collect-chat");

  return spawn(PYTHON_PATH, fullArgs, {
    cwd: ROOT_DIR,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runCheck(username) {
  const child = spawnBridge("check", {
    username,
    durationSec: 8,
    sampleIntervalSec: 1,
    collectChat: false,
    maxComments: 0,
    maxGifts: 0,
  });

  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Check timed out"));
    }, 30000);

    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr || `Bridge exited ${code}`));
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const parsed = parseJsonLine(lines[i]);
        if (parsed) {
          if (!parsed.ok) return reject(new Error(parsed.error || "check failed"));
          return resolve(parsed);
        }
      }
      reject(new Error("Bridge returned invalid JSON"));
    });

    child.on("error", reject);
  });
}

async function applyFinalSessionUpdate(state, errorMessage) {
  const avg = state.sampleCount > 0 ? Number((state.viewerSum / state.sampleCount).toFixed(2)) : 0;
  const warningList = Array.from(new Set(state.warnings.filter(Boolean)));

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
      error: errorMessage || (!state.isLive ? "User is currently offline." : null),
    },
  });
}

function startStreamingJob(sessionId, input) {
  const username = normalizeUsername(input.username);
  const durationRaw = Math.floor(input.durationSec);
  const durationSec = durationRaw <= 0 ? 0 : Math.max(15, Math.min(21600, durationRaw));
  const sampleIntervalSec = clampSampleIntervalSec(input.pollIntervalSec, 0.5);
  const collectChat = Boolean(input.collectChatEvents);

  const child = spawnBridge("stream", {
    username,
    durationSec,
    sampleIntervalSec,
    collectChat,
    maxComments: collectChat ? 1200 : 0,
    maxGifts: collectChat ? 900 : 0,
  });

  activeJobsBySession.set(sessionId, { sessionId, username, child });
  activeSessionByUsername.set(username, sessionId);

  const state = {
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
  let writeQueue = Promise.resolve();

  const enqueue = (action) => {
    writeQueue = writeQueue.then(action).catch((e) => {
      state.warnings.push(e instanceof Error ? e.message : "DB write error");
    });
  };

  const finalize = (errorMessage) => {
    if (state.finalized) return;
    state.finalized = true;

    enqueue(async () => {
      if (stderr.trim()) state.warnings.push(stderr.trim());
      await applyFinalSessionUpdate(state, errorMessage);
    });

    writeQueue.finally(() => {
      activeJobsBySession.delete(sessionId);
      if (activeSessionByUsername.get(username) === sessionId) {
        activeSessionByUsername.delete(username);
      }
    });
  };

  const handleLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const event = parseJsonLine(line);
    if (!event || typeof event.type !== "string") return;

    if (event.type === "meta") {
      state.isLive = Boolean(event.isLive);
      state.statusCode = toNumber(event.statusCode) || undefined;
      state.roomId = typeof event.roomId === "string" ? event.roomId : state.roomId;
      state.title = typeof event.title === "string" ? event.title : state.title;
      state.lastLike = toNumber(event.likeCount) || state.lastLike;
      state.lastEnter = toNumber(event.enterCount) || state.lastEnter;
      enqueue(async () => {
        await prisma.tikTokLiveSession.update({
          where: { id: sessionId },
          data: {
            isLive: state.isLive,
            statusCode: state.statusCode ?? null,
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
          data: { sessionId, capturedAt, viewerCount, likeCount, enterCount },
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
      const comment = typeof event.comment === "string" ? event.comment.trim() : "";
      if (!comment) return;
      state.totalComments += 1;
      enqueue(async () => {
        await prisma.tikTokLiveComment.create({
          data: {
            sessionId,
            createdAt: toDate(event.createdAt) ?? new Date(),
            userUniqueId: typeof event.userUniqueId === "string" ? event.userUniqueId : null,
            nickname: typeof event.nickname === "string" ? event.nickname : null,
            comment,
          },
        });
      });
      return;
    }

    if (event.type === "gift") {
      const diamondCount = Math.max(0, toNumber(event.diamondCount));
      const repeatCount = Math.max(1, toNumber(event.repeatCount) || 1);
      state.totalGifts += 1;
      state.totalDiamonds += diamondCount * repeatCount;
      enqueue(async () => {
        await prisma.tikTokLiveGift.create({
          data: {
            sessionId,
            createdAt: toDate(event.createdAt) ?? new Date(),
            userUniqueId: typeof event.userUniqueId === "string" ? event.userUniqueId : null,
            nickname: typeof event.nickname === "string" ? event.nickname : null,
            giftName: typeof event.giftName === "string" ? event.giftName : null,
            diamondCount,
            repeatCount,
          },
        });
      });
      return;
    }

    if (event.type === "end") {
      if (Array.isArray(event.warnings)) {
        state.warnings.push(...event.warnings.filter((w) => typeof w === "string"));
      }
      if (typeof event.error === "string" && event.error.trim()) finalize(event.error.trim());
      else finalize(null);
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    while (true) {
      const idx = stdoutBuffer.indexOf("\n");
      if (idx < 0) break;
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      handleLine(line);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  child.on("error", (e) => finalize(`TikTokLive stream process error: ${e.message}`));

  child.on("close", (code) => {
    if (stdoutBuffer.trim()) {
      handleLine(stdoutBuffer);
      stdoutBuffer = "";
    }
    if (state.finalized) return;
    const active = activeJobsBySession.get(sessionId);
    if (active?.stopReason) {
      state.warnings.push(active.stopReason);
      finalize(null);
      return;
    }
    if (code === 0) finalize(null);
    else finalize(`TikTokLive stream exited with code ${code ?? -1}`);
  });
}

async function startTrack(body) {
  const username = normalizeUsername(body.username);
  if (!username) throw new Error("Username is required");

  let restarted = false;
  const existingSessionId = activeSessionByUsername.get(username);
  if (existingSessionId && activeJobsBySession.has(existingSessionId)) {
    if (body.forceRestartIfRunning ?? true) {
      stopTrack({ username });
      restarted = true;
    } else {
      return { sessionId: existingSessionId, started: false, message: "Tracking already running" };
    }
  }

  const snapshot = await runCheck(username);
  if (!snapshot.isLive) {
    return { started: false, message: "This user is offline right now. Start again when they are live." };
  }

  const durationRaw = Math.floor(Number(body.durationSec ?? 0));
  const durationSec = durationRaw <= 0 ? 0 : Math.max(15, Math.min(21600, durationRaw));
  const pollIntervalSec = clampSampleIntervalSec(Number(body.pollIntervalSec ?? 0.5), 0.5);
  const collectChatEvents = Boolean(body.collectChatEvents ?? true);

  const session = await prisma.tikTokLiveSession.create({
    data: {
      username,
      source: "tiktoklive-python-stream-worker",
      isLive: false,
      statusCode: 0,
      viewerCountStart: 0,
      viewerCountPeak: 0,
      viewerCountAvg: 0,
      likeCountLatest: 0,
      enterCountLatest: 0,
      totalCommentEvents: 0,
      totalGiftEvents: 0,
      totalGiftDiamonds: 0,
      warnings: null,
      error: null,
    },
  });

  startStreamingJob(session.id, {
    username,
    durationSec,
    pollIntervalSec,
    collectChatEvents,
  });

  return {
    sessionId: session.id,
    started: true,
    message: restarted ? "Live tracker restarted." : "Live tracking started.",
  };
}

function stopTrack(body) {
  const username = normalizeUsername(body.username);
  if (!username) return { stopped: false, message: "Username is required." };

  const sessionId = activeSessionByUsername.get(username);
  if (!sessionId) return { stopped: false, message: "No active tracker found for this username." };

  const active = activeJobsBySession.get(sessionId);
  if (!active) {
    activeSessionByUsername.delete(username);
    return { stopped: false, message: "No active tracker process found." };
  }

  active.stopReason = "Stopped by user.";
  activeJobsBySession.delete(sessionId);
  activeSessionByUsername.delete(username);
  try {
    active.child.kill();
  } catch {}

  return { stopped: true, sessionId, message: "Stop signal sent to live tracker." };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname !== "/track/health" && !isAuthorized(req)) {
      return json(res, 401, { error: "Unauthorized" });
    }

    if (req.method === "GET" && url.pathname === "/track/health") {
      return json(res, 200, {
        ok: true,
        service: "live-worker",
        activeJobs: activeJobsBySession.size,
        uptimeSec: Math.round(process.uptime()),
      });
    }

    if (req.method === "POST" && url.pathname === "/track/check") {
      const body = await readBody(req);
      const username = normalizeUsername(body.username);
      if (!username) return json(res, 400, { error: "username is required" });
      const snapshot = await runCheck(username);
      return json(res, 200, { ok: true, snapshot });
    }

    if (req.method === "POST" && url.pathname === "/track/start") {
      const body = await readBody(req);
      const result = await startTrack(body);
      return json(res, 200, { ok: true, trackedUsername: normalizeUsername(body.username), ...result });
    }

    if (req.method === "POST" && url.pathname === "/track/stop") {
      const body = await readBody(req);
      const result = stopTrack(body);
      return json(res, 200, { ok: true, ...result });
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : "Unknown worker error" });
  }
});

server.listen(PORT, () => {
  console.log(`live-worker listening on :${PORT}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
