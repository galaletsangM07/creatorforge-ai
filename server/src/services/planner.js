// ─── CreatorForge AI · Local Script Planner ────────────────────────────────
// HONESTY: this is a deterministic, rule-based planner — NOT an LLM. It never
// pretends to be AI. It produces an editable first-draft structure (scenes,
// timings, B-roll prompts) so users without an AI key can still build videos.
// When an LLM provider is configured, routes prefer it and fall back here.

const ROLE_LABELS = ["Hook", "Problem", "Explanation", "Solution", "Call to Action"];
const ROLE_FALLBACK = ["Scene", "Build", "Insight", "Turn", "Payoff", "Close"];

function splitSentences(text) {
  return String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

// Rough narration model: ~2.4 words/sec for English voiceover.
export function estimateDuration(text, wps = 2.4) {
  const words = String(text || "").split(/\s+/).filter(Boolean).length;
  return Math.max(2, words / wps);
}

function keywords(sentence) {
  const stop = new Set(("the,a,an,and,or,but,if,then,of,to,in,on,for,with,from,as,at,by,is,are,was,were,be,been,you,your,we,our,they,their,this,that,these,those,it,its,so,very,just,will,can,should,could,would,there,here,when,what,why,how,not,no,yes,do,does,did,have,has,had,i,me,my,he,she,them,his,her,us,all,any,each,more,most,than,too,out,up,down,over,under,into,about,after,before,because,while,during,between,through,also,only,own,same,such,once").split(","));
  return sentence.toLowerCase().replace(/[^a-z0-9\s'-]/g, "").split(/\s+/).filter((w) => w.length > 3 && !stop.has(w)).slice(0, 6);
}

// Keyword → B-roll visual mapping (curated, finance/motivation/lifestyle aware).
const VISUAL_MAP = [
  { match: ["gold", "silver", "bullion"], visual: "macro shot of shining gold bars and coins, dark luxury background" },
  { match: ["trading", "trade", "forex", "chart", "market", "stock", "crypto", "bitcoin", "profit", "loss", "broker"], visual: "trader screens with glowing candlestick charts in a dark modern office" },
  { match: ["money", "cash", "wealth", "rich", "millionaire", "income", "salary"], visual: "hands counting cash and luxury lifestyle details, cinematic light" },
  { match: ["fail", "failure", "lose", "loss", "mistake", "give up"], visual: "silhouette of a person at a crossroads in fog, dramatic moody light" },
  { match: ["success", "win", "winner", "champion", "victory", "goal"], visual: "person raising arms on a mountain peak at sunrise, epic wide shot" },
  { match: ["morning", "wake", "dawn", "sunrise"], visual: "sunrise over a city skyline with warm golden light" },
  { match: ["night", "midnight", "dark"], visual: "city lights at night with long exposure trails, cinematic" },
  { match: ["johannesburg", "joburg", "sandton", "soweto"], visual: "Johannesburg skyline at dusk, Hillbrow tower and city lights" },
  { match: ["car", "cars", "drive", "driving", "ferrari", "lamborghini", "porsche"], visual: "luxury sports car driving through a neon city at night, cinematic tracking shot" },
  { match: ["gym", "workout", "fitness", "muscle", "training", "run", "running"], visual: "athlete training hard in a dark gym, sweat and dramatic rim light" },
  { match: ["business", "office", "meeting", "startup", "entrepreneur"], visual: "modern startup office, team collaborating around glass table" },
  { match: ["phone", "smartphone", "app", "social"], visual: "close-up of hands holding a glowing smartphone, bokeh background" },
  { match: ["food", "cook", "restaurant", "recipe"], visual: "chef plating gourmet food, steam rising, warm kitchen light" },
  { match: ["travel", "beach", "ocean", "flight", "plane", "holiday", "safari"], visual: "aerial drone shot of tropical coastline with turquoise water" },
  { match: ["house", "home", "property", "real estate"], visual: "modern luxury house exterior at golden hour" },
  { match: ["school", "study", "student", "learn", "education", "book"], visual: "student studying with books and laptop, warm desk light" },
  { match: ["love", "family", "friend", "wedding"], visual: "happy family laughing together at sunset, warm tones" },
  { match: ["fear", "anxiety", "stress", "pressure"], visual: "person under dramatic storm clouds, cinematic tension" },
  { match: ["dream", "vision", "future", "believe"], visual: "person looking at a glowing horizon of city lights, hopeful" },
  { match: ["news", "breaking", "report", "announce"], visual: "news studio desk with glowing world map background" },
];

export function suggestBroll(sentence, style = "") {
  const lower = sentence.toLowerCase();
  for (const entry of VISUAL_MAP) {
    if (entry.match.some((m) => lower.includes(m))) {
      return {
        visualPrompt: style ? `${entry.visual}, ${style} style` : entry.visual,
        keywords: keywords(sentence),
        searchTerms: entry.match.filter((m) => lower.includes(m)),
      };
    }
  }
  const kw = keywords(sentence);
  const subject = kw.slice(0, 3).join(", ") || "abstract cinematic background";
  return {
    visualPrompt: style ? `cinematic b-roll of ${subject}, ${style} style, high detail` : `cinematic b-roll of ${subject}, high detail`,
    keywords: kw,
    searchTerms: kw.slice(0, 2),
  };
}

/** Split a script into timed scenes fitted to targetDuration seconds. */
export function splitIntoScenes(scriptText, { targetDuration = 30, style = "", maxScenes = 8 } = {}) {
  const sentences = splitSentences(scriptText);
  if (!sentences.length) return [];
  const natural = estimateDuration(scriptText);
  const scale = targetDuration / Math.max(natural, 1);

  // Group sentences into scenes (1-3 sentences each).
  const groups = [];
  let current = [];
  const targetGroups = Math.min(maxScenes, Math.max(2, Math.round(targetDuration / 6)));
  const perGroup = Math.max(1, Math.ceil(sentences.length / targetGroups));
  sentences.forEach((s, i) => {
    current.push(s);
    if (current.length >= perGroup || i === sentences.length - 1) {
      groups.push(current);
      current = [];
    }
  });

  let t = 0;
  return groups.map((group, i) => {
    const text = group.join(" ");
    const dur = Math.max(2, estimateDuration(text) * scale);
    const start = t;
    const end = i === groups.length - 1 ? targetDuration : Math.min(targetDuration, t + dur);
    t = end;
    const role = (ROLE_LABELS[i] || ROLE_FALLBACK[i % ROLE_FALLBACK.length]);
    const broll = suggestBroll(text, style);
    return {
      index: i,
      title: `Scene ${i + 1} — ${role}`,
      role,
      start: round2(start),
      end: round2(end),
      script: text,
      visualPrompt: broll.visualPrompt,
      brollKeywords: broll.keywords,
      status: "draft",
    };
  });
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Build an editable template-based script draft from a raw idea. */
export function expandIdeaToScript(idea, { duration = 30, videoType = "Motivational", tone = "energetic", language = "en" } = {}) {
  const topic = String(idea || "your idea").trim().slice(0, 300) || "your idea";
  const words = Math.round(duration * 2.4);
  const scale = words < 60 ? "short" : words < 150 ? "medium" : "long";

  const hook = `Stop scrolling. ${capitalize(topic)} — and most people get it completely wrong.`;
  const intro = `In the next ${duration} seconds, I'm going to break it down so simply you'll never forget it.`;
  const p1 = `Here's the truth nobody tells you: the problem was never your talent. It was your approach.`;
  const p2 = `Think about it. Every expert you admire once stood exactly where you are right now — confused, doubting, ready to quit.`;
  const p3 = `The difference? They kept going when it got uncomfortable. That's the whole secret. Consistency beats motivation, every single time.`;
  const ending = `So here's what I want you to do today: take one small step toward ${topic}. Just one.`;
  const cta = `Follow for more, share this with someone who needs it, and I'll see you in the next one.`;

  const parts = scale === "short"
    ? [hook, `Here's the truth: consistency beats motivation, every single time. Take one small step toward ${topic} today.`, cta]
    : scale === "medium"
      ? [hook, intro, p1, p3, ending, cta]
      : [hook, intro, p1, p2, p3, ending, cta];

  const sections = (scale === "short"
    ? [["Hook", parts[0]], ["Main point", parts[1]], ["Call to action", parts[2]]]
    : [["Hook", parts[0]], ["Introduction", parts[1]], ["Main point 1", parts[2]], ["Main point 2", parts[3]], ["Ending", parts[4]], ["Call to action", parts[5]]]
  ).map(([label, text]) => ({ label, text }));

  return {
    title: `${videoType}: ${topic.slice(0, 60)}`,
    sections,
    fullText: parts.join(" "),
    wordCount: parts.join(" ").split(/\s+/).length,
    estimatedSeconds: Math.round(estimateDuration(parts.join(" "))),
    tone, language,
    draftedBy: "local-planner",
    note: "Template-based first draft. Edit freely, or connect an AI text provider in Settings → Providers for full LLM script writing.",
  };
}

function capitalize(s) {
  s = s.trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Rewrite helpers (deterministic transforms, honestly labeled). */
export function transformScript(text, action) {
  const sentences = splitSentences(text);
  switch (action) {
    case "shorten": {
      const keep = Math.max(1, Math.ceil(sentences.length / 2));
      return sentences.filter((_, i) => i % 2 === 0 || i === sentences.length - 1).slice(0, keep + 1).join(" ");
    }
    case "expand":
      return sentences.map((s) => `${s} Let me say that again, because it matters: ${s}`).join(" ");
    case "viral":
      return `Nobody talks about this. ${sentences.join(" ")} Share this before it gets taken down.`;
    case "emotional":
      return sentences.map((s) => s.replace(/\.$/, " — and I mean that with all my heart.")).join(" ");
    case "professional":
      return sentences.map((s) => s.replace(/!/g, ".")).join(" ").replace(/gonna/gi, "going to").replace(/wanna/gi, "want to");
    default:
      return text;
  }
}

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zu", label: "isiZulu" },
  { code: "st", label: "Sesotho" },
  { code: "tn", label: "Setswana" },
  { code: "af", label: "Afrikaans" },
  { code: "xh", label: "isiXhosa" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
];
