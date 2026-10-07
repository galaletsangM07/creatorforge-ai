// ─── CreatorForge AI · AI Studio (video / image / script / voice) ──────────
import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, useToast, fmtTime, ASPECTS, STYLES, CAMERAS, downloadAsset } from "../lib/api";
import { Layout, Field, JobCard, Modal, Empty } from "../components/ui";
import { speakPreview, listBrowserVoices } from "../lib/render";

const TABS = [["video", "🎬 AI Video"], ["image", "🖼 Image"], ["script", "📝 Script Writer"], ["voice", "🎙 Voiceover"]];

export default function Studio() {
  const { tab } = useParams();
  const nav = useNavigate();
  const active = TABS.some(([id]) => id === tab) ? tab : "video";
  return (
    <Layout title="AI Studio" sub="Every generator runs as a real job — nothing is faked.">
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <div key={id} className={`tab ${active === id ? "active" : ""}`} onClick={() => nav(`/studio/${id}`)}>{label}</div>
        ))}
      </div>
      {active === "video" && <VideoGen />}
      {active === "image" && <ImageGen />}
      {active === "script" && <ScriptGen />}
      {active === "voice" && <VoiceGen />}
    </Layout>
  );
}

function useProviders(category) {
  const [all, setAll] = useState([]);
  useEffect(() => { api("/api/providers").then((d) => setAll(d.instances)).catch(() => {}); }, []);
  return all.filter((p) => p.category === category);
}

function ProviderSelect({ providers, value, onChange, category }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="auto">Auto {category} provider</option>
      {providers.map((p) => (
        <option key={p.id} value={p.id}>{p.name}{p.hasKey ? "" : " — no key"}{p.enabled === false ? " (disabled)" : ""}</option>
      ))}
    </select>
  );
}

function SendToProject({ assetId, kind, onClose }) {
  const toast = useToast();
  const nav = useNavigate();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("/api/projects?view=all").then((d) => { setProjects(d.projects); if (d.projects[0]) setProjectId(d.projects[0].id); }).catch(() => {}); }, []);
  const track = kind === "audio" ? "voice" : "video";
  const send = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const { timeline } = await api(`/api/projects/${projectId}`);
      const end = timeline.length ? Math.max(...timeline.map((t) => t.start + t.duration)) : 0;
      await api(`/api/projects/${projectId}/timeline`, {
        method: "POST",
        body: { track, name: kind === "audio" ? "AI Voiceover" : "AI Generated", start: track === "voice" ? 0 : end, duration: kind === "audio" ? 30 : 5, assetId, props: track === "voice" ? { volume: 1 } : { opacity: 1 } },
      });
      toast.push("Added to timeline.");
      nav(`/editor/${projectId}`);
    } catch (e) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <Modal title="Send to project timeline" onClose={onClose}>
      <Field label="Project">
        <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </Field>
      <div className="tiny muted mb">Will be appended to the <strong>{track}</strong> track.</div>
      <button className="btn primary block" disabled={busy || !projectId} onClick={send}>{busy ? "Adding…" : "Add to timeline →"}</button>
    </Modal>
  );
}

function RecentJobs({ type, refreshKey, onSelect }) {
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    api(`/api/generations?type=${type}`).then((d) => setJobs(d.jobs.slice(0, 5))).catch(() => {});
  }, [type, refreshKey]);
  if (!jobs.length) return null;
  return (
    <div className="mt">
      <h4>Recent {type} jobs</h4>
      {jobs.map((j) => (
        <div key={j.id} onClick={() => onSelect?.(j)} style={onSelect ? { cursor: "pointer" } : {}}>
          <JobCard job={j} compact onDone={() => api(`/api/generations?type=${type}`).then((d) => setJobs(d.jobs.slice(0, 5))).catch(() => {})} />
        </div>
      ))}
    </div>
  );
}

// ─── AI Video ────────────────────────────────────────────────────────────
function VideoGen() {
  const toast = useToast();
  const providers = useProviders("video");
  const [form, setForm] = useState({ prompt: "", negativePrompt: "", duration: 5, aspectRatio: "9:16", style: "Cinematic", camera: "Cinematic", lighting: "dramatic", resolution: "720p" });
  const [providerId, setProviderId] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [sendAsset, setSendAsset] = useState(null);
  const [imgFile, setImgFile] = useState(null);
  const [imageAssetId, setImageAssetId] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.prompt.trim()) { setErr("Describe the video you want first."); return; }
    setBusy(true); setErr("");
    try {
      let imgId = imageAssetId;
      if (imgFile && !imgId) {
        const fd = new FormData();
        fd.append("files", imgFile);
        const { assets } = await api("/api/assets", { method: "POST", form: fd });
        imgId = assets[0].id;
      }
      await api("/api/generations", { method: "POST", body: { type: "video", providerId, params: { ...form, imageAssetId: imgId || undefined } } });
      toast.push("Video generation queued — you can keep working.");
      setRefresh((r) => r + 1);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid2">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>🎬 AI Video Generator</h3>
        {err && <div className="err-box mb">{err} <Link to="/settings?tab=providers">Providers →</Link></div>}
        <Field label="Prompt">
          <textarea className="textarea" rows={3} value={form.prompt} onChange={(e) => set("prompt", e.target.value)} placeholder="A luxury sports car driving through Johannesburg at night, neon reflections, cinematic…" />
        </Field>
        <Field label="Image to animate (optional) — image-to-video">
          <input type="file" accept="image/*" onChange={(e) => { setImgFile(e.target.files[0]); setImageAssetId(""); }} />
          {imgFile && <div className="tiny mt">📎 {imgFile.name}</div>}
        </Field>
        <div className="grid2">
          <Field label="Provider"><ProviderSelect providers={providers} value={providerId} onChange={setProviderId} category="video" /></Field>
          <Field label="Duration (sec)"><input className="input" type="number" min={2} max={30} value={form.duration} onChange={(e) => set("duration", Number(e.target.value))} /></Field>
          <Field label="Aspect ratio">
            <select className="select" value={form.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value)}>
              {ASPECTS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Style">
            <select className="select" value={form.style} onChange={(e) => set("style", e.target.value)}>
              {STYLES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Camera movement">
            <select className="select" value={form.camera} onChange={(e) => set("camera", e.target.value)}>
              {CAMERAS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Lighting"><input className="input" value={form.lighting} onChange={(e) => set("lighting", e.target.value)} placeholder="dramatic, golden hour…" /></Field>
        </div>
        <Field label="Negative prompt"><input className="input" value={form.negativePrompt} onChange={(e) => set("negativePrompt", e.target.value)} placeholder="blurry, watermark, low quality…" /></Field>
        <button className="btn primary block big" disabled={busy} onClick={submit}>{busy ? "Queuing…" : "✦ Generate video"}</button>
        <div className="tiny mt">Video generation needs a paid provider (Luma, Runway, Replicate). No key, no fake video — the job will tell you exactly what's missing.</div>
      </div>
      <div>
        <VideoResults refresh={refresh} onSend={setSendAsset} />
        <RecentJobs type="video" refreshKey={refresh} />
      </div>
      {sendAsset && <SendToProject assetId={sendAsset} kind="video" onClose={() => setSendAsset(null)} />}
    </div>
  );
}

function VideoResults({ refresh, onSend }) {
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  useEffect(() => {
    api("/api/assets?kind=video").then((d) => setAssets(d.assets.filter((a) => a.jobId).slice(0, 6))).catch(() => {});
  }, [refresh]);
  if (!assets.length) return <div className="card"><Empty em="🎬" title="No AI videos yet" text="Queued generations appear here with real status. Failed jobs explain why." /></div>;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Generated videos</h3>
      {assets.map((a) => (
        <div key={a.id} className="job-card">
          <div className="spread">
            <strong className="small">{a.name}</strong>
            <span className="tiny">{a.meta?.provider || "AI"}</span>
          </div>
          <AuthedVideo asset={a} />
          <div className="row wrap mt">
            <button className="btn sm primary" onClick={() => onSend(a.id)}>+ Timeline</button>
            <button className="btn sm" onClick={() => downloadAsset(a.id, a.name).catch((e) => toast.push(e.message, "err"))}>⬇ Download</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AuthedVideo({ asset }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    import("../lib/render").then(async ({ authedImageUrl }) => {
      const u = await authedImageUrl(asset);
      if (alive) setUrl(u);
    });
    return () => { alive = false; };
  }, [asset]);
  if (!url) return <div className="tiny muted mt">Loading preview…</div>;
  return <video src={url} controls style={{ width: "100%", borderRadius: 10, marginTop: 10, maxHeight: 260, background: "#000" }} />;
}

// ─── Image ───────────────────────────────────────────────────────────────
function ImageGen() {
  const toast = useToast();
  const providers = useProviders("image");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [style, setStyle] = useState("Cinematic");
  const [quality, setQuality] = useState("standard");
  const [count, setCount] = useState(2);
  const [providerId, setProviderId] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [sendAsset, setSendAsset] = useState(null);

  const submit = async () => {
    if (!prompt.trim()) { setErr("Describe the image first."); return; }
    setBusy(true); setErr("");
    try {
      await api("/api/generations", { method: "POST", body: { type: "image", providerId, params: { prompt, negativePrompt: negative, aspectRatio: aspect, style, quality, count } } });
      toast.push("Image generation queued.");
      setRefresh((r) => r + 1);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid2">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>🖼 AI Image Generator</h3>
        {err && <div className="err-box mb">{err} <Link to="/settings?tab=providers">Providers →</Link></div>}
        <Field label="Prompt">
          <textarea className="textarea" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Luxury sports car driving through Johannesburg at night." />
        </Field>
        <div className="grid2">
          <Field label="Provider"><ProviderSelect providers={providers} value={providerId} onChange={setProviderId} category="image" /></Field>
          <Field label="Aspect"><select className="select" value={aspect} onChange={(e) => setAspect(e.target.value)}>{ASPECTS.map((a) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="Style"><select className="select" value={style} onChange={(e) => setStyle(e.target.value)}>{STYLES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Count"><select className="select" value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
        </div>
        <Field label="Negative prompt"><input className="input" value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="blurry, watermark…" /></Field>
        <button className="btn primary block big" disabled={busy} onClick={submit}>{busy ? "Queuing…" : "✦ Generate images"}</button>
      </div>
      <div>
        <ImageResults refresh={refresh} onSend={setSendAsset} />
        <RecentJobs type="image" refreshKey={refresh} />
      </div>
      {sendAsset && <SendToProject assetId={sendAsset} kind="image" onClose={() => setSendAsset(null)} />}
    </div>
  );
}

export function ImageResults({ refresh, onSend }) {
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  useEffect(() => {
    api("/api/assets?kind=image").then((d) => setAssets(d.assets.filter((a) => a.jobId).slice(0, 8))).catch(() => {});
  }, [refresh]);
  if (!assets.length) return <div className="card"><Empty em="🖼" title="No AI images yet" text="Connect an image provider (or self-host ComfyUI for free) and generate your first visual." /></div>;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Generated images</h3>
      <div className="img-grid">
        {assets.map((a) => (
          <AuthedImg key={a.id} asset={a} onSend={() => onSend?.(a.id)} onDownload={() => downloadAsset(a.id, a.name).catch((e) => toast.push(e.message, "err"))} />
        ))}
      </div>
    </div>
  );
}

export function AuthedImg({ asset, onSend, onDownload }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    import("../lib/render").then(async ({ authedImageUrl }) => {
      const u = await authedImageUrl(asset);
      if (alive) setUrl(u);
    });
    return () => { alive = false; };
  }, [asset]);
  return (
    <div className="img-cell">
      {url ? <img src={url} alt={asset.name} /> : <div style={{ aspectRatio: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><span className="spinner" /></div>}
      <div className="acts">
        {onSend && <button className="btn sm primary" onClick={onSend}>+ Timeline</button>}
        {onDownload && <button className="btn sm" onClick={onDownload}>⬇</button>}
      </div>
    </div>
  );
}

// ─── Script writer ───────────────────────────────────────────────────────
function ScriptGen() {
  const toast = useToast();
  const providers = useProviders("text");
  const [idea, setIdea] = useState("");
  const [duration, setDuration] = useState(30);
  const [videoType, setVideoType] = useState("Motivational");
  const [providerId, setProviderId] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [langs, setLangs] = useState([]);
  const [lang, setLang] = useState("en");
  useEffect(() => { api("/api/languages").then((d) => setLangs(d.languages)).catch(() => {}); }, []);

  const run = async (extra = {}) => {
    if (!idea.trim() && !extra.prompt) { setErr("Enter an idea first."); return; }
    setBusy(true); setErr(""); setResult(null);
    try {
      const { job } = await api("/api/generations", { method: "POST", body: { type: "text", providerId, params: { prompt: idea, targetDuration: duration, videoType, language: lang, ...extra } } });
      const tick = async () => {
        const { job: j } = await api(`/api/generations/${job.id}`);
        if (j.status === "completed") { setResult(j.result); setBusy(false); return; }
        if (j.status === "failed" || j.status === "cancelled") { setErr(j.error); setBusy(false); return; }
        setTimeout(tick, 1800);
      };
      setTimeout(tick, 1500);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const action = async (name) => {
    if (!result?.fullText && !result?.text) return;
    await run({ mode: "transform", action: name, prompt: result.fullText || result.text });
  };

  return (
    <div className="grid2">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>📝 AI Script Writer</h3>
        {err && <div className="err-box mb">{err}</div>}
        <Field label="Video idea">
          <textarea className="textarea" rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Create a viral 30-second video explaining why people fail at trading." />
        </Field>
        <div className="grid3">
          <Field label="Duration (s)"><input className="input" type="number" min={5} max={3600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
          <Field label="Type"><select className="select" value={videoType} onChange={(e) => setVideoType(e.target.value)}>{["Motivational", "Educational", "News", "Advertisement", "Documentary", "Story"].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Language"><select className="select" value={lang} onChange={(e) => setLang(e.target.value)}>{langs.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></Field>
        </div>
        <Field label="Provider"><ProviderSelect providers={providers} value={providerId} onChange={setProviderId} category="text" /></Field>
        <button className="btn primary block big" disabled={busy} onClick={() => run()}>{busy ? "Writing…" : "✦ Generate script"}</button>
        {result && (
          <div className="chip-row mt">
            {[["shorten", "Shorten"], ["expand", "Expand"], ["viral", "More viral"], ["emotional", "More emotional"], ["professional", "More professional"]].map(([id, label]) => (
              <button key={id} className="chip" disabled={busy} onClick={() => action(id)}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Output</h3>
        {!result ? <Empty em="📝" title="No script yet" text="The Local Script Planner drafts instantly for free. Connect an LLM for full AI writing." /> : (
          <>
            <div className="tiny mb">Drafted by <strong>{result.draftedBy || "local planner"}</strong></div>
            {result.note && <div className="info-box mb">{result.note}</div>}
            {(result.sections || [{ label: "Script", text: result.text || result.fullText }]).map((s, i) => (
              <div className="field" key={i}>
                <label>{s.label}</label>
                <div className="small" style={{ background: "#0d1422", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>{s.text}</div>
              </div>
            ))}
            <button className="btn sm" onClick={() => { navigator.clipboard.writeText(result.fullText || result.text || ""); toast.push("Copied to clipboard."); }}>⧉ Copy full script</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Voice ───────────────────────────────────────────────────────────────
function VoiceGen() {
  const toast = useToast();
  const providers = useProviders("voice");
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState("");
  const [text, setText] = useState("Stop scrolling. Your future self is watching you right now — and they're counting on the choice you make today.");
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [emotion, setEmotion] = useState("neutral");
  const [providerId, setProviderId] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [sendAsset, setSendAsset] = useState(null);
  const [browserVoices, setBrowserVoices] = useState([]);
  const [bv, setBv] = useState("");

  useEffect(() => {
    api("/api/voices").then((d) => { setVoices(d.voices); if (d.voices[0]) setVoiceId(d.voices[0].id); }).catch(() => {});
    listBrowserVoices().then((vs) => { setBrowserVoices(vs); if (vs[0]) setBv(vs[0].voiceURI); });
  }, []);

  const voice = voices.find((v) => v.id === voiceId);

  const preview = () => {
    if (!text.trim()) { toast.push("Enter text to preview.", "warn"); return; }
    speakPreview({ text: text.slice(0, 500), voiceURI: bv, rate: speed, pitch });
  };

  const generate = async () => {
    if (!text.trim()) { setErr("Enter narration text first."); return; }
    setBusy(true); setErr("");
    try {
      await api("/api/generations", { method: "POST", body: { type: "voice", providerId, params: { text, voiceRef: voice?.providerVoiceId, voiceId: voice?.id, speed, pitch, emotion } } });
      toast.push("Voiceover queued.");
      setRefresh((r) => r + 1);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid2">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>🎙 AI Voiceover Studio</h3>
        {err && <div className="err-box mb">{err} <Link to="/settings?tab=providers">Providers →</Link></div>}
        <Field label="Voice">
          <select className="select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {voices.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.gender} · {v.accent} · {v.styles?.slice(0, 3).join("/")}</option>)}
          </select>
        </Field>
        <Field label="Narration text"><textarea className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="grid3">
          <Field label={`Speed ${speed}x`}><input type="range" min={0.5} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></Field>
          <Field label={`Pitch ${pitch}`}><input type="range" min={0.5} max={1.5} step={0.05} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} /></Field>
          <Field label="Emotion">
            <select className="select" value={emotion} onChange={(e) => setEmotion(e.target.value)}>
              {["neutral", "energetic", "calm", "dramatic", "friendly", "serious"].map((e) => <option key={e}>{e}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Server provider"><ProviderSelect providers={providers} value={providerId} onChange={setProviderId} category="voice" /></Field>
        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={generate}>{busy ? "Queuing…" : "✦ Generate voiceover"}</button>
        </div>
        <div className="divider" />
        <h4 style={{ margin: "0 0 8px" }}>🔊 Free instant preview (in-browser)</h4>
        <div className="row">
          <select className="select" value={bv} onChange={(e) => setBv(e.target.value)} style={{ flex: 1 }}>
            {browserVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
          </select>
          <button className="btn sm" onClick={preview}>▶ Preview</button>
        </div>
        <div className="tiny mt">Browser previews use your device's voices — free, instant, and honest about quality. Final renders use your server voice provider.</div>
      </div>
      <div>
        <VoiceResults refresh={refresh} onSend={setSendAsset} />
        <RecentJobs type="voice" refreshKey={refresh} />
      </div>
      {sendAsset && <SendToProject assetId={sendAsset} kind="audio" onClose={() => setSendAsset(null)} />}
    </div>
  );
}

function VoiceResults({ refresh, onSend }) {
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  useEffect(() => {
    api("/api/assets?kind=audio").then((d) => setAssets(d.assets.filter((a) => a.jobId).slice(0, 6))).catch(() => {});
  }, [refresh]);
  if (!assets.length) return <div className="card"><Empty em="🎙" title="No voiceovers yet" text="Server voiceovers need a voice provider with an API key. Browser preview is always free." /></div>;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Generated voiceovers</h3>
      {assets.map((a) => (
        <div key={a.id} className="job-card">
          <div className="spread"><strong className="small">{a.name}</strong><span className="tiny">{a.meta?.provider}</span></div>
          <AuthedAudio asset={a} />
          <div className="row wrap mt">
            <button className="btn sm primary" onClick={() => onSend(a.id)}>+ Voice track</button>
            <button className="btn sm" onClick={() => downloadAsset(a.id, a.name).catch((e) => toast.push(e.message, "err"))}>⬇</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AuthedAudio({ asset }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    import("../lib/render").then(async ({ authedImageUrl }) => {
      const u = await authedImageUrl(asset);
      if (alive) setUrl(u);
    });
    return () => { alive = false; };
  }, [asset]);
  if (!url) return <div className="tiny muted mt">Loading…</div>;
  return <audio src={url} controls style={{ width: "100%", marginTop: 8 }} />;
}
