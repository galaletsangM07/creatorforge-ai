// ─── CreatorForge AI · Authentication ─────────────────────────────────────
// scrypt password hashing (Node built-in crypto, no native deps) + JWT.
// Passwords are never stored in plain text. Tokens expire (default 7d).

import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
import config from "./config.js";
import db from "./db.js";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const derived = await scryptAsync(password, salt, 64);
    const a = Buffer.from(derived.toString("hex"), "hex");
    const b = Buffer.from(hash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function publicUser(user) {
  if (!user) return null;
  const { passHash, resetToken, resetExpiry, ...safe } = user;
  return safe;
}

// ─── Express middleware ────────────────────────────────────────────────

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    const payload = verifyToken(token);
    const user = db.get("users", payload.sub);
    if (!user) return res.status(401).json({ error: "Account no longer exists." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Administrator access required." });
  }
  next();
}

// Ownership guard: project must belong to the requesting user (or admin).
export function requireProjectOwnership(req, res, next) {
  const project = db.get("projects", req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found." });
  if (project.userId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "You do not own this project." });
  }
  req.project = project;
  next();
}

export function requireAssetOwnership(req, res, next) {
  const asset = db.get("assets", req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found." });
  if (asset.userId !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "You do not own this asset." });
  }
  req.asset = asset;
  next();
}
