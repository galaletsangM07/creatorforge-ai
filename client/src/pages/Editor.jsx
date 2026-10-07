// ─── CreatorForge AI · Timeline editor ─────────────────────────────────────
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api, useToast, fmtClock, fmtTime, downloadAsset, ASPECTS } from "../lib/api";
import { renderFrame, authedImageUrl, browserRender } from "../lib/render";
import { Modal, Field, StatusBadge, Empty } from "../components/ui";

const TRACKS = [
  ["video", "Video"], ["overlay", "Overlay"], ["text", "Text"],
  ["captions", "Captions"], ["voice", "Voice"], ["music", "Music"], ["sfx", "SFX"],
];

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const round2 = (n) => Math.round(n * 100) / 100;

export default function Editor() {
  const { id } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [items, setItems] = useState([]);
  const [assets, setAssets] = useState([]);
  const [captionStyles, setCaptionStyles] = useState([]);
  const [loading, setLoading] = useState(true);

  const [sel, setSel] = useState(null); // selected item id
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(40); // px per second
  const [panel, setPanel] = useState("media");
  const [panelOpen, setPanelOpen] = useState(false); // mobile
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saved, setSaved] = useState(true);

  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const playStartRef = useRef(0);
  const playFromRef = useRef(0);
  const audioRefs = useRef([]);

  const assetsById = Object.fromEntries(assets.map((a) => [a.id, a]));
  const duration = Math.max(project?.duration || 10, ...items.map((i) => i.start + i.duration), 5);

  // ── Load ──
  const load = useCallback(async () => {
    try {
      const d = await api(`/api/projects/${id}`);
      setProject(d.project);
      setScenes(d.scenes);
      setItems(d.timeline);
      const a = await api("/api/assets");
      setAssets(a.assets);
      const c = await api("/api/caption-styles");
      setCaptionStyles(c.styles);
    } catch (e) {
      toast.push(e.message, "err");
      nav("/projects");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // ── History ──
  const commit = (next, pushHistory = true) => {
    if (pushHistory) {
      setPast((p) => [...p.slice(-49), JSON.stringify(items)]);
      setFuture([]);
    }
    setItems(next);
    setSaved(false);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [JSON.stringify(items), ...f]);
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setItems(JSON.parse(prev));
    setSaved(false);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, JSON.stringify(items)]);
    const [next, ...rest] = future;
    setFuture(rest);
    setItems(JSON.parse(next));
    setSaved(false);
  };

  // ── Autosave ──
  useEffect(() => {
    if (loading || saved || !project) return;
    const h = setTimeout(async () => {
      try {
        await api(`/api/projects/${id}/timeline`, { method: "PUT", body: { items } });
        setSaved(true);
      } catch (e) {
        toast.push(`Autosave failed: ${e.message}`, "err");
      }
    }, 1200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── Preview loop ──
  const draw = useCallback(async (time) => {
    const canvas = canvasRef.current;
    if (!canvas || !project) return;
    const ctx = canvas.getContext("2d");
    await renderFrame(ctx, canvas.width, canvas.height, { project, items, assetsById, captionStyles, t: time });
  }, [project, items, assetsById, captionStyles]);

  useEffect(() => {
    if (!playing) { draw(t); return; }
    playStartRef.current = performance.now();
    playFromRef.current = t;
    const loop = () => {
      const nt = playFromRef.current + (performance.now() - playStartRef.current) / 1000;
      if (nt >= duration) { setPlaying(false); setT(0); stopAudio(); return; }
      setT(nt);
      draw(nt);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    startAudio(t);
    return () => { cancelAnimationFrame(rafRef.current); stopAudio(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => { if (!playing) draw(t); }, [t, playing, draw]);

  // ── Timeline audio (voice/music/sfx) ──
  const stopAudio = () => {
    audioRefs.current.forEach((a) => { try { a.pause(); } catch {} });
    audioRefs.current = [];
  };
  const startAudio = async (from) => {
    stopAudio();
    for (const c of items.filter((x) => ["voice", "music", "sfx"].includes(x.track))) {
      const a = c.assetId ? assetsById[c.assetId] : null;
      if (!a) continue;
      const end = c.start + c.duration;
      if (from >= end) continue;
      const url = await authedImageUrl(a);
      if (!url) continue;
      const el = new Audio(url);
      el.volume = c.props?.volume ?? (c.track === "music" ? 0.35 : 1);
      el.currentTime = Math.max(0, from - c.start);
      el.play().catch(() => {});
      audioRefs.current.push(el);
      const remaining = (end - Math.max(from, c.start)) * 1000;
      setTimeout(() => { try { el.pause(); } catch {} }, remaining);
    }
  };
  const togglePlay = () => {
    if (!playing && t >= duration - 0.1) setT(0);
    setPlaying(!playing);
  };
  const seek = (nt) => {
    nt = Math.min(duration, Math.max(0, nt));
    setT(nt);
    if (playing) { startAudio(nt); playFromRef.current = nt; playStartRef.current = performance.now(); }
  };

  // ── Clip ops ──
  const selected = items.find((i) => i.id === sel);
  const updateSel = (patch, mergeProps = true) => {
    if (!selected) return;
    commit(items.map((i) => (i.id === sel ? { ...i, ...patch, props: mergeProps ? { ...(i.props || {}), ...(patch.props || {}) } : patch.props ?? i.props } : i)));
  };
  const splitAt = (time = t) => {
    const hit = items.filter((i) => time > i.start + 0.1 && time < i.start + i.duration - 0.1);
    if (!hit.length) { toast.push("Playhead is not over a clip.", "warn"); return; }
    const next = [];
    for (const c of items) {
      if (!hit.includes(c)) { next.push(c); continue; }
      const a = { ...c, duration: round2(time - c.start) };
      const b = { ...c, id: uid(), start: round2(time), duration: round2(c.start + c.duration - time) };
      next.push(a, b);
    }
    commit(next);
    toast.push(`Split ${hit.length} clip${hit.length > 1 ? "s" : ""}.`);
  };
  const deleteSel = () => {
    if (!selected) return;
    commit(items.filter((i) => i.id !== sel));
    setSel(null);
  };
  const duplicateSel = () => {
    if (!selected) return;
    const copy = { ...selected, id: uid(), start: round2(selected.start + selected.duration) };
    commit([...items, copy]);
    setSel(copy.id);
  };
  const freezeFrame = () => {
    const v = items.filter((i) => (i.track === "video" || i.track === "overlay") && t >= i.start && t < i.start + i.duration)[0];
    if (!v) { toast.push("Move the playhead over a video clip first.", "warn"); return; }
    commit([...items, { ...v, id: uid(), start: round2(t), duration: 2, name: `${v.name} (freeze)`, props: { ...(v.props || {}), freeze: true } }]);
    toast.push("Freeze frame added (2s).");
  };

  const addItem = (item) => {
    commit([...items, { id: uid(), projectId: id, ...item }]);
  };

  const saveTitle = async (title) => {
    try {
      const { project: p } = await api(`/api/projects/${id}`, { method: "PATCH", body: { title } });
      setProject(p);
    } catch (e) { toast.push(e.message, "err"); }
  };

  if (loading) return <div className="auth-wrap"><div className="card"><span className="spinner" /> Loading editor…</div></div>;
  if (!project) return null;

  const ar = project.aspectRatio || "9:16";
  const [cw, ch] = ar === "16:9" ? [480, 270] : ar === "1:1" ? [360, 360] : ar === "4:5" ? [360, 450] : [300, 533];

  return (
    <div className="editor">
      {/* Top bar */}
      <div className="ed-top">
        <button className="btn sm menu-btn" onClick={() => setPanelOpen(true)}>☰</button>
        <Link className="btn sm ghost" to="/dashboard">←</Link>
        <input className="title" value={project.title} onChange={(e) => setProject({ ...project, title: e.target.value })} onBlur={(e) => saveTitle(e.target.value)} />
        {project.sample && <span className="badge warn">SAMPLE</span>}
        <span className="tiny muted">{saved ? "✓ saved" : "● saving…"}</span>
        <div className="top-spacer" />
        <button className="btn sm ghost" disabled={!past.length} onClick={undo} title="Undo">↩</button>
        <button className="btn sm ghost" disabled={!future.length} onClick={redo} title="Redo">↪</button>
        <button className="btn sm" onClick={() => { setPanel("assistant"); setPanelOpen(true); }}>✦ Assistant</button>
        <button className="btn sm" onClick={() => setInspectorOpen(!inspectorOpen)}>🎚</button>
        <button className="btn sm primary" onClick={() => setExportOpen(true)}>⬆ Export</button>
      </div>

      <div className="ed-mid">
        {/* Left */}
        <div className={`ed-left ${panelOpen ? "open" : ""}`}>
          <div className="ed-rail">
            {[["media", "🗂", "Media"], ["text", "T", "Text"], ["audio", "♪", "Audio"], ["effects", "✨", "FX"], ["captions", "💬", "Caps"], ["scenes", "🎞", "Scenes"], ["tools", "🤖", "AI"], ["assistant", "✦", "Chat"]].map(([pid, em, label]) => (
              <button key={pid} className={`rail-btn ${panel === pid ? "active" : ""}`} onClick={() => { setPanel(pid); setPanelOpen(true); }}>
                <span className="em">{em}</span>{label}
              </button>
            ))}
          </div>
          <div className="ed-panel">
            <PanelContent
              panel={panel} project={project} scenes={scenes} setScenes={setScenes} items={items} commit={commit} addItem={addItem}
              assets={assets} setAssets={setAssets} captionStyles={captionStyles} t={t} duration={duration}
              onClose={() => setPanelOpen(false)} reload={load} setProject={setProject} toast={toast}
            />
          </div>
        </div>

        {/* Center */}
        <div className="ed-center">
          <div className="preview-wrap">
            <div className="preview-frame" style={{ width: Math.min(cw, 9999), maxWidth: "100%", maxHeight: "100%", aspectRatio: `${cw}/${ch}` }}>
              <canvas ref={canvasRef} width={cw * 1.5} height={ch * 1.5} style={{ width: "100%", height: "100%" }} />
            </div>
          </div>
          <div className="transport">
            <button className="tbtn" onClick={() => seek(0)} title="Start">⏮</button>
            <button className="tbtn" onClick={() => seek(t - 2)} title="-2s">‹</button>
            <button className="tbtn play" onClick={togglePlay}>{playing ? "⏸" : "▶"}</button>
            <button className="tbtn" onClick={() => seek(t + 2)} title="+2s">›</button>
            <div className="timecode">{fmtClock(t)} / {fmtClock(duration)}</div>
          </div>
        </div>

        {/* Right inspector */}
        <div className={`ed-right ${inspectorOpen ? "open" : ""}`}>
          <Inspector selected={selected} updateSel={updateSel} captionStyles={captionStyles} scenes={scenes} onClose={() => setInspectorOpen(false)} />
        </div>
      </div>

      {/* Timeline */}
      <Timeline
        items={items} duration={duration} t={t} zoom={zoom} setZoom={setZoom} sel={sel} setSel={setSel}
        seek={seek} commit={commit} splitAt={splitAt} deleteSel={deleteSel} duplicateSel={duplicateSel}
        freezeFrame={freezeFrame} undo={undo} redo={redo} past={past} future={future} addItem={addItem}
      />

      {exportOpen && <ExportModal project={project} items={items} assetsById={assetsById} captionStyles={captionStyles} onClose={() => setExportOpen(false)} />}
    </div>
  );
}

// ═══════════════ Left panels ═══════════════
function PanelContent(props) {
  const { panel } = props;
  if (panel === "media") return <MediaPanel {...props} />;
  if (panel === "text") return <TextPanel {...props} />;
  if (panel === "audio") return <AudioPanel {...props} />;
  if (panel === "effects") return <EffectsPanel {...props} />;
  if (panel === "captions") return <CaptionsPanel {...props} />;
  if (panel === "scenes") return <ScenesPanel {...props} />;
  if (panel === "tools") return <ToolsPanel {...props} />;
  if (panel === "assistant") return <AssistantPanel {...props} />;
  return null;
}

function MediaPanel({ project, addItem, assets, setAssets, t, toast }) {
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("all");
  const upload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      [...files].slice(0, 10).forEach((f) => fd.append("files", f));
      const { assets: fresh } = await api("/api/assets", { method: "POST", form: fd });
      setAssets((a) => [...fresh, ...a]);
      toast.push(`${fresh.length} file${fresh.length > 1 ? "s" : ""} uploaded.`);
    } catch (e) { toast.push(e.message, "err"); } finally { setUploading(false); }
  };
  const shown = assets.filter((a) => filter === "all" || a.kind === filter);
  const place = (a) => {
    const track = a.kind === "audio" ? "music" : "video";
    addItem({ track, name: a.name, start: round2(t), duration: a.kind === "audio" ? project.duration : 5, assetId: a.id, props: track === "music" ? { volume: 0.35 } : { opacity: 1, volume: 1, speed: 1 } });
    toast.push(`Added to ${track} track at ${fmtTime(t)}.`);
  };
  return (
    <div>
      <div className="spread mb"><strong>Media</strong><button className="btn sm ghost" onClick={props_onClose(props)}>✕</button></div>
      <label className="btn sm primary block mb" style={{ cursor: "pointer" }}>
        {uploading ? "Uploading…" : "⬆ Upload media"}
        <input type="file" multiple accept="video/*,image/*,audio/*" hidden onChange={(e) => upload(e.target.files)} />
      </label>
      <div className="chip-row mb">
        {[["all", "All"], ["video", "Video"], ["image", "Image"], ["audio", "Audio"]].map(([id, l]) => (
          <button key={id} className={`chip ${filter === id ? "sel" : ""}`} onClick={() => setFilter(id)}>{l}</button>
        ))}
      </div>
      {shown.length === 0 && <div className="tiny muted">No media yet — upload to begin.</div>}
      {shown.map((a) => (
        <div key={a.id} className="job-card" style={{ padding: 10 }}>
          <div className="row">
            <span style={{ fontSize: 22 }}>{a.kind === "video" ? "🎬" : a.kind === "image" ? "🖼" : a.kind === "audio" ? "♪" : "📄"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="small" style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
              <div className="tiny">{a.kind}{a.meta?.provider ? ` · ${a.meta.provider}` : ""}</div>
            </div>
            <button className="btn sm" onClick={() => place(a)}>+ Add</button>
          </div>
        </div>
      ))}
    </div>
  );
}
const props_onClose = (props) => props.onClose;

function TextPanel({ addItem, t, toast }) {
  const presets = [
    ["Title", { size: 64, y: 0.35, color: "#ffffff" }],
    ["Subtitle", { size: 40, y: 0.7, color: "#ffffff" }],
    ["Lower third", { size: 34, y: 0.82, color: "#ffffff", bg: "#c1121f" }],
    ["Callout", { size: 44, y: 0.2, color: "#ffe600" }],
    ["Sticker ⭐", { size: 90, y: 0.5, text: "⭐" }],
    ["Sticker 🔥", { size: 90, y: 0.5, text: "🔥" }],
    ["Sticker 💯", { size: 90, y: 0.5, text: "💯" }],
  ];
  return (
    <div>
      <div className="spread mb"><strong>Text & stickers</strong><button className="btn sm ghost" onClick={props_onClose({ onClose: null }) || undefined} style={{ display: "none" }} /></div>
      {presets.map(([label, p]) => (
        <button key={label} className="btn sm block mb" style={{ marginBottom: 8 }} onClick={() => {
          addItem({ track: "text", name: label, start: round2(t), duration: 3, props: { text: p.text || "Your text", font: "Arial", size: p.size, weight: 800, color: p.color, bg: p.bg || "transparent", x: 0.5, y: p.y, opacity: 1 } });
          toast.push(`${label} added at playhead. Edit it in the inspector →`);
        }}>+ {label}</button>
      ))}
      <div className="tiny muted">Tip: select a text clip, then edit content, font, size and position on the right.</div>
    </div>
  );
}

function AudioPanel({ project, addItem, t, toast }) {
  const [tracks, setTracks] = useState([]);
  const [cat, setCat] = useState("all");
  useEffect(() => { api("/api/music").then((d) => setTracks(d.tracks)).catch(() => {}); }, []);
  const cats = ["all", ...new Set(tracks.map((x) => x.category))];
  const shown = tracks.filter((x) => cat === "all" || x.category === cat);
  return (
    <div>
      <div className="spread mb"><strong>Audio library</strong></div>
      <div className="chip-row mb">
        {cats.map((c) => <button key={c} className={`chip ${cat === c ? "sel" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {shown.map((x) => (
        <div key={x.id} className="job-card" style={{ padding: 10 }}>
          <div className="small" style={{ fontWeight: 700 }}>{x.title}</div>
          <div className="tiny mb">{x.category} · {fmtTime(x.duration)} · {x.license?.includes("royalty") ? "✓ royalty-free" : x.license}</div>
          <div className="row">
            <button className="btn sm" disabled={!x.assetId} onClick={() => {
              addItem({ track: x.category === "SFX" ? "sfx" : "music", name: x.title, start: x.category === "SFX" ? round2(t) : 0, duration: x.duration || project.duration, assetId: x.assetId, props: { volume: x.category === "SFX" ? 1 : 0.35 } });
              toast.push("Added to timeline.");
            }}>+ {x.category === "SFX" ? "SFX" : "Music"}</button>
          </div>
        </div>
      ))}
      <Link className="btn sm block" to="/audio">Manage audio →</Link>
    </div>
  );
}

function EffectsPanel({ items, commit, toast }) {
  const [selId] = useState(null);
  void selId;
  const apply = (props, label) => {
    const vids = items.filter((i) => i.track === "video" || i.track === "overlay");
    if (!vids.length) { toast.push("Add a video clip first.", "warn"); return; }
    commit(items.map((i) => (vids.includes(i) ? { ...i, props: { ...(i.props || {}), ...props } } : i)));
    toast.push(`${label} applied to ${vids.length} clip${vids.length > 1 ? "s" : ""}.`);
  };
  return (
    <div>
      <div className="spread mb"><strong>Effects & transitions</strong></div>
      <div className="tiny muted mb">Filters</div>
      <div className="chip-row mb">
        {[["None", {}], ["Cinematic", { filter: "cinematic", vignette: true }], ["Noir", { filter: "noir" }], ["Warm", { filter: "warm" }], ["Cool", { filter: "cool" }], ["Vibrant", { filter: "vibrant" }], ["Clear vignette", { vignette: false, filter: null }]].map(([l, p]) => (
          <button key={l} className="chip" onClick={() => apply(p, l)}>{l}</button>
        ))}
      </div>
      <div className="tiny muted mb">Transitions (rendered in preview + browser export)</div>
      <div className="chip-row mb">
        {[["None", null], ["Fade", "fade"], ["Zoom punch", "zoom"], ["Slide", "slide"]].map(([l, v]) => (
          <button key={l} className="chip" onClick={() => apply({ transition: v }, `${l} transition`)}>{l}</button>
        ))}
      </div>
      <div className="tiny muted">Transitions apply to all video clips. Per-clip control lives in the inspector.</div>
    </div>
  );
}

function CaptionsPanel({ project, items, commit, captionStyles, toast, reload }) {
  const [busy, setBusy] = useState(false);
  const [styleId, setStyleId] = useState("tiktok-pop");
  const cues = items.filter((i) => i.track === "captions").sort((a, b) => a.start - b.start);
  const auto = async () => {
    setBusy(true);
    try {
      const { count } = await api(`/api/projects/${project.id}/auto-captions-local`, { method: "POST", body: { styleId, maxWords: 4 } });
      toast.push(`${count} caption cues built from your script.`);
      await reload();
    } catch (e) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };
  const transcribe = async () => {
    setBusy(true);
    try {
      const voice = items.find((i) => i.track === "voice" && i.assetId);
      if (!voice) { toast.push("Add a voiceover clip with audio first.", "warn"); setBusy(false); return; }
      const { job } = await api("/api/generations", { method: "POST", body: { type: "speech", projectId: project.id, params: { assetId: voice.assetId, language: "en" } } });
      toast.push("Transcription queued — cues will appear when it completes.");
      const tick = async () => {
        const { job: j } = await api(`/api/generations/${job.id}`);
        if (j.status === "completed") {
          const segs = j.result?.segments?.length ? j.result.segments : [];
          if (segs.length) {
            const existing = items.filter((i) => !(i.track === "captions" && i.props?.auto));
            const fresh = segs.map((s) => ({ id: uid(), projectId: project.id, track: "captions", name: "AI caption", start: round2(s.start), duration: round2(Math.max(0.3, s.end - s.start)), props: { text: s.text, styleId, auto: true } }));
            commit([...existing, ...fresh]);
            toast.push(`${segs.length} AI captions applied.`);
          } else toast.push("Transcription returned no segments.", "warn");
          setBusy(false);
          return;
        }
        if (j.status === "failed" || j.status === "cancelled") { toast.push(j.error || "Transcription failed.", "err"); setBusy(false); return; }
        setTimeout(tick, 2500);
      };
      setTimeout(tick, 2000);
    } catch (e) { toast.push(e.message, "err"); setBusy(false); }
  };
  return (
    <div>
      <div className="spread mb"><strong>Captions ({cues.length})</strong></div>
      <Field label="Style">
        <select className="select" value={styleId} onChange={(e) => {
          setStyleId(e.target.value);
          commit(items.map((i) => (i.track === "captions" ? { ...i, props: { ...(i.props || {}), styleId: e.target.value } } : i)));
        }}>
          {captionStyles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <div className="row wrap mb">
        <button className="btn sm primary" disabled={busy} onClick={auto}>{busy ? "…" : "✦ Auto from script (free)"}</button>
        <button className="btn sm" disabled={busy} onClick={transcribe}>{busy ? "…" : "🎙 Transcribe voiceover"}</button>
      </div>
      {cues.slice(0, 30).map((c) => (
        <div key={c.id} className="job-card" style={{ padding: 10 }}>
          <div className="tiny" style={{ fontFamily: "var(--mono)", color: "var(--mint)" }}>{fmtClock(c.start)} → {fmtClock(c.start + c.duration)}</div>
          <input className="input" style={{ marginTop: 6 }} value={c.props?.text || ""} onChange={(e) => {
            commit(items.map((i) => (i.id === c.id ? { ...i, props: { ...(i.props || {}), text: e.target.value } } : i)), false);
          }} />
        </div>
      ))}
      {cues.length === 0 && <div className="tiny muted">No captions yet — generate from your script for free.</div>}
    </div>
  );
}

function ScenesPanel({ project, scenes, setScenes, toast }) {
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const d = await api(`/api/projects/${project.id}/scenes`);
    setScenes(d.scenes);
  };
  const regenVisual = async (scene) => {
    setBusy(true);
    try {
      const { job } = await api("/api/generations", { method: "POST", body: { type: "image", projectId: project.id, params: { prompt: scene.visualPrompt, aspectRatio: project.aspectRatio, count: 1, sceneId: scene.id } } });
      toast.push(`Queued visual for ${scene.title}.`);
      const tick = async () => {
        const { job: j } = await api(`/api/generations/${job.id}`);
        if (j.status === "completed" && j.resultAssetIds?.[0]) {
          await api(`/api/projects/${project.id}/scenes/${scene.id}`, { method: "PATCH", body: { visualAssetId: j.resultAssetIds[0], status: "ready" } });
          await refresh();
          toast.push("Scene visual updated.");
          setBusy(false);
          return;
        }
        if (j.status === "failed" || j.status === "cancelled") { toast.push(j.error || "Failed.", "err"); setBusy(false); return; }
        setTimeout(tick, 2500);
      };
      setTimeout(tick, 2000);
    } catch (e) { toast.push(e.message, "err"); setBusy(false); }
  };
  if (!scenes.length) return <div><strong>Scenes</strong><div className="tiny muted mt">This project has no scenes. Use Create → Script-to-Video to build a scene plan.</div></div>;
  return (
    <div>
      <div className="spread mb"><strong>Scenes ({scenes.length})</strong></div>
      {scenes.map((s) => (
        <div key={s.id} className="scene-card" style={{ padding: 12 }}>
          <div className="head">
            <strong className="small">{s.title}</strong>
            <span className="time">{fmtTime(s.start)}–{fmtTime(s.end)}</span>
          </div>
          <div className="tiny muted mb">{s.script?.slice(0, 120)}…</div>
          <div className="row wrap">
            <StatusBadge status={s.visualAssetId ? "ready" : "draft"} />
            <button className="btn sm" disabled={busy} onClick={() => regenVisual(s)}>↻ Regen visual</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolsPanel({ project, items, commit, setProject, toast }) {
  const [tools, setTools] = useState([]);
  const [busy, setBusy] = useState(false);
  const [aspect, setAspect] = useState(project.aspectRatio);
  const [assetId, setAssetId] = useState("");
  const [lang, setLang] = useState("zu");
  const [langs, setLangs] = useState([]);
  useEffect(() => {
    api("/api/tools").then((d) => setTools(d.tools)).catch(() => {});
    api("/api/languages").then((d) => setLangs(d.languages)).catch(() => {});
  }, []);
  const images = items.filter((i) => i.assetId && (i.track === "video" || i.track === "overlay"));
  const run = async (tool) => {
    setBusy(true);
    try {
      const params = {};
      if (tool.id === "resize") params.aspectRatio = aspect;
      if (tool.id === "upscale") {
        if (!assetId && !images[0]?.assetId) { toast.push("Select an image clip first.", "warn"); setBusy(false); return; }
        params.assetId = assetId || images[0].assetId;
        params.scale = 2;
      }
      if (tool.id === "translation") {
        params.text = items.filter((i) => i.track === "captions").map((i) => i.props?.text).join("\n") || project.title;
        params.targetLang = lang;
      }
      const r = await api(`/api/tools/${tool.id}`, { method: "POST", body: { projectId: project.id, params } });
      if (r.local) {
        if (r.project) setProject(r.project);
        toast.push("Applied.");
      } else {
        toast.push(`${tool.label} queued — watch it in Settings → Usage.`);
      }
    } catch (e) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="spread mb"><strong>AI tools</strong></div>
      <Field label="Resize target"><select className="select" value={aspect} onChange={(e) => setAspect(e.target.value)}>{ASPECTS.map((a) => <option key={a}>{a}</option>)}</select></Field>
      <Field label="Upscale source (clip with image)">
        <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          <option value="">First image clip</option>
          {images.map((i) => <option key={i.id} value={i.assetId}>{i.name}</option>)}
        </select>
      </Field>
      <Field label="Translation target"><select className="select" value={lang} onChange={(e) => setLang(e.target.value)}>{langs.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></Field>
      {tools.map((x) => (
        <div key={x.id} className="job-card" style={{ padding: 10 }}>
          <div className="spread">
            <strong className="small">{x.label}</strong>
            <span className={`badge ${x.status === "ready" ? "ok" : x.status === "local" ? "info" : "warn"}`}>{x.status === "ready" ? "ready" : x.status === "local" ? "free · local" : "needs provider"}</span>
          </div>
          <div className="tiny muted" style={{ margin: "4px 0 8px" }}>{x.description}</div>
          <button className="btn sm" disabled={busy || x.status === "needs-provider"} onClick={() => run(x)}>Run</button>
        </div>
      ))}
    </div>
  );
}

function AssistantPanel({ project, toast, reload }) {
  const [msgs, setMsgs] = useState([{ role: "ai", text: "I'm inside your editor and I can see this project. Try: “make captions bigger”, “make this cinematic”, “add motivational music”, “shorten to 30 seconds”, “translate into isiZulu”." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api("/api/assistant", { method: "POST", body: { projectId: project.id, message } });
      setMsgs((m) => [...m, { role: "ai", text: r.reply }]);
      if (r.actions?.length) await reload();
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", text: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="spread mb"><strong>✦ AI Assistant</strong><span className="badge vip">sees project</span></div>
      <div className="chat mb" style={{ maxHeight: 380, overflowY: "auto" }}>
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text}</div>)}
        {busy && <div className="msg ai"><span className="spinner" /></div>}
      </div>
      <div className="row">
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask for an edit…" />
        <button className="btn sm primary" disabled={busy} onClick={() => send()}>→</button>
      </div>
      <div className="chip-row mt">
        {["Make captions bigger", "Make this cinematic", "Shorten to 30 seconds"].map((s) => (
          <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════ Inspector ═══════════════
function Inspector({ selected, updateSel, captionStyles, onClose }) {
  if (!selected) return <div><div className="spread mb"><strong>Inspector</strong><button className="btn sm ghost" onClick={onClose}>✕</button></div><Empty em="🎚" title="Nothing selected" text="Click any clip on the timeline to edit its properties." /></div>;
  const p = selected.props || {};
  const set = (patch) => updateSel({ props: patch });
  return (
    <div>
      <div className="spread mb"><strong>Inspector</strong><button className="btn sm ghost" onClick={onClose}>✕</button></div>
      <Field label="Clip name"><input className="input" value={selected.name} onChange={(e) => updateSel({ name: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="Start (s)"><input className="input" type="number" step={0.1} value={selected.start} onChange={(e) => updateSel({ start: Number(e.target.value) })} /></Field>
        <Field label="Duration (s)"><input className="input" type="number" step={0.1} min={0.2} value={selected.duration} onChange={(e) => updateSel({ duration: Number(e.target.value) })} /></Field>
      </div>
      {(selected.track === "text") && (
        <>
          <Field label="Text"><textarea className="textarea" rows={2} value={p.text || ""} onChange={(e) => set({ text: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="Size"><input className="input" type="number" value={p.size || 48} onChange={(e) => set({ size: Number(e.target.value) })} /></Field>
            <Field label="Color"><input className="input" type="color" value={p.color || "#ffffff"} onChange={(e) => set({ color: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label={`X ${p.x ?? 0.5}`}><input type="range" min={0} max={1} step={0.01} value={p.x ?? 0.5} onChange={(e) => set({ x: Number(e.target.value) })} /></Field>
            <Field label={`Y ${p.y ?? 0.3}`}><input type="range" min={0} max={1} step={0.01} value={p.y ?? 0.3} onChange={(e) => set({ y: Number(e.target.value) })} /></Field>
          </div>
        </>
      )}
      {selected.track === "captions" && (
        <>
          <Field label="Caption text"><textarea className="textarea" rows={2} value={p.text || ""} onChange={(e) => set({ text: e.target.value })} /></Field>
          <Field label="Style">
            <select className="select" value={p.styleId || "tiktok-pop"} onChange={(e) => set({ styleId: e.target.value })}>
              {captionStyles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label={`Size ×${p.fontScale || 1}`}><input type="range" min={0.5} max={2} step={0.05} value={p.fontScale || 1} onChange={(e) => set({ fontScale: Number(e.target.value) })} /></Field>
        </>
      )}
      {(selected.track === "video" || selected.track === "overlay") && (
        <>
          <Field label={`Opacity ${p.opacity ?? 1}`}><input type="range" min={0} max={1} step={0.01} value={p.opacity ?? 1} onChange={(e) => set({ opacity: Number(e.target.value) })} /></Field>
          <Field label={`Zoom ${p.scale ?? 1}`}><input type="range" min={0.5} max={3} step={0.01} value={p.scale ?? 1} onChange={(e) => set({ scale: Number(e.target.value) })} /></Field>
          <Field label={`Rotation ${p.rotation ?? 0}°`}><input type="range" min={-180} max={180} step={1} value={p.rotation ?? 0} onChange={(e) => set({ rotation: Number(e.target.value) })} /></Field>
          <Field label={`Speed ${p.speed ?? 1}x`}><input type="range" min={0.25} max={4} step={0.05} value={p.speed ?? 1} onChange={(e) => set({ speed: Number(e.target.value) })} /></Field>
          <Field label="Filter">
            <select className="select" value={p.filter || ""} onChange={(e) => set({ filter: e.target.value || null })}>
              <option value="">None</option>
              {["cinematic", "noir", "warm", "cool", "vibrant"].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Transition">
            <select className="select" value={p.transition || ""} onChange={(e) => set({ transition: e.target.value || null })}>
              <option value="">None</option>
              <option value="fade">Fade</option>
              <option value="zoom">Zoom punch</option>
              <option value="slide">Slide</option>
            </select>
          </Field>
        </>
      )}
      {(selected.track === "voice" || selected.track === "music" || selected.track === "sfx") && (
        <Field label={`Volume ${Math.round((p.volume ?? 1) * 100)}%`}><input type="range" min={0} max={2} step={0.01} value={p.volume ?? 1} onChange={(e) => set({ volume: Number(e.target.value) })} /></Field>
      )}
      {(selected.track === "text" || selected.track === "overlay") && (
        <Field label={`Opacity ${p.opacity ?? 1}`}><input type="range" min={0} max={1} step={0.01} value={p.opacity ?? 1} onChange={(e) => set({ opacity: Number(e.target.value) })} /></Field>
      )}
    </div>
  );
}

// ═══════════════ Timeline ═══════════════
function Timeline({ items, duration, t, zoom, setZoom, sel, setSel, seek, commit, splitAt, deleteSel, duplicateSel, freezeFrame, undo, redo, past, future }) {
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const width = Math.max(duration * zoom + 200, 600);

  const onRuler = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek((e.clientX - rect.left + e.currentTarget.parentElement.scrollLeft - 0) / zoom);
  };

  const startDrag = (e, clip, mode) => {
    e.stopPropagation();
    setSel(clip.id);
    dragRef.current = { id: clip.id, mode, startX: e.clientX, origStart: clip.start, origDur: clip.duration };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dt = (ev.clientX - d.startX) / zoom;
      if (d.mode === "move") {
        const ns = Math.max(0, round2(d.origStart + dt));
        commit(items.map((i) => (i.id === d.id ? { ...i, start: round2(Math.round(ns * 10) / 10) } : i)), false);
      } else if (d.mode === "l") {
        const ns = Math.max(0, d.origStart + dt);
        const nd = Math.max(0.2, d.origDur - (ns - d.origStart));
        commit(items.map((i) => (i.id === d.id ? { ...i, start: round2(ns), duration: round2(nd) } : i)), false);
      } else if (d.mode === "r") {
        commit(items.map((i) => (i.id === d.id ? { ...i, duration: round2(Math.max(0.2, d.origDur + dt)) } : i)), false);
      }
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit([...itemsRef.current]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const key = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") deleteSel();
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); duplicateSel(); }
      if (e.key === "s" && !e.ctrlKey && !e.metaKey) splitAt();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const ticks = [];
  const step = zoom > 80 ? 1 : zoom > 30 ? 2 : 5;
  for (let s = 0; s <= duration + 2; s += step) ticks.push(s);

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button className="btn sm" onClick={() => splitAt()} title="Split at playhead (S)">✂ Split</button>
        <button className="btn sm" onClick={duplicateSel} title="Duplicate (Ctrl+D)">⧉</button>
        <button className="btn sm" onClick={freezeFrame} title="Freeze frame">❄</button>
        <button className="btn sm danger" onClick={deleteSel} title="Delete (Del)">🗑</button>
        <span className="tiny muted">Zoom</span>
        <input type="range" min={12} max={160} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 110 }} />
        <span className="tiny muted">Drag clips to move · drag edges to trim · click ruler to seek</span>
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          {TRACKS.map(([id, label]) => <div key={id} className="tl-label">{label}</div>)}
        </div>
        <div className="tl-scroll" ref={scrollRef} onClick={() => setSel(null)}>
          <div style={{ width, position: "relative" }}>
            <div className="tl-ruler" onClick={onRuler}>
              {ticks.map((s) => (
                <span key={s} className="tiny" style={{ position: "absolute", left: s * zoom + 4, top: 4, fontFamily: "var(--mono)" }}>{fmtTime(s)}</span>
              ))}
            </div>
            <div className="tl-tracks">
              {TRACKS.map(([id]) => (
                <div key={id} className="tl-track" data-track={id}>
                  {items.filter((i) => i.track === id).map((c) => (
                    <div
                      key={c.id} className={`clip ${sel === c.id ? "sel" : ""}`} data-track={id}
                      style={{ left: c.start * zoom, width: Math.max(8, c.duration * zoom) }}
                      onPointerDown={(e) => startDrag(e, c, "move")}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="trim l" onPointerDown={(e) => startDrag(e, c, "l")} />
                      {c.name}
                      <span className="trim r" onPointerDown={(e) => startDrag(e, c, "r")} />
                    </div>
                  ))}
                </div>
              ))}
              <div className="playhead" style={{ left: t * zoom }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════ Export ═══════════════
function ExportModal({ project, items, assetsById, captionStyles, onClose }) {
  const toast = useToast();
  const [kind, setKind] = useState("video");
  const [resolution, setResolution] = useState("1080p");
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState(0);

  const serverExport = async () => {
    setBusy(true); setJob(null);
    try {
      const { job: j } = await api("/api/exports", { method: "POST", body: { projectId: project.id, kind, resolution, fps } });
      const tick = async () => {
        const { job: cur } = await api(`/api/exports/${j.id}`);
        setJob(cur);
        if (["completed", "failed"].includes(cur.status)) { setBusy(false); return; }
        setTimeout(tick, 2000);
      };
      setTimeout(tick, 1500);
    } catch (e) {
      toast.push(e.message, "err");
      setBusy(false);
    }
  };

  const browserExport = async () => {
    setBusy(true); setProgress(0);
    try {
      const { blob, mime, width, height } = await browserRender({
        project, items, assetsById, captionStyles, fps,
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.title.replace(/[^a-z0-9]+/gi, "-")}-${width}x${height}.${mime.includes("mp4") ? "mp4" : "webm"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      toast.push("Browser render complete — file downloaded.");
    } catch (e) {
      toast.push(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  const downloadOutputs = async () => {
    try {
      if (job?.result?.srtAssetId) {
        await downloadAsset(job.result.srtAssetId, "captions.srt");
        await downloadAsset(job.result.vttAssetId, "captions.vtt");
      } else if (job?.outputAssetId) {
        await downloadAsset(job.outputAssetId, `export.${kind === "audio" ? "m4a" : kind === "manifest" ? "json" : "mp4"}`);
      }
    } catch (e) { toast.push(e.message, "err"); }
  };

  return (
    <Modal title="⬆ Export" onClose={onClose}>
      <div className="grid3">
        <Field label="Kind">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="video">Video (MP4)</option>
            <option value="audio">Audio (M4A)</option>
            <option value="captions">Captions (SRT+VTT)</option>
            <option value="manifest">Edit manifest (JSON)</option>
          </select>
        </Field>
        <Field label="Resolution">
          <select className="select" value={resolution} onChange={(e) => setResolution(e.target.value)} disabled={kind !== "video"}>
            {["720p", "1080p", "4K"].map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Frame rate">
          <select className="select" value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={kind !== "video"}>
            {[24, 30, 60].map((f) => <option key={f} value={f}>{f} FPS</option>)}
          </select>
        </Field>
      </div>

      {job && (
        <div className="job-card">
          <div className="spread"><StatusBadge status={job.status === "running" ? "running" : job.status} /><span className="tiny">{job.progress}%</span></div>
          {job.status === "running" && <div className="progress mt"><div style={{ width: `${job.progress}%` }} /></div>}
          {job.status === "failed" && <div className="err-box mt">{job.error}</div>}
          {job.status === "completed" && <div className="ok-box mt">✓ Export complete. <button className="btn sm mt" onClick={downloadOutputs}>⬇ Download files</button></div>}
          {job.logs?.length > 0 && <div className="job-log">{job.logs.slice(-8).join("\n")}</div>}
        </div>
      )}

      <div className="row wrap mt">
        <button className="btn primary" disabled={busy} onClick={serverExport}>{busy ? "Exporting…" : "⬆ Server export"}</button>
        {kind === "video" && <button className="btn" disabled={busy} onClick={browserExport}>🖥 Browser render (this device)</button>}
      </div>
      {busy && kind === "video" && progress > 0 && <div className="progress mt"><div style={{ width: `${progress}%` }} /></div>}
      <div className="tiny muted mt">
        Server video export needs an ffmpeg worker — if it's missing you'll get the real reason, and Browser render (a genuine real-time render on your device) as the fallback. Captions + manifest always work.
      </div>
    </Modal>
  );
}
