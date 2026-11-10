import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

export const db = new Database(path.join(ROOT, 'data', 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  file_name TEXT,
  file_size INTEGER,
  chunk_size INTEGER,
  chunk_count INTEGER,
  uploaded_chunk_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'INIT',
  storage_path TEXT,
  biz_type TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  upload_id TEXT,
  type TEXT,
  status TEXT DEFAULT 'QUEUED',
  priority INTEGER DEFAULT 0,
  seq INTEGER,
  progress INTEGER DEFAULT 0,
  message TEXT,
  result_url TEXT,
  error_message TEXT,
  created_at TEXT,
  updated_at TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS app_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT,
  notes TEXT,
  force_update INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_seq ON tasks (status, seq);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads (status);
`);

export const now = () => new Date().toISOString();
