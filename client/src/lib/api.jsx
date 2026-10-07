// ─── CreatorForge AI · API client + auth context ─────────────────────────────
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const TOKEN_KEY = "cf_token";

// Deployment: point the web app at any backend with VITE_API_URL.
// • Same-origin (dev proxy / single-service hosting): leave empty → relative "/api"
// • Split hosting (Vercel frontend + Render backend): VITE_API_URL=https://your-api.onrender.com
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export async function api(path, { method = "GET", body, form, token } = {}) {
  const headers = {};
  const t = token || getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const opts = { method, headers };
  if (form) opts.body = form; // FormData — browser sets content-type
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + path, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    err.hint = data?.hint;
    err.provider = data?.provider;
    throw err;
  }
  return data;
}

export const mediaUrl = (assetId) => `/api/assets/${assetId}/file`;

// ─── Auth ────────────────────────────────────────────────────────────────
const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return null; }
    try {
      const { user } = await api("/api/auth/me");
      setUser(user);
      return user;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh ]);

  const login = async (email, password) => {
    const data = await api("/api/auth/login", { method: "POST", body: { email, password } });
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  };

  const signup = async (name, email, password) => {
    const data = await api("/api/auth/signup", { method: "POST", body: { name, email, password } });
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, signup, logout, refresh, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

// ─── Toasts ──────────────────────────────────────────────────────────────
const ToastCtx = createContext(null);
let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = "ok") => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "ok" ? "" : t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ─── Helpers ─────────────────────────────────────────────────────────────
export const fmtTime = (s) => {
  s = Math.max(0, Number(s) || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

export const fmtClock = (s) => {
  s = Math.max(0, Number(s) || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${ms}`;
};

export const fmtAgo = (iso) => {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
};

export const fmtBytes = (b) => {
  b = Number(b) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${Math.round((b / 1024 / 1024) * 10) / 10} MB`;
};

export function downloadUrl(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Authenticated download (assets are NOT public — attach the token).
export async function downloadAsset(assetId, filename) {
  const t = getToken();
  const res = await fetch(mediaUrl(assetId), { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error("Download failed.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Job polling hook — polls a generation until terminal state.
export function useJobPoll(jobId, onDone) {
  const [job, setJob] = useState(null);
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      try {
        const { job } = await api(`/api/generations/${jobId}`);
        if (!alive) return;
        setJob(job);
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          onDone?.(job);
          return;
        }
        setTimeout(tick, 2000);
      } catch {
        if (alive) setTimeout(tick, 4000);
      }
    };
    tick();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  return job;
}

export const VIDEO_TYPES = ["TikTok", "YouTube Shorts", "Instagram Reels", "YouTube", "Facebook", "Advertisement", "Story", "Educational", "Motivational", "Faceless video", "Documentary", "News", "Product promotion"];
export const ASPECTS = ["9:16", "16:9", "1:1", "4:5"];
export const DURATIONS = [15, 30, 60, 180, 300];
export const STYLES = ["Cinematic", "Realistic", "Anime", "Cartoon", "3D", "Documentary", "News", "Luxury", "Minimal", "Gaming", "Motivational", "Futuristic", "Social Media", "Corporate"];
export const CAMERAS = ["Static", "Slow Zoom", "Pan", "Tilt", "Tracking", "Handheld", "Cinematic", "Drone", "Close-up"];
