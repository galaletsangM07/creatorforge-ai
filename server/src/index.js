// ─── CreatorForge AI · API server ───────────────────────────────────────────

import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import config from "./config.js";
import { errorHandler, rateLimit } from "./http.js";
import { ensureSeedProviders } from "./providers.js";
import { seedAll } from "./seed.js";
import authRoutes from "./routes/auth.js";
import coreRoutes from "./routes/core.js";
import aiRoutes from "./routes/ai.js";
import sysRoutes from "./routes/sys.js";

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Ensure data dirs exist before workers start importing anything else.
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

// Side-effect import: starts generation + export worker loops.
await import("./services/jobs.js");
await import("./services/exports.js");

ensureSeedProviders();
await seedAll();

app.get("/api/health", rateLimit("api"), async (req, res) => {
  const { checkFfmpeg } = await import("./services/exports.js");
  res.json({
    ok: true,
    app: "CreatorForge AI",
    version: "1.0.0",
    time: new Date().toISOString(),
    ffmpeg: Boolean(await checkFfmpeg()),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api", coreRoutes);
app.use("/api", aiRoutes);
app.use("/api", sysRoutes);

// Serve the built web client (production) — same origin, no CORS issues.
const clientDist = path.resolve(config.root, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use("/api", (req, res) => res.status(404).json({ error: "API route not found." }));
app.use(errorHandler);

app.listen(config.port, "0.0.0.0", () => {
  console.log(`\n  ▲ CreatorForge AI server running on http://localhost:${config.port}`);
  console.log(`  ▲ API: http://localhost:${config.port}/api/health\n`);
});
