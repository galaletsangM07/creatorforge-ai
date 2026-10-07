// ─── CreatorForge AI · Shared UI components ────────────────────────────────
import React, { useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth, fmtAgo, fmtTime, useJobPoll, api, useToast } from "../lib/api";

const NAV = [
  { to: "/dashboard", label: "Dashboard", ico: "◈" },
  { to: "/create", label: "Create", ico: "✦" },
  { to: "/studio/video", label: "AI Video", ico: "🎬" },
  { to: "/templates", label: "Templates", ico: "▦" },
  { to: "/assets", label: "Assets", ico: "🗂" },
  { to: "/projects", label: "Projects", ico: "📁" },
  { to: "/audio", label: "Audio", ico: "♪" },
  { to: "/settings", label: "Settings", ico: "⚙" },
];

const MOBILE_NAV = [
  { to: "/dashboard", label: "Home", ico: "◈" },
  { to: "/create", label: "Create", ico: "✦" },
  { to: "/projects", label: "Projects", ico: "📁" },
  { to: "/templates", label: "Templates", ico: "▦" },
  { to: "/settings", label: "Profile", ico: "⚙" },
];

export function Layout({ title, sub, actions, children, wide }) {
  const { user, logout, isAdmin } = useAuth();
  const [sideOpen, setSideOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div className="shell">
      <aside className={`sidebar ${sideOpen ? "open" : ""}`}>
        <Link to="/dashboard" className="brand" onClick={() => setSideOpen(false)}>
          <img src="/logo.svg" alt="CreatorForge AI" />
          <div>
            <div className="bt">Creator<span>Forge</span> AI</div>
            <div className="tag">Turn an idea into a video.</div>
          </div>
        </Link>
        <div className="nav-label">Studio</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setSideOpen(false)}>
            <span className="ico">{n.ico}</span> {n.label}
          </NavLink>
        ))}
        {isAdmin && (
          <>
            <div className="nav-label">Admin</div>
            <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setSideOpen(false)}>
              <span className="ico">🛡</span> Admin Panel
            </NavLink>
          </>
        )}
        <div className="side-foot">
          <div className="row">
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: user?.avatarColor || "#7c5cff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 }}>
              {(user?.name || "U")[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.name}</div>
              <div className="tiny">{user?.role}</div>
            </div>
          </div>
          <button className="btn ghost sm mt" onClick={async () => { await logout(); nav("/"); }}>Log out</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <button className="btn sm menu-btn" onClick={() => setSideOpen(!sideOpen)}>☰</button>
          <div>
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <div className="top-spacer" />
          {actions}
        </div>
        <div className={`content ${wide ? "wide" : ""}`}>{children}</div>
      </div>

      <nav className="mobile-nav">
        {MOBILE_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
            <span className="em">{n.ico}</span>{n.label}
          </NavLink>
        ))}
      </nav>
      {sideOpen && <div className="modal-bg" style={{ background: "transparent" }} onClick={() => setSideOpen(false)} />}
    </div>
  );
}

export function Empty({ em = "◌", title = "Nothing here yet", text, action }) {
  return (
    <div className="empty">
      <span className="em">{em}</span>
      <h3 style={{ margin: "0 0 6px" }}>{title}</h3>
      {text && <p className="small muted" style={{ maxWidth: 420, margin: "0 auto 14px" }}>{text}</p>}
      {action}
    </div>
  );
}

export function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="spread mb">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    queued: ["warn", "Queued"], running: ["info", "● Generating"], generating: ["info", "● Generating"],
    completed: ["ok", "✓ Completed"], failed: ["err", "✕ Failed"], cancelled: ["", "Cancelled"],
    draft: ["", "Draft"], ready: ["ok", "Ready"], rendered: ["vip", "Rendered"],
  };
  const [cls, label] = map[status] || ["", status];
  return <span className={`badge ${cls} ${status === "running" ? "pulse" : ""}`}>{label}</span>;
}

export function ProjectCard({ p, onOpen, onFav, onTrash, onMenu }) {
  return (
    <div className="proj-card" onClick={onOpen}>
      <div className="proj-thumb" style={{ background: p.thumbnail || "linear-gradient(135deg,#1b2a4a,#0d1422)" }}>
        {!p.thumbnail && <span>🎞</span>}
        <span className="ar">{p.aspectRatio}</span>
        <span className="dur">{fmtTime(p.duration)}</span>
      </div>
      <div className="proj-body">
        <div className="t">{p.sample ? "★ " : ""}{p.title}</div>
        <div className="m">Edited {fmtAgo(p.updatedAt)} {p.sample ? "· SAMPLE" : ""}</div>
      </div>
    </div>
  );
}

// Live generation job card: polls, shows progress/logs, offers actions.
export function JobCard({ job: initial, onDone, compact }) {
  const live = useJobPoll(initial.id, onDone);
  const job = live || initial;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const terminal = ["completed", "failed", "cancelled"].includes(job.status);

  const act = async (action) => {
    setBusy(true);
    try {
      await api(`/api/generations/${job.id}/${action}`, { method: "POST" });
      toast.push(action === "cancel" ? "Generation cancelled." : "Generation re-queued.");
      if (action === "retry") window.location.reload();
    } catch (e) {
      toast.push(e.message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="job-card">
      <div className="spread">
        <div className="row wrap">
          <StatusBadge status={job.status} />
          <strong className="small">{job.type}</strong>
          <span className="tiny">via {job.providerName || "—"}</span>
        </div>
        <span className="tiny">{fmtAgo(job.createdAt)}</span>
      </div>
      {!terminal && <div className="progress mt"><div style={{ width: `${job.progress || 5}%` }} /></div>}
      {job.status === "failed" && (
        <div className="err-box mt">
          <strong>Generation failed.</strong> {job.error || "Unknown error."}
          <div className="row wrap mt">
            <button className="btn sm" disabled={busy} onClick={() => act("retry")}>↻ Retry</button>
            <Link className="btn sm" to="/settings?tab=providers">Change provider</Link>
          </div>
        </div>
      )}
      {job.status === "completed" && job.resultAssetIds?.length > 0 && (
        <div className="ok-box mt">✓ {job.resultAssetIds.length} asset{job.resultAssetIds.length > 1 ? "s" : ""} saved to your library.</div>
      )}
      {!compact && job.logs?.length > 0 && (
        <div className="job-log">{job.logs.slice(-12).join("\n")}</div>
      )}
      {!terminal && (
        <div className="row mt">
          <button className="btn sm danger" disabled={busy} onClick={() => act("cancel")}>Cancel</button>
        </div>
      )}
    </div>
  );
}

export function ProviderHint({ error }) {
  if (!error) return null;
  const needsProvider = error.hint === "open-providers" || /provider/i.test(error.message || "");
  return (
    <div className="err-box">
      {error.message}
      {needsProvider && (
        <div className="mt"><Link className="btn sm" to="/settings?tab=providers">Open Settings → Providers</Link></div>
      )}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
