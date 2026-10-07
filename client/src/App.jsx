// ─── CreatorForge AI · Router ──────────────────────────────────────────────
import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, ToastProvider, useAuth } from "./lib/api";
import Landing from "./pages/Landing";
import { Login, Signup, Reset } from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Create from "./pages/Create";
import Studio from "./pages/Studio";
import Editor from "./pages/Editor";
import Templates from "./pages/Templates";
import Assets from "./pages/Assets";
import Audio from "./pages/Audio";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";

function RequireAuth({ children, admin }) {
  const { user, loading, isAdmin } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="auth-wrap"><div className="card"><span className="spinner" /> Loading…</div></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (admin && !isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/reset" element={<Reset />} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
            <Route path="/create" element={<RequireAuth><Create /></RequireAuth>} />
            <Route path="/studio/:tab" element={<RequireAuth><Studio /></RequireAuth>} />
            <Route path="/studio" element={<Navigate to="/studio/video" replace />} />
            <Route path="/editor/:id" element={<RequireAuth><Editor /></RequireAuth>} />
            <Route path="/templates" element={<RequireAuth><Templates /></RequireAuth>} />
            <Route path="/assets" element={<RequireAuth><Assets /></RequireAuth>} />
            <Route path="/audio" element={<RequireAuth><Audio /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
