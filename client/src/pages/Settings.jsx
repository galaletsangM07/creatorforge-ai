// ─── CreatorForge AI · Settings: profile, providers, usage ─────────────────
import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, useAuth, useToast, fmtAgo } from "../lib/api";
import { Layout, Field, JobCard, StatusBadge } from "../components/ui";

export default function Settings() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "profile");
  useEffect(() => { if (params.get("tab")) setTab(params.get("tab")); }, [params]);
  return (
    <Layout title="Settings" sub="Profile, AI providers and usage.">
      <div className="tabs">
        {[["profile", "👤 Profile"], ["providers", "🔌 Providers"], ["usage", "📊 Usage"]].map(([id, label]) => (
          <div key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</div>
        ))}
      </div>
      {tab === "profile" && <ProfileTab />}
      {tab === "providers" && <ProvidersTab />}
      {tab === "usage" && <UsageTab />}
    </Layout>
  );
}

function ProfileTab() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(user?.name || ""); }, [user]);
  const save = async () => {
    setBusy(true);
    try {
      await api("/api/auth/me", { method: "PATCH", body: { name, ...(password ? { password } : {}) } });
      await refresh();
      setPassword("");
      toast.push("Profile updated.");
    } catch (e) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>Profile</h3>
      <dl className="kv mb">
        <dt>Email</dt><dd>{user?.email}</dd>
        <dt>Role</dt><dd>{user?.role}</dd>
        <dt>Member since</dt><dd>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</dd>
      </dl>
      <Field label="Display name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="New password (optional)" hint="Leave blank to keep the current one."><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
    </div>
  );
}

function ProvidersTab() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [catalog, setCatalog] = useState([]);
  const [categories, setCategories] = useState([]);
  const [instances, setInstances] = useState([]);
  const [busy, setBusy] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addForm, setAddForm] = useState({ name: "", endpoint: "", model: "", apiKey: "" });

  const load = async () => {
    const c = await api("/api/providers/catalog");
    setCatalog(c.catalog); setCategories(c.categories);
    const i = await api("/api/providers");
    setInstances(i.instances);
  };
  useEffect(() => { load().catch((e) => toast.push(e.message, "err")); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startAdd = (def) => {
    setAddKey(def.key);
    setAddForm({ name: def.label, endpoint: def.endpoint, model: def.models[0], apiKey: "" });
  };

  const create = async () => {
    setBusy(true);
    try {
      await api("/api/providers", { method: "POST", body: { defKey: addKey, ...addForm } });
      toast.push("Provider added. Test the connection below.");
      setAddKey("");
      await load();
    } catch (e) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };

  const update = async (id, patch) => {
    try {
      await api(`/api/providers/${id}`, { method: "PATCH", body: patch });
      toast.push("Provider updated.");
      await load();
    } catch (e) { toast.push(e.message, "err"); }
  };

  const test = async (id) => {
    setBusy(true);
    try {
      const r = await api(`/api/providers/${id}/test`, { method: "POST" });
      toast.push(r.ok ? `✓ ${r.message} (${r.latencyMs}ms)` : `✕ ${r.message}`, r.ok ? "ok" : "err");
      await load();
    } catch (e) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!confirm("Delete this provider configuration?")) return;
    try {
      await api(`/api/providers/${id}`, { method: "DELETE" });
      toast.push("Provider deleted.");
      await load();
    } catch (e) { toast.push(e.message, "err"); }
  };

  return (
    <div>
      <div className="info-box mb">
        🔌 <strong>Free-first, no lock-in.</strong> Built-in local providers work without keys. Paid providers need an API key —
        keys are stored server-side only and are <strong>never</strong> sent to the browser{!isAdmin && ", so only an administrator can add or edit them"}. Failed jobs always show the real reason.
      </div>

      <h3>Configured providers</h3>
      {categories.map((cat) => {
        const list = instances.filter((i) => i.category === cat);
        return (
          <div key={cat} className="card mb">
            <div className="spread mb"><h4 style={{ margin: 0, textTransform: "capitalize" }}>{cat}</h4><span className={`badge ${list.length ? "ok" : "warn"}`}>{list.length ? `${list.length} configured` : "none configured"}</span></div>
            {list.length === 0 && <div className="tiny muted">No {cat} provider yet — generations in this category will fail honestly until one is added.</div>}
            {list.map((p) => (
              <div key={p.id} className="job-card">
                <div className="spread">
                  <div className="row wrap">
                    <strong className="small">{p.name}</strong>
                    <span className="tiny muted">{p.model}</span>
                    {p.hasKey ? <span className="badge ok">key {p.keyPreview}</span> : <span className="badge warn">no key</span>}
                    {!p.enabled && <span className="badge err">disabled</span>}
                  </div>
                  {isAdmin && (
                    <div className="row">
                      <button className="btn sm" disabled={busy} onClick={() => test(p.id)}>Test</button>
                      <button className="btn sm" onClick={() => update(p.id, { enabled: !p.enabled })}>{p.enabled ? "Disable" : "Enable"}</button>
                      <button className="btn sm danger" onClick={() => remove(p.id)}>Delete</button>
                    </div>
                  )}
                </div>
                <div className="tiny muted mt"><code className="inline">{p.endpoint}</code></div>
                {p.lastError && <div className="err-box mt">Last error: {p.lastError}</div>}
                {isAdmin && <KeyEditor provider={p} onSave={(apiKey) => update(p.id, { apiKey })} />}
              </div>
            ))}
          </div>
        );
      })}

      {isAdmin && (
        <>
          <h3>Add a provider</h3>
          <div className="card">
            <div className="chip-row mb">
              {catalog.map((d) => (
                <button key={d.key} className={`chip ${addKey === d.key ? "sel" : ""}`} onClick={() => startAdd(d)}>
                  {d.free ? "🆓 " : ""}{d.label}
                </button>
              ))}
            </div>
            {addKey ? (
              <div className="grid2">
                <Field label="Display name"><input className="input" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></Field>
                <Field label="Endpoint"><input className="input" value={addForm.endpoint} onChange={(e) => setAddForm({ ...addForm, endpoint: e.target.value })} /></Field>
                <Field label="Model"><input className="input" value={addForm.model} onChange={(e) => setAddForm({ ...addForm, model: e.target.value })} /></Field>
                <Field label="API key" hint="Stored server-side. Never exposed to the browser."><input className="input" type="password" value={addForm.apiKey} onChange={(e) => setAddForm({ ...addForm, apiKey: e.target.value })} placeholder={catalog.find((d) => d.key === addKey)?.requiresKey ? "sk-…" : "not required"} /></Field>
              </div>
            ) : <div className="tiny muted">Pick a provider type above. Free/self-hosted options are marked 🆓.</div>}
            {addKey && <button className="btn primary mt" disabled={busy} onClick={create}>{busy ? "Adding…" : "Add provider"}</button>}
            {addKey && <div className="tiny muted mt">{catalog.find((d) => d.key === addKey)?.description}</div>}
          </div>
        </>
      )}
    </div>
  );
}

function KeyEditor({ provider, onSave }) {
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn sm mt" onClick={() => setOpen(true)}>🔑 {provider.hasKey ? "Replace key" : "Add key"}</button>;
  return (
    <div className="row mt">
      <input className="input" type="password" placeholder="paste new API key" value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1 }} />
      <button className="btn sm primary" onClick={() => { onSave(key); setKey(""); setOpen(false); }}>Save</button>
      <button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function UsageTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  useEffect(() => { api("/api/usage").then(setData).catch((e) => toast.push(e.message, "err")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="card"><span className="spinner" /> Loading usage…</div>;
  const s = data.summary;
  const bars = [
    ["🎬 Videos generated", s.videosGenerated, s.quotas.videoGenerations],
    ["🖼 Images generated", s.imagesGenerated, s.quotas.imageGenerations],
    ["🎙 Voice minutes", s.voiceMinutes, s.quotas.voiceMinutes],
    ["⬆ Exports", s.exports, s.quotas.exports],
    ["💾 Storage (MB)", s.storageMB, s.quotas.storageMB],
  ];
  return (
    <div>
      <div className="card mb">
        <h3 style={{ marginTop: 0 }}>This month</h3>
        {bars.map(([label, used, quota]) => (
          <div key={label} className="mb">
            <div className="spread"><span className="small"><strong>{label}</strong></span><span className="tiny">{used} / {quota}</span></div>
            <div className="progress mt"><div style={{ width: `${Math.min(100, (used / Math.max(quota, 1)) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Recent generation jobs</h3>
        {data.jobs.length === 0 && <div className="tiny muted">No jobs yet.</div>}
        {data.jobs.map((j) => (
          <div key={j.id} className="spread" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="row wrap">
              <StatusBadge status={j.status} />
              <span className="small">{j.type}</span>
              <span className="tiny muted">via {j.providerName}</span>
            </div>
            <span className="tiny muted">{fmtAgo(j.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
