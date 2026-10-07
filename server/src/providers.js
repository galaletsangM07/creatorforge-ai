// ─── CreatorForge AI · AI Provider Architecture ────────────────────────────
// Provider abstraction layer. NO route or service talks to a vendor API
// directly — everything goes through this registry.
//
// Categories: text | image | video | voice | speech | translate | upscale
//
// Each category exposes a stable interface:
//
//   TextProvider:    generateText({ prompt, system, maxTokens, json }) -> { text }
//   ImageProvider:   generateImage(job) -> { files: [{ buffer, mime, label }] }
//   VideoProvider:   startVideo(job) -> { remoteId, pollAfterMs }
//                    checkVideo(instance, remoteId) -> { status, progress, fileUrl?, error? }
//   VoiceProvider:   synthesize(job) -> { buffer, mime }
//   SpeechProvider:  transcribe({ buffer, filename, mime, language }) -> { text, segments[] }
//   Translate:       translateText({ text, targetLang, sourceLang }) -> { text }
//   Upscale:         upscaleImage({ buffer, scale }) -> { buffer, mime }
//
// Adding a provider = add a definition to PROVIDER_CATALOG + implement the
// category adapter switch below. No route changes required.
//
// HONESTY RULE: if a provider needs an API key that isn't configured, the
// adapter throws ProviderError with code KEY_MISSING and the UI shows the
// real reason with a link to Settings → Providers. Nothing is ever faked.

import { ProviderError } from "./http.js";
import db from "./db.js";

// ─── Catalog: every integration the platform knows how to speak to ────────
// requiresKey: true  → admin must paste a key before it can run (paid/external)
// free:        true  → free / self-hosted / local option
// clientSide:  true  → runs in the browser (no server key possible)

export const PROVIDER_CATALOG = [
  // ——— TEXT / LLM ————————————————————————————————————————————————
  { key: "local-planner", category: "text", label: "Local Script Planner", requiresKey: false, free: true,
    description: "Built-in deterministic planner. Splits scripts into timed scenes with B-roll suggestions. No AI key needed — rule-based, not an LLM.",
    endpoint: "internal://local-planner", models: ["planner-v1"], docsUrl: "" },
  { key: "openai-text", category: "text", label: "OpenAI (GPT)", requiresKey: true, free: false,
    description: "GPT models via OpenAI chat-completions API. Paid, per-token.",
    endpoint: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"], docsUrl: "https://platform.openai.com/docs" },
  { key: "openai-compatible", category: "text", label: "OpenAI-Compatible (Groq / Together / OpenRouter)", requiresKey: true, free: false,
    description: "Any server speaking the OpenAI chat-completions dialect. Override the endpoint, e.g. https://api.groq.com/openai/v1",
    endpoint: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"], docsUrl: "" },
  { key: "anthropic-text", category: "text", label: "Anthropic (Claude)", requiresKey: true, free: false,
    description: "Claude models via the Anthropic Messages API. Paid, per-token.",
    endpoint: "https://api.anthropic.com/v1", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], docsUrl: "https://docs.anthropic.com" },
  { key: "ollama-text", category: "text", label: "Ollama (self-hosted, free)", requiresKey: false, free: true,
    description: "Free local LLMs via Ollama on your own machine or server. Set endpoint to your Ollama host.",
    endpoint: "http://localhost:11434/v1", models: ["llama3.1", "qwen2.5", "mistral"], docsUrl: "https://ollama.com" },

  // ——— IMAGE —————————————————————————————————————————————————————
  { key: "openai-image", category: "image", label: "OpenAI Images (DALL-E / GPT-Image)", requiresKey: true, free: false,
    description: "Paid image generation via OpenAI. Supports dall-e-3 and gpt-image-1.",
    endpoint: "https://api.openai.com/v1", models: ["gpt-image-1", "dall-e-3"], docsUrl: "https://platform.openai.com/docs/guides/images" },
  { key: "stability-image", category: "image", label: "Stability AI (Stable Image)", requiresKey: true, free: false,
    description: "Paid Stable Diffusion 3.5 generation via Stability AI.",
    endpoint: "https://api.stability.ai/v2beta", models: ["sd3.5-large", "sd3.5-medium"], docsUrl: "https://platform.stability.ai/docs" },
  { key: "replicate-image", category: "image", label: "Replicate (FLUX / SDXL)", requiresKey: true, free: false,
    description: "Pay-per-run open models (e.g. black-forest-labs/flux-schnell). Set model to owner/name or owner/name:version.",
    endpoint: "https://api.replicate.com/v1", models: ["black-forest-labs/flux-schnell", "stability-ai/sdxl"], docsUrl: "https://replicate.com/docs" },
  { key: "comfyui-image", category: "image", label: "ComfyUI (self-hosted, free)", requiresKey: false, free: true,
    description: "Your own ComfyUI server with the standard text-to-image workflow API. Free after your own GPU.",
    endpoint: "http://localhost:8188", models: ["txt2img-default"], docsUrl: "https://docs.comfy.org" },

  // ——— VIDEO —————————————————————————————————————————————————————
  { key: "luma-video", category: "video", label: "Luma Dream Machine", requiresKey: true, free: false,
    description: "Paid text/image-to-video via the Luma API (async, polled).",
    endpoint: "https://api.lumalabs.ai/dream-machine/v1", models: ["ray-2", "ray-flash-2"], docsUrl: "https://docs.lumalabs.ai" },
  { key: "runway-video", category: "video", label: "Runway (Gen-4)", requiresKey: true, free: false,
    description: "Paid video generation via the Runway API (async task, polled).",
    endpoint: "https://api.dev.runwayml.com/v1", models: ["gen4_turbo", "gen4"], docsUrl: "https://docs.dev.runwayml.com" },
  { key: "replicate-video", category: "video", label: "Replicate Video (open models)", requiresKey: true, free: false,
    description: "Pay-per-run open video models. Set model to owner/name, e.g. zeroscope-v2 or CogVideoX.",
    endpoint: "https://api.replicate.com/v1", models: ["anotherjesse/zeroscope-v2-xl", "lucataco/cogvideox-5b"], docsUrl: "https://replicate.com/docs" },

  // ——— VOICE / TTS ———————————————————————————————————————————————
  { key: "browser-tts", category: "voice", label: "Browser Preview Voice", requiresKey: false, free: true, clientSide: true,
    description: "Free in-browser speech synthesis for instant previews. Quality depends on the device. Not used for final renders.",
    endpoint: "client://speech-synthesis", models: ["device-voices"], docsUrl: "" },
  { key: "elevenlabs-voice", category: "voice", label: "ElevenLabs", requiresKey: true, free: false,
    description: "High-quality neural voices. Paid per character. Set voice ID per request.",
    endpoint: "https://api.elevenlabs.io/v1", models: ["eleven_multilingual_v2", "eleven_turbo_v2_5"], docsUrl: "https://elevenlabs.io/docs" },
  { key: "openai-tts", category: "voice", label: "OpenAI Text-to-Speech", requiresKey: true, free: false,
    description: "Paid TTS via OpenAI audio API. Voices: alloy, echo, fable, onyx, nova, shimmer.",
    endpoint: "https://api.openai.com/v1", models: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"], docsUrl: "https://platform.openai.com/docs/guides/text-to-speech" },
  { key: "coqui-voice", category: "voice", label: "Coqui / XTTS (self-hosted, free)", requiresKey: false, free: true,
    description: "Self-hosted Coqui TTS server exposing an OpenAI-compatible /v1/audio/speech endpoint.",
    endpoint: "http://localhost:5002/v1", models: ["xtts-v2"], docsUrl: "https://github.com/coqui-ai/TTS" },

  // ——— SPEECH-TO-TEXT ————————————————————————————————————————————
  { key: "whisper-speech", category: "speech", label: "OpenAI Whisper", requiresKey: true, free: false,
    description: "Paid transcription with word timestamps via OpenAI Whisper API.",
    endpoint: "https://api.openai.com/v1", models: ["whisper-1"], docsUrl: "https://platform.openai.com/docs/guides/speech-to-text" },
  { key: "local-whisper", category: "speech", label: "Whisper (self-hosted, free)", requiresKey: false, free: true,
    description: "Your own whisper/faster-whisper server exposing an OpenAI-compatible transcription endpoint.",
    endpoint: "http://localhost:9000/v1", models: ["large-v3", "medium"], docsUrl: "https://github.com/SYSTRAN/faster-whisper" },

  // ——— TRANSLATION ———————————————————————————————————————————————
  { key: "libre-translate", category: "translate", label: "LibreTranslate (self-hosted, free)", requiresKey: false, free: true,
    description: "Free self-hosted translation. Public demo instances are rate-limited.",
    endpoint: "https://libretranslate.com", models: ["nllb"], docsUrl: "https://libretranslate.com" },

  // ——— UPSCALING —————————————————————————————————————————————————
  { key: "replicate-upscale", category: "upscale", label: "Replicate (Real-ESRGAN)", requiresKey: true, free: false,
    description: "Pay-per-run AI upscaling via Replicate-hosted Real-ESRGAN.",
    endpoint: "https://api.replicate.com/v1", models: ["nightmareai/real-esrgan"], docsUrl: "https://replicate.com/docs" },
];

export const CATEGORIES = ["text", "image", "video", "voice", "speech", "translate", "upscale"];

// ─── Instance store (admin-configured) ─────────────────────────────────────

export function listInstances(category) {
  const rows = category ? db.where("api_providers", { category }) : db.all("api_providers");
  return rows
    .filter((r) => r.enabled !== false)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export function publicInstance(row) {
  if (!row) return null;
  const { apiKey, ...rest } = row;
  return { ...rest, hasKey: Boolean(apiKey), keyPreview: apiKey ? `••••${String(apiKey).slice(-4)}` : null };
}

export function getDef(defKey) {
  return PROVIDER_CATALOG.find((d) => d.key === defKey) || null;
}

/** Resolve which provider instance should handle a job. Throws honest errors. */
export function resolveProvider(category, preferredId = "auto") {
  const instances = listInstances(category);
  if (preferredId && preferredId !== "auto") {
    const inst = db.get("api_providers", preferredId);
    if (!inst || inst.category !== category) {
      throw new ProviderError(`The selected ${category} provider no longer exists. Choose another provider.`, {
        code: "PROVIDER_NOT_FOUND", status: 400,
      });
    }
    if (inst.enabled === false) {
      throw new ProviderError(`The provider "${inst.name}" is disabled. Enable it in Settings → Providers or choose another.`, {
        code: "PROVIDER_DISABLED", status: 400, provider: inst.name,
      });
    }
    return inst;
  }
  // auto: first enabled instance by priority
  if (instances.length > 0) return instances[0];
  const free = PROVIDER_CATALOG.filter((d) => d.category === category && d.free).map((d) => d.label);
  throw new ProviderError(
    `No ${category} provider is configured. ` +
      (free.length ? `Free options exist (${free.join(", ")}) — configure one in Settings → Providers, or add a paid provider.` : `Add a provider in Settings → Providers first.`),
    { code: "NO_PROVIDER", status: 400, hint: "open-providers" }
  );
}

export function requireKey(instance) {
  const def = getDef(instance.defKey);
  if (def?.requiresKey && !instance.apiKey) {
    throw new ProviderError(
      `Generation requires an external ${instance.category} provider. "${instance.name}" has no API key configured. Add one in Settings → Providers, or switch to a free provider.`,
      { code: "KEY_MISSING", status: 400, provider: instance.name, hint: "open-providers" }
    );
  }
}

// ─── HTTP helper with timeout + honest errors ─────────────────────────────

async function callJson(url, { method = "POST", headers = {}, body, timeoutMs = 120_000, provider = "provider" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || data?.detail || data?.message || text?.slice(0, 300) || `HTTP ${res.status}`;
      throw new ProviderError(`The configured ${provider} provider rejected the request (${res.status}): ${msg}`, {
        code: "PROVIDER_REJECTED", provider, status: 502,
      });
    }
    return data;
  } catch (err) {
    if (err?.isProviderError) throw err;
    if (err?.name === "AbortError") {
      throw new ProviderError(`The ${provider} provider timed out after ${Math.round(timeoutMs / 1000)}s. Try again or switch providers.`, {
        code: "PROVIDER_TIMEOUT", provider, status: 504,
      });
    }
    throw new ProviderError(`Could not reach the ${provider} provider (${err.message}). Check the endpoint URL and your connection.`, {
      code: "PROVIDER_UNREACHABLE", provider, status: 502,
    });
  } finally {
    clearTimeout(t);
  }
}

async function callBinary(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 180_000);
  try {
    const res = await fetch(url, { ...opts.fetchInit, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`The configured ${opts.provider || "provider"} provider rejected the request (${res.status}): ${text.slice(0, 300)}`, {
        code: "PROVIDER_REJECTED", provider: opts.provider, status: 502,
      });
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mime: res.headers.get("content-type") || opts.fallbackMime || "application/octet-stream" };
  } catch (err) {
    if (err?.isProviderError) throw err;
    if (err?.name === "AbortError") throw new ProviderError(`The ${opts.provider} provider timed out.`, { code: "PROVIDER_TIMEOUT", provider: opts.provider, status: 504 });
    throw new ProviderError(`Could not reach the ${opts.provider} provider (${err.message}).`, { code: "PROVIDER_UNREACHABLE", provider: opts.provider, status: 502 });
  } finally {
    clearTimeout(t);
  }
}

const endpointOf = (instance, def) => (instance.endpoint || def?.endpoint || "").replace(/\/$/, "");

// ══════════════════ TEXT ══════════════════════════════════════════════════

export async function generateText(instance, { prompt, system, maxTokens = 2000, json = false, temperature = 0.7 }) {
  const def = getDef(instance.defKey);
  requireKey(instance);
  const base = endpointOf(instance, def);
  const model = instance.model || def?.models?.[0];

  if (["openai-text", "openai-compatible", "ollama-text"].includes(instance.defKey)) {
    const data = await callJson(`${base}/chat/completions`, {
      provider: instance.name,
      headers: {
        "Content-Type": "application/json",
        ...(instance.apiKey ? { Authorization: `Bearer ${instance.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
      }),
    });
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new ProviderError(`The ${instance.name} provider returned an empty response.`, { provider: instance.name });
    return { text };
  }

  if (instance.defKey === "anthropic-text") {
    const data = await callJson(`${base}/messages`, {
      provider: instance.name,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": instance.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const text = (data?.content || []).map((b) => b.text || "").join("").trim();
    if (!text) throw new ProviderError(`The ${instance.name} provider returned an empty response.`, { provider: instance.name });
    return { text };
  }

  throw new ProviderError(`Text generation is not implemented for provider "${instance.name}".`, { provider: instance.name, code: "NOT_IMPLEMENTED", status: 400 });
}

// ══════════════════ IMAGE ═════════════════════════════════════════════════

const IMAGE_SIZES = {
  "1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792", "4:5": "1024x1280",
};

export async function generateImage(instance, params) {
  const def = getDef(instance.defKey);
  requireKey(instance);
  const base = endpointOf(instance, def);
  const model = instance.model || def?.models?.[0];
  const { prompt, negativePrompt = "", aspectRatio = "16:9", style = "", quality = "standard", count = 1 } = params;
  const fullPrompt = style ? `${prompt}. Style: ${style}` : prompt;
  const n = Math.min(4, Math.max(1, Number(count) || 1));

  if (instance.defKey === "openai-image") {
    const size = IMAGE_SIZES[aspectRatio] || "1024x1024";
    const data = await callJson(`${base}/images/generations`, {
      provider: instance.name, timeoutMs: 180_000,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${instance.apiKey}` },
      body: JSON.stringify({ model, prompt: fullPrompt.slice(0, 4000), n, size, ...(model.includes("dall-e-3") ? { quality, style: "vivid" } : {}) }),
    });
    const files = [];
    for (const d of data?.data || []) {
      if (d.b64_json) files.push({ buffer: Buffer.from(d.b64_json, "base64"), mime: "image/png", label: "generated" });
      else if (d.url) {
        const dl = await callBinary(d.url, { provider: instance.name, fetchInit: {}, fallbackMime: "image/png" });
        files.push({ buffer: dl.buffer, mime: dl.mime, label: "generated" });
      }
    }
    if (!files.length) throw new ProviderError(`The ${instance.name} provider returned no images.`, { provider: instance.name });
    return { files };
  }

  if (instance.defKey === "stability-image") {
    const [w, h] = (IMAGE_SIZES[aspectRatio] || "1024x1024").split("x").map(Number);
    const form = new FormData();
    form.set("prompt", fullPrompt.slice(0, 10000));
    if (negativePrompt) form.set("negative_prompt", negativePrompt.slice(0, 2000));
    form.set("model", model);
    form.set("output_format", "png");
    const files = [];
    for (let i = 0; i < n; i++) {
      form.set("seed", String(Math.floor(Math.random() * 4294967295)));
      const { buffer } = await callBinary(`${base}/stable-image/generate/sd3`, {
        provider: instance.name, timeoutMs: 240_000, fallbackMime: "image/png",
        fetchInit: { method: "POST", headers: { Authorization: `Bearer ${instance.apiKey}`, Accept: "image/*" }, body: form },
      });
      files.push({ buffer, mime: "image/png", label: `generated-${i + 1}` });
    }
    void w; void h;
    return { files };
  }

  if (instance.defKey === "replicate-image") {
    const files = [];
    for (let i = 0; i < n; i++) {
      const out = await replicatePrediction(instance, model, {
        prompt: fullPrompt.slice(0, 4000),
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
        aspect_ratio: aspectRatio === "16:9" ? "16:9" : aspectRatio === "9:16" ? "9:16" : aspectRatio === "4:5" ? "4:5" : "1:1",
        output_format: "png",
      });
      for (const url of out) {
        const dl = await callBinary(url, { provider: instance.name, fetchInit: {}, fallbackMime: "image/png" });
        files.push({ buffer: dl.buffer, mime: dl.mime, label: "generated" });
      }
    }
    if (!files.length) throw new ProviderError(`The ${instance.name} provider returned no images.`, { provider: instance.name });
    return { files };
  }

  if (instance.defKey === "comfyui-image") {
    // Minimal ComfyUI API workflow (SD1.5-style checkpoint). Works against a
    // stock ComfyUI server; errors from ComfyUI are surfaced verbatim.
    const [w, h] = (IMAGE_SIZES[aspectRatio] || "1024x1024").split("x").map(Number);
    const seed = Math.floor(Math.random() * 10 ** 12);
    const workflow = {
      1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "v1-5-pruned-emaonly.safetensors" } },
      2: { class_type: "CLIPTextEncode", inputs: { text: fullPrompt.slice(0, 2000), clip: ["1", 1] } },
      3: { class_type: "CLIPTextEncode", inputs: { text: negativePrompt || "blurry, low quality", clip: ["1", 1] } },
      4: { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: n } },
      5: { class_type: "KSampler", inputs: { seed, steps: 25, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
      6: { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
      7: { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "creatorforge" } },
    };
    const queued = await callJson(`${base}/prompt`, {
      provider: instance.name, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
    const promptId = queued?.prompt_id;
    if (!promptId) throw new ProviderError(`ComfyUI did not accept the prompt.`, { provider: instance.name });
    const started = Date.now();
    while (Date.now() - started < 600_000) {
      await new Promise((r) => setTimeout(r, 2500));
      const hist = await callJson(`${base}/history/${promptId}`, { method: "GET", provider: instance.name });
      const entry = hist?.[promptId];
      if (entry?.outputs) {
        const files = [];
        for (const nodeOut of Object.values(entry.outputs)) {
          for (const img of nodeOut.images || []) {
            const { buffer } = await callBinary(`${base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`, {
              provider: instance.name, fetchInit: {}, fallbackMime: "image/png",
            });
            files.push({ buffer, mime: "image/png", label: "generated" });
          }
        }
        if (files.length) return { files };
        throw new ProviderError(`ComfyUI finished but produced no images.`, { provider: instance.name });
      }
    }
    throw new ProviderError(`ComfyUI timed out after 10 minutes.`, { provider: instance.name, code: "PROVIDER_TIMEOUT", status: 504 });
  }

  throw new ProviderError(`Image generation is not implemented for provider "${instance.name}".`, { provider: instance.name, code: "NOT_IMPLEMENTED", status: 400 });
}

// Generic Replicate prediction runner (used by image/video/upscale).
async function replicatePrediction(instance, model, input, timeoutMs = 600_000) {
  const base = endpointOf(instance, getDef(instance.defKey));
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${instance.apiKey}`, Prefer: "wait" };
  let payload;
  if (String(model).includes(":")) {
    const [m, version] = String(model).split(":");
    payload = { version, input };
    void m;
  } else {
    // Resolve official model → latest version
    const info = await callJson(`${base}/models/${model}`, { method: "GET", headers, provider: instance.name, timeoutMs: 30_000 });
    const version = info?.latest_version?.id;
    if (!version) throw new ProviderError(`Replicate model "${model}" was not found. Use owner/name or owner/name:version.`, { provider: instance.name, code: "MODEL_NOT_FOUND", status: 400 });
    payload = { version, input };
  }
  let pred = await callJson(`${base}/predictions`, { headers, provider: instance.name, body: JSON.stringify(payload), timeoutMs: 60_000 });
  const started = Date.now();
  while (["starting", "processing"].includes(pred?.status)) {
    if (Date.now() - started > timeoutMs) {
      await callJson(`${base}/predictions/${pred.id}/cancel`, { method: "POST", headers, provider: instance.name }).catch(() => null);
      throw new ProviderError(`Replicate timed out after ${Math.round(timeoutMs / 60000)} minutes.`, { provider: instance.name, code: "PROVIDER_TIMEOUT", status: 504 });
    }
    await new Promise((r) => setTimeout(r, 3000));
    pred = await callJson(`${base}/predictions/${pred.id}`, { method: "GET", headers, provider: instance.name, timeoutMs: 30_000 });
  }
  if (pred?.status !== "succeeded") {
    throw new ProviderError(`Replicate failed: ${pred?.error || "unknown error"}. Logs: ${(pred?.logs || "").slice(-300)}`, { provider: instance.name });
  }
  const out = pred.output;
  const urls = Array.isArray(out) ? out : [out];
  return urls.filter((u) => typeof u === "string");
}

// ══════════════════ VIDEO (async: start + poll) ═══════════════════════════

export async function startVideo(instance, params) {
  const def = getDef(instance.defKey);
  requireKey(instance);
  const base = endpointOf(instance, def);
  const model = instance.model || def?.models?.[0];
  const { prompt, negativePrompt = "", duration = 5, aspectRatio = "16:9", imageUrl } = params;

  if (instance.defKey === "luma-video") {
    const data = await callJson(`${base}/generations`, {
      provider: instance.name,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${instance.apiKey}` },
      body: JSON.stringify({
        model, prompt: String(prompt).slice(0, 4000),
        ...(imageUrl ? { keyframes: { frame0: { type: "image", url: imageUrl } } } : {}),
        aspect_ratio: aspectRatio,
      }),
    });
    if (!data?.id) throw new ProviderError(`Luma did not return a generation id.`, { provider: instance.name });
    return { remoteId: data.id, pollAfterMs: 5000 };
  }

  if (instance.defKey === "runway-video") {
    // Runway image-to-video task API (text-to-video uses the same tasks API).
    const data = await callJson(`${base}/image_to_video`, {
      provider: instance.name,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${instance.apiKey}`, "X-Runway-Version": "2024-11-06" },
      body: JSON.stringify({
        model, promptText: String(prompt).slice(0, 2000),
        ...(imageUrl ? { promptImage: imageUrl } : { promptImage: "https://static.creatorforge.ai/placeholder-16x9.png" }),
        duration: Math.min(10, Math.max(2, Number(duration) || 5)),
        ratio: aspectRatio === "9:16" ? "720:1280" : "1280:720",
      }),
    });
    if (!data?.id) throw new ProviderError(`Runway did not return a task id.`, { provider: instance.name });
    return { remoteId: data.id, pollAfterMs: 8000 };
  }

  if (instance.defKey === "replicate-video") {
    const baseUrl = endpointOf(instance, getDef(instance.defKey));
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${instance.apiKey}` };
    let version = String(model).includes(":") ? String(model).split(":")[1] : null;
    if (!version) {
      const info = await callJson(`${baseUrl}/models/${model}`, { method: "GET", headers, provider: instance.name, timeoutMs: 30_000 });
      version = info?.latest_version?.id;
      if (!version) throw new ProviderError(`Replicate model "${model}" was not found.`, { provider: instance.name, code: "MODEL_NOT_FOUND", status: 400 });
    }
    const pred = await callJson(`${baseUrl}/predictions`, {
      headers, provider: instance.name, timeoutMs: 60_000,
      body: JSON.stringify({ version, input: { prompt: String(prompt).slice(0, 4000), ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) } }),
    });
    return { remoteId: pred.id, pollAfterMs: 5000 };
  }

  throw new ProviderError(`Video generation is not implemented for provider "${instance.name}".`, { provider: instance.name, code: "NOT_IMPLEMENTED", status: 400 });
}

export async function checkVideo(instance, remoteId) {
  const def = getDef(instance.defKey);
  const base = endpointOf(instance, def);

  if (instance.defKey === "luma-video") {
    const data = await callJson(`${base}/generations/${remoteId}`, {
      method: "GET", provider: instance.name, timeoutMs: 30_000,
      headers: { Authorization: `Bearer ${instance.apiKey}` },
    });
    if (data.state === "completed") return { status: "completed", progress: 100, fileUrl: data.assets?.video };
    if (data.state === "failed") return { status: "failed", error: data.failure_reason || "Luma generation failed." };
    return { status: "running", progress: 20 };
  }

  if (instance.defKey === "runway-video") {
    const data = await callJson(`${base}/tasks/${remoteId}`, {
      method: "GET", provider: instance.name, timeoutMs: 30_000,
      headers: { Authorization: `Bearer ${instance.apiKey}`, "X-Runway-Version": "2024-11-06" },
    });
    if (data.status === "SUCCEEDED") return { status: "completed", progress: 100, fileUrl: data.output?.[0] };
    if (data.status === "FAILED") return { status: "failed", error: data.failure || data.failureCode || "Runway task failed." };
    return { status: "running", progress: data.status === "RUNNING" ? 50 : 15 };
  }

  if (instance.defKey === "replicate-video") {
    const data = await callJson(`${base}/predictions/${remoteId}`, {
      method: "GET", provider: instance.name, timeoutMs: 30_000,
      headers: { Authorization: `Bearer ${instance.apiKey}` },
    });
    if (data.status === "succeeded") {
      const out = Array.isArray(data.output) ? data.output[0] : data.output;
      return { status: "completed", progress: 100, fileUrl: out };
    }
    if (data.status === "failed" || data.status === "canceled") {
      return { status: "failed", error: data.error || `Replicate prediction ${data.status}.` };
    }
    return { status: "running", progress: 30 };
  }

  throw new ProviderError(`Video polling is not implemented for provider "${instance.name}".`, { provider: instance.name, code: "NOT_IMPLEMENTED", status: 400 });
}

export async function cancelRemoteVideo(instance, remoteId) {
  const base = endpointOf(instance, getDef(instance.defKey));
  try {
    if (instance.defKey === "replicate-video") {
      await callJson(`${base}/predictions/${remoteId}/cancel`, {
        method: "POST", provider: instance.name,
        headers: { Authorization: `Bearer ${instance.apiKey}` },
      });
    }
    // Luma/Runway have no public cancel; local job is marked cancelled.
  } catch { /* best effort */ }
}

// ══════════════════ VOICE ═════════════════════════════════════════════════

export async function synthesize(instance, { text, voiceRef = "", speed = 1, emotion = "", model: modelOverride }) {
  const def = getDef(instance.defKey);
  requireKey(instance);
  const base = endpointOf(instance, def);
  const model = modelOverride || instance.model || def?.models?.[0];
  const clean = String(text || "").slice(0, 5000);
  if (!clean.trim()) throw new ProviderError("There is no text to speak.", { code: "EMPTY_TEXT", status: 400, provider: instance.name });

  if (instance.defKey === "elevenlabs-voice") {
    const voiceId = voiceRef || "21m00Tcm4TlvDq8ikWAM"; // Rachel (public default)
    const { buffer } = await callBinary(`${base}/text-to-speech/${voiceId}`, {
      provider: instance.name, timeoutMs: 180_000, fallbackMime: "audio/mpeg",
      fetchInit: {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": instance.apiKey },
        body: JSON.stringify({
          text: clean, model_id: model,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.5, Math.max(0.5, Number(speed) || 1)) },
        }),
      },
    });
    return { buffer, mime: "audio/mpeg" };
  }

  if (instance.defKey === "openai-tts" || instance.defKey === "coqui-voice") {
    const voice = voiceRef || "alloy";
    const { buffer } = await callBinary(`${base}/audio/speech`, {
      provider: instance.name, timeoutMs: 180_000, fallbackMime: "audio/mpeg",
      fetchInit: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(instance.apiKey ? { Authorization: `Bearer ${instance.apiKey}` } : {}),
        },
        body: JSON.stringify({ model, input: clean, voice, speed: Math.min(4, Math.max(0.25, Number(speed) || 1)), response_format: "mp3" }),
      },
    });
    void emotion;
    return { buffer, mime: "audio/mpeg" };
  }

  throw new ProviderError(`Voice synthesis is not implemented for provider "${instance.name}".`, { provider: instance.name, code: "NOT_IMPLEMENTED", status: 400 });
}

// ══════════════════ SPEECH-TO-TEXT ════════════════════════════════════════

export async function transcribe(instance, { buffer, filename = "audio.mp3", mime = "audio/mpeg", language = "en" }) {
  requireKey(instance);
  const base = endpointOf(instance, getDef(instance.defKey));
  const model = instance.model || getDef(instance.defKey)?.models?.[0];
  const form = new FormData();
  form.set("model", model);
  form.set("file", new Blob([buffer], { type: mime }), filename);
  form.set("response_format", "verbose_json");
  form.set("timestamp_granularities[]", "word");
  if (language && language !== "auto") form.set("language", language);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 300_000);
  try {
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { ...(instance.apiKey ? { Authorization: `Bearer ${instance.apiKey}` } : {}) },
      body: form, signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ProviderError(`The ${instance.name} provider rejected the transcription (${res.status}): ${data?.error?.message || res.statusText}`, {
        code: "PROVIDER_REJECTED", provider: instance.name, status: 502,
      });
    }
    const segments = (data?.segments || []).map((s) => ({ start: s.start ?? 0, end: s.end ?? 0, text: (s.text || "").trim() }));
    const words = (data?.words || []).map((w) => ({ start: w.start ?? 0, end: w.end ?? 0, text: w.word || w.text || "" }));
    return { text: (data?.text || "").trim(), segments, words };
  } catch (err) {
    if (err?.isProviderError) throw err;
    throw new ProviderError(`Transcription via ${instance.name} failed: ${err.message}`, { provider: instance.name });
  } finally {
    clearTimeout(t);
  }
}

// ══════════════════ TRANSLATE ═════════════════════════════════════════════

export async function translateText(instance, { text, targetLang = "en", sourceLang = "auto" }) {
  const base = endpointOf(instance, getDef(instance.defKey));
  const data = await callJson(`${base}/translate`, {
    provider: instance.name,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: String(text).slice(0, 10000), source: sourceLang, target: targetLang, format: "text" }),
  });
  const out = data?.translatedText;
  if (!out) throw new ProviderError(`The ${instance.name} provider returned no translation.`, { provider: instance.name });
  return { text: out };
}

// ══════════════════ UPSCALE ═══════════════════════════════════════════════

export async function upscaleImage(instance, { buffer, scale = 2 }) {
  requireKey(instance);
  const model = instance.model || getDef(instance.defKey)?.models?.[0];
  // Replicate needs a public URL — upload via data URI is supported by
  // Real-ESRGAN (image field accepts data URIs).
  const dataUri = `data:image/png;base64,${buffer.toString("base64")}`;
  const urls = await replicatePrediction(instance, model, { image: dataUri, scale: Math.min(4, Math.max(2, Number(scale) || 2)) }, 600_000);
  if (!urls[0]) throw new ProviderError(`The ${instance.name} provider returned no upscaled image.`, { provider: instance.name });
  const dl = await callBinary(urls[0], { provider: instance.name, fetchInit: {}, fallbackMime: "image/png" });
  return { buffer: dl.buffer, mime: dl.mime };
}

// ══════════════════ CONNECTION TEST (real minimal call) ═══════════════════

export async function testProvider(instance) {
  const started = Date.now();
  const def = getDef(instance.defKey);
  try {
    requireKey(instance);
    const base = endpointOf(instance, def);
    if (instance.defKey === "local-planner" || instance.defKey === "browser-tts") {
      return { ok: true, message: "Local provider is always available.", latencyMs: 0 };
    }
    if (["openai-text", "openai-compatible", "ollama-text", "openai-image", "openai-tts", "whisper-speech", "local-whisper", "coqui-voice"].includes(instance.defKey)) {
      await callJson(`${base}/models`, { method: "GET", provider: instance.name, timeoutMs: 20_000,
        headers: { ...(instance.apiKey ? { Authorization: `Bearer ${instance.apiKey}` } : {}) } });
    } else if (instance.defKey === "anthropic-text") {
      await callJson(`${base}/models`, { method: "GET", provider: instance.name, timeoutMs: 20_000,
        headers: { "x-api-key": instance.apiKey, "anthropic-version": "2023-06-01" } });
    } else if (instance.defKey === "elevenlabs-voice") {
      await callJson(`${base}/voices`, { method: "GET", provider: instance.name, timeoutMs: 20_000, headers: { "xi-api-key": instance.apiKey } });
    } else if (instance.defKey.startsWith("replicate-")) {
      await callJson(`${base}/collections`, { method: "GET", provider: instance.name, timeoutMs: 20_000, headers: { Authorization: `Bearer ${instance.apiKey}` } });
    } else if (instance.defKey === "stability-image") {
      await callJson(`${base.replace(/\/v2beta$/, "")}/v1/user/account`, { method: "GET", provider: instance.name, timeoutMs: 20_000, headers: { Authorization: `Bearer ${instance.apiKey}` } });
    } else if (instance.defKey === "luma-video") {
      await callJson(`${base}/ping`, { method: "GET", provider: instance.name, timeoutMs: 20_000, headers: { Authorization: `Bearer ${instance.apiKey}` } });
    } else if (instance.defKey === "runway-video") {
      await callJson(`${base}/models`, { method: "GET", provider: instance.name, timeoutMs: 20_000, headers: { Authorization: `Bearer ${instance.apiKey}` } });
    } else if (instance.defKey === "comfyui-image") {
      await callJson(`${base}/system_stats`, { method: "GET", provider: instance.name, timeoutMs: 20_000 });
    } else if (instance.defKey === "libre-translate") {
      await callJson(`${base}/languages`, { method: "GET", provider: instance.name, timeoutMs: 20_000 });
    }
    db.update("api_providers", instance.id, { lastError: "" });
    return { ok: true, message: `Connected to ${instance.name}.`, latencyMs: Date.now() - started };
  } catch (err) {
    db.update("api_providers", instance.id, { lastError: err.message });
    return { ok: false, message: err.message, latencyMs: Date.now() - started };
  }
}

// Auto-seed: ensure at least the free local providers exist as instances.
export function ensureSeedProviders() {
  const ensure = (defKey, name, extra = {}) => {
    const def = getDef(defKey);
    if (!def) return;
    const existing = db.where("api_providers", { defKey })[0];
    if (existing) return;
    db.insert("api_providers", {
      defKey, category: def.category, name,
      endpoint: def.endpoint, model: def.models[0],
      apiKey: "", enabled: true, priority: def.free ? 200 : 100, ...extra,
    });
  };
  ensure("local-planner", "Local Script Planner");
  ensure("browser-tts", "Browser Preview Voice");
  ensure("ollama-text", "Ollama (self-hosted)", { enabled: false });
  ensure("comfyui-image", "ComfyUI (self-hosted)", { enabled: false });
  ensure("local-whisper", "Whisper (self-hosted)", { enabled: false });
  ensure("coqui-voice", "Coqui XTTS (self-hosted)", { enabled: false });
  ensure("libre-translate", "LibreTranslate", { enabled: false });
}
