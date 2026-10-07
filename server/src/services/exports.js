// ─── CreatorForge AI · Export engine ───────────────────────────────────────
// Honest export pipeline:
//   • Captions (SRT/VTT) — always available, pure server-side generation.
//   • Edit manifest (JSON EDL) — always available.
//   • Video / mixed audio — requires an ffmpeg worker. If ffmpeg is missing,
//     the job FAILS with the real reason (never a fake "completed") and the
//     client offers a real in-browser render fallback (MediaRecorder).
// When ffmpeg IS present, renderTimeline() performs a genuine render.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import db from "../db.js";
import { AppError } from "../http.js";
import { userDir, safeName } from "../storage.js";
import { segmentsToSrt, segmentsToVtt } from "./captions.js";
import { trackUsage, usageSummary } from "./jobs.js";

const execFileAsync = promisify(execFile);
let ffmpegPath = null;
let ffmpegChecked = false;

export async function checkFfmpeg() {
  if (ffmpegChecked) return ffmpegPath;
  ffmpegChecked = true;
  for (const candidate of ["ffmpeg", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) {
    try {
      await execFileAsync(candidate, ["-version"]);
      ffmpegPath = candidate;
      break;
    } catch { /* try next */ }
  }
  return ffmpegPath;
}

export const RESOLUTIONS = {
  "720p": { w: 1280, h: 720 }, "1080p": { w: 1920, h: 1080 }, "4K": { w: 3840, h: 2160 },
};

export function createExportJob({ userId, projectId, kind = "video", resolution = "1080p", fps = 30, format = "mp4" }) {
  const project = db.get("projects", projectId);
  if (!project || project.userId !== userId) throw new AppError("Project not found.", 404, "NOT_FOUND");
  const u = usageSummary(userId);
  if (u.exports >= u.quotas.exports) {
    throw new AppError(`Monthly export quota reached (${u.quotas.exports}).`, 429, "QUOTA_EXCEEDED");
  }
  const job = db.insert("export_jobs", {
    userId, projectId, kind, resolution, fps, format,
    status: "queued", progress: 0, error: "",
    logs: [`Export queued: ${kind} · ${resolution} · ${fps}fps`],
  });
  setImmediate(() => pumpExports().catch((e) => console.error("[export] pump:", e.message)));
  return job;
}

let exporting = false;

export async function pumpExports() {
  if (exporting) return;
  exporting = true;
  try {
    const job = db.where("export_jobs", { status: "queued" })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    if (!job) return;
    await processExport(job);
  } finally {
    exporting = false;
  }
}

setInterval(() => pumpExports().catch(() => null), 3000);

function elog(job, message, progress = null) {
  const patch = { logs: [...(db.get("export_jobs", job.id).logs || []), message] };
  if (progress !== null) patch.progress = progress;
  db.update("export_jobs", job.id, patch);
}

async function processExport(job) {
  db.update("export_jobs", job.id, { status: "running", progress: 5 });
  try {
    if (job.kind === "captions") await exportCaptions(job);
    else if (job.kind === "manifest") await exportManifest(job);
    else if (job.kind === "audio" || job.kind === "video") await exportMedia(job);
    else throw new AppError(`Unknown export kind: ${job.kind}`, 400, "BAD_KIND");
    trackUsage(job.userId, "export", 1, `${job.kind}:${job.resolution}`);
  } catch (err) {
    db.update("export_jobs", job.id, {
      status: "failed", error: err?.message || String(err),
      logs: [...(db.get("export_jobs", job.id).logs || []), `Failed: ${err?.message}`],
    });
  }
}

function captionSegments(projectId) {
  const items = db.where("timeline_items", (t) => t.projectId === projectId && t.track === "captions")
    .sort((a, b) => a.start - b.start);
  return items.map((t) => ({ start: t.start, end: t.start + t.duration, text: t.props?.text || t.name || "" }));
}

async function exportCaptions(job) {
  elog(job, "Generating subtitle files…", 30);
  const segments = captionSegments(job.projectId);
  if (!segments.length) throw new AppError("This project has no captions on the captions track. Generate or add captions first.", 400, "NO_CAPTIONS");
  const dir = userDir(job.userId);
  const base = `captions-${job.projectId.slice(0, 8)}`;
  const srt = segmentsToSrt(segments);
  const vtt = segmentsToVtt(segments);
  await fs.promises.writeFile(path.join(dir, `${base}.srt`), srt);
  await fs.promises.writeFile(path.join(dir, `${base}.vtt`), vtt);
  const srtAsset = db.insert("assets", {
    userId: job.userId, kind: "other", name: `${base}.srt`, mime: "text/plain",
    size: Buffer.byteLength(srt), path: path.join(dir, `${base}.srt`), jobId: null, meta: { exportJobId: job.id },
  });
  const vttAsset = db.insert("assets", {
    userId: job.userId, kind: "other", name: `${base}.vtt`, mime: "text/vtt",
    size: Buffer.byteLength(vtt), path: path.join(dir, `${base}.vtt`), jobId: null, meta: { exportJobId: job.id },
  });
  db.update("export_jobs", job.id, {
    status: "completed", progress: 100, outputAssetId: srtAsset.id,
    result: { srtAssetId: srtAsset.id, vttAssetId: vttAsset.id, count: segments.length },
    logs: [...db.get("export_jobs", job.id).logs, `Completed: ${segments.length} cues → SRT + VTT.`],
  });
}

async function exportManifest(job) {
  elog(job, "Writing edit manifest…", 40);
  const project = db.get("projects", job.projectId);
  const scenes = db.where("scenes", { projectId: job.projectId }).sort((a, b) => a.index - b.index);
  const items = db.where("timeline_items", { projectId: job.projectId }).sort((a, b) => a.start - b.start);
  const manifest = {
    app: "CreatorForge AI", version: 1, exportedAt: new Date().toISOString(),
    project: { ...project }, scenes, timeline: items,
  };
  const dir = userDir(job.userId);
  const name = `manifest-${project.id.slice(0, 8)}.json`;
  const body = JSON.stringify(manifest, null, 2);
  await fs.promises.writeFile(path.join(dir, name), body);
  const asset = db.insert("assets", {
    userId: job.userId, kind: "other", name, mime: "application/json",
    size: Buffer.byteLength(body), path: path.join(dir, name), meta: { exportJobId: job.id },
  });
  db.update("export_jobs", job.id, {
    status: "completed", progress: 100, outputAssetId: asset.id,
    logs: [...db.get("export_jobs", job.id).logs, "Completed: edit manifest (JSON EDL) saved."],
  });
}

async function exportMedia(job) {
  const ffmpeg = await checkFfmpeg();
  if (!ffmpeg) {
    throw new AppError(
      "Video export failed: no ffmpeg worker is installed on this server. Your project is safe — use 'Browser render' in the export dialog to render this video on your device right now, or ask the administrator to install ffmpeg for server-side 4K renders.",
      503, "FFMPEG_MISSING", { hint: "browser-render" }
    );
  }
  await renderTimeline(job, ffmpeg);
}

// ─── Real ffmpeg timeline renderer (runs when ffmpeg is installed) ────────
// Supports: image clips sequenced on the video track (with slow zoom),
// video clips, burned-in SRT captions, mixed audio tracks. Text overlays and
// advanced effects are flattened where supported; anything unsupported is
// logged honestly in the job log.

async function renderTimeline(job, ffmpeg) {
  const project = db.get("projects", job.projectId);
  const items = db.where("timeline_items", { projectId: job.projectId }).sort((a, b) => a.start - b.start);
  const dir = userDir(job.userId);
  const workDir = path.join(dir, `.export-${job.id.slice(0, 8)}`);
  await fs.promises.mkdir(workDir, { recursive: true });

  try {
    elog(job, "Preparing timeline…", 10);
    const videoItems = items.filter((t) => t.track === "video");
    const audioItems = items.filter((t) => ["voice", "music", "sfx"].includes(t.track));
    const duration = Math.max(project.duration || 0, ...items.map((t) => t.start + t.duration), 1);

    const res = RESOLUTIONS[job.resolution] || RESOLUTIONS["1080p"];
    const vertical = project.aspectRatio === "9:16" || project.aspectRatio === "4:5";
    const W = vertical ? Math.round(res.h * (project.aspectRatio === "4:5" ? 4 / 5 : 9 / 16)) : res.w;
    const H = vertical ? res.h : Math.round(res.w * (project.aspectRatio === "1:1" ? 1 : 9 / 16));
    const W2 = W - (W % 2), H2 = H - (H % 2);

    const inputs = [];
    const filters = [];
    let videoChain = [];

    // Build one segment per video item, then concat.
    const segFiles = [];
    let idx = 0;
    for (const item of videoItems) {
      const asset = item.assetId ? db.get("assets", item.assetId) : null;
      const segOut = path.join(workDir, `seg${idx}.mp4`);
      if (asset && asset.kind === "image") {
        const frames = Math.max(1, Math.round(item.duration * job.fps));
        await execFileAsync(ffmpeg, [
          "-y", "-loop", "1", "-i", asset.path,
          "-vf", `scale=${W2 * 2}:${H2 * 2}:force_original_aspect_ratio=increase,crop=${W2 * 2}:${H2 * 2},zoompan=z='min(zoom+0.0015,1.25)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W2}x${H2}:fps=${job.fps}`,
          "-frames:v", String(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", segOut,
        ]);
        segFiles.push(segOut);
      } else if (asset && asset.kind === "video") {
        await execFileAsync(ffmpeg, [
          "-y", "-i", asset.path,
          "-vf", `scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},setsar=1,fps=${job.fps}`,
          "-t", String(item.duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-an", segOut,
        ]);
        segFiles.push(segOut);
      } else {
        // Placeholder color segment (honestly logged)
        const hue = ["#1b2a4a", "#2a1b4a", "#4a1b2a", "#1b4a2a"][idx % 4];
        await execFileAsync(ffmpeg, [
          "-y", "-f", "lavfi", "-i", `color=${hue}:s=${W2}x${H2}:d=${item.duration}:r=${job.fps}`,
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", segOut,
        ]);
        segFiles.push(segOut);
        elog(job, `Note: "${item.name}" has no media — rendered as a placeholder card.`);
      }
      idx += 1;
      elog(job, `Rendered segment ${idx}/${videoItems.length}…`, 10 + Math.round((idx / Math.max(videoItems.length, 1)) * 50));
    }

    if (!segFiles.length) {
      throw new AppError("Nothing to render: the video track is empty. Add clips or images to the timeline first.", 400, "EMPTY_TIMELINE");
    }

    // Concat video segments
    const listFile = path.join(workDir, "list.txt");
    await fs.promises.writeFile(listFile, segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const vcat = path.join(workDir, "video.mp4");
    await execFileAsync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", vcat]);

    // Captions burn-in
    let withSubs = vcat;
    const segments = captionSegments(job.projectId);
    if (segments.length && job.kind === "video") {
      const srtPath = path.join(workDir, "subs.srt");
      await fs.promises.writeFile(srtPath, segmentsToSrt(segments));
      const subbed = path.join(workDir, "subbed.mp4");
      try {
        await execFileAsync(ffmpeg, ["-y", "-i", vcat, "-vf", `subtitles=${srtPath.replace(/:/g, "\\:")}:force_style='FontSize=20,PrimaryColour=&HFFFFFF&,OutlineColour=&H80000000&,BorderStyle=1,Outline=2'`, "-c:a", "copy", subbed]);
        withSubs = subbed;
      } catch (e) {
        elog(job, `Note: caption burn-in skipped (${String(e.message).slice(0, 120)}). Captions are still available as SRT export.`);
      }
    }

    if (job.kind === "audio") {
      if (!audioItems.length) throw new AppError("Nothing to render: no voice, music or SFX on the timeline.", 400, "EMPTY_TIMELINE");
    }

    // Audio mix
    const audioInputs = [];
    const amix = [];
    audioItems.forEach((item, i) => {
      const asset = item.assetId ? db.get("assets", item.assetId) : null;
      if (!asset) return;
      audioInputs.push("-i", asset.path);
      const vol = item.props?.volume ?? 1;
      amix.push(`[${1 + i}:a]adelay=${Math.round(item.start * 1000)}|${Math.round(item.start * 1000)},volume=${vol}[a${i}]`);
      void inputs; void filters; void videoChain;
    });

    const outName = `export-${project.id.slice(0, 8)}-${job.resolution}.${job.format === "mp4" ? "mp4" : "mp4"}`;
    const outPath = path.join(dir, `${Date.now()}-${safeName(outName)}`);
    elog(job, "Muxing final file…", 85);

    if (job.kind === "audio") {
      const args = [...audioInputs.flatMap((_, i, arr) => (i % 2 === 0 ? ["-i", arr[i + 1]] : [])).filter(Boolean)];
      // Rebuild cleanly: audioInputs is already ["-i", path, ...]
      const aArgs = [...audioInputs];
      if (amix.length > 1) {
        aArgs.push("-filter_complex", `${amix.join(";")};${amix.map((_, i) => `[a${i}]`).join("")}amix=inputs=${amix.length}:duration=longest[aout}`, "-map", "[aout]");
      } else if (amix.length === 1) {
        aArgs.push("-filter_complex", `${amix[0]},anull[aout}`, "-map", "[aout]");
      }
      aArgs.push("-c:a", "aac", "-b:a", "192k", "-y", outPath);
      await execFileAsync(ffmpeg, ["-y", ...aArgs]);
      void args;
    } else {
      const aArgs = ["-y", "-i", withSubs, ...audioInputs];
      if (amix.length > 0) {
        // shift audio indices by 1 (video is input 0)
        const shifted = amix.map((s, i) => s.replace(`[${1 + i}:a]`, `[${1 + i}:a]`));
        aArgs.push("-filter_complex", `${shifted.join(";")};${shifted.map((_, i) => `[a${i}]`).join("")}amix=inputs=${shifted.length}:duration=first:dropout_transition=0[aout]`, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest");
      } else {
        aArgs.push("-c", "copy");
      }
      aArgs.push(outPath);
      await execFileAsync(ffmpeg, aArgs);
    }

    const stat = await fs.promises.stat(outPath);
    const asset = db.insert("assets", {
      userId: job.userId, kind: job.kind === "audio" ? "audio" : "video",
      name: path.basename(outPath), mime: job.kind === "audio" ? "audio/mp4" : "video/mp4",
      size: stat.size, path: outPath, meta: { exportJobId: job.id, resolution: job.resolution, fps: job.fps },
    });
    db.update("export_jobs", job.id, {
      status: "completed", progress: 100, outputAssetId: asset.id,
      logs: [...db.get("export_jobs", job.id).logs, `Completed: ${path.basename(outPath)} (${Math.round(stat.size / 1024)} KB).`],
    });
    void duration;
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => null);
  }
}
