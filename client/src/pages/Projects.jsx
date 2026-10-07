// ─── CreatorForge AI · Project management ──────────────────────────────────
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useToast } from "../lib/api";
import { Layout, ProjectCard, Empty, Modal, Field } from "../components/ui";

const VIEWS = [["all", "All"], ["drafts", "Drafts"], ["completed", "Completed"], ["favorites", "Favorites"], ["trash", "Trash"]];

export default function Projects() {
  const toast = useToast();
  const nav = useNavigate();
  const [view, setView] = useState("all");
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState(null); // project being managed
  const [rename, setRename] = useState("");

  const load = () => {
    setLoading(true);
    api(`/api/projects?view=${view}`).then((d) => setProjects(d.projects)).catch((e) => toast.push(e.message, "err")).finally(() => setLoading(false));
  };
  useEffect(load, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const doAction = async (action) => {
    if (!menu) return;
    try {
      if (action === "rename") {
        await api(`/api/projects/${menu.id}`, { method: "PATCH", body: { title: rename } });
        toast.push("Renamed.");
      } else if (action === "duplicate") {
        const { project } = await api(`/api/projects/${menu.id}/duplicate`, { method: "POST" });
        toast.push("Duplicated.");
        nav(`/editor/${project.id}`);
        return;
      } else if (action === "fav") {
        await api(`/api/projects/${menu.id}`, { method: "PATCH", body: { favorite: !menu.favorite } });
        toast.push(menu.favorite ? "Removed from favorites." : "Added to favorites.");
      } else if (action === "complete") {
        await api(`/api/projects/${menu.id}`, { method: "PATCH", body: { status: menu.status === "completed" ? "draft" : "completed" } });
        toast.push("Status updated.");
      } else if (action === "trash") {
        await api(`/api/projects/${menu.id}`, { method: "PATCH", body: { trashed: true } });
        toast.push("Moved to trash.");
      } else if (action === "restore") {
        await api(`/api/projects/${menu.id}`, { method: "PATCH", body: { trashed: false } });
        toast.push("Restored.");
      } else if (action === "delete") {
        await api(`/api/projects/${menu.id}?hard=1`, { method: "DELETE" });
        toast.push("Permanently deleted.");
      }
      setMenu(null);
      load();
    } catch (e) {
      toast.push(e.message, "err");
    }
  };

  return (
    <Layout
      title="Projects"
      sub="Drafts, completed work, favorites and trash."
      actions={<Link className="btn primary" to="/create">+ New Project</Link>}
    >
      <div className="tabs">
        {VIEWS.map(([id, label]) => (
          <div key={id} className={`tab ${view === id ? "active" : ""}`} onClick={() => setView(id)}>{label}</div>
        ))}
      </div>

      {loading ? (
        <div className="card"><span className="spinner" /> Loading…</div>
      ) : projects.length === 0 ? (
        <div className="card">
          <Empty em="📁" title={`No ${view} projects`} text={view === "trash" ? "Trash is empty. Deleted projects land here first." : "Start something new — it takes 30 seconds."} action={view !== "trash" && <Link className="btn primary" to="/create">+ New Project</Link>} />
        </div>
      ) : (
        <div className="proj-grid">
          {projects.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <ProjectCard p={p} onOpen={() => nav(`/editor/${p.id}`)} />
              <button
                className="btn sm"
                style={{ position: "absolute", top: 8, right: 8 }}
                onClick={(e) => { e.stopPropagation(); setMenu(p); setRename(p.title); }}
              >⋯</button>
            </div>
          ))}
        </div>
      )}

      {menu && (
        <Modal title={menu.title} onClose={() => setMenu(null)}>
          <Field label="Rename">
            <div className="row">
              <input className="input" value={rename} onChange={(e) => setRename(e.target.value)} />
              <button className="btn sm" onClick={() => doAction("rename")}>Save</button>
            </div>
          </Field>
          <div className="chip-row">
            <button className="chip" onClick={() => nav(`/editor/${menu.id}`)}>✎ Open in editor</button>
            <button className="chip" onClick={() => doAction("duplicate")}>⧉ Duplicate</button>
            <button className="chip" onClick={() => doAction("fav")}>{menu.favorite ? "☆ Unfavorite" : "★ Favorite"}</button>
            <button className="chip" onClick={() => doAction("complete")}>{menu.status === "completed" ? "↩ Mark as draft" : "✓ Mark completed"}</button>
            {view === "trash" ? (
              <>
                <button className="chip" onClick={() => doAction("restore")}>♻ Restore</button>
                <button className="chip" onClick={() => { if (confirm("Permanently delete this project? This cannot be undone.")) doAction("delete"); }}>🗑 Delete forever</button>
              </>
            ) : (
              <button className="chip" onClick={() => doAction("trash")}>🗑 Move to trash</button>
            )}
          </div>
          <div className="tiny mt">Created {new Date(menu.createdAt).toLocaleString()} · {menu.aspectRatio} · {menu.duration}s</div>
        </Modal>
      )}
    </Layout>
  );
}
