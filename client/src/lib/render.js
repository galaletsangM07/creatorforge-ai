// ─── CreatorForge AI · Browser preview renderer + browser export ───────────
// Real client-side rendering: draws the timeline (images, video frames,
// gradient placeholders, text, captions) onto a canvas. The same renderer
// powers the live preview AND the "Browser render" export (MediaRecorder),
// so export works even when the server has no ffmpeg worker.

import { mediaUrl, getToken } from "./api";

const imgCache = new Map();
const vidCache = new Map();

function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imgCache.set(url, p);
  return p;
}

// Videos need the auth token — fetch as blob once, then use object URL.
async function loadVideo(assetId) {
  if (vidCache.has(assetId)) return vidCache.get(assetId);
  const p = (async () => {
    try {
      const t = getToken();
      const res = await fetch(mediaUrl(assetId), { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      if (!res.ok) return null;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = url;
      await new Promise((resolve) => {
        v.onloadeddata = resolve;
        v.onerror = resolve;
        setTimeout(resolve, 5000);
      });
      return v;
    } catch {
      return null;
    }
  })();
  vidCache.set(assetId, p);
  return p;
}

function coverDraw(ctx, source, sw, sh, W, H) {
  const scale = Math.max(W / sw, H / sh);
  const w = sw * scale, h = sh * scale;
  ctx.drawImage(source, (W - w) / 2, (H - h) / 2, w, h);
}

function gradientBg(ctx, W, H, color = "#1b2a4a", label = "") {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0a0e14");
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // subtle grid
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += Math.max(24, W / 12)) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  if (label) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `700 ${Math.round(H / 22)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(label, W / 2, H / 2 - H / 40);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = `${Math.round(H / 34)}px system-ui, sans-serif`;
    ctx.fillText("Placeholder visual — generate or upload media", W / 2, H / 2 + H / 30);
  }
}

const FILTERS = {
  cinematic: "saturate(0.85) contrast(1.15)",
  noir: "grayscale(1) contrast(1.2)",
  warm: "sepia(0.35) saturate(1.2)",
  cool: "hue-rotate(15deg) saturate(1.1)",
  vibrant: "saturate(1.5) contrast(1.1)",
};

function drawCaption(ctx, W, H, text, style, fontScale = 1) {
  if (!text) return;
  const st = style || {};
  const base = (st.size || 46) * fontScale;
  const size = Math.round(base * (W < 500 ? 0.55 : W < 900 ? 0.8 : 1));
  ctx.font = `900 ${size}px ${st.font || "Arial, sans-serif"}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxW = W * 0.88;
  // wrap
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  const lh = size * 1.18;
  let y = H * 0.5;
  if (st.position === "bottom" || st.position === "lower-third") y = H * 0.82;
  if (st.position === "top") y = H * 0.18;
  y -= ((shown.length - 1) * lh) / 2;
  shown.forEach((ln, i) => {
    const yy = y + i * lh;
    if (st.bg && st.bg !== "transparent") {
      const w = Math.min(maxW, ctx.measureText(ln).width + size * 0.7);
      ctx.fillStyle = st.bg;
      const bx = W / 2 - w / 2, by = yy - lh / 2;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, w, lh, 8); ctx.fill(); }
      else ctx.fillRect(bx, by, w, lh);
    }
    if (st.stroke && st.stroke !== "transparent") {
      ctx.lineWidth = Math.max(2, size / 10);
      ctx.strokeStyle = st.stroke;
      ctx.lineJoin = "round";
      ctx.strokeText(ln, W / 2, yy);
    }
    ctx.fillStyle = st.color || "#fff";
    ctx.fillText(ln, W / 2, yy);
  });
}

/** Draw one frame of the timeline at time t onto ctx. */
export async function renderFrame(ctx, W, H, { project, items, assetsById, captionStyles, t }) {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const at = (track) => items.filter((c) => c.track === track && t >= c.start && t < c.start + c.duration);
  const video = at("video")[0] || at("overlay")[0];

  if (!video) {
    gradientBg(ctx, W, H, "#101828", project.title);
  } else {
    const p = video.props || {};
    const asset = video.assetId ? assetsById[video.assetId] : null;
    const local = t - video.start;
    const remain = video.start + video.duration - t;
    // Transition envelopes (also used by browser export — genuinely rendered)
    let alpha = p.opacity ?? 1;
    let tScale = p.scale ?? 1;
    let slideX = 0;
    if (p.transition === "fade") {
      alpha *= Math.min(1, local / 0.5, remain / 0.5);
    } else if (p.transition === "zoom") {
      const k = Math.min(1, local / 0.6);
      tScale *= 1.18 - 0.18 * k;
      alpha *= Math.min(1, local / 0.25 + 0.2);
    } else if (p.transition === "slide") {
      const k = Math.min(1, local / 0.5);
      slideX = W * (1 - k) * (p.slideFrom === "left" ? -1 : 1);
      alpha *= 0.25 + 0.75 * k;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (p.filter && FILTERS[p.filter]) ctx.filter = FILTERS[p.filter];
    if ((p.rotation || slideX || tScale !== 1)) {
      ctx.translate(W / 2 + slideX, H / 2);
      if (p.rotation) ctx.rotate(((p.rotation || 0) * Math.PI) / 180);
      if (tScale !== 1) ctx.scale(tScale, tScale);
      ctx.translate(-W / 2, -H / 2);
    }
    if (asset?.mime?.startsWith("image/")) {
      const blobUrl = await authedImageUrl(asset);
      const img = blobUrl ? await loadImage(blobUrl) : null;
      if (img && img.complete && img.naturalWidth) coverDraw(ctx, img, img.naturalWidth, img.naturalHeight, W, H);
      else gradientBg(ctx, W, H, p.color, video.name);
    } else if (asset?.mime?.startsWith("video/")) {
      const v = await loadVideo(asset.id);
      if (v && v.readyState >= 2) {
        try {
          const speed = p.freeze ? 0 : p.speed || 1;
          const target = p.freeze ? 0.05 : Math.min(Math.max(local * speed, 0), (v.duration || 1) - 0.05);
          if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
        } catch {}
        coverDraw(ctx, v, v.videoWidth || W, v.videoHeight || H, W, H);
      } else gradientBg(ctx, W, H, p.color, video.name);
    } else {
      gradientBg(ctx, W, H, p.color || "#1b2a4a", video.name);
    }
    ctx.filter = "none";
    ctx.restore();
    if (p.vignette) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) / 3, W / 2, H / 2, Math.max(W, H) / 1.1);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Text overlays
  for (const tx of at("text")) {
    const p = tx.props || {};
    ctx.save();
    ctx.globalAlpha = p.opacity ?? 1;
    ctx.font = `${p.weight || 800} ${(p.size || 48) * (W < 500 ? 0.55 : 1)}px ${p.font || "Arial, sans-serif"}`;
    ctx.textAlign = "center";
    const x = W * (p.x ?? 0.5), y = H * (p.y ?? 0.3);
    if (p.bg && p.bg !== "transparent") {
      const w = Math.min(W * 0.9, ctx.measureText(p.text || tx.name).width + 30);
      ctx.fillStyle = p.bg;
      ctx.fillRect(x - w / 2, y - (p.size || 48) * 0.75, w, (p.size || 48) * 1.3);
    }
    ctx.fillStyle = p.color || "#fff";
    ctx.fillText(p.text || tx.name, x, y);
    ctx.restore();
  }

  // Captions
  const cap = at("captions")[0];
  if (cap) {
    const st = (captionStyles || []).find((s) => s.id === cap.props?.styleId) || (captionStyles || [])[0];
    drawCaption(ctx, W, H, cap.props?.text || "", st, cap.props?.fontScale || 1);
  }
  ctx.restore();
}

// Images need auth headers — route them through an authed blob cache.
const authImgCache = new Map();
export async function authedImageUrl(asset) {
  if (!asset) return null;
  if (authImgCache.has(asset.id)) return authImgCache.get(asset.id);
  const p = (async () => {
    try {
      const t = getToken();
      const res = await fetch(mediaUrl(asset.id), { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  })();
  authImgCache.set(asset.id, p);
  return p;
}

// ─── Browser export (real MediaRecorder render) ───────────────────────────
export async function browserRender({ project, items, assetsById, captionStyles, width = 720, height = 1280, fps = 30, onProgress }) {
  const ar = project.aspectRatio || "9:16";
  if (ar === "16:9") { width = 1280; height = 720; }
  else if (ar === "1:1") { width = 960; height = 960; }
  else if (ar === "4:5") { width = 960; height = 1200; }
  else { width = 720; height = 1280; }

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(fps);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("This browser cannot record video (MediaRecorder unsupported). Try Chrome or Edge.");
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve) => { rec.onstop = resolve; });
  rec.start(250);

  const duration = Math.max(1, project.duration || 5);
  const frameMs = 1000 / fps;
  const started = performance.now();
  let t = 0;
  // Preload assets
  for (const c of items) {
    const a = c.assetId ? assetsById[c.assetId] : null;
    if (a?.mime?.startsWith("video/")) await loadVideo(a.id);
  }
  while (t < duration) {
    await renderFrame(ctx, width, height, { project, items, assetsById, captionStyles, t });
    onProgress?.(Math.min(99, Math.round((t / duration) * 100)));
    t += 1 / fps;
    const expected = started + t * 1000;
    const wait = expected - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, frameMs * 2)));
  }
  rec.stop();
  await done;
  onProgress?.(100);
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), mime: mime.split(";")[0], width, height };
}

// ─── Free in-browser speech preview (SpeechSynthesis) ────────────────────
export function listBrowserVoices() {
  return new Promise((resolve) => {
    const vs = speechSynthesis.getVoices();
    if (vs.length) return resolve(vs);
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
  });
}

export function speakPreview({ text, voiceURI, rate = 1, pitch = 1 }) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const vs = speechSynthesis.getVoices();
  const match = vs.find((v) => v.voiceURI === voiceURI) || vs.find((v) => v.lang?.startsWith("en"));
  if (match) u.voice = match;
  u.rate = rate; u.pitch = pitch;
  speechSynthesis.speak(u);
  return () => speechSynthesis.cancel();
}
