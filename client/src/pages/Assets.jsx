// ─── CreatorForge AI · Asset library ───────────────────────────────────────
import React, { useEffect, useState } from "react";
import { api, useToast, fmtBytes, fmtAgo, downloadAsset } from "../lib/api";
import { Layout, Empty, Modal, Field } from "../components/ui";
import { AuthedImg, AuthedVideo, AuthedAudio } from "./Studio";

export default function Assets() {
  const toast = useToast();
  const [assets, setAssets] = useState([]);
  const [kind, setKind] = useState("all");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState(null);

  const load = () => {
    api("/api/assets").then((d) => setAssets(d.assets)).catch((e) => toast.push(e.message, "err")).finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      [...files].slice(0, 10).forEach((f) => fd.append("files", f));
      await api("/api/assets", { method: "POST", form: fd });
      toast.push("Uploaded.");
      load();
    } catch (e) { toast.push(e.message, "err"); } finally { setUploading(false); }
  };

  const remove = async (a) => {
    if (!confirm(`Delete "${a.name}"? Timelines using it will keep their edits with a placeholder.`)) return;
    try {
      await api(`/api/assets/${a.id}`, { method: "DELETE" });
      toast.push("Deleted.");
      setView(null);
      load();
    } catch (e) { toast.push(e.message, "err"); }
  };

  const shown = assets.filter((a) => kind === "all" || a.kind === kind);
  const kinds = [["all", "All"], ["video", "Video"], ["image", "Image"], ["audio", "Audio"], ["other", "Files"]];

  return (
    <Layout
      title="Assets"
      sub="Private to your account. Served only after an ownership check."
      actions={
        <label className="btn primary sm" style={{ cursor: "pointer" }}>
          {uploading ? "Uploading…" : "⬆ Upload"}
          <input type="file" multiple hidden accept="video/*,image/*,audio/*,.srt,.vtt,.txt,.json" onChange={(e) => upload(e.target.files)} />
        </label>
      }
    >
      <div className="chip-row mb">
        {kinds.map(([id, l]) => <button key={id} className={`chip ${kind === id ? "sel" : ""}`} onClick={() => setKind(id)}>{l}</button>)}
      </div>
      {loading ? (
        <div className="card"><span className="spinner" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="card"><Empty em="🗂" title="No assets yet" text="Upload media or generate with AI — everything lands here, privately." /></div>
      ) : (
        <div className="img-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
          {shown.map((a) => (
            <div key={a.id} className="img-cell" style={{ cursor: "pointer" }} onClick={() => setView(a)}>
              {a.kind === "image" && <AuthedImg asset={a} />}
              {a.kind !== "image" && (
                <div style={{ aspectRatio: "16/10", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 12 }}>
                  <span style={{ fontSize: 34 }}>{a.kind === "video" ? "🎬" : a.kind === "audio" ? "♪" : "📄"}</span>
                  <div className="tiny" style={{ textAlign: "center", wordBreak: "break-word" }}>{a.name}</div>
                </div>
              )}
              <div className="acts" style={{ position: "static", background: "#0d1422", padding: 8 }}>
                <span className="tiny" style={{ flex: 1 }}>{fmtBytes(a.size)} · {fmtAgo(a.createdAt)}</span>
                {a.jobId && <span className="badge vip">AI</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {view && (
        <Modal title={view.name} onClose={() => setView(null)}>
          <div className="tiny muted mb">{view.kind} · {fmtBytes(view.size)} · {view.mime}{view.meta?.provider ? ` · via ${view.meta.provider}` : ""}</div>
          {view.kind === "image" && <AuthedImg asset={view} />}
          {view.kind === "video" && <AuthedVideo asset={view} />}
          {view.kind === "audio" && <AuthedAudio asset={view} />}
          <div className="row wrap mt">
            <button className="btn sm" onClick={() => downloadAsset(view.id, view.name).catch((e) => toast.push(e.message, "err"))}>⬇ Download</button>
            <button className="btn sm danger" onClick={() => remove(view)}>🗑 Delete</button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
