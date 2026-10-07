// ─── CreatorForge AI · Landing page ────────────────────────────────────────
import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/api";

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <nav className="l-nav">
        <Link to="/" className="brand">
          <img src="/logo.svg" alt="CreatorForge AI" />
          <div>
            <div className="bt">Creator<span>Forge</span> AI</div>
            <div className="tag">Turn an idea into a video.</div>
          </div>
        </Link>
        <div className="top-spacer" />
        {user ? (
          <Link className="btn primary" to="/dashboard">Open Studio →</Link>
        ) : (
          <div className="row">
            <Link className="btn ghost" to="/login">Log in</Link>
            <Link className="btn primary" to="/signup">Start Creating</Link>
          </div>
        )}
      </nav>

      <header className="hero">
        <span className="badge vip kicker">✦ AI VIDEO STUDIO + PRO EDITOR</span>
        <h1>Create Videos With AI. <span className="g">Edit Everything.</span> Publish Anywhere.</h1>
        <p>Turn scripts, ideas, images and prompts into complete videos with AI-powered creation and a professional editor.</p>
        <div className="hero-cta">
          <Link className="btn primary big" to={user ? "/create" : "/signup"}>Start Creating</Link>
          <Link className="btn big" to={user ? "/templates" : "/signup"}>Explore Templates</Link>
        </div>
        <div className="flow-strip">
          {["IDEA", "SCRIPT", "SCENES", "VISUALS", "VOICEOVER", "CAPTIONS", "MUSIC", "EXPORT"].map((s, i) => (
            <React.Fragment key={s}>
              <span className="badge">{s}</span>
              {i < 7 && <span className="tiny">→</span>}
            </React.Fragment>
          ))}
        </div>
      </header>

      <section className="feats">
        {[
          ["📝", "Script → Video", "Paste an idea, get timed scenes, B-roll direction, voiceover and captions on a real timeline."],
          ["🎙", "AI Voice", "Neural voiceovers with speed, pitch and emotion control — plus free instant browser previews."],
          ["🖼", "AI B-Roll", "Every sentence gets a suggested visual. Generate with your provider or swap in your own media."],
          ["💬", "Auto Captions", "Word-grouped animated captions in viral styles — TikTok Pop, Karaoke, Hormozi Punch and more."],
          ["🎨", "AI Images", "Generate scene art in 14 styles through any image provider you connect. No lock-in."],
          ["✂", "Professional Editor", "Multi-track timeline, text, effects, transitions, AI assistant and honest one-click export."],
        ].map(([em, t, d]) => (
          <div className="feat" key={t}>
            <span className="em">{em}</span>
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </section>

      <section className="howto">
        <h2 style={{ margin: 0 }}>From idea to published in four steps</h2>
        <p className="muted">Tell us what video you want. CreatorForge AI builds the first version. You edit it. You export it.</p>
        <div className="steps">
          {[
            ["Describe your video", "A sentence is enough. Pick type, ratio, duration and style."],
            ["Forge the first cut", "Script, scenes, visuals, voice and captions assemble on the timeline."],
            ["Edit like a pro", "Trim, caption, grade, remix — with an AI assistant inside the editor."],
            ["Export anywhere", "Captions, audio and video exports with real progress — no fake renders."],
          ].map(([t, d], i) => (
            <div className="step" key={t}>
              <div className="n">{i + 1}</div>
              <strong>{t}</strong>
              <p className="small muted" style={{ margin: "6px 0 0" }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="l-foot">
        CreatorForge AI · Turn an idea into a video. · Bring your own AI keys — free-first, no lock-in.
      </footer>
    </div>
  );
}
