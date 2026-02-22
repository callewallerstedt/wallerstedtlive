# Live Worker + Cloudflare Tunnel (Free)

This setup keeps TikTokLive ingestion on a persistent machine and lets Vercel call it securely.

## Cost
- Cloudflare Tunnel via `trycloudflare.com`: **free**
- Cloudflare account + named tunnel: free tier available
- Vercel: your existing plan

## 1) Start the worker locally

```bash
cd wallerstedtlive
npm install
python -m pip install -r requirements.txt
node services/live-worker/index.mjs
```

Worker health check:

```bash
curl http://127.0.0.1:8787/track/health
```

## 2) Expose worker with free temporary tunnel

Install cloudflared (one-time), then:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

You’ll get a URL like:
`https://random-name.trycloudflare.com`

## 3) Set Vercel env vars

In Vercel project settings:

- `LIVE_WORKER_URL=https://random-name.trycloudflare.com`
- `LIVE_WORKER_API_TOKEN=<long-random-token>`

Also set same DB URL on both Vercel and worker:

- `DATABASE_URL` (or `LIVE_DATABASE_POSTGRES_URL`)

## 4) Start worker with auth token

```bash
export LIVE_WORKER_API_TOKEN="<same-token-as-vercel>"
export DATABASE_URL="<same-postgres-url-as-vercel>"
node services/live-worker/index.mjs
```

## 5) Verify end-to-end

- Open `/live`
- Start tracking username
- Confirm session appears and metrics update

## Optional: always-on free setup

Use systemd/pm2 to keep worker alive and run cloudflared alongside it.

### systemd service example (worker)

`/etc/systemd/system/wallerstedtlive-worker.service`

```ini
[Unit]
Description=Wallerstedt Live Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/<user>/wallerstedtlive
Environment=DATABASE_URL=<postgres-url>
Environment=LIVE_WORKER_API_TOKEN=<token>
Environment=PYTHON_PATH=python
ExecStart=/usr/bin/node services/live-worker/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wallerstedtlive-worker
```
