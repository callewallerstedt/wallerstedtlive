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

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? `Worker call failed: ${response.status}`);
  }
  return data;
}
