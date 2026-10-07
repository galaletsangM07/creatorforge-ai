// ─── CreatorForge AI · Server configuration ────────────────────────────────
// All secrets live here (server-side only). NOTHING in this file is ever
// sent to the browser. Provider API keys are stored in the database and
// only ever used inside provider adapters.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");

export const config = {
  root: ROOT,
  dataDir: DATA_DIR,
  uploadDir: UPLOAD_DIR,
  dbPath: DB_PATH,
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  adminEmail: process.env.ADMIN_EMAIL || "admin@creatorforge.ai",
  adminPassword: process.env.ADMIN_PASSWORD || "Admin123!",
  maxUploadMB: Number(process.env.MAX_UPLOAD_MB || 500),
  // Free-first defaults
  defaultTextProvider: process.env.DEFAULT_TEXT_PROVIDER || "local-planner",
  // Rate limits (requests per minute per IP)
  rateLimit: {
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_MAX || 300),
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX || 30),
  },
  // Quotas (per user, per month) — enforced honestly, surfaced in UI
  quotas: {
    videoGenerations: Number(process.env.QUOTA_VIDEO || 20),
    imageGenerations: Number(process.env.QUOTA_IMAGE || 200),
    voiceMinutes: Number(process.env.QUOTA_VOICE_MIN || 60),
    exports: Number(process.env.QUOTA_EXPORT || 50),
    storageMB: Number(process.env.QUOTA_STORAGE_MB || 2048),
  },
};

export default config;
