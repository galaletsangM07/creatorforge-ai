// ─── CreatorForge AI · Dashboard ───────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useAuth, useToast } from "../lib/api";
import { Layout, ProjectCard, Empty } from "../components/ui";

const SHORTCUTS = [
  { to: "/create?from=script", em: "📝", t: "Create from Script", d: "Script → scenes → video" },
  { to: "/create?from=prompt", em: "✦", t: "Create from Prompt", d: "One idea → first cut" },
  { to: "/create?from=images", em: "🖼", t: "Create from Images", d: "Uploads → slideshow" },
  { to: "/create?from=video", em: "🎬", t: "Create from Video", d: "Import & remix" },
];

const TOOLS = [
  { to: "/create", em: "🎥", t: "AI Video Generator", d: "Prompt → video" },
  { to: "/studio/script", em: "📝", t: "Script to Video", d: "AI scene planner" },
  { to: "/studio/image", em: "🖼", t: "Text to Image", d: "14 styles" },
  { to: "/studio/voice", em: "🎙", t: "AI Voiceover", d: "Neural voices" },
  { to: "/templates", em: "▦", t: "Templates", d: "12 starters" },
  { to: "/audio", em: "♪", t: "Music & SFX", d: "Royalty-free" },
  { to: "/assets", em: "🗂", t: "Assets", d: "Your library" },
  { to: "/settings?tab=usage", em: "📊", t: "Usage", d: "Quotas & jobs" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/projects?view=all").then((d) => setProjects(d.projects)).catch((e) => toast.push(e.message, "err")).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recent = projects.slice(0, 8);
  const drafts = projects.filter((p) => p.status === "draft" && !p.sample).length;

  return (
    <Layout
      title={`Welcome back, ${user?.name?.split(" ")[0] || "Creator"}`}
      sub="Turn an idea into a video."
      actions={<Link className="btn primary" to="/create">+ Create New Video</Link>}
    >
      <div className="hero-banner">
        <h2>What are we forging today?</h2>
        <p>Describe your video — CreatorForge AI builds the first version with script, scenes, visuals, voice and captions. You edit it. You export it.</p>
        <div className="row wrap">
          <Link className="btn primary big" to="/create">+ Create New Video</Link>
          <Link className="btn big" to="/templates">Explore Templates</Link>
        </div>
      </div>

      <div className="panel-title"><h2>✦ AI shortcuts</h2></div>
      <div className="tool-grid mb" style={{ marginBottom: 22 }}>
        {SHORTCUTS.map((s) => (
          <Link key={s.t} className="tool-card" to={s.to}>
            <span className="em">{s.em}</span>
            <div className="t">{s.t}</div>
            <div className="d">{s.d}</div>
          </Link>
        ))}
      </div>

      <div className="panel-title"><h2>Studio tools</h2></div>
      <div className="tool-grid" style={{ marginBottom: 26 }}>
        {TOOLS.map((s) => (
          <Link key={s.t} className="tool-card" to={s.to}>
            <span className="em">{s.em}</span>
            <div className="t">{s.t}</div>
            <div className="d">{s.d}</div>
          </Link>
        ))}
      </div>

      <div className="panel-title">
        <h2>Recent projects {drafts > 0 && <span className="badge">{drafts} draft{drafts > 1 ? "s" : ""}</span>}</h2>
        <Link className="btn sm ghost" to="/projects">View all →</Link>
      </div>
      {loading ? (
        <div className="card"><span className="spinner" /> Loading projects…</div>
      ) : recent.length === 0 ? (
        <div className="card">
          <Empty em="🎞" title="No projects yet" text="Create your first video — start from a prompt, a script, images or a template." action={<Link className="btn primary" to="/create">+ Create New Video</Link>} />
        </div>
      ) : (
        <div className="proj-grid">
          {recent.map((p) => (
            <ProjectCard key={p.id} p={p} onOpen={() => nav(`/editor/${p.id}`)} />
          ))}
        </div>
      )}
    </Layout>
  );
}
