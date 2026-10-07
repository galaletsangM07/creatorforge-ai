// ─── CreatorForge AI · Database layer ─────────────────────────────────────
// Production architecture: this module exposes a small document-store
// interface (insert/get/where/update/remove) so the backing store can be
// swapped for Postgres/Mongo without touching routes or services.
// Default backing store: atomic JSON file (zero native deps, works anywhere).
// Set DB_PATH via config. Every project row belongs to exactly one user.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import config from "./config.js";

const COLLECTIONS = [
  "users",
  "projects",
  "scenes",
  "timeline_items",
  "assets",
  "generations",
  "templates",
  "voices",
  "music",
  "subscriptions",
  "usage",
  "api_providers",
  "export_jobs",
];

function blank() {
  const db = {};
  for (const c of COLLECTIONS) db[c] = [];
  return db;
}

class JsonDB {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = blank();
    this._saveTimer = null;
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw || "{}");
        this.data = { ...blank(), ...parsed };
        for (const c of COLLECTIONS) if (!Array.isArray(this.data[c])) this.data[c] = [];
      } else {
        this.persist();
      }
    } catch (err) {
      console.error("[db] failed to load, starting blank:", err.message);
      this.data = blank();
    }
  }

  persist() {
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
  }

  save() {
    // Debounced atomic write — safe under concurrent job updates.
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        this.persist();
      } catch (e) {
        console.error("[db] persist failed:", e.message);
      }
    }, 120);
  }

  flush() {
    clearTimeout(this._saveTimer);
    this.persist();
  }

  now() {
    return new Date().toISOString();
  }

  insert(collection, doc) {
    const row = { id: doc.id || randomUUID(), ...doc };
    const t = this.now();
    if (!row.createdAt) row.createdAt = t;
    row.updatedAt = t;
    this.data[collection].push(row);
    this.save();
    return row;
  }

  get(collection, id) {
    return this.data[collection].find((r) => r.id === id) || null;
  }

  where(collection, predicate) {
    if (typeof predicate === "function") return this.data[collection].filter(predicate);
    const keys = Object.keys(predicate || {});
    return this.data[collection].filter((r) => keys.every((k) => r[k] === predicate[k]));
  }

  all(collection) {
    return [...this.data[collection]];
  }

  update(collection, id, patch) {
    const row = this.get(collection, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: this.now() });
    this.save();
    return row;
  }

  remove(collection, id) {
    const idx = this.data[collection].findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.data[collection].splice(idx, 1);
    this.save();
    return true;
  }

  count(collection, predicate) {
    return predicate ? this.where(collection, predicate).length : this.data[collection].length;
  }
}

export const db = new JsonDB(config.dbPath);
export const uid = () => randomUUID();
export default db;
