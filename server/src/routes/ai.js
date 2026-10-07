// ─── CreatorForge AI · AI routes: jobs, voices, tools, assistant ────────────

import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";
import { asyncHandler, AppError, cleanStr, cleanText, num, rateLimit } from "../http.js";
import { createGeneration, getJob, cancelGeneration, retryGeneration } from "../services/jobs.js";
import { suggestBroll, SUPPORTED_LANGUAGES } from "../services/planner.js";
import { CAPTION_STYLES, distributeScript } from "../services/captions.js";
import { resolveProvider, generateText } from "../providers.js";

const router = Router();
router.use(requireAuth, rateLimit("api"));

// ─── Generation jobs ─────────────────────────────────────────────────────

router.post("/generations", asyncHandler(async (req, res) => {
  const { type, providerId = "auto", projectId = null, params = {} } = req.body || {};
  if (!type) throw new AppError("Generation type is required.", 400, "BAD_TYPE");
  const job = createGeneration({ userId: req.user.id, projectId, type, providerId, params });
  res.status(201).json({ job: sanitizeJob(job) });
}));

router.get("/generations", asyncHandler(async (req, res) => {
  let rows = db.where("generations", { userId: req.user.id });
  if (req.query.projectId) rows = rows.filter((j) => j.projectId === req.query.projectId);
  if (req.query.status) rows = rows.filter((j) => j.status === req.query.status);
  if (req.query.type) rows = rows.filter((j) => j.type === req.query.type);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ jobs: rows.slice(0, 100).map(sanitizeJob) });
}));

router.get("/generations/:id", asyncHandler(async (req, res) => {
  const job = getJob(req.params.id, req.user.id, req.user.role === "admin");
  if (!job) throw new AppError("Generation job not found.", 404, "NOT_FOUND");
  res.json({ job: sanitizeJob(job) });
}));

router.post("/generations/:id/cancel", asyncHandler(async (req, res) => {
  res.json({ job: sanitizeJob(cancelGeneration(req.params.id, req.user.id, req.user.role === "admin")) });
}));

router.post("/generations/:id/retry", asyncHandler(async (req, res) => {
  res.json({ job: sanitizeJob(retryGeneration(req.params.id, req.user.id, req.user.role === "admin")) });
}));

function sanitizeJob(job) {
  return job; // jobs contain no secrets; provider keys are never embedded
}

// ─── Voices ──────────────────────────────────────────────────────────────

router.get("/voices", asyncHandler(async (req, res) => {
  const voices = db.where("voices", (v) => v.enabled !== false);
  res.json({ voices });
}));

// ─── Caption styles + local caption builder (no provider needed) ──────────

router.get("/caption-styles", (req, res) => {
  res.json({ styles: CAPTION_STYLES });
});

router.get("/languages", (req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

// Build word-grouped captions from scene scripts — real, local, free.
router.post("/projects/:id/auto-captions-local", asyncHandler(async (req, res) => {
  const project = db.get("projects", req.params.id);
  if (!project || (project.userId !== req.user.id && req.user.role !== "admin")) {
    throw new AppError("Project not found.", 404, "NOT_FOUND");
  }
  const scenes = db.where("scenes", { projectId: project.id }).sort((a, b) => a.index - b.index);
  const source = scenes.length
    ? scenes
    : [{ id: null, script: req.body?.script || "", start: 0, end: project.duration || 30 }];
  if (!source.some((s) => s.script?.trim())) {
    throw new AppError("There's no script text to build captions from. Write a script in the Scene Builder first.", 400, "NO_SCRIPT");
  }
  const styleId = req.body?.styleId || "tiktok-pop";
  const maxWords = Math.min(8, Math.max(1, num(req.body?.maxWords, 4, 1, 8)));
  // Remove existing auto captions to avoid duplicates
  for (const t of db.where("timeline_items", (t) => t.projectId === project.id && t.track === "captions" && t.props?.auto)) {
    db.remove("timeline_items", t.id);
  }
  const items = [];
  for (const s of source) {
    const dur = Math.max(1, (s.end ?? project.duration) - (s.start ?? 0));
    const segs = distributeScript(s.script, dur, maxWords);
    for (const g of segs) {
      items.push(db.insert("timeline_items", {
        projectId: project.id, track: "captions", name: "Auto caption",
        start: (s.start ?? 0) + g.start, duration: Math.max(0.3, g.end - g.start),
        sceneId: s.id || null, assetId: null,
        props: { text: g.text, styleId, auto: true },
      }));
    }
  }
  db.update("projects", project.id, {});
  res.json({ items, count: items.length, note: "Evenly-distributed script captions (local, free). For word-perfect timing, run AI transcription on your voiceover instead." });
}));

// B-roll suggestion for a single sentence (local, free).
router.post("/broll-suggest", asyncHandler(async (req, res) => {
  const sentence = cleanText(req.body?.sentence, 1000);
  if (!sentence) throw new AppError("Sentence is required.", 400, "BAD_BODY");
  res.json({ suggestion: suggestBroll(sentence, cleanStr(req.body?.style, 60)) });
}));

// ─── AI tools ────────────────────────────────────────────────────────────
// Each tool declares which provider category it needs. Tools with a local
// implementation run immediately; the rest create generation jobs and fail
// honestly when no provider is configured.

export const AI_TOOLS = [
  { id: "subtitle-generator", label: "AI Subtitle Generator", category: "speech", local: "auto-captions", description: "Transcribe narration into timed captions (provider) or distribute script text evenly (free, local)." },
  { id: "translation", label: "AI Translation", category: "translate", description: "Translate scripts and captions into 12+ languages." },
  { id: "upscale", label: "AI Video Upscaling", category: "upscale", description: "Upscale images with Real-ESRGAN via a configured provider." },
  { id: "dubbing", label: "AI Dubbing", category: "voice", description: "Translate + re-speak narration in another language (needs translate + voice providers)." },
  { id: "broll", label: "AI B-Roll Generator", category: "image", local: "broll-suggest", description: "Suggest or generate a visual for any sentence." },
  { id: "resize", label: "AI Resize / Reframe", category: null, local: "resize", description: "Change aspect ratio instantly (local, free)." },
  { id: "background-replace", label: "AI Background Replacement", category: "image", description: "Generate a new background plate for a scene (needs image provider)." },
  { id: "remove-background", label: "AI Remove Background", category: "image", description: "Needs an image-editing provider (e.g. Replicate BiRefNet). Configure one to enable." },
  { id: "object-removal", label: "AI Object Removal", category: "image", description: "Needs an inpainting provider. Configure one to enable." },
  { id: "noise-removal", label: "AI Noise Removal", category: null, description: "Needs an audio-enhancement provider or ffmpeg worker. Not configured yet." },
  { id: "audio-enhance", label: "AI Audio Enhancement", category: null, description: "Needs an audio-enhancement provider or ffmpeg worker. Not configured yet." },
  { id: "voice-isolation", label: "AI Voice Isolation", category: null, description: "Needs a stem-separation provider (e.g. Replicate). Configure one to enable." },
  { id: "scene-detection", label: "AI Scene Detection", category: null, description: "Needs an ffmpeg worker to analyse cuts. Not configured yet." },
  { id: "highlight", label: "AI Highlight Generator", category: "text", description: "Picks the strongest lines via an LLM text provider." },
  { id: "summarizer", label: "AI Video Summarizer", category: "text", description: "Summarises the script via an LLM text provider." },
];

router.get("/tools", asyncHandler(async (req, res) => {
  const tools = AI_TOOLS.map((t) => {
    let status = "local";
    if (t.category) {
      const instances = db.where("api_providers", { category: t.category }).filter((i) => i.enabled !== false);
      status = instances.length ? "ready" : "needs-provider";
    } else if (!t.local || t.local === "resize") {
      status = t.local ? "local" : "needs-provider";
    }
    if (!t.category && !t.local) status = "needs-provider";
    return { ...t, status };
  });
  res.json({ tools });
}));

router.post("/tools/:tool", asyncHandler(async (req, res) => {
  const tool = AI_TOOLS.find((t) => t.id === req.params.tool);
  if (!tool) throw new AppError("Unknown AI tool.", 404, "NOT_FOUND");
  const { projectId = null, providerId = "auto", params = {} } = req.body || {};

  // Local tools run immediately.
  if (tool.id === "resize" && projectId) {
    const project = db.get("projects", projectId);
    if (!project || project.userId !== req.user.id) throw new AppError("Project not found.", 404, "NOT_FOUND");
    const aspectRatio = ["9:16", "16:9", "1:1", "4:5"].includes(params.aspectRatio) ? params.aspectRatio : project.aspectRatio;
    db.update("projects", project.id, { aspectRatio });
    return res.json({ ok: true, local: true, project: db.get("projects", project.id) });
  }
  if (tool.local === "broll-suggest") {
    return res.json({ ok: true, local: true, suggestion: suggestBroll(params.sentence || "", params.style || "") });
  }

  // Provider-backed tools → generation jobs (honest failures when unconfigured).
  const map = {
    "subtitle-generator": "speech", translation: "translate", upscale: "upscale",
    dubbing: "translate", broll: "image", "background-replace": "image",
    "remove-background": "image", "object-removal": "image",
    highlight: "text", summarizer: "text",
  };
  if (tool.id === "noise-removal" || tool.id === "audio-enhance" || tool.id === "voice-isolation" || tool.id === "scene-detection") {
    throw new AppError(`"${tool.label}" needs a worker that isn't configured yet (${tool.description}). Your project is unchanged.`, 400, "TOOL_UNAVAILABLE");
  }
  const type = map[tool.id];
  if (!type) throw new AppError("This tool has no execution path yet.", 400, "TOOL_UNAVAILABLE");
  const job = createGeneration({ userId: req.user.id, projectId, type, providerId, params: { ...params, tool: tool.id } });
  res.status(201).json({ job: sanitizeJob(job) });
}));

// ─── In-editor AI assistant ──────────────────────────────────────────────
// Rule-based project commands (always available, real edits) + optional LLM
// reasoning when a text provider is configured.

router.post("/assistant", asyncHandler(async (req, res) => {
  const projectId = req.body?.projectId;
  const message = cleanText(req.body?.message, 2000);
  if (!projectId || !message) throw new AppError("projectId and message are required.", 400, "BAD_BODY");
  const project = db.get("projects", projectId);
  if (!project || (project.userId !== req.user.id && req.user.role !== "admin")) {
    throw new AppError("Project not found.", 404, "NOT_FOUND");
  }
  const actions = await runAssistant(project, message, req.user);
  res.json({ reply: actions.reply, actions: actions.ops, project: db.get("projects", projectId) });
}));

async function runAssistant(project, message, user) {
  const msg = message.toLowerCase();
  const ops = [];
  const items = () => db.where("timeline_items", { projectId: project.id });
  const scenes = () => db.where("scenes", { projectId: project.id }).sort((a, b) => a.index - b.index);

  const applyCaptions = (mutate, label) => {
    let n = 0;
    for (const t of items().filter((t) => t.track === "captions")) {
      db.update("timeline_items", t.id, { props: mutate({ ...(t.props || {}) }) });
      n += 1;
    }
    ops.push({ op: "captions", label, count: n });
    return n;
  };

  // — Captions bigger/smaller —
  if (/caption.*(bigger|larger|increase)|bigger.*caption/.test(msg)) {
    const n = applyCaptions((p) => ({ ...p, fontScale: Math.min(2, (p.fontScale || 1) + 0.25) }), "captions bigger");
    return { ops, reply: n ? `Done — I increased caption size on ${n} caption cue${n === 1 ? "" : "s"}.` : "There are no captions on the timeline yet. Generate captions first, then I'll resize them." };
  }
  if (/caption.*(smaller|decrease)|smaller.*caption/.test(msg)) {
    const n = applyCaptions((p) => ({ ...p, fontScale: Math.max(0.5, (p.fontScale || 1) - 0.25) }), "captions smaller");
    return { ops, reply: n ? `Done — captions are now smaller across ${n} cue${n === 1 ? "" : "s"}.` : "There are no captions on the timeline yet." };
  }
  // — Caption style —
  const styleHit = CAPTION_STYLES.find((s) => msg.includes(s.label.toLowerCase()) || msg.includes(s.id));
  if (/caption/.test(msg) && styleHit) {
    const n = applyCaptions((p) => ({ ...p, styleId: styleHit.id }), `style ${styleHit.id}`);
    return { ops, reply: n ? `Applied the "${styleHit.label}" caption style to ${n} cue${n === 1 ? "" : "s"}.` : "Add captions first, then I'll style them." };
  }
  // — Cinematic —
  if (/cinematic/.test(msg)) {
    let n = 0;
    for (const t of items().filter((t) => t.track === "video" || t.track === "overlay")) {
      db.update("timeline_items", t.id, { props: { ...(t.props || {}), filter: "cinematic", vignette: true } });
      n += 1;
    }
    applyCaptions((p) => ({ ...p, styleId: "cinematic" }), "style cinematic");
    ops.push({ op: "filter", label: "cinematic", count: n });
    return { ops, reply: n ? `Applied a cinematic grade + vignette to ${n} clip${n === 1 ? "" : "s"} and matched the captions.` : "Add video clips first, then I'll grade them." };
  }
  // — Music —
  if (/remove.*music|mute.*music|no music/.test(msg)) {
    let n = 0;
    for (const t of items().filter((t) => t.track === "music")) { db.remove("timeline_items", t.id); n += 1; }
    ops.push({ op: "remove-music", count: n });
    return { ops, reply: n ? `Removed ${n} music track${n === 1 ? "" : "s"} from the timeline.` : "There's no music on the timeline." };
  }
  if (/change.*music|different.*music|swap.*music/.test(msg)) {
    const tracks = db.all("music");
    const current = items().find((t) => t.track === "music");
    const next = tracks.find((m) => m.assetId && (!current || m.assetId !== current.assetId));
    if (!next?.assetId) return { ops, reply: "Your music library is empty. Upload a track in Audio, then I'll swap it in." };
    if (current) db.update("timeline_items", current.id, { assetId: next.assetId, name: next.title });
    else db.insert("timeline_items", { projectId: project.id, track: "music", name: next.title, start: 0, duration: project.duration, assetId: next.assetId, props: { volume: 0.35 } });
    ops.push({ op: "change-music", label: next.title });
    return { ops, reply: `Swapped the background music to "${next.title}".` };
  }
  if (/add.*music|background music/.test(msg)) {
    const tracks = db.all("music").filter((m) => m.assetId);
    const cat = ["motivational", "cinematic", "hip-hop", "afrobeats", "electronic", "corporate", "emotional", "ambient"].find((c) => msg.includes(c));
    const pick = (cat && tracks.find((t) => (t.category || "").toLowerCase().includes(cat))) || tracks[0];
    if (!pick) return { ops, reply: "Your music library is empty. Upload a track in Audio first — I can't bundle copyrighted music for you." };
    db.insert("timeline_items", { projectId: project.id, track: "music", name: pick.title, start: 0, duration: project.duration, assetId: pick.assetId, props: { volume: 0.35 } });
    ops.push({ op: "add-music", label: pick.title });
    return { ops, reply: `Added "${pick.title}" as background music at 35% volume.` };
  }
  // — Shorten —
  {
    const m = msg.match(/shorten[^0-9]*(\d+)\s*(s|sec|second|minute|min|m)?/);
    if (m) {
      let target = Number(m[1]);
      if (m[2]?.startsWith("m")) target *= 60;
      target = Math.min(3600, Math.max(3, target));
      const ratio = target / Math.max(project.duration, 0.01);
      for (const t of items()) {
        db.update("timeline_items", t.id, { start: round2(t.start * ratio), duration: round2(Math.max(0.2, t.duration * ratio)) });
      }
      for (const s of scenes()) db.update("scenes", s.id, { start: round2(s.start * ratio), end: round2(s.end * ratio) });
      db.update("projects", project.id, { duration: target });
      ops.push({ op: "retime", label: `${target}s` });
      return { ops, reply: `Shortened the project to ${target} seconds — all clips, scenes and captions were scaled proportionally.` };
    }
  }
  // — Hook stronger —
  if (/hook/.test(msg)) {
    const first = scenes()[0];
    if (!first) return { ops, reply: "There are no scenes yet. Build scenes from your script first." };
    const stronger = first.script?.startsWith("Stop scrolling") ? first.script : `Stop scrolling — ${first.script || "this changes everything."}`;
    db.update("scenes", first.id, { script: stronger });
    for (const t of items().filter((t) => t.sceneId === first.id && t.track === "captions")) {
      db.update("timeline_items", t.id, { props: { ...(t.props || {}), text: stronger } });
    }
    ops.push({ op: "hook", label: first.title });
    return { ops, reply: `I punched up the hook in "${first.title}". Open the Scene Builder to fine-tune it, or ask me to regenerate it with an AI provider.` };
  }
  // — Scene drama / b-roll refresh —
  {
    const m = msg.match(/scene\s*(\d+)/);
    if (m && /dramatic|better|b-roll|broll|visual/.test(msg)) {
      const scene = scenes()[Number(m[1]) - 1];
      if (!scene) return { ops, reply: `Scene ${m[1]} doesn't exist in this project.` };
      const suggestion = suggestBroll(scene.script || scene.title, project.meta?.style || "cinematic");
      db.update("scenes", scene.id, { visualPrompt: `${suggestion.visualPrompt}, dramatic lighting, high contrast`, status: "draft" });
      ops.push({ op: "scene-visual", label: scene.title });
      return { ops, reply: `Rewrote the visual direction for "${scene.title}" to be more dramatic. Queue an image generation from that scene to render it.` };
    }
  }
  if (/b-roll|broll/.test(msg)) {
    const list = scenes();
    if (!list.length) return { ops, reply: "There are no scenes yet." };
    for (const s of list) {
      const sug = suggestBroll(s.script || s.title, project.meta?.style || "");
      db.update("scenes", s.id, { visualPrompt: sug.visualPrompt, brollKeywords: sug.keywords });
    }
    ops.push({ op: "broll-refresh", count: list.length });
    return { ops, reply: `Refreshed B-roll direction for all ${list.length} scenes based on the script.` };
  }
  // — Translate video —
  {
    const lang = SUPPORTED_LANGUAGES.find((l) => msg.includes(l.label.toLowerCase()) || (l.code !== "en" && msg.includes(` ${l.code} `)));
    if (/translat/.test(msg) && lang) {
      try {
        const inst = resolveProvider("translate", "auto");
        const { translateText } = await import("../providers.js");
        let n = 0;
        for (const s of scenes()) {
          if (!s.script?.trim()) continue;
          const { text } = await translateText(inst, { text: s.script, targetLang: lang.code });
          db.update("scenes", s.id, { script: text });
          n += 1;
        }
        for (const t of items().filter((t) => t.track === "captions" && t.props?.text)) {
          const { text } = await translateText(inst, { text: t.props.text, targetLang: lang.code });
          db.update("timeline_items", t.id, { props: { ...(t.props || {}), text } });
        }
        ops.push({ op: "translate", label: lang.label, count: n });
        return { ops, reply: `Translated ${n} scene${n === 1 ? "" : "s"} and all captions into ${lang.label} with ${inst.name}.` };
      } catch (e) {
        return { ops, reply: `I couldn't translate: ${e.message}` };
      }
    }
  }

  // — LLM fallback: free-form reasoning when a text provider exists —
  try {
    const inst = resolveProvider("text", "auto");
    if (inst.defKey !== "local-planner") {
      const summary = {
        title: project.title, duration: project.duration, aspectRatio: project.aspectRatio,
        scenes: scenes().map((s) => ({ title: s.title, script: s.script?.slice(0, 200) })),
        tracks: items().map((t) => `${t.track}:${t.name}`),
      };
      const { text } = await generateText(inst, {
        system: "You are the CreatorForge AI in-editor assistant. The user asked for an edit. Reply with 1-3 short sentences: either explain exactly what rule-based change to make, or say plainly that it needs manual editing. Never claim you changed something you didn't.",
        prompt: `Project: ${JSON.stringify(summary)}\n\nUser request: ${message}`,
        maxTokens: 300,
      });
      return { ops, reply: `${text}\n\n(I can directly apply: caption size/style, cinematic grade, music add/swap/remove, retiming, hook punch-up, B-roll refresh, translation.)` };
    }
  } catch { /* no LLM — fall through to help text */ }

  return {
    ops,
    reply: "I can directly edit this project: try “make captions bigger”, “use the Hormozi Punch caption style”, “make this cinematic”, “add motivational music”, “shorten to 30 seconds”, “make the hook stronger”, “refresh B-roll”, or “translate into isiZulu”.",
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

export default router;
