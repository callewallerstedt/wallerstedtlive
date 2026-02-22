const WORKER_URL = process.env.LIVE_WORKER_URL?.trim();
const WORKER_TOKEN = process.env.LIVE_WORKER_API_TOKEN?.trim();

export function hasLiveWorkerConfigured(): boolean {
  return Boolean(WORKER_URL);
}

export async function callLiveWorker<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!WORKER_URL) {
    throw new Error("LIVE_WORKER_URL is not configured");
  }

  const response = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(WORKER_TOKEN ? { Authorization: `Bearer ${WORKER_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const rawText = await response.text();
  let data: (T & { error?: string }) | null = null;
  try {
    data = JSON.parse(rawText) as T & { error?: string };
  } catch {
    if (rawText.includes("no tunnel") || rawText.includes("<h1>")) {
      throw new Error("Live worker tunnel is offline. Reconnecting now — retry in ~20-40s.");
    }
    throw new Error("Live worker returned non-JSON response.");
  }

  if (!response.ok) {
    throw new Error(data.error ?? `Worker call failed: ${response.status}`);
  }
  return data;
}
