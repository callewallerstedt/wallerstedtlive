import { ExperimentMetrics } from "@/lib/types";

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

export function calculateExperimentScore(metrics: ExperimentMetrics): number {
  const views = safeNumber(metrics.views);
  const likes = safeNumber(metrics.likes);
  const comments = safeNumber(metrics.comments);
  const shares = safeNumber(metrics.shares);
  const saves = safeNumber(metrics.saves);
  const linkClicks = safeNumber(metrics.linkClicks);
  const spotifyStreamsDelta = safeNumber(metrics.spotifyStreamsDelta);
  const completionRate = safeNumber(metrics.completionRate);

  const engagementRate = views > 0 ? (likes + comments + shares + saves) / views : 0;
  const viewsScore = clamp(views / 100_000);
  const engagementScore = clamp(engagementRate / 0.12);
  const completionScore = clamp(completionRate / 0.6);
  const clickScore = clamp(linkClicks / 300);
  const spotifyScore = spotifyStreamsDelta > 0 ? clamp(1 - Math.exp(-spotifyStreamsDelta / 75)) : 0;

  const score = spotifyStreamsDelta > 0
    ? 0.55 * spotifyScore + 0.2 * viewsScore + 0.15 * engagementScore + 0.1 * completionScore
    : 0.35 * viewsScore + 0.25 * engagementScore + 0.2 * completionScore + 0.2 * clickScore;

  return clamp(score);
}

export function updateRunningAverage(previous: number, count: number, value: number): number {
  if (count <= 0) {
    return value;
  }
  return (previous * count + value) / (count + 1);
}
