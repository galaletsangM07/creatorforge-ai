# CreatorForge AI — Turn an idea into a video.

CapCut-style AI video studio + professional timeline editor in one app:
**IDEA → SCRIPT → SCENES → VISUALS → VOICEOVER → CAPTIONS → MUSIC → TIMELINE → EDIT → EXPORT**

> **Honesty by design:** nothing is ever faked. Generators run as real async jobs
> against real provider APIs. If a provider isn't configured, the job fails with
> the *actual reason* (e.g. `NO_PROVIDER`, `KEY_MISSING`) and links to Settings →
> Providers. Free local tools are always clearly labeled as local/rule-based.

---

## Quick start

**Prerequisites:** Node.js 18+ (20 recommended). No database server needed.
Optional: `ffmpeg` on the server unlocks server-side video/audio rendering.

```bash
# 1. API server
cd server
npm install
node src/index.js        # → http://localhost:4000  (API + health at /api/health)

# 2. Web studio (new terminal)
cd client
npm install
npm run dev              # → http://localhost:5173  (proxies /api to :4000)
```

Open **http://localhost:5173**, sign up, and a ★ SAMPLE project is created for you.

**Admin login (seeded on first boot):**

- email: `admin@creatorforge.ai`
- password: `Admin123!` (override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars)

**Production:** `cd client && npm run build` — the API server automatically serves
`client/dist` on the same origin when it exists.

## Environment variables (server)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `DATA_DIR` | `server/data` | JSON DB + uploads live here |
| `JWT_SECRET` | dev secret | **Change in production** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | see above | Seeded admin account |
| `MAX_UPLOAD_MB` | `500` | Upload cap |
| `QUOTA_VIDEO` / `QUOTA_IMAGE` / `QUOTA_VOICE_MIN` / `QUOTA_EXPORT` / `QUOTA_STORAGE_MB` | `20/200/60/50/2048` | Monthly per-user quotas |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_AUTH_MAX` | `300/30` | Requests per IP per minute |

## What works out of the box (no API keys)

- Auth (signup/login/logout/reset), profiles, per-user isolated projects
- Script-to-video wizard with the **Local Script Planner** (rule-based scene
  splitting, B-roll direction — honestly labeled, editable)
- Real multi-track timeline editor (video/overlay/text/captions/voice/music/SFX):
  drag-move, trim, split, duplicate, delete, undo/redo, speed, volume, opacity,
  zoom, rotation, filters, transitions, freeze frame
- Live canvas preview + real timeline audio playback
- Free auto-captions from script, 8 animated caption styles, full cue editing
- In-editor AI assistant with real project commands (captions, grade, music,
  retiming, hook, B-roll, translation)
- 12 one-click templates, 10 voices, 10 royalty-free original music/SFX tracks
  (synthesized in code — zero copyrighted stock), user uploads
- Captions export (SRT+VTT, always works), edit-manifest export, **browser
  render** (genuine MediaRecorder video export on the user's device)
- Usage dashboard, quotas, admin panel (users/jobs/providers/health)

## Connecting real AI providers

Settings → Providers (admin only for keys). Supported integrations:

| Category | Paid / external | Free / self-hosted |
|---|---|---|
| Text/LLM | OpenAI, OpenAI-compatible (Groq…), Anthropic | Local planner (built-in), Ollama |
| Image | OpenAI, Stability, Replicate (FLUX…) | ComfyUI |
| Video | Luma, Runway, Replicate video | — (needs GPU host) |
| Voice | ElevenLabs, OpenAI TTS | Browser preview (built-in), Coqui XTTS |
| Speech-to-text | OpenAI Whisper | Self-hosted Whisper |
| Translate | via any LLM | LibreTranslate |
| Upscale | Replicate Real-ESRGAN | — |

API keys are stored server-side and **never sent to the browser**
(admin UI only ever sees `••••last4`). Each provider has a **Test** button that
performs a real minimal API call.

## Adding a new provider (no rewrite needed)

1. Add a definition to `PROVIDER_CATALOG` in `server/src/providers.js`
   (`{ key, category, label, endpoint, models, requiresKey, free }`).
2. Implement the category adapter in the same file (`generateText`,
   `generateImage`, `startVideo`/`checkVideo`, `synthesize`, `transcribe`,
   `translateText`, `upscaleImage`). Throw `ProviderError` with the real cause.
3. It appears in Settings → Providers automatically; jobs route to it via the
   `auto` priority system. Done — no route or UI changes required.

## Architecture

```
client/                    React 18 + Vite + React Router (original Forge UI)
  src/pages/               Landing, Auth, Dashboard, Projects, Create (wizard),
                           Studio (video/image/script/voice), Editor, Templates,
                           Assets, Audio, Settings, Admin
  src/lib/render.js        Canvas preview renderer + MediaRecorder browser export
  src/components/ui.jsx    Layout, job cards, modals, toasts
server/                    Express API (ES modules, zero native deps)
  src/index.js             App wiring, static client serving
  src/db.js                Document-store interface (JSON file today → swap for
                           Postgres later without touching routes/services)
  src/auth.js              scrypt + JWT, ownership guards
  src/storage.js           Private per-user file storage, range-request serving
  src/providers.js         Provider registry + real vendor API adapters
  src/services/jobs.js     Async generation worker (queued→running→completed/failed)
  src/services/exports.js  Export worker (ffmpeg when present, honest otherwise)
  src/services/planner.js  Local rule-based script/scene/B-roll planner
  src/services/captions.js SRT/VTT engine, word grouping, caption styles
  src/routes/              auth · core (projects/scenes/timeline/assets/templates/music)
                           ai (generations/voices/tools/assistant) · sys (providers/
                           exports/usage/admin)
```

### Job flow (generation & export)

```
request → row (queued) → worker picks up → provider call → poll if async
→ store result as private asset → completed | failed (real error + retry)
```

The UI polls job status and stays fully usable during generation.

### Database collections

`users · projects · scenes · timeline_items · assets · generations · templates ·
voices · music · subscriptions · usage · api_providers · export_jobs`

Every project/asset/job belongs to exactly one user; all reads/writes enforce it.

### Export matrix

| Kind | Needs | Fallback |
|---|---|---|
| Captions (SRT+VTT) | nothing | — always works |
| Manifest (JSON EDL) | nothing | — always works |
| Video / mixed audio | `ffmpeg` on server | **Browser render** (real device-side render) |

## Security notes

- Passwords: scrypt-hashed. Sessions: expiring JWT.
- Secrets live server-side only; keys are masked (`••••1234`) in every response.
- Uploads validated by MIME/extension, stored outside any public path, served
  only after auth + ownership checks with HTTP range support.
- Rate limiting, per-user monthly quotas, project ownership guards everywhere.

## Roadmap ideas

Postgres adapter for `db.js` · BullMQ/Redis workers · S3/R2 storage backend ·
email sender for password resets · more vendor adapters (they slot straight into
`providers.js`).
