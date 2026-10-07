// ─── CreatorForge AI · Caption engine ─────────────────────────────────────
// Real SRT/VTT generation from transcript segments or timeline caption items.
// Pure functions — used by export jobs and the editor.

function ts(seconds, sep = ",") {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(sec)}${sep}${p(ms, 3)}`;
}

export function segmentsToSrt(segments) {
  return segments
    .map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`)
    .join("\n");
}

export function segmentsToVtt(segments) {
  return "WEBVTT\n\n" + segments
    .map((s) => `${ts(s.start, ".")} --> ${ts(s.end, ".")}\n${s.text}\n`)
    .join("\n");
}

/** Group word-level timings into caption lines of maxWords each. */
export function wordsToSegments(words, maxWords = 4) {
  const out = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunk = words.slice(i, i + maxWords);
    if (!chunk.length) continue;
    out.push({
      start: chunk[0].start ?? 0,
      end: chunk[chunk.length - 1].end ?? chunk[0].start ?? 0,
      text: chunk.map((w) => w.text).join(" ").trim(),
      words: chunk,
    });
  }
  return out;
}

/** Evenly distribute plain script text across a duration (fallback when no STT). */
export function distributeScript(scriptText, duration, maxWords = 5) {
  const words = String(scriptText || "").split(/\s+/).filter(Boolean);
  if (!words.length || !duration) return [];
  const perWord = duration / words.length;
  const segments = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunk = words.slice(i, i + maxWords);
    segments.push({
      start: round2(i * perWord),
      end: round2(Math.min(duration, (i + chunk.length) * perWord)),
      text: chunk.join(" "),
    });
  }
  return segments;
}

const round2 = (n) => Math.round(n * 100) / 100;

export const CAPTION_STYLES = [
  { id: "tiktok-pop", label: "TikTok Pop", font: "Arial Black, sans-serif", size: 54, color: "#ffffff", stroke: "#000000", bg: "transparent", animation: "pop", position: "center" },
  { id: "karaoke", label: "Karaoke", font: "Verdana, sans-serif", size: 46, color: "#ffe600", stroke: "#000000", bg: "transparent", animation: "karaoke", position: "bottom" },
  { id: "minimal", label: "Minimal", font: "Helvetica, sans-serif", size: 38, color: "#ffffff", stroke: "transparent", bg: "rgba(0,0,0,0.55)", animation: "fade", position: "bottom" },
  { id: "news", label: "News Lower-Third", font: "Arial, sans-serif", size: 34, color: "#ffffff", stroke: "transparent", bg: "#c1121f", animation: "slide", position: "lower-third" },
  { id: "cinematic", label: "Cinematic", font: "Georgia, serif", size: 40, color: "#f5f0e6", stroke: "#000000", bg: "transparent", animation: "fade", position: "bottom" },
  { id: "gaming", label: "Gaming Neon", font: "'Courier New', monospace", size: 44, color: "#00ffcc", stroke: "#001a12", bg: "transparent", animation: "glow", position: "top" },
  { id: "corporate", label: "Corporate Clean", font: "Helvetica, sans-serif", size: 36, color: "#0b1c2c", stroke: "transparent", bg: "#ffffff", animation: "slide", position: "lower-third" },
  { id: "hormozi", label: "Hormozi Punch", font: "Arial Black, sans-serif", size: 60, color: "#ffffff", stroke: "#000000", bg: "transparent", animation: "word-pop", position: "center", highlight: "#ffe600" },
];
