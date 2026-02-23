# Live Worker Setup (Always-On Machine)

Run the TikTok live tracking worker + Cloudflare tunnel on a dedicated machine.

## What you need before starting

From your **Vercel Dashboard** → project → **Settings** → **Environment Variables**, grab:

- `DATABASE_URL` — the Postgres connection string
- `LIVE_WORKER_API_TOKEN` — the auth token (or pick a new long random one)

---

## Setup (one-time, in WSL terminal)

### 1. Install prerequisites

```bash
# Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Python 3 + pip
sudo apt-get install -y python3 python3-pip

# cloudflared
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

### 2. Clone the repo

```bash
cd ~
git clone https://github.com/callewallerstedt/wallerstedtlive.git
cd wallerstedtlive
```

### 3. Install dependencies

```bash
npm install
pip3 install TikTokLive==6.6.5
```

### 4. Generate Prisma client

```bash
npx prisma generate
```

### 5. Create environment file

```bash
cat > ~/.worker-env << 'ENVEOF'
DATABASE_URL="postgres://YOUR_VERCEL_POSTGRES_URL_HERE"
LIVE_WORKER_API_TOKEN="YOUR_TOKEN_HERE"
LIVE_WORKER_PORT=8787
PYTHON_PATH=python3
ENVEOF
```

Edit it with your real values:

```bash
nano ~/.worker-env
```

### 6. Test that it works

```bash
# Load env and start worker
set -a; source ~/.worker-env; set +a
node services/live-worker/index.mjs &

# Wait a moment, then check health
sleep 3
curl http://127.0.0.1:8787/track/health

# If you see {"ok":true,...} it works. Kill the test:
kill %1
```

---

## Running (every time / auto-start)

### Option A: Quick manual start

Open two WSL terminals:

**Terminal 1 — Worker:**
```bash
cd ~/wallerstedtlive
set -a; source ~/.worker-env; set +a
node services/live-worker/index.mjs
```

**Terminal 2 — Tunnel:**
```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

Copy the `https://xxxxx.trycloudflare.com` URL from the output.

### Option B: Single command (recommended)

```bash
cd ~/wallerstedtlive
bash start-worker.sh
```

This starts both worker + tunnel and prints the URL.

### Option C: Auto-start on boot (best)

```bash
# Install pm2 for process management
sudo npm install -g pm2

# Start worker via pm2
cd ~/wallerstedtlive
set -a; source ~/.worker-env; set +a
pm2 start services/live-worker/index.mjs --name live-worker

# Start tunnel via pm2
pm2 start cloudflared --name tunnel -- tunnel --url http://127.0.0.1:8787

# Save so it restarts on reboot
pm2 save
pm2 startup
```

**Note:** With free `trycloudflare.com` tunnels, the URL changes every restart.
After each restart, copy the new URL and update `LIVE_WORKER_URL` in Vercel.

---

## After starting: Update Vercel

1. Copy the tunnel URL (e.g. `https://random-words.trycloudflare.com`)
2. Go to **Vercel Dashboard** → project → **Settings** → **Environment Variables**
3. Set `LIVE_WORKER_URL` = the tunnel URL
4. Set `LIVE_WORKER_API_TOKEN` = same token as in `~/.worker-env`
5. **Redeploy** the project (Settings → Deployments → redeploy latest)

---

## Verify end-to-end

```bash
# From the worker machine, test through the tunnel:
curl -X POST https://YOUR-TUNNEL-URL.trycloudflare.com/track/health

# Should return: {"ok":true,"service":"live-worker",...}
```

Then open your Vercel app → start tracking a username → it should work.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "tunnel was temporarily offline" | Tunnel died — restart it and update LIVE_WORKER_URL in Vercel |
| Worker crashes on start | Check DATABASE_URL is a valid Postgres URL |
| Python bridge errors | Run `pip3 install TikTokLive==6.6.5` again |
| "ECONNREFUSED" | Worker isn't running — start it first |
| Tracking says "offline" | The TikTok user isn't currently live |
