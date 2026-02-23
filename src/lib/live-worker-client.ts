const WORKER_URL = process.env.LIVE_WORKER_URL?.trim();
const WORKER_TOKEN = process.env.LIVE_WORKER_API_TOKEN?.trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hasLiveWorkerConfigured(): boolean {
  return Boolean(WORKER_URL);
}

export async function callLiveWorker<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!WORKER_URL) {
    throw new Error("LIVE_WORKER_URL is not configured");
  }

  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`${WORKER_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // localtunnel free domains can require this header to skip the interstitial page
        "bypass-tunnel-reminder": "true",
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
      const tunnelOffline = rawText.includes("no tunnel") || rawText.includes("<h1>");
      if (tunnelOffline && attempt < attempts) {
        await sleep(1200 * attempt);
        continue;
      }
      if (tunnelOffline) {
        throw new Error("Live worker tunnel was temporarily offline. It should reconnect automatically; retry in a few seconds.");
      }
      throw new Error("Live worker returned non-JSON response.");
    }

    if (!response.ok) {
      const msg = data.error ?? `Worker call failed: ${response.status}`;
      const tunnelOffline = msg.toLowerCase().includes("tunnel") || msg.toLowerCase().includes("offline");
      if (tunnelOffline && attempt < attempts) {
        await sleep(1200 * attempt);
        continue;
      }
      throw new Error(msg);
    }
    return data;
  }

  throw new Error("Live worker temporarily unavailable. Please retry.");
}
