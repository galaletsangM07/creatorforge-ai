// ─── CreatorForge AI · HTTP helpers: rate limiting + validation ───────────

import config from "./config.js";

// Simple in-memory sliding-window rate limiter (per IP + route group).
const buckets = new Map();

export function rateLimit(group = "api") {
  const max = group === "auth" ? config.rateLimit.authMax : config.rateLimit.max;
  const windowMs = config.rateLimit.windowMs;
  return (req, res, next) => {
    const key = `${group}:${req.ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset < now) {
      bucket = { count: 0, reset: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - bucket.count));
    if (bucket.count > max) {
      return res.status(429).json({
        error: "Too many requests. Please slow down and try again shortly.",
        retryAfterMs: bucket.reset - now,
      });
    }
    next();
  };
}

export function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function cleanStr(v, max = 500) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

export function cleanText(v, max = 20000) {
  if (typeof v !== "string") return "";
  return v.replace(/\r/g, "").slice(0, max);
}

export function num(v, fallback = 0, min = -Infinity, max = Infinity) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function oneOf(v, list, fallback) {
  return list.includes(v) ? v : fallback;
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Honest error formatter: provider/validation errors keep their real message,
// unexpected errors are logged server-side with a generic client message.
export function errorHandler(err, _req, res, _next) {
  if (err?.isProviderError || err?.isAppError) {
    return res.status(err.status || 502).json({
      error: err.message,
      code: err.code || "PROVIDER_ERROR",
      provider: err.provider || undefined,
      hint: err.hint || undefined,
    });
  }
  if (err?.message?.includes("File type not allowed")) {
    return res.status(400).json({ error: err.message });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File is too large for upload." });
  }
  console.error("[api] unexpected error:", err);
  res.status(500).json({ error: "Internal server error. Please try again." });
}

export class AppError extends Error {
  constructor(message, status = 400, code = "APP_ERROR", extra = {}) {
    super(message);
    this.isAppError = true;
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

export class ProviderError extends Error {
  constructor(message, { code = "PROVIDER_FAILED", status = 502, provider, hint } = {}) {
    super(message);
    this.isProviderError = true;
    this.status = status;
    this.code = code;
    this.provider = provider;
    this.hint = hint;
  }
}
