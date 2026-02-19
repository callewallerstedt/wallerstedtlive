import * as cheerio from "cheerio";

export type TikTokScrapedPost = {
  platformId: string;
  description: string;
  videoUrl: string;
  coverUrl?: string;
  durationSec?: number;
  postedAt?: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  musicTitle?: string;
  musicAuthor?: string;
};

export type TikTokProfileSnapshot = {
  uniqueId?: string;
  nickname?: string;
  followerCount?: number;
  followingCount?: number;
  heartCount?: number;
  videoCount?: number;
  signature?: string;
};

const DEFAULT_LIMIT = 30;
const WEB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
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

function normalizeTikwmVideo(video: Record<string, unknown>, handle: string): TikTokScrapedPost | null {
  const platformId = String(video.video_id ?? video.aweme_id ?? video.id ?? "").trim();
  if (!platformId) {
    return null;
  }

  const stats = (video.stats ?? {}) as Record<string, unknown>;
  const play =
    typeof video.play === "string" && video.play.trim()
      ? video.play
      : `https://www.tiktok.com/@${handle}/video/${platformId}`;
  const musicInfo = (video.music_info ?? {}) as Record<string, unknown>;
  const createTimeRaw = video.create_time;
  const createTime = toNumber(createTimeRaw);

  return {
    platformId,
    description: String(video.title ?? video.desc ?? "").trim(),
    videoUrl: play,
    coverUrl: typeof video.cover === "string" ? video.cover : undefined,
    durationSec: toNumber(video.duration) || undefined,
    postedAt: createTime > 0 ? new Date(createTime * 1000) : undefined,
    views: toNumber(video.play_count ?? video.playCount ?? stats.playCount ?? stats.play_count),
    likes: toNumber(video.digg_count ?? video.like_count ?? stats.diggCount ?? stats.likeCount),
    comments: toNumber(video.comment_count ?? stats.commentCount),
    shares: toNumber(video.share_count ?? stats.shareCount),
    saves: toNumber(video.collect_count ?? stats.collectCount),
    musicTitle: typeof musicInfo.title === "string" ? musicInfo.title : undefined,
    musicAuthor: typeof musicInfo.author === "string" ? musicInfo.author : undefined,
  };
}

async function fetchFromTikwm(
  handle: string,
  limit: number
): Promise<{ posts: TikTokScrapedPost[]; warnings: string[]; profile?: TikTokProfileSnapshot }> {
  const url = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(handle)}&count=${limit}&cursor=0`;
  const response = await fetch(url, {
    headers: {
      Referer: "https://www.tikwm.com/",
      "User-Agent": WEB_HEADERS["User-Agent"],
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Tikwm returned ${response.status}`);
  }

  const data = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: {
      videos?: Record<string, unknown>[] | Record<string, Record<string, unknown>>;
      user?: Record<string, unknown>;
      author?: Record<string, unknown>;
    };
  };

  const videosRaw = data.data?.videos;
  const videos = Array.isArray(videosRaw)
    ? videosRaw
    : videosRaw && typeof videosRaw === "object"
      ? Object.values(videosRaw)
      : [];

  if (data.code !== 0 || videos.length === 0) {
    throw new Error(`Tikwm payload invalid: ${data.msg ?? "unknown error"}`);
  }

  const user = ((data.data?.user ?? data.data?.author ?? {}) as Record<string, unknown>) ?? {};
  const profile: TikTokProfileSnapshot = {
    uniqueId: typeof user.unique_id === "string" ? user.unique_id : undefined,
    nickname: typeof user.nickname === "string" ? user.nickname : undefined,
    followerCount: toNumber(user.follower_count ?? user.followers),
    followingCount: toNumber(user.following_count ?? user.following),
    heartCount: toNumber(user.heart_count ?? user.likes),
    videoCount: toNumber(user.video_count ?? user.videos),
    signature: typeof user.signature === "string" ? user.signature : undefined,
  };

  const posts = videos
    .map((video) => normalizeTikwmVideo(video, handle))
    .filter((video): video is TikTokScrapedPost => Boolean(video));

  return { posts, warnings: [], profile };
}

function collectLikelyVideoNodes(node: unknown, acc: Record<string, unknown>[]): void {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const value of node) {
      collectLikelyVideoNodes(value, acc);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const asRecord = node as Record<string, unknown>;

  const hasIdentity = Boolean(asRecord.id || asRecord.video_id || asRecord.aweme_id);
  const hasStats = typeof asRecord.stats === "object" || asRecord.playCount || asRecord.diggCount;
  if (hasIdentity && hasStats) {
    acc.push(asRecord);
  }

  for (const value of Object.values(asRecord)) {
    collectLikelyVideoNodes(value, acc);
  }
}

function normalizeScrapedVideo(node: Record<string, unknown>, handle: string): TikTokScrapedPost | null {
  const platformId = String(node.id ?? node.video_id ?? node.aweme_id ?? "").trim();
  if (!platformId) {
    return null;
  }

  const stats = (node.stats ?? {}) as Record<string, unknown>;
  const video = (node.video ?? {}) as Record<string, unknown>;
  const music = (node.music ?? {}) as Record<string, unknown>;

  return {
    platformId,
    description: String(node.desc ?? node.title ?? "").trim(),
    videoUrl: `https://www.tiktok.com/@${handle}/video/${platformId}`,
    coverUrl: typeof video.cover === "string" ? video.cover : undefined,
    durationSec: toNumber(video.duration ?? node.duration) || undefined,
    postedAt: toNumber(node.createTime) > 0 ? new Date(toNumber(node.createTime) * 1000) : undefined,
    views: toNumber(stats.playCount ?? stats.play_count ?? node.playCount),
    likes: toNumber(stats.diggCount ?? stats.digg_count ?? node.diggCount),
    comments: toNumber(stats.commentCount ?? stats.comment_count ?? node.commentCount),
    shares: toNumber(stats.shareCount ?? stats.share_count ?? node.shareCount),
    saves: toNumber(stats.collectCount ?? stats.collect_count ?? node.collectCount),
    musicTitle: typeof music.title === "string" ? music.title : undefined,
    musicAuthor: typeof music.authorName === "string" ? music.authorName : undefined,
  };
}

function normalizeItemStruct(itemStruct: Record<string, unknown>, handle: string): TikTokScrapedPost | null {
  const platformId = String(itemStruct.id ?? "").trim();
  if (!platformId) {
    return null;
  }

  const stats = (itemStruct.stats ?? {}) as Record<string, unknown>;
  const video = (itemStruct.video ?? {}) as Record<string, unknown>;
  const music = (itemStruct.music ?? {}) as Record<string, unknown>;

  return {
    platformId,
    description: String(itemStruct.desc ?? "").trim(),
    videoUrl: `https://www.tiktok.com/@${handle}/video/${platformId}`,
    coverUrl: typeof video.cover === "string" ? video.cover : undefined,
    durationSec: toNumber(video.duration) || undefined,
    postedAt: toNumber(itemStruct.createTime) > 0 ? new Date(toNumber(itemStruct.createTime) * 1000) : undefined,
    views: toNumber(stats.playCount),
    likes: toNumber(stats.diggCount),
    comments: toNumber(stats.commentCount),
    shares: toNumber(stats.shareCount),
    saves: toNumber(stats.collectCount),
    musicTitle: typeof music.title === "string" ? music.title : undefined,
    musicAuthor: typeof music.authorName === "string" ? music.authorName : undefined,
  };
}

function extractVideoDetailFromUniversal(
  payload: unknown,
  handle: string
): TikTokScrapedPost | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const defaultScope = (payload as Record<string, unknown>).__DEFAULT_SCOPE__;
  if (!defaultScope || typeof defaultScope !== "object") {
    return null;
  }

  const videoDetail = (defaultScope as Record<string, unknown>)["webapp.video-detail"];
  if (!videoDetail || typeof videoDetail !== "object") {
    return null;
  }

  const itemInfo = ((videoDetail as Record<string, unknown>).itemInfo ?? {}) as Record<string, unknown>;
  const itemStruct = (itemInfo.itemStruct ?? null) as Record<string, unknown> | null;
  if (!itemStruct) {
    return null;
  }

  return normalizeItemStruct(itemStruct, handle);
}

async function fetchFromTikTokVideoSubpage(
  handle: string,
  videoId: string
): Promise<TikTokScrapedPost | null> {
  const url = `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${videoId}?lang=en`;
  const response = await fetch(url, {
    headers: WEB_HEADERS,
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const scriptContent =
    $("#__UNIVERSAL_DATA_FOR_REHYDRATION__").html() ??
    $("#SIGI_STATE").html() ??
    $('script[type="application/json"]').first().html();
  if (!scriptContent) {
    return null;
  }

  try {
    const payload = JSON.parse(scriptContent);
    const detail = extractVideoDetailFromUniversal(payload, handle);
    if (detail) {
      return detail;
    }
  } catch {
    return null;
  }

  return null;
}

function parseCompactNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const cleaned = value.replace(/,/g, "").trim();
  const match = cleaned.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) {
    return toNumber(cleaned);
  }
  const base = Number(match[1]);
  const unit = (match[2] ?? "").toUpperCase();
  if (!Number.isFinite(base)) {
    return 0;
  }
  if (unit === "K") {
    return Math.round(base * 1_000);
  }
  if (unit === "M") {
    return Math.round(base * 1_000_000);
  }
  if (unit === "B") {
    return Math.round(base * 1_000_000_000);
  }
  return Math.round(base);
}

type UrlebirdEntry = {
  title?: string;
  videoId: string;
  urlebirdPath: string;
};

function parseUrlebirdEntries(markdown: string): UrlebirdEntry[] {
  const regex = /\[([^\]]*)\]\(https:\/\/urlebird\.com\/video\/([^)\/]+?)\/\)/g;
  const deduped = new Map<string, UrlebirdEntry>();

  for (const match of markdown.matchAll(regex)) {
    const title = match[1]?.trim();
    const path = match[2]?.trim();
    if (!path) {
      continue;
    }

    const videoIdMatch = path.match(/(\d{12,})$/);
    const videoId = videoIdMatch?.[1];
    if (!videoId) {
      continue;
    }

    if (!deduped.has(videoId)) {
      deduped.set(videoId, {
        title: title || undefined,
        videoId,
        urlebirdPath: path,
      });
    }
  }

  return Array.from(deduped.values());
}

function parseUrlebirdProfile(markdown: string): TikTokProfileSnapshot | undefined {
  const following = markdown.match(/([\d.,KMB]+)\s*Following/i)?.[1];
  const followers = markdown.match(/([\d.,KMB]+)\s*Followers/i)?.[1];
  const likes = markdown.match(/([\d.,KMB]+)\s*Likes/i)?.[1];
  const videos = markdown.match(/with\s+(\d+)\s+videos/i)?.[1];
  const uniqueId = markdown.match(/\(@([^)]+)\)/)?.[1];

  if (!following && !followers && !likes && !uniqueId && !videos) {
    return undefined;
  }

  return {
    uniqueId,
    followingCount: following ? parseCompactNumber(following) : undefined,
    followerCount: followers ? parseCompactNumber(followers) : undefined,
    heartCount: likes ? parseCompactNumber(likes) : undefined,
    videoCount: videos ? toNumber(videos) : undefined,
  };
}

function parseUrlebirdVideoDetails(markdown: string): {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  musicTitle?: string;
} {
  const views = parseCompactNumber(markdown.match(/([\d.,KMB]+)\s+views/i)?.[1]);
  const likes = parseCompactNumber(markdown.match(/([\d.,KMB]+)\s+likes/i)?.[1]);
  const comments = parseCompactNumber(markdown.match(/([\d.,KMB]+)\s+comments/i)?.[1]);
  const shares = parseCompactNumber(markdown.match(/([\d.,KMB]+)\s+shares/i)?.[1]);

  const musicMatch = markdown.match(/\[([^\]]+)\]\(https:\/\/urlebird\.com\/song\/[^)]+\)/i);
  const musicTitle = musicMatch?.[1]?.trim();

  return { views, likes, comments, shares, musicTitle };
}

async function fetchFromUrlebirdViaJina(
  handle: string,
  limit: number
): Promise<{ posts: TikTokScrapedPost[]; warnings: string[]; profile?: TikTokProfileSnapshot }> {
  const userPage = `https://r.jina.ai/http://www.urlebird.com/user/${encodeURIComponent(handle)}/`;
  const userResponse = await fetch(userPage, {
    headers: WEB_HEADERS,
    cache: "no-store",
  });

  if (!userResponse.ok) {
    throw new Error(`Urlebird mirror failed with ${userResponse.status}`);
  }

  const markdown = await userResponse.text();
  const entries = parseUrlebirdEntries(markdown).slice(0, limit);
  const profile = parseUrlebirdProfile(markdown);

  if (!entries.length) {
    return {
      posts: [],
      warnings: ["Urlebird did not provide extractable video entries for this profile."],
      profile,
    };
  }

  const posts: TikTokScrapedPost[] = [];
  for (const entry of entries) {
    const subpageDetail = await fetchFromTikTokVideoSubpage(handle, entry.videoId);
    if (subpageDetail) {
      posts.push({
        ...subpageDetail,
        description: subpageDetail.description || entry.title || "",
      });
      continue;
    }

    const detailUrl = `https://r.jina.ai/http://www.urlebird.com/video/${entry.urlebirdPath}/`;
    const detailResponse = await fetch(detailUrl, {
      headers: WEB_HEADERS,
      cache: "no-store",
    });
    if (!detailResponse.ok) {
      continue;
    }

    const detailMarkdown = await detailResponse.text();
    const parsed = parseUrlebirdVideoDetails(detailMarkdown);

    posts.push({
      platformId: entry.videoId,
      description: entry.title ?? "",
      videoUrl: `https://www.tiktok.com/@${handle}/video/${entry.videoId}`,
      views: parsed.views,
      likes: parsed.likes,
      comments: parsed.comments,
      shares: parsed.shares,
      saves: 0,
      musicTitle: parsed.musicTitle,
    });
  }

  return {
    posts: posts.slice(0, limit),
    warnings: [
      "Used Urlebird mirror fallback through r.jina.ai due TikTok direct scraping restrictions.",
      "Recovered video IDs and enriched each from direct TikTok video subpages when possible.",
    ],
    profile,
  };
}

function extractProfileFromUniversal(payload: unknown): TikTokProfileSnapshot | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const defaultScope = (payload as Record<string, unknown>).__DEFAULT_SCOPE__;
  if (!defaultScope || typeof defaultScope !== "object") {
    return undefined;
  }

  const userDetail = (defaultScope as Record<string, unknown>)["webapp.user-detail"];
  if (!userDetail || typeof userDetail !== "object") {
    return undefined;
  }

  const userInfo = ((userDetail as Record<string, unknown>).userInfo ?? {}) as Record<string, unknown>;
  const user = (userInfo.user ?? {}) as Record<string, unknown>;
  const stats = (userInfo.stats ?? userInfo.statsV2 ?? {}) as Record<string, unknown>;

  return {
    uniqueId: typeof user.uniqueId === "string" ? user.uniqueId : undefined,
    nickname: typeof user.nickname === "string" ? user.nickname : undefined,
    followerCount: toNumber(stats.followerCount),
    followingCount: toNumber(stats.followingCount),
    heartCount: toNumber(stats.heartCount ?? stats.heart),
    videoCount: toNumber(stats.videoCount),
    signature: typeof user.signature === "string" ? user.signature : undefined,
  };
}

function extractItemListFromUniversal(payload: unknown, handle: string): TikTokScrapedPost[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const defaultScope = (payload as Record<string, unknown>).__DEFAULT_SCOPE__;
  if (!defaultScope || typeof defaultScope !== "object") {
    return [];
  }

  const userDetail = (defaultScope as Record<string, unknown>)["webapp.user-detail"];
  if (!userDetail || typeof userDetail !== "object") {
    return [];
  }

  const userInfo = ((userDetail as Record<string, unknown>).userInfo ?? {}) as Record<string, unknown>;
  const itemList = Array.isArray(userInfo.itemList) ? userInfo.itemList : [];

  return itemList
    .map((item) => normalizeItemStruct(item as Record<string, unknown>, handle))
    .filter((item): item is TikTokScrapedPost => Boolean(item));
}

async function scrapeFromTikTokHtml(
  handle: string,
  limit: number
): Promise<{ posts: TikTokScrapedPost[]; warnings: string[]; profile?: TikTokProfileSnapshot }> {
  const response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
    headers: WEB_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`TikTok web page returned ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const scriptContent =
    $("#__UNIVERSAL_DATA_FOR_REHYDRATION__").html() ??
    $("#SIGI_STATE").html() ??
    $('script[type="application/json"]').first().html();

  if (!scriptContent) {
    throw new Error("Unable to locate TikTok hydration payload.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(scriptContent);
  } catch {
    const decoded = scriptContent.replace(/\\u002F/g, "/");
    payload = JSON.parse(decoded);
  }

  const candidates: Record<string, unknown>[] = [];
  collectLikelyVideoNodes(payload, candidates);
  const fromItemList = extractItemListFromUniversal(payload, handle);
  const profile = extractProfileFromUniversal(payload);

  const deduped = new Map<string, TikTokScrapedPost>();
  for (const candidate of candidates) {
    const normalized = normalizeScrapedVideo(candidate, handle);
    if (normalized && !deduped.has(normalized.platformId)) {
      deduped.set(normalized.platformId, normalized);
    }
  }
  for (const item of fromItemList) {
    if (!deduped.has(item.platformId)) {
      deduped.set(item.platformId, item);
    }
  }

  const posts = Array.from(deduped.values())
    .sort((a, b) => b.likes - a.likes)
    .slice(0, limit);

  return {
    posts,
    warnings: [
      "Tikwm fallback used TikTok HTML scraping.",
      posts.length === 0
        ? "TikTok returned profile metadata but no post list (anti-bot restriction)."
        : "TikTok HTML delivered post list successfully.",
    ],
    profile,
  };
}

export async function scrapeTikTokProfile(
  rawHandle: string,
  limit: number = DEFAULT_LIMIT
): Promise<{ source: string; posts: TikTokScrapedPost[]; warnings: string[]; profile?: TikTokProfileSnapshot }> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) {
    throw new Error("Missing TikTok handle.");
  }

  try {
    const tikwm = await fetchFromTikwm(handle, limit);
    if (tikwm.posts.length === 0) {
      throw new Error("Tikwm returned 0 videos.");
    }
    return {
      source: "tikwm",
      posts: tikwm.posts.slice(0, limit),
      warnings: tikwm.warnings,
      profile: tikwm.profile,
    };
  } catch (primaryError) {
    try {
      const fallback = await scrapeFromTikTokHtml(handle, limit);
      if (fallback.posts.length > 0) {
        return {
          source: "tiktok-web",
          posts: fallback.posts,
          profile: fallback.profile,
          warnings: [
            `Tikwm failed: ${primaryError instanceof Error ? primaryError.message : "unknown error"}`,
            ...fallback.warnings,
          ],
        };
      }

      const urlebird = await fetchFromUrlebirdViaJina(handle, limit);
      return {
        source: "urlebird-rjina",
        posts: urlebird.posts,
        profile: urlebird.profile ?? fallback.profile,
        warnings: [
          `Tikwm failed: ${primaryError instanceof Error ? primaryError.message : "unknown error"}`,
          ...fallback.warnings,
          ...urlebird.warnings,
        ],
      };
    } catch (secondaryError) {
      const urlebird = await fetchFromUrlebirdViaJina(handle, limit);
      return {
        source: "urlebird-rjina",
        posts: urlebird.posts,
        profile: urlebird.profile,
        warnings: [
          `Tikwm failed: ${primaryError instanceof Error ? primaryError.message : "unknown error"}`,
          `TikTok web fallback failed: ${secondaryError instanceof Error ? secondaryError.message : "unknown error"}`,
          ...urlebird.warnings,
        ],
      };
    }
  }
}
