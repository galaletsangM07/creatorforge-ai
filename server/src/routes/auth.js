// ─── CreatorForge AI · Auth routes ─────────────────────────────────────────

import { Router } from "express";
import { randomBytes } from "node:crypto";
import db from "../db.js";
import config from "../config.js";
import { hashPassword, verifyPassword, signToken, publicUser, requireAuth } from "../auth.js";
import { asyncHandler, AppError, isEmail, cleanStr, rateLimit } from "../http.js";
import { createSampleProject } from "../seed.js";

const router = Router();
router.use(rateLimit("auth"));

const AVATAR_COLORS = ["#7c5cff", "#00d4a4", "#ff5c7a", "#ffb020", "#3aa0ff", "#ff7ad9"];

router.post("/signup", asyncHandler(async (req, res) => {
  const name = cleanStr(req.body?.name, 80);
  const email = cleanStr(req.body?.email, 160).toLowerCase();
  const password = String(req.body?.password || "");
  if (!name) throw new AppError("Please enter your name.", 400, "BAD_NAME");
  if (!isEmail(email)) throw new AppError("Please enter a valid email address.", 400, "BAD_EMAIL");
  if (password.length < 8) throw new AppError("Password must be at least 8 characters.", 400, "BAD_PASSWORD");
  if (db.where("users", { email })[0]) throw new AppError("An account with this email already exists. Try logging in.", 409, "EXISTS");

  const isFirstUser = db.count("users") === 0;
  const user = db.insert("users", {
    name, email,
    passHash: await hashPassword(password),
    role: email === config.adminEmail || isFirstUser ? "admin" : "user",
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  });
  db.insert("subscriptions", { userId: user.id, plan: "free", status: "active", renewsAt: null });
  try { createSampleProject(user); } catch (e) { console.error("[seed] sample project failed:", e.message); }
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const email = cleanStr(req.body?.email, 160).toLowerCase();
  const password = String(req.body?.password || "");
  if (!isEmail(email) || !password) throw new AppError("Enter your email and password.", 400, "BAD_CREDENTIALS");
  const user = db.where("users", { email })[0];
  if (!user || !(await verifyPassword(password, user.passHash))) {
    throw new AppError("Incorrect email or password.", 401, "BAD_CREDENTIALS");
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.post("/logout", requireAuth, (req, res) => {
  // JWTs are stateless — the client drops the token. Endpoint exists so the
  // client has a single honest "logged out" handshake.
  res.json({ ok: true });
});

router.post("/reset-request", asyncHandler(async (req, res) => {
  const email = cleanStr(req.body?.email, 160).toLowerCase();
  const user = isEmail(email) ? db.where("users", { email })[0] : null;
  // Always respond identically to avoid account enumeration.
  if (user) {
    const token = randomBytes(24).toString("hex");
    db.update("users", user.id, { resetToken: token, resetExpiry: new Date(Date.now() + 3600_000).toISOString() });
    // No email provider configured in core: in development the token is
    // returned so the flow is testable; in production plug in an email sender.
    return res.json({ ok: true, message: "If that email exists, a reset link was generated.", ...(process.env.NODE_ENV !== "production" ? { devResetToken: token } : {}) });
  }
  res.json({ ok: true, message: "If that email exists, a reset link was generated." });
}));

router.post("/reset-confirm", asyncHandler(async (req, res) => {
  const token = cleanStr(req.body?.token, 100);
  const password = String(req.body?.password || "");
  if (password.length < 8) throw new AppError("Password must be at least 8 characters.", 400, "BAD_PASSWORD");
  const user = db.where("users", (u) => u.resetToken === token && u.resetExpiry && new Date(u.resetExpiry) > new Date())[0];
  if (!user) throw new AppError("Reset link is invalid or expired.", 400, "BAD_TOKEN");
  db.update("users", user.id, { passHash: await hashPassword(password), resetToken: null, resetExpiry: null });
  res.json({ ok: true, message: "Password updated. You can log in now." });
}));

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.patch("/me", requireAuth, asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body?.name !== undefined) {
    const name = cleanStr(req.body.name, 80);
    if (!name) throw new AppError("Name cannot be empty.", 400, "BAD_NAME");
    patch.name = name;
  }
  if (req.body?.password) {
    const pw = String(req.body.password);
    if (pw.length < 8) throw new AppError("Password must be at least 8 characters.", 400, "BAD_PASSWORD");
    patch.passHash = await hashPassword(pw);
  }
  const updated = db.update("users", req.user.id, patch);
  res.json({ user: publicUser(updated) });
}));

export default router;
