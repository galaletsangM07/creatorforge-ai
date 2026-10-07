// ─── CreatorForge AI · Generation job engine ──────────────────────────────
// Flow (never blocks the UI):
//   request → generation row (queued) → worker picks it up → provider call
//   → poll if async → store result as asset → completed | failed (real error)
// In production this worker can be replaced by BullMQ/Redis; the interface
// (createGeneration / cancelGeneration / getJob) stays identical.

import fs from "node:fs";
import path from "node:path";
import db, { uid } from "../db.js";
import config from "../config.js";
import { AppError } from "../http.js";
import { userDir, safeName } from "../storage.js";
import {
  resolveProvider, generateText, generateImage, startVideo, checkVideo,
  cancelRemoteVideo, synthesize, transcribe, translateText, upscaleImage,
} from "../providers.js";
import { expandIdeaToScript, splitIntoScenes, transformScript } from "./planner.js";

const TYPE_CATEGORY = {
  text: "text", image: "image", video: "video", voice: "voice",
  speech: "speech", translate: "translate", upscale: "upscale",
};

// ─── Usage + quotas ──────────────────────────────────────────────────────

export function trackUsage(userId, kind, amount = 1, detail = "") {
  db.insert("usage", { userId, kind, amount, detail });
}

export function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export function usageSummary(userId) {
  const since = monthStart();
  const rows = db.where("usage", (r) => r.userId === userId && r.createdAt >= since);
  const sum = (kind) => rows.filter((r) => r.kind === kind).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const assets = db.where("assets", { userId });
  const storageMB = assets.reduce((a, x) => a + (Number(x.size) || 0), 0) / (1024 * 1024);
  return {
    videosGenerated: sum("video-gen"),
    imagesGenerated: sum("image-gen"),
    voiceMinutes: Math.round(sum("voice-min") * 100) / 100,
    exports: sum("export"),
    storageMB: Math.round(storageMB * 100) / 100,
    quotas: config.quotas,
  };
}

function checkQuota(userId, type, params) {
  const u = usageSummary(userId);
  const q = config.quotas;
  if (type === "video" && u.videosGenerated >= q.videoGenerations) {
    throw new AppError(`Monthly video generation quota reached (${q.videoGenerations}). Quotas reset on the 1st.`, 429, "QUOTA_EXCEEDED");
  }
  if (type === "image" && u.imagesGenerated + (Number(params.count) || 1) > q.imageGenerations) {
    throw new AppError(`This would exceed your monthly image quota (${q.imageGenerations}).`, 429, "QUOTA_EXCEEDED");
  }
  if (type === "voice") {
    const mins = String(params.text || "").split(/\s+/).filter(Boolean).length / 150;
    if (u.voiceMinutes + mins > q.voiceMinutes) {
      throw new AppError(`This would exceed your monthly voice quota (${q.voiceMinutes} min).`, 429, "QUOTA_EXCEEDED");
    }
  }
  if (u.storageMB >= q.storageMB) {
    throw new AppError(`Storage quota reached (${q.storageMB} MB). Delete unused assets to continue.`, 429, "QUOTA_EXCEEDED");
  }
}

// ─── Job lifecycle ───────────────────────────────────────────────────────

export function createGeneration({ userId, projectId = null, type, providerId = "auto", params = {} }) {
  const category = TYPE_CATEGORY[type];
  if (!category) throw new AppError(`Unknown generation type: ${type}`, 400, "BAD_TYPE");
  if (projectId) {
    const p = db.get("projects", projectId);
    if (!p || p.userId !== userId) throw new AppError("Project not found.", 404, "NOT_FOUND");
  }
  checkQuota(userId, type, params);
  // Validate early so misconfigured providers fail fast with a useful message.
  const provider = resolveProvider(category, type === "text" && params.mode === "local" ? localPlannerId() : providerId);
  const job = db.insert("generations", {
    userId, projectId, type, category,
    providerId: provider.id, providerName: provider.name, model: provider.model,
    params, status: "queued", progress: 0, resultAssetIds: [], result: null,
    error: "", logs: [`Queued · provider: ${provider.name}`],
  });
  setImmediate(() => pump().catch((e) => console.error("[jobs] pump error:", e.message)));
  return job;
}

function localPlannerId() {
  const inst = db.where("api_providers", { defKey: "local-planner" })[0];
  if (!inst) throw new AppError("Local planner is not available.", 500, "NO_LOCAL");
  return inst.id;
}

export function getJob(id, userId, isAdmin = false) {
  const job = db.get("generations", id);
  if (!job) return null;
  if (!isAdmin && job.userId !== userId) return null;
  return job;
}

export function cancelGeneration(id, userId, isAdmin = false) {
  const job = getJob(id, userId, isAdmin);
  if (!job) throw new AppError("Generation job not found.", 404, "NOT_FOUND");
  if (["completed", "failed", "cancelled"].includes(job.status)) return job;
  if (job.remoteId) {
    const inst = db.get("api_providers", job.providerId);
    if (inst) cancelRemoteVideo(inst, job.remoteId).catch(() => null);
  }
  return db.update("generations", id, {
    status: "cancelled", error: "Cancelled by user.",
    logs: [...(job.logs || []), "Cancelled by user."],
  });
}

export function retryGeneration(id, userId, isAdmin = false) {
  const job = getJob(id, userId, isAdmin);
  if (!job) throw new AppError("Generation job not found.", 404, "NOT_FOUND");
  if (!["failed", "cancelled"].includes(job.status)) throw new AppError("Only failed or cancelled jobs can be retried.", 400, "BAD_STATE");
  const updated = db.update("generations", id, {
    status: "queued", progress: 0, error: "", remoteId: null,
    logs: [...(job.logs || []), "Re-queued by user."],
  });
  setImmediate(() => pump().catch(() => null));
  return updated;
}

function log(job, message, progress = null) {
  const patch = { logs: [...(job.logs || []), message] };
  if (progress !== null) patch.progress = progress;
  Object.assign(job, db.update("generations", job.id, patch));
}

function fail(job, error) {
  const message = error?.message || String(error);
  const inst = db.get("api_providers", job.providerId);
  if (inst) db.update("api_providers", inst.id, { lastError: message });
  return db.update("generations", job.id, {
    status: "failed", error: message,
    logs: [...(job.logs || []), `Failed: ${message}`],
  });
}

// ─── Result storage ──────────────────────────────────────────────────────

export async function saveResultBuffer({ userId, jobId = null, kind, name, mime, buffer, meta = {} }) {
  const dir = userDir(userId);
  const filename = `${Date.now()}-${uid().slice(0, 8)}-${safeName(name)}`;
  const full = path.join(dir, filename);
  await fs.promises.writeFile(full, buffer);
  const asset = db.insert("assets", {
    userId, kind, name: safeName(name), mime, size: buffer.length,
    path: full, jobId, meta,
  });
  trackUsage(userId, "storage-write", 0, `${kind}:${filename}`);
  return asset;
}

// ─── Worker ──────────────────────────────────────────────────────────────

let pumping = false;
const MAX_CONCURRENT = 3;

export async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const running = db.where("generations", (j) => j.status === "running").length;
    const slots = Math.max(0, MAX_CONCURRENT - running);
    if (slots === 0) return;
    const queued = db.where("generations", { status: "queued" })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, slots);
    await Promise.allSettled(queued.map((job) => processJob(job)));
  } finally {
    pumping = false;
  }
}

setInterval(() => pump().catch(() => null), 2500);
setInterval(() => pollVideoJobs().catch(() => null), 6000);

async function processJob(job) {
  const fresh = db.get("generations", job.id);
  if (!fresh || fresh.status !== "queued") return;
  db.update("generations", job.id, { status: "running", progress: 5 });
  Object.assign(job, db.get("generations", job.id));
  try {
    switch (job.type) {
      case "text": await runText(job); break;
      case "image": await runImage(job); break;
      case "video": await runVideoStart(job); break;
      case "voice": await runVoice(job); break;
      case "speech": await runSpeech(job); break;
      case "translate": await runTranslate(job); break;
      case "upscale": await runUpscale(job); break;
      default: throw new AppError(`Unsupported generation type: ${job.type}`, 400, "BAD_TYPE");
    }
  } catch (err) {
    fail(job, err);
  }
}

// ─── Type runners ────────────────────────────────────────────────────────

async function runText(job) {
  const p = job.params || {};
  const instance = db.get("api_providers", job.providerId);
  log(job, `Generating script text…`, 20);

  // Local deterministic planner path (free, no key)
  if (instance?.defKey === "local-planner" || p.mode === "local") {
    let result;
    if (p.mode === "transform" && p.action) {
      result = { text: transformScript(p.prompt || "", p.action), draftedBy: "local-planner" };
    } else if (p.mode === "scenes") {
      result = { scenes: splitIntoScenes(p.prompt || "", { targetDuration: p.targetDuration || 30, style: p.style || "" }), draftedBy: "local-planner" };
    } else {
      const draft = expandIdeaToScript(p.prompt || p.idea || "", {
        duration: p.targetDuration || 30, videoType: p.videoType || "Motivational",
        tone: p.tone || "energetic", language: p.language || "en",
      });
      result = { ...draft, scenes: splitIntoScenes(draft.fullText, { targetDuration: p.targetDuration || 30, style: p.style || "" }) };
    }
    db.update("generations", job.id, { status: "completed", progress: 100, result, logs: [...job.logs, "Completed with Local Script Planner (rule-based draft)."] });
    return;
  }

  // LLM provider path
  const system = p.system || "You are CreatorForge AI, an expert short-form video scriptwriter. Respond with clean, ready-to-narrate script text. No stage directions in brackets unless asked.";
  const { text } = await generateText(instance, { prompt: p.prompt || "", system, maxTokens: p.maxTokens || 2000, temperature: p.temperature ?? 0.8 });
  log(job, "LLM responded, structuring scenes…", 80);
  const scenes = splitIntoScenes(text, { targetDuration: p.targetDuration || 30, style: p.style || "" });
  db.update("generations", job.id, {
    status: "completed", progress: 100,
    result: { text, scenes, draftedBy: instance.name },
    logs: [...job.logs, `Completed with ${instance.name}.`],
  });
}

async function runImage(job) {
  const p = job.params || {};
  const instance = db.get("api_providers", job.providerId);
  log(job, `Contacting ${instance.name}…`, 15);
  const { files } = await generateImage(instance, p);
  log(job, `Saving ${files.length} image(s)…`, 70);
  const assets = [];
  for (let i = 0; i < files.length; i++) {
    const a = await saveResultBuffer({
      userId: job.userId, jobId: job.id, kind: "image",
      name: `gen-image-${i + 1}.png`, mime: files[i].mime, buffer: files[i].buffer,
      meta: { prompt: p.prompt, provider: instance.name, sceneId: p.sceneId || null },
    });
    assets.push(a.id);
    trackUsage(job.userId, "image-gen", 1, instance.name);
  }
  db.update("generations", job.id, {
    status: "completed", progress: 100, resultAssetIds: assets,
    result: { count: assets.length }, logs: [...job.logs, `Completed: ${assets.length} image(s) saved.`],
  });
}

async function runVideoStart(job) {
  const p = job.params || {};
  const instance = db.get("api_providers", job.providerId);
  log(job, `Submitting video request to ${instance.name}…`, 10);
  let imageUrl;
  if (p.imageAssetId) {
    const asset = db.get("assets", p.imageAssetId);
    if (!asset || asset.userId !== job.userId) throw new AppError("Source image not found.", 404, "NOT_FOUND");
    const buf = await fs.promises.readFile(asset.path);
    imageUrl = `data:${asset.mime};base64,${buf.toString("base64")}`;
  }
  const camera = p.camera && p.camera !== "Static" ? ` Camera: ${p.camera}.` : "";
  const lighting = p.lighting ? ` Lighting: ${p.lighting}.` : "";
  const { remoteId } = await startVideo(instance, {
    prompt: `${p.prompt || ""}${camera}${lighting}`,
    negativePrompt: p.negativePrompt || "",
    duration: p.duration || 5,
    aspectRatio: p.aspectRatio || "16:9",
    imageUrl,
  });
  db.update("generations", job.id, {
    remoteId, progress: 15,
    logs: [...job.logs, `Accepted by ${instance.name} (remote id ${String(remoteId).slice(0, 12)}…). Polling for completion…`],
  });
}

async function pollVideoJobs() {
  const running = db.where("generations", (j) => j.type === "video" && j.status === "running" && j.remoteId);
  for (const job of running) {
    try {
      const instance = db.get("api_providers", job.providerId);
      if (!instance) { fail(job, new Error("Provider was deleted while the job was running.")); continue; }
      const check = await checkVideo(instance, job.remoteId);
      if (check.status === "completed") {
        if (!check.fileUrl) { fail(job, new Error(`${instance.name} reported completion but returned no video URL.`)); continue; }
        log(job, "Downloading finished video…", 90);
        const res = await fetch(check.fileUrl);
        if (!res.ok) throw new Error(`Could not download finished video (HTTP ${res.status}).`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const asset = await saveResultBuffer({
          userId: job.userId, jobId: job.id, kind: "video",
          name: "gen-video.mp4", mime: res.headers.get("content-type") || "video/mp4",
          buffer, meta: { prompt: job.params?.prompt, provider: instance.name },
        });
        trackUsage(job.userId, "video-gen", 1, instance.name);
        db.update("generations", job.id, {
          status: "completed", progress: 100, resultAssetIds: [asset.id],
          result: { count: 1 }, logs: [...(db.get("generations", job.id).logs || []), "Completed: video saved to your assets."],
        });
      } else if (check.status === "failed") {
        fail(job, new Error(`${instance.name}: ${check.error || "generation failed"}`));
      } else {
        db.update("generations", job.id, { progress: Math.min(90, Math.max(job.progress || 15, check.progress || 20)) });
      }
    } catch (err) {
      // Transient poll errors shouldn't kill the job immediately — log and retry.
      const ageMin = (Date.now() - new Date(job.updatedAt).getTime()) / 60000;
      if (ageMin > 45) fail(job, err);
      else db.update("generations", job.id, { logs: [...(job.logs || []), `Poll note: ${err.message}`] });
    }
  }
}

async function runVoice(job) {
  const p = job.params || {};
  const instance = db.get("api_providers", job.providerId);
  if (instance?.defKey === "browser-tts") {
    throw new AppError("Browser Preview Voice runs in your browser, not on the server. Use Preview in the Voice Studio, or choose a server voice provider.", 400, "CLIENT_SIDE");
  }
  log(job, `Synthesizing speech with ${instance.name}…`, 25);
  const { buffer, mime } = await synthesize(instance, {
    text: p.text, voiceRef: p.voiceRef || p.voiceId, speed: p.speed, emotion: p.emotion,
  });
  const asset = await saveResultBuffer({
    userId: job.userId, jobId: job.id, kind: "audio",
    name: "voiceover.mp3", mime, buffer,
    meta: { text: String(p.text || "").slice(0, 500), provider: instance.name, sceneId: p.sceneId || null },
  });
  const minutes = String(p.text || "").split(/\s+/).filter(Boolean).length / 150;
  trackUsage(job.userId, "voice-min", Math.round(minutes * 100) / 100, instance.name);
  db.update("generations", job.id, {
    status: "completed", progress: 100, resultAssetIds: [asset.id],
    result: { minutes }, logs: [...job.logs, "Completed: voiceover saved to your assets."],
  });
}

async function runSpeech(job) {
  const p = job.params || {};
  const instance = db.get("api_providers", job.providerId);
  const asset = db.get("assets", p.assetId);
  if (!asset || asset.userId !== job.userId) throw new AppError("Audio asset not found.", 404, "NOT_FOUND");
  log(job, `Transcribing with ${instance.name}…`, 25);
  const buffer = await fs.promises.readFile(asset.path);
  const out = await transcribe(instance, { buffer, filename: asset.name, mime: asset.mime, language: p.language || "en" });
  db.update("generations", job.id, {
    status: "completed", progress: 100, result: out,
    logs: [...job.logs, `Completed: ${out.segments?.length || 0} caption segments.`],
  });
}

async function runTranslate(job) {
  const p = job.params || {};
  const instance = db.get("api_providers", job.providerId);
  // Prefer dedicated translate provider; fall back to LLM translation via text provider.
  if (job.providerId && instance?.category === "translate") {
    const { text } = await translateText(instance, { text: p.text, targetLang: p.targetLang, sourceLang: p.sourceLang });
    db.update("generations", job.id, { status: "completed", progress: 100, result: { text }, logs: [...job.logs, `Completed with ${instance.name}.`] });
    return;
  }
  const { text } = await generateText(instance, {
    prompt: `Translate the following text to ${p.targetLang}. Return ONLY the translation, no explanations:\n\n${p.text}`,
    system: "You are a precise translator.", maxTokens: 3000,
  });
  db.update("generations", job.id, { status: "completed", progress: 100, result: { text }, logs: [...job.logs, `Completed with ${instance.name}.`] });
}

async function runUpscale(job) {
  const p = job.params || {};
  const instance = db.get("api_providers", job.providerId);
  const asset = db.get("assets", p.assetId);
  if (!asset || asset.userId !== job.userId) throw new AppError("Image asset not found.", 404, "NOT_FOUND");
  log(job, `Upscaling with ${instance.name}…`, 25);
  const buffer = await fs.promises.readFile(asset.path);
  const { buffer: out, mime } = await upscaleImage(instance, { buffer, scale: p.scale || 2 });
  const saved = await saveResultBuffer({
    userId: job.userId, jobId: job.id, kind: "image",
    name: `upscaled-${asset.name}`, mime, buffer: out, meta: { provider: instance.name, sourceAssetId: asset.id },
  });
  db.update("generations", job.id, {
    status: "completed", progress: 100, resultAssetIds: [saved.id], result: { count: 1 },
    logs: [...job.logs, "Completed: upscaled image saved."],
  });
}
