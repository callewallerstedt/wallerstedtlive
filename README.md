# Wallerstedt Content Strategist

Local-first AI strategist for TikTok + Spotify optimization, with persistent memory from every test.

## What it does

- Syncs TikTok profile videos (unofficial automated scraping via Tikwm + HTML fallback).
- Tracks TikTok LIVE sessions on `/live` using `TikTokLive` (comments, gifts, diamonds, viewer/like/enter curves).
- Includes iPad-first stream remote control on `/stream-control` and a clean on-stream overlay on `/stream-overlay`.
- Syncs Spotify artist library for `Wallerstedt` (or custom artist) via Spotify API.
- Pulls label/publisher metadata per track and lets you mark each song as `Mine` or `Not mine`.
- Uses OpenAI (`gpt-5.2` by default) to generate post ideas optimized for Spotify streams.
- Lets you upload screenshot + metrics after posting and updates strategy memory.
- Tracks reusable pattern performance (reinforcement-like loop).

## Stack

- Next.js 16 (App Router, TypeScript)
- Prisma ORM
- SQLite locally (`DATABASE_URL=file:./dev.db`)
- Ready to switch to Vercel Postgres by replacing `DATABASE_URL`

## Setup

1. Install dependencies

```bash
npm install
npm run python:deps
```

2. Copy env file and fill keys

```bash
cp .env.example .env
```

PowerShell alternative:

```powershell
Copy-Item .env.example .env
```

Required for full functionality:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `OPENAI_API_KEY` (optional if you paste key in settings UI)
- `PYTHON_PATH` (optional, defaults to `python`)
- `TIKTOK_SESSION_ID` (optional but recommended for age-restricted LIVE streams)
- `TIKTOK_TT_TARGET_IDC` (optional companion cookie for some accounts)

3. Create DB

```bash
npm run prisma:init
```

If you need a clean re-init:

```bash
npm run prisma:init -- --reset
```

4. Run app

```bash
npm run dev
```

For iPad/phone access on your local network:

```bash
npm run dev:lan
```

Open `http://localhost:3000`.

## Stream control setup (iPad + stream PC)

1. On your stream computer, open:

`http://<your-local-ip>:3000/stream-overlay`

Use this browser source/window in OBS or display capture.

2. On your iPad (same Wi-Fi), open:

`http://<your-local-ip>:3000/stream-control`

3. Use iPad controls to instantly update overlay content:

- `Show Spotify CTA`
- tap a song in `Now Playing`
- tap a live comment in `Show Comment`
- tap a gift in `Thank Donor`
- `Custom Overlay` text

4. iPad-local audio monitor:

- Song/comment actions attempt Spotify preview first.
- If preview is missing, it falls back to YouTube embed playback on the iPad page.

## Production path (Vercel-ready)

1. Replace `DATABASE_URL` with a Postgres connection string (for example Vercel Postgres).
2. Set environment variables in Vercel project settings.
3. Deploy as standard Next.js app.

## Notes

- TikTok scraping is unofficial and can break if TikTok/Tikwm changes formats.
- TikTok LIVE tracking depends on `TikTokLive` and can break if TikTok changes protocols.
- If TikTok returns `0 videos`, the app now reports it as a warning/error instead of false success.
- Local file uploads are stored in `data/uploads`. In Vercel production, move screenshots to blob/object storage.
- `prisma:init` is used for local bootstrap compatibility in some Windows/OneDrive paths where `prisma migrate dev` may fail.
