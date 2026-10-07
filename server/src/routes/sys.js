// ─── CreatorForge AI · System routes: providers, exports, usage, admin ──────
// API keys are NEVER sent to the browser — admin responses mask them.

import { Router } from "express";
import fs from "node:fs";
import db from "../db.js";
import config from "../config.js";
import { requireAuth, requireAdmin, publicUser } from "../auth.js";
import { asyncHandler, AppError, cleanStr, num, oneOf, rateLimit } from "../http.js";
import {
  PROVIDER_CATALOG, CATEGORIES, getDef, publicInstance, testProvider,
} from "../providers.js";
import { createExportJob, checkFfmpeg } from "../services/exports.js";
import { usageSummary, monthStart } from "../services/jobs.js";

const router = Router();
router.use(requireAuth, rateLimit("api"));

// ─── Providers ───────────────────────────────────────────────────────────

router.get("/providers/catalog", (req, res) => {
  res.json({ categories: CATEGORIES, catalog: PROVIDER_CATALOG });
});

router.get("/providers", (req, res) => {
  // Masked instances visible to every user (so the UI can show status);
  // only admins can create/edit keys.
  const instances = db.all("api_providers").map(publicInstance);
  res.json({ instances, isAdmin: req.user.role === "admin" });
});

router.post("/providers", requireAdmin, asyncHandler(async (req, res) => {
  const def = getDef(req.body?.defKey);
  if (!def) throw new AppError("Unknown provider type.", 400, "BAD_DEF");
  const inst = db.insert("api_providers", {
    defKey: def.key, category: def.category,
    name: cleanStr(req.body?.name, 80) || def.label,
    endpoint: cleanStr(req.body?.endpoint, 300) || def.endpoint,
    model: cleanStr(req.body?.model, 120) || def.models[0],
    apiKey: cleanStr(req.body?.apiKey, 500),
    enabled: req.body?.enabled !== false,
    priority: num(req.body?.priority, def.free ? 200 : 100, 1, 1000),
    lastError: "",
  });
  res.status(201).json({ instance: publicInstance(inst) });
}));

router.patch("/providers/:id", requireAdmin, asyncHandler(async (req, res) => {
  const inst = db.get("api_providers", req.params.id);
  if (!inst) throw new AppError("Provider not found.", 404, "NOT_FOUND");
  const patch = {};
  if (req.body?.name !== undefined) patch.name = cleanStr(req.body.name, 80) || inst.name;
  if (req.body?.endpoint !== undefined) patch.endpoint = cleanStr(req.body.endpoint, 300);
  if (req.body?.model !== undefined) patch.model = cleanStr(req.body.model, 120);
  if (req.body?.apiKey !== undefined) patch.apiKey = cleanStr(req.body.apiKey, 500);
  if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
  if (req.body?.priority !== undefined) patch.priority = num(req.body.priority, inst.priority, 1, 1000);
  patch.lastError = "";
  res.json({ instance: publicInstance(db.update("api_providers", inst.id, patch)) });
}));

router.delete("/providers/:id", requireAdmin, (req, res) => {
  const inst = db.get("providers", req.params.id) || db.get("api_providers", req.params.id);
  if (!inst) throw new AppError("Provider not found.", 404, "NOT_FOUND");
  if (["local-planner", "browser-tts"].includes(inst.defKey)) {
    throw new AppError("Built-in local providers cannot be deleted (you can disable them).", 400, "PROTECTED");
  }
  db.remove("api_providers", inst.id);
  res.json({ ok: true });
});

router.post("/providers/:id/test", requireAdmin, asyncHandler(async (req, res) => {
  const inst = db.get("api_providers", req.params.id);
  if (!inst) throw new AppError("Provider not found.", 404, "NOT_FOUND");
  res.json(await testProvider(inst));
}));

// ─── Exports ─────────────────────────────────────────────────────────────

router.post("/exports", asyncHandler(async (req, res) => {
  const kind = oneOf(req.body?.kind, ["video", "audio", "captions", "manifest"], "video");
  const job = createExportJob({
    userId: req.user.id,
    projectId: req.body?.projectId,
    kind,
    resolution: oneOf(req.body?.resolution, ["720p", "1080p", "4K"], "1080p"),
    fps: oneOf(Number(req.body?.fps), [24, 30, 60], 30),
    format: "mp4",
  });
  res.status(201).json({ job });
}));

router.get("/exports", asyncHandler(async (req, res) => {
  let rows = db.where("export_jobs", { userId: req.user.id });
  if (req.query.projectId) rows = rows.filter((j) => j.projectId === req.query.projectId);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ jobs: rows.slice(0, 50) });
}));

router.get("/exports/:id", asyncHandler(async (req, res) => {
  const job = db.get("export_jobs", req.params.id);
  if (!job || (job.userId !== req.user.id && req.user.role !== "admin")) {
    throw new AppError("Export job not found.", 404, "NOT_FOUND");
  }
  res.json({ job });
}));

// ─── Usage ───────────────────────────────────────────────────────────────

router.get("/usage", asyncHandler(async (req, res) => {
  const summary = usageSummary(req.user.id);
  const recent = db.where("usage", (r) => r.userId === req.user.id && r.createdAt >= monthStart())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
  const jobs = db.where("generations", { userId: req.user.id })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20)
    .map((j) => ({ id: j.id, type: j.type, status: j.status, providerName: j.providerName, error: j.error, createdAt: j.createdAt }));
  res.json({ summary, recent, jobs });
}));

// ─── Admin ───────────────────────────────────────────────────────────────

router.get("/admin/overview", requireAdmin, asyncHandler(async (req, res) => {
  const ffmpeg = await checkFfmpeg();
  let storageBytes = 0;
  try {
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${f.name}`;
        if (f.isDirectory()) walk(p);
        else { try { storageBytes += fs.statSync(p).size; } catch {} }
      }
    };
    walk(config.uploadDir);
  } catch {}
  const gens = db.all("generations");
  const byStatus = {};
  for (const g of gens) byStatus[g.status] = (byStatus[g.status] || 0) + 1;
  res.json({
    health: {
      ffmpeg: ffmpeg ? `available (${ffmpeg})` : "NOT INSTALLED — server video/audio export disabled",
      dbRecords: db.all("projects").length + db.all("assets").length,
      storageMB: Math.round((storageBytes / 1024 / 1024) * 100) / 100,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
    },
    counts: {
      users: db.count("users"), projects: db.count("projects"), assets: db.count("assets"),
      generations: gens.length, templates: db.count("templates"),
      providers: db.count("api_providers"), exports: db.count("export_jobs"),
    },
    generationsByStatus: byStatus,
    providers: db.all("api_providers").map(publicInstance),
  });
}));

router.get("/admin/users", requireAdmin, (req, res) => {
  const users = db.all("users").map((u) => ({
    ...publicUser(u),
    projects: db.count("projects", { userId: u.id }),
    generations: db.count("generations", { userId: u.id }),
  }));
  res.json({ users });
});

router.patch("/admin/users/:id", requireAdmin, asyncHandler(async (req, res) => {
  const user = db.get("users", req.params.id);
  if (!user) throw new AppError("User not found.", 404, "NOT_FOUND");
  if (user.id === req.user.id && req.body?.role && req.body.role !== "admin") {
    throw new AppError("You cannot demote yourself.", 400, "SELF_DEMOTE");
  }
  const patch = {};
  if (req.body?.role !== undefined) patch.role = oneOf(req.body.role, ["user", "admin"], user.role);
  if (req.body?.name !== undefined) patch.name = cleanStr(req.body.name, 80) || user.name;
  res.json({ user: publicUser(db.update("users", user.id, patch)) });
}));

router.get("/admin/jobs", requireAdmin, (req, res) => {
  const rows = db.all("generations").sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
  res.json({ jobs: rows });
});

router.get("/admin/projects", requireAdmin, (req, res) => {
  const rows = db.all("projects").sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 100);
  res.json({ projects: rows });
});

router.get("/admin/templates", requireAdmin, (req, res) => {
  res.json({ templates: db.all("templates") });
});

router.post("/admin/templates", requireAdmin, asyncHandler(async (req, res) => {
  const tpl = db.insert("templates", {
    title: cleanStr(req.body?.title, 120) || "Untitled template",
    category: cleanStr(req.body?.category, 40) || "General",
    description: cleanStr(req.body?.description, 500),
    aspectRatio: oneOf(req.body?.aspectRatio, ["9:16", "16:9", "1:1", "4:5"], "9:16"),
    duration: num(req.body?.duration, 30, 1, 36000),
    captionStyle: cleanStr(req.body?.captionStyle, 40) || "tiktok-pop",
    gradient: cleanStr(req.body?.gradient, 120) || "linear-gradient(135deg,#7c5cff,#00d4a4)",
    data: req.body?.data && typeof req.body.data === "object" ? req.body.data : { scenes: [], items: [] },
    featured: Boolean(req.body?.featured),
    downloads: 0,
  });
  res.status(201).json({ template: tpl });
}));

router.delete("/admin/templates/:id", requireAdmin, (req, res) => {
  if (!db.remove("templates", req.params.id)) throw new AppError("Template not found.", 404, "NOT_FOUND");
  res.json({ ok: true });
});

router.get("/admin/voices", requireAdmin, (req, res) => {
  res.json({ voices: db.all("voices") });
});

router.post("/admin/voices", requireAdmin, asyncHandler(async (req, res) => {
  const voice = db.insert("voices", {
    name: cleanStr(req.body?.name, 80) || "New voice",
    gender: oneOf(req.body?.gender, ["male", "female", "neutral"], "neutral"),
    age: cleanStr(req.body?.age, 20) || "adult",
    accent: cleanStr(req.body?.accent, 60) || "Neutral",
    styles: Array.isArray(req.body?.styles) ? req.body.styles.slice(0, 8) : [],
    provider: cleanStr(req.body?.provider, 40) || "browser",
    providerVoiceId: cleanStr(req.body?.providerVoiceId, 120),
    previewText: cleanStr(req.body?.previewText, 300) || "Hello! This is a preview of my voice.",
    enabled: req.body?.enabled !== false,
  });
  res.status(201).json({ voice });
}));

router.patch("/admin/voices/:id", requireAdmin, asyncHandler(async (req, res) => {
  const voice = db.get("voices", req.params.id);
  if (!voice) throw new AppError("Voice not found.", 404, "NOT_FOUND");
  const patch = {};
  for (const k of ["name", "age", "accent", "provider", "providerVoiceId", "previewText"]) {
    if (req.body?.[k] !== undefined) patch[k] = cleanStr(req.body[k], 300);
  }
  if (req.body?.gender !== undefined) patch.gender = oneOf(req.body.gender, ["male", "female", "neutral"], voice.gender);
  if (req.body?.styles !== undefined && Array.isArray(req.body.styles)) patch.styles = req.body.styles.slice(0, 8);
  if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
  res.json({ voice: db.update("voices", voice.id, patch) });
}));

router.delete("/admin/voices/:id", requireAdmin, (req, res) => {
  if (!db.remove("voices", req.params.id)) throw new AppError("Voice not found.", 404, "NOT_FOUND");
  res.json({ ok: true });
});

export default router;
