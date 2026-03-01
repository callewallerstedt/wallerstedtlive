"use client";

const LIVE_URL = "https://www.tiktok.com/@cwallerstedt/live";

export default function LiveViewPage() {
  return (
    <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 md:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-800 bg-stone-900/60 p-4">
          <div>
            <h1 className="text-lg font-semibold text-amber-100">TikTok Live View</h1>
            <p className="text-xs text-stone-400">Target: @cwallerstedt</p>
          </div>
          <a
            href={LIVE_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-300/20"
          >
            Open live in new tab
          </a>
        </div>

        <div className="rounded-2xl border border-stone-800 bg-black/60 p-2">
          <iframe
            title="TikTok Live @cwallerstedt"
            src={LIVE_URL}
            className="h-[80vh] w-full rounded-xl border border-stone-800 bg-stone-950"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>

        <p className="text-xs text-stone-500">
          If TikTok blocks embedding in your browser, use the "Open live in new tab" button above.
        </p>
      </div>
    </main>
  );
}
