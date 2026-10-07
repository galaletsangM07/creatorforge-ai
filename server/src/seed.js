// ─── CreatorForge AI · Seed data ───────────────────────────────────────────
// Templates, voices, original royalty-free audio (synthesized in code — no
// copyrighted stock), per-user sample project, admin bootstrap.

import fs from "node:fs";
import path from "node:path";
import db from "./db.js";
import config from "./config.js";
import { hashPassword } from "./auth.js";
import { userDir } from "./storage.js";

// ─── Tiny WAV synthesizer (original, royalty-free loops + SFX) ────────────
// All "stock" audio ships as code-generated WAVs so the app bundles ZERO
// copyrighted music. Users can upload their own tracks anytime.

const SR = 22050;

function encodeWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const sine = (f, t) => Math.sin(2 * Math.PI * f * t);
const noise = () => Math.random() * 2 - 1;

function synthPad(seconds, freqs, brightness = 0.35) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 2) * Math.min(1, (seconds - t) / 2); // slow fade
    const lfo = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.15 * t);
    let v = 0;
    freqs.forEach((f, k) => { v += sine(f, t) * (1 / (k + 2)) + sine(f * 2, t) * brightness * (1 / (k + 3)); });
    out[i] = v * env * lfo * 0.5;
  }
  return out;
}

function synthPulse(seconds, bpm = 100) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const beat = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const phase = (t % beat) / beat;
    const kick = Math.exp(-phase * 9) * sine(55 + phase * 30, t);
    const hat = (i % Math.floor(SR * beat / 4) < SR * 0.005) ? noise() * 0.25 * Math.exp(-phase * 20) : 0;
    const bass = sine(110, t) * 0.3 * (0.6 + 0.4 * Math.sin(2 * Math.PI * t / beat));
    const env = Math.min(1, t / 0.3) * Math.min(1, (seconds - t) / 0.5);
    out[i] = (kick * 0.9 + hat + bass) * env * 0.6;
  }
  return out;
}

function synthWhoosh(seconds = 1.2) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const pos = t / seconds;
    const cutoff = 0.02 + 0.3 * Math.sin(pos * Math.PI); // sweep up then down
    lp += cutoff * (noise() - lp);
    out[i] = lp * Math.sin(pos * Math.PI) * 1.6;
  }
  return out;
}

function synthImpact(seconds = 1.6) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = (sine(58, t) * Math.exp(-t * 4) + noise() * Math.exp(-t * 30) * 0.6) * 0.9;
  }
  return out;
}

function synthTone(freqs, seconds = 0.7) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const per = seconds / freqs.length;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = Math.min(freqs.length - 1, Math.floor(t / per));
    const local = (t - k * per) / per;
    out[i] = sine(freqs[k], t) * Math.exp(-local * 3) * 0.6;
  }
  return out;
}

function synthTyping(seconds = 2.0) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  let t = 0.1;
  while (t < seconds - 0.1) {
    const start = Math.floor(t * SR);
    const len = Math.floor(SR * 0.03);
    for (let i = 0; i < len && start + i < n; i++) {
      out[start + i] += (sine(2200 + Math.random() * 800, i / SR) * Math.exp(-i / (SR * 0.008))) * 0.5;
    }
    t += 0.12 + Math.random() * 0.14;
  }
  return out;
}

const STOCK_AUDIO = [
  { name: "Rise — Motivational Pad", category: "Motivational", kind: "music", make: () => synthPad(14, [110, 164.8, 220, 261.6, 329.6]) },
  { name: "Deep Focus — Ambient Pad", category: "Ambient", kind: "music", make: () => synthPad(16, [87.3, 130.8, 174.6, 261.6], 0.2) },
  { name: "Night Drive — Electronic Pulse", category: "Electronic", kind: "music", make: () => synthPulse(12, 104) },
  { name: "Boardroom — Corporate Pulse", category: "Corporate", kind: "music", make: () => synthPulse(12, 92) },
  { name: "Whoosh", category: "SFX", kind: "sfx", make: () => synthWhoosh(1.2) },
  { name: "Cinematic Impact", category: "SFX", kind: "sfx", make: () => synthImpact(1.6) },
  { name: "Soft Click", category: "SFX", kind: "sfx", make: () => synthTone([2400], 0.12) },
  { name: "Notification Chime", category: "SFX", kind: "sfx", make: () => synthTone([880, 1318], 0.8) },
  { name: "Keyboard Typing", category: "SFX", kind: "sfx", make: () => synthTyping(2.2) },
  { name: "Riser", category: "SFX", kind: "sfx", make: () => { const n = Math.floor(SR * 2); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; o[i] = sine(200 + 900 * (t / 2), t) * (t / 2) * 0.5; } return o; } },
];

export function seedStockAudio() {
  if (db.count("music") > 0) return;
  const sysDir = path.join(config.uploadDir, "_stock");
  fs.mkdirSync(sysDir, { recursive: true });
  for (const s of STOCK_AUDIO) {
    try {
      const wav = encodeWav(s.make());
      const filename = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".wav";
      const full = path.join(sysDir, filename);
      if (!fs.existsSync(full)) fs.writeFileSync(full, wav);
      const asset = db.insert("assets", {
        userId: "_stock", kind: "audio", name: filename, mime: "audio/wav",
        size: wav.length, path: full, jobId: null, meta: { stock: true },
      });
      db.insert("music", {
        title: s.name, category: s.kind === "sfx" ? "SFX" : s.category,
        artist: "CreatorForge Originals", duration: Math.round((wav.length - 44) / 2 / SR),
        assetId: asset.id, stock: true, license: "creatorforge-original royalty-free",
        uploadedBy: null,
      });
    } catch (e) {
      console.error("[seed] stock audio failed:", s.name, e.message);
    }
  }
  console.log("[seed] stock audio ready");
}

// ─── Templates ───────────────────────────────────────────────────────────

const T = (title, category, description, aspectRatio, duration, captionStyle, gradient, scenes) => ({
  title, category, description, aspectRatio, duration, captionStyle, gradient,
  featured: false, downloads: 0,
  data: {
    scenes: scenes.map((s, i) => ({ title: s[0], role: s[1], script: s[2], visualPrompt: s[3] })),
    captionStyle,
  },
});

const TEMPLATE_DEFS = [
  T("Viral Motivation Hit", "Motivational", "Punchy 30s motivational short with pop captions.", "9:16", 30, "hormozi", "linear-gradient(135deg,#ff5c7a,#ffb020)",
    [["Scene 1 — Hook", "Hook", "Stop scrolling. Nobody is coming to save you — and that's the best news you'll hear today.", "silhouette of a person at sunrise on a mountain peak, epic wide shot"],
     ["Scene 2 — Problem", "Problem", "Most people fail because they wait for motivation. Motivation is a mood. Moods change.", "person sitting alone in a dark room lit by a phone screen"],
     ["Scene 3 — Truth", "Explanation", "Winners build systems. Small steps, every day, especially on the days you feel like nothing.", "athlete training hard in a dark gym, dramatic rim light"],
     ["Scene 4 — CTA", "Call to Action", "Save this. Share it with someone who needs it. And start today.", "sunrise over a city skyline with warm golden light"]]),
  T("Trading Breakdown", "Trading", "News-style finance explainer with lower-thirds.", "9:16", 30, "news", "linear-gradient(135deg,#0b1c2c,#14532d)",
    [["Scene 1 — Hook", "Hook", "Gold is moving aggressively today — and most retail traders are reading it wrong.", "trader screens with glowing candlestick charts in a dark modern office"],
     ["Scene 2 — Context", "Problem", "Price swept liquidity below support, then reclaimed it within the hour. Classic stop hunt.", "macro shot of shining gold bars and coins, dark luxury background"],
     ["Scene 3 — Lesson", "Explanation", "The lesson? Never chase the first move. Wait for confirmation, then execute your plan.", "close-up of hands on a trading desk with charts"],
     ["Scene 4 — CTA", "Call to Action", "Follow for a daily market breakdown in 30 seconds.", "news studio desk with glowing world map background"]]),
  T("Headline News Flash", "News", "60-second news brief with broadcast styling.", "16:9", 60, "news", "linear-gradient(135deg,#c1121f,#0b1c2c)",
    [["Cold Open", "Hook", "Breaking: markets rally as tech stocks surge for a third straight session.", "news studio desk with glowing world map background"],
     ["Detail", "Explanation", "Analysts point to strong earnings and cooling inflation data as the main drivers.", "city skyline at dusk with traffic lights"],
     ["Reaction", "Solution", "Trading desks are watching tomorrow's jobs report for confirmation.", "trader screens with glowing candlestick charts"],
     ["Sign-off", "Call to Action", "That's your 60-second brief. Subscribe for updates every hour.", "broadcast control room with monitors"]]),
  T("Product Launch Ad", "Product Advertisement", "High-energy 15s product promo.", "9:16", 15, "tiktok-pop", "linear-gradient(135deg,#7c5cff,#ff7ad9)",
    [["Hook", "Hook", "This changes everything.", "luxury product on a pedestal with dramatic studio light"],
     ["Benefit", "Explanation", "Faster. Smarter. Built for creators like you.", "close-up of hands holding a glowing smartphone"],
     ["CTA", "Call to Action", "Tap the link. Launch offer ends Friday.", "confetti and stage lights, celebration"]]),
  T("Study With Me", "Education", "Calm explainer layout for lessons.", "16:9", 60, "minimal", "linear-gradient(135deg,#3aa0ff,#00d4a4)",
    [["Intro", "Hook", "In the next minute you'll finally understand compound interest.", "student studying with books and laptop, warm desk light"],
     ["Concept", "Explanation", "Money grows on itself. Small amounts, left alone, become big amounts.", "coins stacking up in timelapse, bright background"],
     ["Example", "Solution", "One hundred rand a month at ten percent becomes thousands over time.", "calculator and notebook on a clean desk"],
     ["Recap", "Call to Action", "Save this for exam season — and follow for daily lessons.", "graduation caps thrown in the air"]]),
  T("Epic Game Montage", "Gaming", "Neon gaming intro with top captions.", "16:9", 30, "gaming", "linear-gradient(135deg,#12002e,#00ffcc)",
    [["Intro", "Hook", "Ranked grind. Episode twelve. No mercy.", "neon gaming setup with RGB lights in a dark room"],
     ["Play", "Explanation", "Triple kill, one HP, zero fear. Watch this flank.", "esports arena with crowd and big screens"],
     ["Outro", "Call to Action", "Drop a sub if that play was clean.", "trophy on a desk with dramatic light"]]),
  T("Podcast Clip", "Podcast", "Quote-style clip with karaoke captions.", "9:16", 30, "karaoke", "linear-gradient(135deg,#3a2b12,#c1121f)",
    [["Quote", "Hook", "The best time to start was ten years ago. The second best time is today.", "podcast microphones in a warm studio"],
     ["Context", "Explanation", "We talked about fear, failure, and starting before you're ready.", "two people talking in a recording studio"],
     ["CTA", "Call to Action", "Full episode linked in bio.", "headphones on a mixer desk, moody light"]]),
  T("Dream Home Tour", "Real Estate", "Luxury property walkthrough.", "16:9", 45, "cinematic", "linear-gradient(135deg,#1b2a4a,#b08d4f)",
    [["Exterior", "Hook", "Welcome to 12 Palm Avenue — four bedrooms, endless sunsets.", "modern luxury house exterior at golden hour"],
     ["Interior", "Explanation", "Open-plan living, stone finishes, and a kitchen built for hosting.", "bright modern living room interior"],
     ["CTA", "Call to Action", "Book your private viewing this weekend.", "aerial drone shot of suburban homes at dusk"]]),
  T("Wanderlust Reel", "Travel", "Aerial-style travel teaser.", "9:16", 20, "cinematic", "linear-gradient(135deg,#00d4a4,#3aa0ff)",
    [["Hook", "Hook", "POV: you finally booked the flight.", "aerial drone shot of tropical coastline with turquoise water"],
     ["Moment", "Explanation", "Salt air. No emails. Just this.", "person walking on a beach at sunset"],
     ["CTA", "Call to Action", "Save this for your next escape.", "airplane wing above the clouds at sunset"]]),
  T("Founder Story", "Business", "Corporate mini-doc opener.", "16:9", 60, "corporate", "linear-gradient(135deg,#0b1c2c,#3aa0ff)",
    [["Hook", "Hook", "We started in a garage with one laptop and a ridiculous idea.", "modern startup office, team collaborating"],
     ["Journey", "Explanation", "Three years later we serve ten thousand customers across Africa.", "glass office building looking up, blue sky"],
     ["CTA", "Call to Action", "This is our story. Let's build yours.", "handshake in a bright office"]]),
  T("Daily Affirmation", "Motivational", "Soft morning affirmation short.", "9:16", 15, "minimal", "linear-gradient(135deg,#ffb6c1,#7c5cff)",
    [["Affirmation", "Hook", "I am capable. I am consistent. I finish what I start.", "sunrise over calm water with soft mist"],
     ["Close", "Call to Action", "Say it with me tomorrow.", "hands holding a warm cup of coffee by a window"]]),
  T("Gym Hustle Short", "Motivational", "Hard-cut workout hype reel.", "9:16", 20, "hormozi", "linear-gradient(135deg,#111111,#ff5c7a)",
    [["Hook", "Hook", "Nobody cares. Work harder.", "athlete training hard in a dark gym"],
     ["Push", "Explanation", "One more rep. One more round. That's the difference.", "close-up of hands gripping a barbell"],
     ["CTA", "Call to Action", "Follow the grind.", "gym lights with dramatic haze"]]),
];

export function seedTemplates() {
  if (db.count("templates") > 0) return;
  for (const t of TEMPLATE_DEFS) db.insert("templates", t);
  console.log("[seed] templates ready:", TEMPLATE_DEFS.length);
}

export function listTemplates(category) {
  let rows = db.all("templates");
  if (category && category !== "all") rows = rows.filter((t) => t.category === category);
  return rows.sort((a, b) => (b.featured - a.featured) || (b.downloads - a.downloads));
}

export function buildProjectFromTemplate(user, tpl, title) {
  const project = db.insert("projects", {
    userId: user.id,
    title: title || `${tpl.title} (from template)`,
    aspectRatio: tpl.aspectRatio || "9:16",
    duration: tpl.duration || 30,
    description: tpl.description || "",
    status: "draft", favorite: false, trashed: false, sample: false,
    meta: { videoType: tpl.category, style: "Cinematic", templateId: tpl.id },
  });
  const tplScenes = tpl.data?.scenes || [];
  const per = project.duration / Math.max(tplScenes.length, 1);
  const palette = ["#1b2a4a", "#2a1b4a", "#4a1b2a", "#123b36", "#3a2b12"];
  tplScenes.forEach((s, i) => {
    const scene = db.insert("scenes", {
      projectId: project.id, index: i,
      title: s.title || `Scene ${i + 1}`, role: s.role || "Scene",
      start: round2(i * per), end: round2(i === tplScenes.length - 1 ? project.duration : (i + 1) * per),
      script: s.script || "", visualPrompt: s.visualPrompt || "",
      brollKeywords: [], visualAssetId: null, voiceAssetId: null, status: "draft",
    });
    db.insert("timeline_items", {
      projectId: project.id, track: "video", name: scene.title,
      start: scene.start, duration: round2(scene.end - scene.start),
      sceneId: scene.id, assetId: null,
      props: { placeholder: true, color: palette[i % palette.length], opacity: 1, volume: 1, speed: 1 },
    });
    db.insert("timeline_items", {
      projectId: project.id, track: "captions", name: `Caption ${i + 1}`,
      start: scene.start, duration: round2(scene.end - scene.start),
      sceneId: scene.id, assetId: null,
      props: { text: s.script || "", styleId: tpl.captionStyle || "tiktok-pop", auto: true },
    });
  });
  return project;
}

const round2 = (n) => Math.round(n * 100) / 100;

// ─── Voices ──────────────────────────────────────────────────────────────

const VOICE_DEFS = [
  { name: "Thabo (Preview)", gender: "male", age: "adult", accent: "South African", styles: ["Friendly", "Storytelling"], provider: "browser", providerVoiceId: "", previewText: "Hey, I'm Thabo. I will narrate your story with warmth and energy." },
  { name: "Lerato (Preview)", gender: "female", age: "young adult", accent: "South African", styles: ["Energetic", "Friendly"], provider: "browser", providerVoiceId: "", previewText: "Hi, I'm Lerato! Let's make your video impossible to scroll past." },
  { name: "News Anchor (Preview)", gender: "neutral", age: "adult", accent: "Neutral", styles: ["News presenter", "Professional"], provider: "browser", providerVoiceId: "", previewText: "Breaking news: your video is about to sound incredible." },
  { name: "Deep Narrator (Preview)", gender: "male", age: "middle-aged", accent: "Neutral", styles: ["Deep", "Calm", "Documentary"], provider: "browser", providerVoiceId: "", previewText: "In a world of endless content, one voice rises above the noise." },
  { name: "ElevenLabs — Rachel", gender: "female", age: "young adult", accent: "American", styles: ["Professional", "Calm"], provider: "elevenlabs", providerVoiceId: "21m00Tcm4TlvDq8ikWAM", previewText: "Hello, I'm Rachel, a neural voice from ElevenLabs." },
  { name: "ElevenLabs — Domi", gender: "female", age: "young adult", accent: "American", styles: ["Energetic", "Storytelling"], provider: "elevenlabs", providerVoiceId: "AZnzlk1XvdvUeBnXmlld", previewText: "Hi! I'm Domi, bold and expressive." },
  { name: "ElevenLabs — Antoni", gender: "male", age: "young adult", accent: "American", styles: ["Friendly", "Professional"], provider: "elevenlabs", providerVoiceId: "ErXwobaYiN019PkySvjV", previewText: "Hey there, I'm Antoni, warm and well-rounded." },
  { name: "OpenAI — Alloy", gender: "neutral", age: "adult", accent: "Neutral", styles: ["Professional", "Calm"], provider: "openai", providerVoiceId: "alloy", previewText: "Hello, I'm Alloy from OpenAI." },
  { name: "OpenAI — Nova", gender: "female", age: "adult", accent: "Neutral", styles: ["Friendly", "Energetic"], provider: "openai", providerVoiceId: "nova", previewText: "Hi, I'm Nova, bright and engaging." },
  { name: "OpenAI — Onyx", gender: "male", age: "adult", accent: "Neutral", styles: ["Deep", "Storytelling"], provider: "openai", providerVoiceId: "onyx", previewText: "I am Onyx. Deep, steady, and serious." },
];

export function seedVoices() {
  if (db.count("voices") > 0) return;
  for (const v of VOICE_DEFS) db.insert("voices", { ...v, enabled: true });
  console.log("[seed] voices ready:", VOICE_DEFS.length);
}

// ─── Sample project (clearly marked) ─────────────────────────────────────

export function createSampleProject(user) {
  if (db.where("projects", { userId: user.id, sample: true })[0]) return;
  const project = db.insert("projects", {
    userId: user.id, title: "★ SAMPLE — My First Motivation Short",
    description: "Sample project for exploring the editor. Placeholder visuals — generate or upload real media to replace them.",
    aspectRatio: "9:16", duration: 15, status: "draft",
    favorite: false, trashed: false, sample: true,
    meta: { videoType: "Motivational", style: "Cinematic" },
  });
  const scenes = [
    { title: "Scene 1 — Hook", role: "Hook", script: "Stop scrolling. Your future self is watching you right now.", visual: "person looking at a glowing horizon of city lights, hopeful" },
    { title: "Scene 2 — Truth", role: "Explanation", script: "Small steps every day beat giant leaps once a year.", visual: "athlete training hard in a dark gym, dramatic rim light" },
    { title: "Scene 3 — CTA", role: "Call to Action", script: "Start today. Follow for daily motivation.", visual: "sunrise over a city skyline with warm golden light" },
  ];
  const palette = ["#1b2a4a", "#2a1b4a", "#4a1b2a"];
  scenes.forEach((s, i) => {
    const start = i * 5, end = (i + 1) * 5;
    const scene = db.insert("scenes", {
      projectId: project.id, index: i, title: s.title, role: s.role,
      start, end, script: s.script, visualPrompt: s.visual,
      brollKeywords: [], visualAssetId: null, voiceAssetId: null, status: "draft",
    });
    db.insert("timeline_items", {
      projectId: project.id, track: "video", name: s.title, start, duration: 5,
      sceneId: scene.id, assetId: null,
      props: { placeholder: true, color: palette[i], opacity: 1, speed: 1 },
    });
    db.insert("timeline_items", {
      projectId: project.id, track: "captions", name: `Caption ${i + 1}`, start, duration: 5,
      sceneId: scene.id, assetId: null,
      props: { text: s.script, styleId: "hormozi", auto: true },
    });
  });
  userDir(user.id);
  return project;
}

// ─── Admin bootstrap ─────────────────────────────────────────────────────

export async function ensureAdmin() {
  const email = (config.adminEmail || "").toLowerCase();
  if (!email || db.where("users", { email })[0]) return;
  const user = db.insert("users", {
    name: "Administrator", email,
    passHash: await hashPassword(config.adminPassword),
    role: "admin", avatarColor: "#7c5cff",
  });
  db.insert("subscriptions", { userId: user.id, plan: "admin", status: "active", renewsAt: null });
  console.log(`[seed] admin account created: ${email}`);
}

export async function seedAll() {
  seedTemplates();
  seedVoices();
  seedStockAudio();
  await ensureAdmin();
}
