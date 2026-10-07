// ─── CreatorForge AI · Auth pages ──────────────────────────────────────────
import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth, api, useToast } from "../lib/api";
import { Field } from "../components/ui";

function Shell({ title, sub, children, alt }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link to="/" className="brand">
          <img src="/logo.svg" alt="CreatorForge AI" />
          <div>
            <div className="bt">Creator<span>Forge</span> AI</div>
            <div className="tag">Turn an idea into a video.</div>
          </div>
        </Link>
        <h2>{title}</h2>
        <div className="sub">{sub}</div>
        {children}
        <div className="auth-alt">{alt}</div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await login(email.trim(), password);
      nav(loc.state?.from || "/dashboard");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Welcome back" sub="Log in to your studio." alt={<>New here? <Link to="/signup">Create an account</Link></>}>
      <form onSubmit={submit}>
        {err && <div className="err-box mb">{err}</div>}
        <Field label="Email">
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </Field>
        <Field label="Password">
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </Field>
        <button className="btn primary block" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        <div className="auth-alt"><Link to="/reset">Forgot password?</Link></div>
      </form>
    </Shell>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await signup(name.trim(), email.trim(), password);
      nav("/dashboard");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Create your studio" sub="Free to start. Your projects stay yours." alt={<>Have an account? <Link to="/login">Log in</Link></>}>
      <form onSubmit={submit}>
        {err && <div className="err-box mb">{err}</div>}
        <Field label="Your name">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Creator name" autoComplete="name" />
        </Field>
        <Field label="Email">
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </Field>
        <button className="btn primary block" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
    </Shell>
  );
}

export function Reset() {
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const request = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api("/api/auth/reset-request", { method: "POST", body: { email: email.trim() } });
      if (r.devResetToken) {
        setToken(r.devResetToken);
        toast.push("Reset token generated (dev mode).");
      } else {
        toast.push("If that email exists, a reset was issued.");
      }
      setStep(2);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await api("/api/auth/reset-confirm", { method: "POST", body: { token: token.trim(), password } });
      toast.push("Password updated — log in now.");
      nav("/login");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Reset password" sub="We'll get you back in." alt={<Link to="/login">Back to login</Link>}>
      {err && <div className="err-box mb">{err}</div>}
      {step === 1 ? (
        <form onSubmit={request}>
          <Field label="Account email">
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <button className="btn primary block" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      ) : (
        <form onSubmit={confirm}>
          <Field label="Reset token" hint="Pasted automatically in dev mode.">
            <input className="input" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="token" />
          </Field>
          <Field label="New password">
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <button className="btn primary block" disabled={busy}>{busy ? "Updating…" : "Set new password"}</button>
        </form>
      )}
    </Shell>
  );
}
