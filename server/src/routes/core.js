// ─── CreatorForge AI · Core routes: projects, scenes, timeline, assets ─────

import { Router } from "express";
import fs from "node:fs";
import db, { uid } from "../db.js";
import { requireAuth, requireProjectOwnership, requireAssetOwnership } from "../auth.js";
import { asyncHandler, AppError, cleanStr, cleanText, num, oneOf, rateLimit } from "../http.js";
import { upload, KIND_BY_MIME, deleteFile } from "../storage.js";
import { buildProjectFromTemplate, listTemplates } from "../seed.js";

const router = Router();
router.use(requireAuth, rateLimit("api"));

const ASPECTS = ["9:16", "16:9", "1:1", "4:5"];
const TRACKS = ["video", "overlay", "text", "captions", "voice", "music", "sfx"];

// ─── Projects ────────────────────────────────────────────────────────────

router.get("/projects", asyncHandler(async (req, res) => {
  const view = oneOf(req.query.view, ["all", "drafts", "completed", "favorites", "trash"], "all");
  let rows = db.where("projects", { userId: req.user.id });
  if (view === "trash") rows = rows.filter((p) => p.trashed);
  else {
    rows = rows.filter((p) => !p.trashed);
    if (view === "drafts") rows = rows.filter((p) => p.status === "draft");
    if (view === "completed") rows = rows.filter((p) => p.status === "completed");
    if (view === "favorites") rows = rows.filter((p) => p.favorite);
  }
  rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json({ projects: rows });
}));

router.post("/projects", asyncHandler(async (req, res) => {
  const title = cleanStr(req.body?.title, 120) || "Untitled video";
  const aspectRatio = oneOf(req.body?.aspectRatio, ASPECTS, "9:16");
  const duration = num(req.body?.duration, 30, 1, 36000);
  const project = db.insert("projects", {
    userId: req.user.id, title, aspectRatio, duration,
    description: cleanStr(req.body?.description, 500),
    status: "draft", favorite: false, trashed: false,
    thumbnail: null, sample: false,
    meta: {
      videoType: cleanStr(req.body?.videoType, 60) || "Short",
      style: cleanStr(req.body?.style, 60) || "Cinematic",
    },
  });
  res.status(201).json({ project });
}));

router.get("/projects/:id", requireProjectOwnership, asyncHandler(async (req, res) => {
  const scenes = db.where("scenes", { projectId: req.project.id }).sort((a, b) => a.index - b.index);
  const timeline = db.where("timeline_items", { projectId: req.project.id }).sort((a, b) => a.start - b.start);
  res.json({ project: req.project, scenes, timeline });
}));

router.patch("/projects/:id", requireProjectOwnership, asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body?.title !== undefined) patch.title = cleanStr(req.body.title, 120) || "Untitled video";
  if (req.body?.description !== undefined) patch.description = cleanStr(req.body.description, 500);
  if (req.body?.aspectRatio !== undefined) patch.aspectRatio = oneOf(req.body.aspectRatio, ASPECTS, req.project.aspectRatio);
  if (req.body?.duration !== undefined) patch.duration = num(req.body.duration, req.project.duration, 1, 36000);
  if (req.body?.status !== undefined) patch.status = oneOf(req.body.status, ["draft", "completed"], req.project.status);
  if (req.body?.favorite !== undefined) patch.favorite = Boolean(req.body.favorite);
  if (req.body?.trashed !== undefined) patch.trashed = Boolean(req.body.trashed);
  if (req.body?.thumbnail !== undefined) patch.thumbnail = cleanStr(req.body.thumbnail, 20000);
  if (req.body?.meta !== undefined && typeof req.body.meta === "object") patch.meta = { ...req.project.meta, ...req.body.meta };
  res.json({ project: db.update("projects", req.project.id, patch) });
}));

router.post("/projects/:id/duplicate", requireProjectOwnership, asyncHandler(async (req, res) => {
  const src = req.project;
  const copy = db.insert("projects", {
    userId: req.user.id, title: `${src.title} (copy)`, description: src.description,
    aspectRatio: src.aspectRatio, duration: src.duration, status: "draft",
    favorite: false, trashed: false, thumbnail: src.thumbnail, sample: false, meta: { ...(src.meta || {}) },
  });
  for (const s of db.where("scenes", { projectId: src.id })) {
    const { id, projectId, createdAt, updatedAt, ...rest } = s;
    db.insert("scenes", { ...rest, projectId: copy.id });
  }
  for (const t of db.where("timeline_items", { projectId: src.id })) {
    const { id, projectId, createdAt, updatedAt, ...rest } = t;
    db.insert("timeline_items", { ...rest, projectId: copy.id });
  }
  res.status(201).json({ project: copy });
}));

router.delete("/projects/:id", requireProjectOwnership, asyncHandler(async (req, res) => {
  const hard = req.query.hard === "1";
  if (hard || req.project.trashed) {
    for (const s of db.where("scenes", { projectId: req.project.id })) db.remove("scenes", s.id);
    for (const t of db.where("timeline_items", { projectId: req.project.id })) db.remove("timeline_items", t.id);
    db.remove("projects", req.project.id);
    return res.json({ ok: true, deleted: true });
  }
  db.update("projects", req.project.id, { trashed: true });
  res.json({ ok: true, trashed: true });
}));

// ─── Scenes ──────────────────────────────────────────────────────────────

router.get("/projects/:id/scenes", requireProjectOwnership, (req, res) => {
  const scenes = db.where("scenes", { projectId: req.project.id }).sort((a, b) => a.index - b.index);
  res.json({ scenes });
});

router.post("/projects/:id/scenes", requireProjectOwnership, asyncHandler(async (req, res) => {
  const existing = db.where("scenes", { projectId: req.project.id });
  const scene = db.insert("scenes", {
    projectId: req.project.id,
    index: req.body?.index ?? existing.length,
    title: cleanStr(req.body?.title, 120) || `Scene ${existing.length + 1}`,
    role: cleanStr(req.body?.role, 60) || "Scene",
    start: num(req.body?.start, 0, 0, 36000),
    end: num(req.body?.end, 5, 0, 36000),
    script: cleanText(req.body?.script, 5000),
    visualPrompt: cleanText(req.body?.visualPrompt, 2000),
    brollKeywords: Array.isArray(req.body?.brollKeywords) ? req.body.brollKeywords.slice(0, 10) : [],
    visualAssetId: req.body?.visualAssetId || null,
    voiceAssetId: req.body?.voiceAssetId || null,
    status: oneOf(req.body?.status, ["draft", "ready", "rendered"], "draft"),
  });
  touchProject(req.project.id);
  res.status(201).json({ scene });
}));

router.put("/projects/:id/scenes", requireProjectOwnership, asyncHandler(async (req, res) => {
  // Replace the full scene list (used by Scene Builder save).
  const list = Array.isArray(req.body?.scenes) ? req.body.scenes : null;
  if (!list) throw new AppError("Expected { scenes: [...] }.", 400, "BAD_BODY");
  for (const s of db.where("scenes", { projectId: req.project.id })) db.remove("scenes", s.id);
  const scenes = list.slice(0, 60).map((s, i) => db.insert("scenes", {
    projectId: req.project.id,
    index: i,
    title: cleanStr(s.title, 120) || `Scene ${i + 1}`,
    role: cleanStr(s.role, 60) || "Scene",
    start: num(s.start, 0, 0, 36000),
    end: num(s.end, 5, 0, 36000),
    script: cleanText(s.script, 5000),
    visualPrompt: cleanText(s.visualPrompt, 2000),
    brollKeywords: Array.isArray(s.brollKeywords) ? s.brollKeywords.slice(0, 10) : [],
    visualAssetId: s.visualAssetId || null,
    voiceAssetId: s.voiceAssetId || null,
    status: oneOf(s.status, ["draft", "ready", "rendered"], "draft"),
  }));
  // Keep project duration in sync with last scene end.
  const lastEnd = scenes.length ? Math.max(...scenes.map((s) => s.end)) : req.project.duration;
  db.update("projects", req.project.id, { duration: lastEnd });
  res.json({ scenes });
}));

router.patch("/projects/:id/scenes/:sceneId", requireProjectOwnership, asyncHandler(async (req, res) => {
  const scene = db.get("scenes", req.params.sceneId);
  if (!scene || scene.projectId !== req.project.id) throw new AppError("Scene not found.", 404, "NOT_FOUND");
  const patch = {};
  for (const k of ["title", "role"]) if (req.body?.[k] !== undefined) patch[k] = cleanStr(req.body[k], 120);
  for (const k of ["script"]) if (req.body?.[k] !== undefined) patch[k] = cleanText(req.body[k], 5000);
  for (const k of ["visualPrompt"]) if (req.body?.[k] !== undefined) patch[k] = cleanText(req.body[k], 2000);
  for (const k of ["start", "end"]) if (req.body?.[k] !== undefined) patch[k] = num(req.body[k], scene[k], 0, 36000);
  if (req.body?.visualAssetId !== undefined) patch.visualAssetId = req.body.visualAssetId || null;
  if (req.body?.voiceAssetId !== undefined) patch.voiceAssetId = req.body.voiceAssetId || null;
  if (req.body?.status !== undefined) patch.status = oneOf(req.body.status, ["draft", "ready", "rendered"], scene.status);
  if (req.body?.brollKeywords !== undefined && Array.isArray(req.body.brollKeywords)) patch.brollKeywords = req.body.brollKeywords.slice(0, 10);
  touchProject(req.project.id);
  res.json({ scene: db.update("scenes", scene.id, patch) });
}));

router.delete("/projects/:id/scenes/:sceneId", requireProjectOwnership, (req, res) => {
  const scene = db.get("scenes", req.params.sceneId);
  if (!scene || scene.projectId !== req.project.id) throw new AppError("Scene not found.", 404, "NOT_FOUND");
  db.remove("scenes", scene.id);
  touchProject(req.project.id);
  res.json({ ok: true });
});

// ─── Timeline items ──────────────────────────────────────────────────────

router.post("/projects/:id/timeline", requireProjectOwnership, asyncHandler(async (req, res) => {
  const track = oneOf(req.body?.track, TRACKS, null);
  if (!track) throw new AppError(`Track must be one of: ${TRACKS.join(", ")}.`, 400, "BAD_TRACK");
  if (req.body?.assetId) {
    const asset = db.get("assets", req.body.assetId);
    if (!asset || (asset.userId !== req.user.id && req.user.role !== "admin")) {
      throw new AppError("Asset not found.", 404, "NOT_FOUND");
    }
  }
  const item = db.insert("timeline_items", {
    projectId: req.project.id, track,
    name: cleanStr(req.body?.name, 160) || `${track} clip`,
    start: num(req.body?.start, 0, 0, 36000),
    duration: num(req.body?.duration, 3, 0.1, 36000),
    assetId: req.body?.assetId || null,
    sceneId: req.body?.sceneId || null,
    props: typeof req.body?.props === "object" && req.body.props ? req.body.props : {},
  });
  touchProject(req.project.id);
  res.status(201).json({ item });
}));

router.put("/projects/:id/timeline", requireProjectOwnership, asyncHandler(async (req, res) => {
  // Full timeline replace (editor autosave).
  const list = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!list) throw new AppError("Expected { items: [...] }.", 400, "BAD_BODY");
  for (const t of db.where("timeline_items", { projectId: req.project.id })) db.remove("timeline_items", t.id);
  const items = list.slice(0, 500).map((t) => db.insert("timeline_items", {
    id: t.id && typeof t.id === "string" ? t.id : uid(),
    projectId: req.project.id,
    track: oneOf(t.track, TRACKS, "video"),
    name: cleanStr(t.name, 160) || "clip",
    start: num(t.start, 0, 0, 36000),
    duration: num(t.duration, 3, 0.1, 36000),
    assetId: t.assetId || null,
    sceneId: t.sceneId || null,
    props: typeof t.props === "object" && t.props ? t.props : {},
  }));
  if (req.body?.duration !== undefined) db.update("projects", req.project.id, { duration: num(req.body.duration, req.project.duration, 1, 36000) });
  else touchProject(req.project.id);
  res.json({ items });
}));

router.patch("/projects/:id/timeline/:itemId", requireProjectOwnership, asyncHandler(async (req, res) => {
  const item = db.get("timeline_items", req.params.itemId);
  if (!item || item.projectId !== req.project.id) throw new AppError("Timeline item not found.", 404, "NOT_FOUND");
  const patch = {};
  if (req.body?.name !== undefined) patch.name = cleanStr(req.body.name, 160);
  if (req.body?.track !== undefined) patch.track = oneOf(req.body.track, TRACKS, item.track);
  if (req.body?.start !== undefined) patch.start = num(req.body.start, item.start, 0, 36000);
  if (req.body?.duration !== undefined) patch.duration = num(req.body.duration, item.duration, 0.1, 36000);
  if (req.body?.assetId !== undefined) patch.assetId = req.body.assetId || null;
  if (req.body?.sceneId !== undefined) patch.sceneId = req.body.sceneId || null;
  if (req.body?.props !== undefined && typeof req.body.props === "object") patch.props = { ...(item.props || {}), ...req.body.props };
  touchProject(req.project.id);
  res.json({ item: db.update("timeline_items", item.id, patch) });
}));

router.delete("/projects/:id/timeline/:itemId", requireProjectOwnership, (req, res) => {
  const item = db.get("timeline_items", req.params.itemId);
  if (!item || item.projectId !== req.project.id) throw new AppError("Timeline item not found.", 404, "NOT_FOUND");
  db.remove("timeline_items", item.id);
  touchProject(req.project.id);
  res.json({ ok: true });
});

// Build timeline from scenes (one video card per scene + caption cues).
router.post("/projects/:id/build-timeline", requireProjectOwnership, asyncHandler(async (req, res) => {
  const scenes = db.where("scenes", { projectId: req.project.id }).sort((a, b) => a.index - b.index);
  if (!scenes.length) throw new AppError("Add scenes first — the Scene Builder creates them from your script.", 400, "NO_SCENES");
  for (const t of db.where("timeline_items", { projectId: req.project.id })) db.remove("timeline_items", t.id);
  const items = [];
  const palette = ["#1b2a4a", "#2a1b4a", "#4a1b2a", "#123b36", "#3a2b12"];
  scenes.forEach((s, i) => {
    items.push(db.insert("timeline_items", {
      projectId: req.project.id, track: "video", name: s.title,
      start: s.start, duration: Math.max(0.5, s.end - s.start),
      assetId: s.visualAssetId || null, sceneId: s.id,
      props: { placeholder: !s.visualAssetId, color: palette[i % palette.length], fit: "cover", opacity: 1, volume: 1, speed: 1 },
    }));
    // Caption cue from scene script
    items.push(db.insert("timeline_items", {
      projectId: req.project.id, track: "captions", name: `Caption ${i + 1}`,
      start: s.start, duration: Math.max(0.5, s.end - s.start),
      assetId: null, sceneId: s.id,
      props: { text: s.script || "", styleId: req.body?.captionStyle || "tiktok-pop" },
    }));
  });
  const lastEnd = Math.max(...scenes.map((s) => s.end));
  db.update("projects", req.project.id, { duration: lastEnd });
  res.json({ items, duration: lastEnd });
}));

// ─── Assets ──────────────────────────────────────────────────────────────

router.get("/assets", asyncHandler(async (req, res) => {
  const kind = req.query.kind;
  let rows = db.where("assets", { userId: req.user.id });
  if (kind && kind !== "all") rows = rows.filter((a) => a.kind === kind);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const { path: _p, ...rest0 } = {};
  void rest0;
  res.json({ assets: rows.map((a) => ({ ...a, path: undefined })) });
}));

router.post("/assets", upload.array("files", 10), asyncHandler(async (req, res) => {
  if (!req.files?.length) throw new AppError("No files received.", 400, "NO_FILES");
  const assets = req.files.map((f) => db.insert("assets", {
    userId: req.user.id,
    kind: KIND_BY_MIME(f.mimetype),
    name: f.originalname, mime: f.mimetype, size: f.size,
    path: f.path, jobId: null,
    meta: { width: null, height: null, duration: null },
  }));
  res.status(201).json({ assets: assets.map((a) => ({ ...a, path: undefined })) });
}));

router.get("/assets/:id/file", requireAssetOwnership, asyncHandler(async (req, res) => {
  // Authenticated, ownership-checked media serving. Supports range requests
  // so video/audio scrubbing works without loading whole files.
  const full = req.asset.path;
  if (!fs.existsSync(full)) throw new AppError("The file for this asset is missing from storage.", 410, "FILE_MISSING");
  const stat = fs.statSync(full);
  res.setHeader("Content-Type", req.asset.mime || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace(/bytes=/, "").split("-").map(Number);
    const start = Number.isFinite(s) ? s : 0;
    const end = Number.isFinite(e) ? e : stat.size - 1;
    if (start >= stat.size) return res.status(416).end();
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", end - start + 1);
    return fs.createReadStream(full, { start, end }).pipe(res);
  }
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(full).pipe(res);
}));

router.delete("/assets/:id", requireAssetOwnership, asyncHandler(async (req, res) => {
  await deleteFile(req.asset.path);
  // Detach from timelines/scenes (keep edits, drop media refs)
  for (const t of db.where("timeline_items", (t) => t.assetId === req.asset.id)) {
    db.update("timeline_items", t.id, { assetId: null, props: { ...(t.props || {}), placeholder: true } });
  }
  for (const s of db.where("scenes", (s) => s.visualAssetId === req.asset.id)) db.update("scenes", s.id, { visualAssetId: null });
  for (const s of db.where("scenes", (s) => s.voiceAssetId === req.asset.id)) db.update("scenes", s.id, { voiceAssetId: null });
  db.remove("assets", req.asset.id);
  res.json({ ok: true });
}));

// ─── Templates ───────────────────────────────────────────────────────────

router.get("/templates", asyncHandler(async (req, res) => {
  res.json({ templates: listTemplates(req.query.category) });
}));

router.post("/templates/:id/use", asyncHandler(async (req, res) => {
  const tpl = db.get("templates", req.params.id);
  if (!tpl) throw new AppError("Template not found.", 404, "NOT_FOUND");
  const project = buildProjectFromTemplate(req.user, tpl, req.body?.title);
  db.update("templates", tpl.id, { downloads: (tpl.downloads || 0) + 1 });
  res.status(201).json({ project });
}));

// ─── Music / SFX library ─────────────────────────────────────────────────

router.get("/music", asyncHandler(async (req, res) => {
  const category = req.query.category;
  let rows = db.all("music");
  if (category && category !== "all") rows = rows.filter((m) => m.category === category);
  // Only expose entries whose asset (if any) belongs to the user or is stock.
  const out = rows.filter((m) => !m.assetId || (() => {
    const a = db.get("assets", m.assetId);
    return a && (a.userId === req.user.id || m.stock);
  })());
  res.json({ tracks: out });
}));

router.post("/music", upload.single("file"), asyncHandler(async (req, res) => {
  // User-uploaded music: licensing stays with the uploader (no copyrighted
  // stock is bundled with the app).
  if (!req.file) throw new AppError("No audio file received.", 400, "NO_FILES");
  const asset = db.insert("assets", {
    userId: req.user.id, kind: "audio", name: req.file.originalname,
    mime: req.file.mimetype, size: req.file.size, path: req.file.path,
    meta: { uploadedMusic: true },
  });
  const track = db.insert("music", {
    title: cleanStr(req.body?.title, 120) || req.file.originalname,
    category: cleanStr(req.body?.category, 40) || "My Uploads",
    artist: cleanStr(req.body?.artist, 80) || req.user.name,
    duration: num(req.body?.duration, 0, 0, 36000),
    assetId: asset.id, stock: false, license: "user-upload",
    uploadedBy: req.user.id,
  });
  res.status(201).json({ track });
}));

router.delete("/music/:id", asyncHandler(async (req, res) => {
  const track = db.get("music", req.params.id);
  if (!track) throw new AppError("Track not found.", 404, "NOT_FOUND");
  if (!track.stock && track.uploadedBy !== req.user.id && req.user.role !== "admin") {
    throw new AppError("You can only delete your own uploads.", 403, "FORBIDDEN");
  }
  if (track.stock && req.user.role !== "admin") throw new AppError("Only admins can remove stock tracks.", 403, "FORBIDDEN");
  db.remove("music", track.id);
  res.json({ ok: true });
}));

function touchProject(id) {
  db.update("projects", id, {});
}

export default router;
