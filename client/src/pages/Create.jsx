// ─── CreatorForge AI · Script-to-Video creation wizard ──────────────────────
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, useToast, fmtTime, VIDEO_TYPES, ASPECTS, DURATIONS, STYLES, mediaUrl } from "../lib/api";
import { Layout, Field, JobCard, StatusBadge, Modal } from "../components/ui";

const STEPS = ["Idea", "Script", "Scenes", "Visuals", "Voice", "Captions", "Music", "Review"];

export default function Create() {
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Step 1 — idea
  const [idea, setIdea] = useState("");
  const [videoType, setVideoType] = useState("Motivational");
  const [aspect, setAspect] = useState("9:16");
  const [duration, setDuration] = useState(30);
  const [customDur, setCustomDur] = useState("");
  const [style, setStyle] = useState("Cinematic");
  const [rawScript, setRawScript] = useState("");

  // Project + pipeline state
  const [project, setProject] = useState(null);
  const [script, setScript] = useState(null); // { sections, fullText, note, draftedBy }
  const [scenes, setScenes] = useState([]);
  const [jobs, setJobs] = useState([]); // active generation jobs
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceId] = useState("");
  const [captionStyle, setCaptionStyle] = useState("tiktok-pop");
  const [tracks, setTracks] = useState([]);
  const [musicId, setMusicId] = useState("");
  const [providers, setProviders] = useState([]);
  const [textProvider, setTextProvider] = useState("auto");
  const [imageProvider, setImageProvider] = useState("auto");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api("/api/voices").then((d) => { setVoices(d.voices); if (d.voices[0]) setVoiceId(d.voices[0].id); }).catch(() => {});
    api("/api/music").then((d) => setTracks(d.tracks)).catch(() => {});
    api("/api/providers").then((d) => setProviders(d.instances)).catch(() => {});
    const from = params.get("from");
    if (from === "script") setRawScript("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetDuration = customDur ? Math.min(3600, Math.max(5, Number(customDur) || 30)) : duration;
  const providersFor = (cat) => providers.filter((p) => p.category === cat);

  const ensureProject = async () => {
    if (project) return project;
    const { project: p } = await api("/api/projects", {
      method: "POST",
      body: { title: idea.slice(0, 60) || "Untitled video", aspectRatio: aspect, duration: targetDuration, videoType, style },
    });
    setProject(p);
    return p;
  };

  const trackJob = (job) => {
    setJobs((j) => [job, ...j.filter((x) => x.id !== job.id)]);
  };

  // ── Step 2: script ──
  const genScript = async (mode = "draft") => {
    setBusy(true); setErr("");
    try {
      const p = await ensureProject();
      const body = mode === "transform"
        ? { type: "text", providerId: textProvider, projectId: p.id, params: { mode: "transform", action: "viral", prompt: script?.fullText || rawScript } }
        : rawScript.trim()
          ? { type: "text", providerId: textProvider, projectId: p.id, params: { mode: "scenes", prompt: rawScript, targetDuration, videoType, style } }
          : { type: "text", providerId: textProvider, projectId: p.id, params: { prompt: idea, targetDuration, videoType, style } };
      const { job } = await api("/api/generations", { method: "POST", body });
      trackJob(job);
      pollUntil(job.id, (done) => {
        if (done.status !== "completed") return;
        const r = done.result || {};
        if (r.scenes) {
          const fullText = r.fullText || r.text || rawScript;
          setScript({ sections: r.sections || [{ label: "Script", text: fullText }], fullText, note: r.note, draftedBy: r.draftedBy });
          setScenes(r.scenes);
        } else if (r.text) {
          setScript({ sections: [{ label: "Script", text: r.text }], fullText: r.text, draftedBy: r.draftedBy });
        }
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pollUntil = (jobId, cb) => {
    const tick = async () => {
      try {
        const { job } = await api(`/api/generations/${jobId}`);
        trackJob(job);
        if (["completed", "failed", "cancelled"].includes(job.status)) { cb(job); return; }
        setTimeout(tick, 2000);
      } catch { setTimeout(tick, 4000); }
    };
    setTimeout(tick, 1500);
  };

  const saveScenes = async (list = scenes) => {
    const p = await ensureProject();
    const { scenes: saved } = await api(`/api/projects/${p.id}/scenes`, { method: "PUT", body: { scenes: list } });
    setScenes(saved);
    setProject({ ...p, duration: Math.max(...saved.map((s) => s.end), p.duration) });
    return saved;
  };

  // ── Step 4: visuals ──
  const genVisual = async (scene) => {
    setErr("");
    try {
      const p = await ensureProject();
      const { job } = await api("/api/generations", {
        method: "POST",
        body: { type: "image", providerId: imageProvider, projectId: p.id, params: { prompt: scene.visualPrompt, aspectRatio: aspect, style, count: 1, sceneId: scene.id } },
      });
      trackJob(job);
      pollUntil(job.id, async (done) => {
        if (done.status === "completed" && done.resultAssetIds?.[0]) {
          const assetId = done.resultAssetIds[0];
          await api(`/api/projects/${p.id}/scenes/${scene.id}`, { method: "PATCH", body: { visualAssetId: assetId, status: "ready" } });
          setScenes((s) => s.map((x) => (x.id === scene.id ? { ...x, visualAssetId: assetId, status: "ready" } : x)));
          toast.push(`Visual ready for ${scene.title}.`);
        }
      });
    } catch (e) {
      setErr(e.message);
    }
  };

  const uploadVisual = async (scene, file) => {
    if (!file) return;
    setUploading(true);
    try {
      const p = await ensureProject();
      const form = new FormData();
      form.append("files", file);
      const { assets } = await api("/api/assets", { method: "POST", form });
      await api(`/api/projects/${p.id}/scenes/${scene.id}`, { method: "PATCH", body: { visualAssetId: assets[0].id, status: "ready" } });
      setScenes((s) => s.map((x) => (x.id === scene.id ? { ...x, visualAssetId: assets[0].id, status: "ready" } : x)));
      toast.push("Image attached to scene.");
    } catch (e) {
      toast.push(e.message, "err");
    } finally {
      setUploading(false);
    }
  };

  // ── Step 5: voice ──
  const [voiceJobId, setVoiceJobId] = useState(null);
  const genVoice = async () => {
    setErr("");
    try {
      const p = await ensureProject();
      const voice = voices.find((v) => v.id === voiceId);
      const { job } = await api("/api/generations", {
        method: "POST",
        body: { type: "voice", projectId: p.id, params: { text: scenes.map((s) => s.script).join(" "), voiceRef: voice?.providerVoiceId, voiceId: voice?.id, speed: 1 } },
      });
      setVoiceJobId(job.id);
      trackJob(job);
      pollUntil(job.id, (done) => {
        if (done.status === "completed") toast.push("Voiceover ready — it will be placed on the timeline at review.");
      });
    } catch (e) {
      setErr(e.message);
    }
  };

  // ── Step 8: build timeline ──
  const buildTimeline = async () => {
    setBusy(true); setErr("");
    try {
      const p = await ensureProject();
      await saveScenes();
      await api(`/api/projects/${p.id}/build-timeline`, { method: "POST", body: { captionStyle } });
      // Attach voiceover if generated
      if (voiceJobId) {
        const { job } = await api(`/api/generations/${voiceJobId}`);
        if (job.status === "completed" && job.resultAssetIds?.[0]) {
          await api(`/api/projects/${p.id}/timeline`, {
            method: "POST",
            body: { track: "voice", name: "AI Voiceover", start: 0, duration: p.duration, assetId: job.resultAssetIds[0], props: { volume: 1 } },
          });
        }
      }
      // Attach music
      if (musicId) {
        const track = tracks.find((t) => t.id === musicId);
        if (track?.assetId) {
          await api(`/api/projects/${p.id}/timeline`, {
            method: "POST",
            body: { track: "music", name: track.title, start: 0, duration: p.duration, assetId: track.assetId, props: { volume: 0.35 } },
          });
        }
      }
      // Word-grouped captions from scene scripts
      await api(`/api/projects/${p.id}/auto-captions-local`, { method: "POST", body: { styleId: captionStyle, maxWords: 4 } });
      toast.push("Timeline built — opening the editor.");
      nav(`/editor/${p.id}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const canNext = () => {
    if (step === 0) return idea.trim().length > 2 || rawScript.trim().length > 10;
    if (step === 1) return script || rawScript.trim();
    if (step === 2) return scenes.length > 0;
    return true;
  };

  return (
    <Layout title="Create" sub="IDEA → SCRIPT → SCENES → VISUALS → VOICE → CAPTIONS → MUSIC → EDIT" actions={project && <Link className="btn sm" to={`/editor/${project.id}`}>Open in editor →</Link>}>
      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`wstep ${i === step ? "active" : ""} ${i < step ? "done" : ""}`} onClick={() => i < step && setStep(i)}>
            {i < step ? "✓" : i + 1} {s}
          </div>
        ))}
      </div>

      {err && <div className="err-box mb">{err} {/provider/i.test(err) && <> <Link to="/settings?tab=providers">Open Providers →</Link></>}</div>}

      {step === 0 && (
        <div className="grid2">
          <div className="card">
            <Field label="💡 What video do you want?">
              <textarea className="textarea" rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="I want a 30-second motivational video about never giving up." />
            </Field>
            <Field label="…or paste your own script (optional)" hint="If provided, the AI structures it into scenes instead of writing one.">
              <textarea className="textarea" rows={5} value={rawScript} onChange={(e) => setRawScript(e.target.value)} placeholder="Paste a full script here…" />
            </Field>
            <Field label="AI text provider" hint="Local planner is free and built-in. Connect an LLM for full AI writing.">
              <select className="select" value={textProvider} onChange={(e) => setTextProvider(e.target.value)}>
                <option value="auto">Auto (recommended)</option>
                {providersFor("text").map((p) => <option key={p.id} value={p.id}>{p.name}{p.hasKey ? "" : " — no key"}</option>)}
              </select>
            </Field>
          </div>
          <div className="card">
            <Field label="Video type">
              <div className="opt-grid">{VIDEO_TYPES.map((v) => <div key={v} className={`opt ${videoType === v ? "sel" : ""}`} onClick={() => setVideoType(v)}>{v}</div>)}</div>
            </Field>
            <div className="grid2">
              <Field label="Aspect ratio">
                <div className="opt-grid">{ASPECTS.map((a) => <div key={a} className={`opt ${aspect === a ? "sel" : ""}`} onClick={() => setAspect(a)}>{a}</div>)}</div>
              </Field>
              <Field label="Duration">
                <div className="opt-grid">{DURATIONS.map((d) => <div key={d} className={`opt ${duration === d && !customDur ? "sel" : ""}`} onClick={() => { setDuration(d); setCustomDur(""); }}>{d >= 60 ? `${d / 60}m` : `${d}s`}</div>)}</div>
                <input className="input mt" type="number" min={5} max={3600} placeholder="Custom seconds…" value={customDur} onChange={(e) => setCustomDur(e.target.value)} />
              </Field>
            </div>
            <Field label="Style">
              <div className="opt-grid">{STYLES.map((s) => <div key={s} className={`opt ${style === s ? "sel" : ""}`} onClick={() => setStyle(s)}>{s}</div>)}</div>
            </Field>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <div className="spread mb">
            <h3 style={{ margin: 0 }}>📝 Script</h3>
            <div className="row wrap">
              <button className="btn sm primary" disabled={busy} onClick={() => genScript("draft")}>{busy ? "Working…" : rawScript.trim() ? "Structure my script" : "Generate script"}</button>
              {script && <button className="btn sm" disabled={busy} onClick={() => genScript("transform")}>Make more viral</button>}
            </div>
          </div>
          {script?.note && <div className="info-box mb">{script.note}</div>}
          {script ? (
            <>
              <div className="tiny mb">Drafted by: <strong>{script.draftedBy || "local planner"}</strong> · ~{script.fullText?.split(/\s+/).length} words · click any section to edit</div>
              {script.sections.map((s, i) => (
                <div className="field" key={i}>
                  <label>{s.label}</label>
                  <textarea
                    className="textarea" rows={2} value={s.text}
                    onChange={(e) => {
                      const sections = script.sections.map((x, j) => (j === i ? { ...x, text: e.target.value } : x));
                      setScript({ ...script, sections, fullText: sections.map((x) => x.text).join(" ") });
                    }}
                  />
                </div>
              ))}
              <button className="btn primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  const p = await ensureProject();
                  const { job } = await api("/api/generations", { method: "POST", body: { type: "text", providerId: textProvider, projectId: p.id, params: { mode: "scenes", prompt: script.fullText, targetDuration, style } } });
                  trackJob(job);
                  pollUntil(job.id, (done) => { if (done.status === "completed") { setScenes(done.result.scenes); setStep(2); } });
                } catch (e) { setErr(e.message); } finally { setBusy(false); }
              }}>Split into scenes →</button>
            </>
          ) : (
            <p className="muted">No script yet — generate one from your idea{rawScript.trim() ? ", or structure your pasted script" : ""}.</p>
          )}
          <ActiveJobs jobs={jobs} />
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="spread mb">
            <h3 style={{ margin: 0 }}>🎞 Scenes ({scenes.length}) · {fmtTime(targetDuration)} total</h3>
            <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); try { await saveScenes(); toast.push("Scenes saved."); } catch (e) { toast.push(e.message, "err"); } finally { setBusy(false); } }}>Save scenes</button>
          </div>
          {scenes.map((s, i) => (
            <div className="scene-card" key={s.id || i}>
              <div className="head">
                <strong>{s.title || `Scene ${i + 1}`}</strong>
                <span className="time">{fmtTime(s.start)}–{fmtTime(s.end)}</span>
                <span className="badge">{s.role}</span>
                <div className="top-spacer" />
                <button className="btn sm ghost" onClick={async () => {
                  try {
                    const { suggestion } = await api("/api/broll-suggest", { method: "POST", body: { sentence: s.script, style } });
                    setScenes((list) => list.map((x, j) => (j === i ? { ...x, visualPrompt: suggestion.visualPrompt, brollKeywords: suggestion.keywords } : x)));
                  } catch (e) { toast.push(e.message, "err"); }
                }}>↻ B-roll idea</button>
              </div>
              <div className="grid2">
                <Field label="Narration">
                  <textarea className="textarea" rows={2} value={s.script} onChange={(e) => setScenes((list) => list.map((x, j) => (j === i ? { ...x, script: e.target.value } : x)))} />
                </Field>
                <Field label="Visual direction (B-roll)">
                  <textarea className="textarea" rows={2} value={s.visualPrompt} onChange={(e) => setScenes((list) => list.map((x, j) => (j === i ? { ...x, visualPrompt: e.target.value } : x)))} />
                </Field>
              </div>
            </div>
          ))}
          <ActiveJobs jobs={jobs} />
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="card mb">
            <div className="spread">
              <div>
                <h3 style={{ margin: "0 0 4px" }}>🖼 Scene visuals</h3>
                <div className="small muted">Generate with your image provider, or upload your own — placeholders stay clearly marked until replaced.</div>
              </div>
              <select className="select" style={{ width: 240 }} value={imageProvider} onChange={(e) => setImageProvider(e.target.value)}>
                <option value="auto">Auto image provider</option>
                {providersFor("image").map((p) => <option key={p.id} value={p.id}>{p.name}{p.hasKey ? "" : " — no key"}</option>)}
              </select>
            </div>
          </div>
          {scenes.map((s, i) => (
            <div className="scene-card" key={s.id || i}>
              <div className="head">
                <strong>{s.title}</strong>
                <span className="time">{fmtTime(s.start)}–{fmtTime(s.end)}</span>
                {s.visualAssetId ? <span className="badge ok">✓ visual ready</span> : <span className="badge warn">placeholder</span>}
              </div>
              <div className="row wrap">
                {s.visualAssetId && <Thumb assetId={s.visualAssetId} />}
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="small muted mb">{s.visualPrompt}</div>
                  <div className="row wrap">
                    <button className="btn sm primary" onClick={() => genVisual(s)}>✦ Generate visual</button>
                    <label className="btn sm" style={{ cursor: "pointer" }}>
                      {uploading ? "Uploading…" : "⬆ Upload"}
                      <input type="file" accept="image/*,video/*" hidden onChange={(e) => uploadVisual(s, e.target.files[0])} />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <ActiveJobs jobs={jobs} />
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🎙 Voiceover</h3>
          <div className="grid2">
            <Field label="Voice">
              <select className="select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                {voices.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.accent} · {v.styles?.join("/")}</option>)}
              </select>
            </Field>
            <Field label="Provider" hint="Server TTS needs a voice provider with an API key. Browser preview is always free.">
              <select className="select" value="auto" disabled><option>Auto voice provider</option></select>
            </Field>
          </div>
          <div className="row wrap mb">
            <button className="btn primary" onClick={genVoice}>Generate full voiceover</button>
            <Link className="btn" to="/studio/voice">Open Voice Studio →</Link>
          </div>
          <div className="tiny muted">Narration: {scenes.map((s) => s.script).join(" ").slice(0, 220)}…</div>
          <ActiveJobs jobs={jobs} />
        </div>
      )}

      {step === 5 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>💬 Captions</h3>
          <p className="muted small">Word-grouped animated captions are built from your scene scripts automatically at review (free, local). For word-perfect timing, transcribe the voiceover in the editor instead.</p>
          <Field label="Caption style">
            <div className="opt-grid">
              {[["tiktok-pop", "TikTok Pop"], ["karaoke", "Karaoke"], ["minimal", "Minimal"], ["news", "News"], ["cinematic", "Cinematic"], ["gaming", "Gaming"], ["corporate", "Corporate"], ["hormozi", "Hormozi Punch"]].map(([id, label]) => (
                <div key={id} className={`opt ${captionStyle === id ? "sel" : ""}`} onClick={() => setCaptionStyle(id)}>{label}</div>
              ))}
            </div>
          </Field>
        </div>
      )}

      {step === 6 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>♪ Background music</h3>
          <p className="muted small">Royalty-free CreatorForge Originals included. Upload your own tracks in Audio — we never bundle copyrighted music.</p>
          <div className="opt-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
            <div className={`opt ${musicId === "" ? "sel" : ""}`} onClick={() => setMusicId("")}>No music</div>
            {tracks.filter((t) => t.category !== "SFX").map((t) => (
              <div key={t.id} className={`opt ${musicId === t.id ? "sel" : ""}`} onClick={() => setMusicId(t.id)}>
                {t.title}<div className="tiny">{t.category} · {fmtTime(t.duration)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 7 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🚀 Review & forge</h3>
          <dl className="kv mb">
            <dt>Title</dt><dd>{idea.slice(0, 80) || "Untitled video"}</dd>
            <dt>Format</dt><dd>{videoType} · {aspect} · {fmtTime(targetDuration)} · {style}</dd>
            <dt>Scenes</dt><dd>{scenes.length} ({scenes.filter((s) => s.visualAssetId).length} with real visuals, {scenes.filter((s) => !s.visualAssetId).length} placeholders)</dd>
            <dt>Voiceover</dt><dd>{voiceJobId ? "generated ✓" : "skipped — add later in editor"}</dd>
            <dt>Captions</dt><dd>{captionStyle} · auto-built from script</dd>
            <dt>Music</dt><dd>{musicId ? tracks.find((t) => t.id === musicId)?.title : "none"}</dd>
          </dl>
          <button className="btn primary big" disabled={busy} onClick={buildTimeline}>{busy ? "Forging…" : "Forge timeline & open editor →"}</button>
        </div>
      )}

      <div className="spread mt">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>← Back</button>
        {step < 7 && <button className="btn primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>Continue →</button>}
      </div>
    </Layout>
  );
}

function ActiveJobs({ jobs }) {
  if (!jobs.length) return null;
  return (
    <div className="mt">
      <h4>Generation jobs</h4>
      {jobs.slice(0, 4).map((j) => <JobCard key={j.id} job={j} compact />)}
    </div>
  );
}

function Thumb({ assetId }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    import("../lib/render").then(async ({ authedImageUrl }) => {
      const u = await authedImageUrl({ id: assetId });
      if (alive) setUrl(u);
    });
    return () => { alive = false; };
  }, [assetId]);
  if (!url) return <div style={{ width: 120, height: 90, borderRadius: 10, background: "#0d1422", display: "flex", alignItems: "center", justifyContent: "center" }}><span className="spinner" /></div>;
  return <img src={url} alt="" style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line2)" }} />;
}
