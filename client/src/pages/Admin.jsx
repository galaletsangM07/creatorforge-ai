// ─── CreatorForge AI · Admin panel ─────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, useToast, fmtAgo } from "../lib/api";
import { Layout, StatusBadge, Modal, Field, Empty } from "../components/ui";

export default function Admin() {
  const toast = useToast();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [voices, setVoices] = useState([]);

  const load = async () => {
    try {
      const o = await api("/api/admin/overview");
      setOverview(o);
      const u = await api("/api/admin/users");
      setUsers(u.users);
      const j = await api("/api/admin/jobs");
      setJobs(j.jobs.slice(0, 40));
      const p = await api("/api/admin/projects");
      setProjects(p.projects.slice(0, 40));
      const t = await api("/api/admin/templates");
      setTemplates(t.templates);
      const v = await api("/api/admin/voices");
      setVoices(v.voices);
    } catch (e) {
      toast.push(e.message, "err");
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRole = async (u, role) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role } });
      toast.push(`${u.name} is now ${role}.`);
      load();
    } catch (e) { toast.push(e.message, "err"); }
  };

  return (
    <Layout title="Admin Panel" sub="Users, jobs, providers, templates and system health.">
      <div className="tabs">
        {[["overview", "🛡 Overview"], ["users", "👥 Users"], ["jobs", "⚙ Jobs"], ["projects", "📁 Projects"], ["templates", "▦ Templates"], ["voices", "🎙 Voices"]].map(([id, label]) => (
          <div key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</div>
        ))}
      </div>

      {tab === "overview" && overview && (
        <>
          <div className="grid2">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>System health</h3>
              <dl className="kv">
                <dt>ffmpeg</dt><dd>{overview.health.ffmpeg.includes("NOT") ? <span className="badge warn">{overview.health.ffmpeg}</span> : <span className="badge ok">{overview.health.ffmpeg}</span>}</dd>
                <dt>Storage</dt><dd>{overview.health.storageMB} MB</dd>
                <dt>Uptime</dt><dd>{Math.round(overview.health.uptimeSec / 60)} min</dd>
                <dt>Node</dt><dd>{overview.health.node}</dd>
              </dl>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Totals</h3>
              <dl className="kv">
                <dt>Users</dt><dd>{overview.counts.users}</dd>
                <dt>Projects</dt><dd>{overview.counts.projects}</dd>
                <dt>Assets</dt><dd>{overview.counts.assets}</dd>
                <dt>Generations</dt><dd>{overview.counts.generations}</dd>
                <dt>Templates</dt><dd>{overview.counts.templates}</dd>
                <dt>Exports</dt><dd>{overview.counts.exports}</dd>
              </dl>
            </div>
          </div>
          <div className="card mt">
            <h3 style={{ marginTop: 0 }}>Jobs by status</h3>
            <div className="row wrap">
              {Object.entries(overview.generationsByStatus).map(([s, n]) => (
                <span key={s} className="badge">{s}: {n}</span>
              ))}
            </div>
          </div>
          <div className="card mt">
            <div className="spread"><h3 style={{ margin: 0 }}>Providers</h3><Link className="btn sm" to="/settings?tab=providers">Manage →</Link></div>
            <div className="chip-row mt">
              {overview.providers.map((p) => (
                <span key={p.id} className={`badge ${p.enabled === false ? "err" : p.hasKey ? "ok" : "warn"}`}>
                  {p.name} · {p.hasKey ? "key set" : "no key"}{p.enabled === false ? " · disabled" : ""}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "users" && (
        <div className="card">
          <table className="table">
            <thead><tr><th>User</th><th>Role</th><th>Projects</th><th>Generations</th><th>Joined</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong><div className="tiny muted">{u.email}</div></td>
                  <td><span className={`badge ${u.role === "admin" ? "vip" : ""}`}>{u.role}</span></td>
                  <td>{u.projects}</td>
                  <td>{u.generations}</td>
                  <td className="tiny">{fmtAgo(u.createdAt)}</td>
                  <td>
                    {u.role === "admin"
                      ? <button className="btn sm" onClick={() => setRole(u, "user")}>Demote</button>
                      : <button className="btn sm" onClick={() => setRole(u, "admin")}>Make admin</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "jobs" && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Status</th><th>Type</th><th>Provider</th><th>Error</th><th>Created</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td><StatusBadge status={j.status} /></td>
                  <td>{j.type}</td>
                  <td className="small">{j.providerName}</td>
                  <td className="tiny" style={{ maxWidth: 320 }}>{j.error || "—"}</td>
                  <td className="tiny">{fmtAgo(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length === 0 && <Empty em="⚙" title="No jobs" text="Generation jobs across all users appear here." />}
        </div>
      )}

      {tab === "projects" && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Title</th><th>Format</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><strong className="small">{p.title}</strong>{p.sample && <span className="badge warn"> sample</span>}</td>
                  <td className="tiny">{p.aspectRatio} · {p.duration}s</td>
                  <td><span className="badge">{p.status}</span></td>
                  <td className="tiny">{fmtAgo(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "templates" && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Title</th><th>Category</th><th>Uses</th><th></th></tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td><strong className="small">{t.title}</strong></td>
                  <td>{t.category}</td>
                  <td>{t.downloads || 0}</td>
                  <td><button className="btn sm danger" onClick={async () => {
                    if (!confirm("Delete template?")) return;
                    try { await api(`/api/admin/templates/${t.id}`, { method: "DELETE" }); toast.push("Deleted."); load(); }
                    catch (e) { toast.push(e.message, "err"); }
                  }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "voices" && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Name</th><th>Profile</th><th>Provider</th><th></th></tr></thead>
            <tbody>
              {voices.map((v) => (
                <tr key={v.id}>
                  <td><strong className="small">{v.name}</strong></td>
                  <td className="tiny">{v.gender} · {v.accent} · {v.styles?.join("/")}</td>
                  <td className="tiny">{v.provider}{v.providerVoiceId ? ` · ${v.providerVoiceId.slice(0, 12)}…` : ""}</td>
                  <td>
                    <button className="btn sm" onClick={async () => {
                      try { await api(`/api/admin/voices/${v.id}`, { method: "PATCH", body: { enabled: !v.enabled } }); load(); }
                      catch (e) { toast.push(e.message, "err"); }
                    }}>{v.enabled === false ? "Enable" : "Disable"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
