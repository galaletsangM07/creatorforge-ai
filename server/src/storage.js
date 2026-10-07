// ─── CreatorForge AI · Secure object storage ──────────────────────────────
// Files are stored under DATA_DIR/uploads/<userId>/ and are NEVER served
// publicly. Every download goes through an authenticated route with an
// ownership check. In production this module can be swapped for S3/R2 by
// replacing saveBuffer/filePath/createReadStream (same interface).

import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import config from "./config.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

export function userDir(userId) {
  const dir = path.join(config.uploadDir, String(userId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeName(original) {
  const base = path.basename(String(original || "file")).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base.slice(0, 120) || "file";
}

export function filePathFor(userId, filename) {
  // Prevent path traversal: always resolve inside the user's dir.
  const dir = userDir(userId);
  const resolved = path.resolve(dir, safeName(filename));
  if (!resolved.startsWith(path.resolve(dir))) throw new Error("Invalid filename.");
  return resolved;
}

export async function saveBuffer(userId, filename, buffer) {
  const full = filePathFor(userId, `${Date.now()}-${filename}`);
  await fs.promises.writeFile(full, buffer);
  return full;
}

export function createReadStream(absolutePath) {
  return fs.createReadStream(absolutePath);
}

export async function deleteFile(absolutePath) {
  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) from provider URL.`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(destPath, buf);
  return { bytes: buf.length, contentType: res.headers.get("content-type") };
}

const ALLOWED_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "text/plain",
  "application/json",
  ".srt",
  "text/vtt",
]);

export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        cb(null, userDir(req.user.id));
      } catch (e) {
        cb(e);
      }
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${safeName(file.originalname)}`),
  }),
  limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    // Allow subtitle/text-ish uploads by extension as a fallback
    if (/\.(srt|vtt|txt|json)$/i.test(file.originalname)) return cb(null, true);
    cb(new Error(`File type not allowed: ${file.mimetype || file.originalname}`));
  },
});

export const KIND_BY_MIME = (mime = "") => {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
};
