# Deploying CreatorForge AI — get a permanent public link 🌍

## What goes where (read this first — 30 seconds)

| Part | Folder | Host it on |
|---|---|---|
| Web app (buttons, editor, pages) | `client/` | **Vercel, Netlify, or Render** (static — free) |
| API + database + uploads + AI jobs | `server/` | **Render / Railway / Fly.io** (always-on server — free tier exists) |

**Why can't the whole thing go on Vercel/Netlify?** Those run short-lived
serverless functions with no persistent disk and no background workers.
CreatorForge's API stores uploaded videos, keeps a database, and runs
generation/export workers in the background — that needs a real server.
The setups below give you **one permanent link** either way.

**Easiest path (recommended): Option A** — everything on Render with one URL.

---

## Step 0 — Put the code on GitHub (all options, 5 min)

You need the code in a GitHub repo so hosts can deploy it. On your computer:

```bash
# 1. Unzip creatorforge-ai-v1.0.0.zip, then in that folder:
git init
git add -A
git commit -m "CreatorForge AI v1.0.0"

# 2. Create an empty repo on github.com (no README), then:
git branch -M main
git remote add origin https://github.com/YOURNAME/creatorforge-ai.git
git push -u origin main
```

> The zip already excludes `node_modules`, build output, and local data —
> hosts install and build everything themselves.

---

## Option A — Everything on Render, one link ⭐ (recommended)

The API automatically serves the built web app, so one service = one URL like
`https://creatorforge-ai.onrender.com`. Open it on your phone's browser. 📱

1. Go to **dashboard.render.com** → sign up (GitHub login is easiest).
2. **New → Blueprint** → select your `creatorforge-ai` repo → **Apply**.
   (The `render.yaml` in the repo configures build + start automatically.)
3. **Storage choice** — Render shows you the disk from `render.yaml`:
   - **Free demo:** remove the disk / pick the Free plan — works fully, but
     uploaded files and accounts **reset when the service restarts**. Fine for testing.
   - **Permanent (recommended for real use):** keep the 1 GB disk on the
     **Starter ($7/mo)** plan — uploads, projects and users persist forever.
4. Check **Environment**: `JWT_SECRET` and `ADMIN_PASSWORD` were auto-generated.
   **Copy the `ADMIN_PASSWORD` value** — it's your admin login. (Or set your own
   values before deploying.)
5. Click **Deploy**, wait ~5 minutes, open your `https://….onrender.com` link.
   - First visit on the free tier can take ~60s (service wakes from sleep).
   - Sign up for a creator account, or log in as admin:
     `admin@creatorforge.ai` + your `ADMIN_PASSWORD`.
6. **On your phone:** just open the same link — the UI is fully responsive
   (bottom nav: Home · Create · Projects · Templates · Profile).

**Updating later:** `git push` to `main` → Render redeploys automatically.

---

## Option B — Vercel (frontend) + Render (backend)

Use this if you want the web app on Vercel's fast global CDN.

**Backend first (Render):**

1. Render dashboard → **New → Web Service** → select your repo.
   - **Build command:** `cd client && npm install && npm run build && cd ../server && npm install`
   - **Start command:** `cd server && node src/index.js`
   - Add env vars: `NODE_VERSION=20`, `JWT_SECRET=<long random string>`,
     `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Add a disk at `/var/data/creatorforge`
     + `DATA_DIR=/var/data/creatorforge` if on a paid plan.
2. Deploy → copy your backend URL, e.g. `https://creatorforge-api.onrender.com`.

**Frontend (Vercel):**

1. Go to **vercel.com** → **Add New → Project** → import the same repo.
2. Settings: Framework = **Vite**, **Root Directory = `client`**,
   Build = `npm run build`, Output = `dist`.
3. **Environment variable:** `VITE_API_URL` = your Render backend URL
   (no trailing slash). This is the one wire connecting them.
4. Deploy → you get `https://creatorforge-ai.vercel.app` — your permanent link.
   (`client/vercel.json` already handles page refreshes/routing.)

---

## Option C — Netlify (frontend) + Render (backend)

Same backend steps as Option B, then:

1. Go to **app.netlify.com** → **Add new site → Import an existing project** →
   select the repo. (`netlify.toml` in the repo sets base/build/publish for you.)
2. **Site settings → Environment variables:** add
   `VITE_API_URL` = your Render backend URL.
3. **Trigger deploy** → you get `https://creatorforge-ai.netlify.app`.
   (`_redirects` already handles page refreshes/routing.)

---

## Option D — Docker / VPS (advanced)

```bash
docker build -t creatorforge-ai .
docker run -d --restart unless-stopped -p 4000:4000 \
  -v creatorforge-data:/data \
  -e DATA_DIR=/data \
  -e JWT_SECRET='<generate with: openssl rand -hex 32>' \
  -e ADMIN_EMAIL='admin@yourdomain.com' \
  -e ADMIN_PASSWORD='<strong password>' \
  --name creatorforge creatorforge-ai
```

Open `http://YOUR-SERVER-IP:4000`. Put Cloudflare or Nginx + HTTPS in front
for a public phone-friendly link.

---

## Environment checklist (production)

| Var (server) | Required? | Notes |
|---|---|---|
| `JWT_SECRET` | ✅ | Long random string. Changing it logs everyone out. |
| `ADMIN_PASSWORD` | ✅ | Strong password for the seeded admin. |
| `ADMIN_EMAIL` | ✅ | Defaults to `admin@creatorforge.ai`. |
| `DATA_DIR` | If disk | Must match the disk mount path. |
| `NODE_ENV=production` | ✅ | Hides dev-only reset tokens. |
| `VITE_API_URL` (client) | Split hosting only | Backend URL for Vercel/Netlify. Leave empty on Render full-stack. |
| Quotas / rate limits | Optional | See `server/.env.example`. |

## After deploy — connect real AI (2 min)

1. Log in as **admin** → **Settings → Providers**.
2. Add a provider (e.g. OpenAI), paste the API key, **Test** the connection.
3. Keys stay on the server — the browser never sees them.
4. Without keys, everything local still works: planner, editor, captions,
   templates, browser previews, browser-render export.

## Troubleshooting

- **Blank page / 404 on refresh (Vercel/Netlify):** the rewrite configs are
  included — make sure Root Directory / base is `client`.
- **"Network error" / login fails on Vercel/Netlify:** `VITE_API_URL` is wrong
  or missing the `https://`. Redeploy after changing env vars.
- **First load is slow:** free-tier Render sleeps after inactivity; it wakes in
  ~30–60s. Paid plans stay warm.
- **Uploads/projects disappeared:** you're on Render Free without a disk —
  add the disk (Starter plan) for persistence.
- **Video export fails:** server has no `ffmpeg` (normal on Render free) —
  use **Browser render** in the export dialog, or install ffmpeg on a VPS/Docker host.

Built with 💜 by CreatorForge AI — *turn an idea into a video.*
