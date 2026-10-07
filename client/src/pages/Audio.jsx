// ─── CreatorForge AI · Music & SFX library ─────────────────────────────────
import React, { useEffect, useState } from "react";
import { api, useToast, fmtTime } from "../lib/api";
import { Layout, Empty, Modal, Field } from "../components/ui";
import { AuthedAudio } from "./Studio";

export default function Audio() {
  const toast = useToast();
  const [tracks, setTracks] = useState([]);
  const [cat, setCat] = useState("all");
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("My Uploads");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api("/api/music").then((d) => setTracks(d.tracks)).catch((e) => toast.push(e.message, "err")).finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = ["all", ...new Set(tracks.map((t) => t.category))];
  const shown = tracks.filter((t) => cat === "all" || t.category === cat);

  const upload = async () => {
    if (!file) { toast.push("Choose an audio file first.", "warn"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title || file.name);
      fd.append("category", category);
      await api("/api/music", { method: "POST", form: fd });
      toast.push("Track uploaded — licensing stays with you as the uploader.");
      setUploadOpen(false);
      setFile(null); setTitle("");
      load();
    } catch (e) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };

  const remove = async (t) => {
    if (!confirm(`Remove "${t.title}" from the library?`)) return;
    try {
      await api(`/api/music/${t.id}`, { method: "DELETE" });
      toast.push("Removed.");
      load();
    } catch (e) { toast.push(e.message, "err"); }
  };

  return (
    <Layout
      title="Audio"
      sub="Motivational → Ambient, plus SFX. Stock is 100% original & royalty-free."
      actions={<button className="btn primary sm" onClick={() => setUploadOpen(true)}>⬆ Upload music</button>}
    >
      <div className="info-box mb">
        🎵 CreatorForge ships <strong>zero copyrighted music</strong>. Built-in tracks are originals composed in code (royalty-free).
        Upload your own licensed tracks anytime — you keep full responsibility for their licenses.
      </div>
      <div className="chip-row mb">
        {cats.map((c) => <button key={c} className={`chip ${cat === c ? "sel" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {loading ? (
        <div className="card"><span className="spinner" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="card"><Empty em="♪" title="No tracks here" text="Upload your own music to fill this shelf." /></div>
      ) : (
        <div className="grid2">
          {shown.map((t) => (
            <div key={t.id} className="card" style={{ padding: 14 }}>
              <div className="spread">
                <strong className="small">{t.title}</strong>
                <span className="badge">{t.category}</span>
              </div>
              <div className="tiny muted">{t.artist} · {fmtTime(t.duration)} · {t.license}</div>
              {t.assetId && <AuthedAudio asset={{ id: t.assetId }} />}
              {!t.stock && <button className="btn sm ghost mt" onClick={() => remove(t)}>Remove</button>}
            </div>
          ))}
        </div>
      )}

      {uploadOpen && (
        <Modal title="Upload music" onClose={() => setUploadOpen(false)}>
          <Field label="Audio file (mp3/wav/ogg)">
            <input type="file" accept="audio/*" onChange={(e) => { setFile(e.target.files[0]); if (e.target.files[0] && !title) setTitle(e.target.files[0].name.replace(/\.[^.]+$/, "")); }} />
          </Field>
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Category">
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {["My Uploads", "Motivational", "Cinematic", "Hip-hop", "Afrobeats", "Electronic", "Corporate", "Emotional", "Suspense", "Gaming", "Ambient", "SFX"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <div className="tiny muted mb">By uploading you confirm you have the rights to use this audio in your videos.</div>
          <button className="btn primary block" disabled={busy} onClick={upload}>{busy ? "Uploading…" : "Upload track"}</button>
        </Modal>
      )}
    </Layout>
  );
}
