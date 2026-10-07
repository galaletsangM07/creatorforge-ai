// ─── CreatorForge AI · Template library ────────────────────────────────────
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, useToast, fmtTime } from "../lib/api";
import { Layout, Empty, Modal } from "../components/ui";

export default function Templates() {
  const toast = useToast();
  const nav = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [cat, setCat] = useState("all");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/templates").then((d) => setTemplates(d.templates)).catch((e) => toast.push(e.message, "err")).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cats = ["all", ...new Set(templates.map((t) => t.category))];
  const shown = templates.filter((t) => cat === "all" || t.category === cat);

  const useTemplate = async (tpl) => {
    setBusy(true);
    try {
      const { project } = await api(`/api/templates/${tpl.id}/use`, { method: "POST" });
      toast.push(`Project created from "${tpl.title}".`);
      nav(`/editor/${project.id}`);
    } catch (e) {
      toast.push(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title="Templates" sub="One click → a real timeline, scenes, captions and style.">
      <div className="chip-row mb">
        {cats.map((c) => <button key={c} className={`chip ${cat === c ? "sel" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {loading ? (
        <div className="card"><span className="spinner" /> Loading templates…</div>
      ) : shown.length === 0 ? (
        <div className="card"><Empty em="▦" title="No templates here" text="Try another category." /></div>
      ) : (
        <div className="proj-grid">
          {shown.map((t) => (
            <div key={t.id} className="proj-card" onClick={() => setPreview(t)}>
              <div className="proj-thumb" style={{ background: t.gradient || "var(--grad-soft)" }}>
                <span style={{ fontSize: 34 }}>▦</span>
                <span className="ar">{t.aspectRatio}</span>
                <span className="dur">{fmtTime(t.duration)}</span>
              </div>
              <div className="proj-body">
                <div className="t">{t.title}</div>
                <div className="m">{t.category} · {t.data?.scenes?.length || 0} scenes · {t.downloads || 0} uses</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)}>
          <p className="muted small">{preview.description}</p>
          <div className="row wrap mb">
            <span className="badge">{preview.category}</span>
            <span className="badge">{preview.aspectRatio}</span>
            <span className="badge">{fmtTime(preview.duration)}</span>
            <span className="badge vip">captions: {preview.captionStyle}</span>
          </div>
          <h4>Scene structure</h4>
          {(preview.data?.scenes || []).map((s, i) => (
            <div key={i} className="job-card" style={{ padding: 10 }}>
              <strong className="small">{i + 1}. {s.title}</strong>
              <div className="tiny muted">{s.script?.slice(0, 140)}</div>
            </div>
          ))}
          <button className="btn primary block big mt" disabled={busy} onClick={() => useTemplate(preview)}>
            {busy ? "Creating…" : "Use Template →"}
          </button>
          <div className="tiny muted mt">Creates a full project: timeline, text, caption style and scene structure. Music is left empty for your own licensed tracks.</div>
        </Modal>
      )}
    </Layout>
  );
}
