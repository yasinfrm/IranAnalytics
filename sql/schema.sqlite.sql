-- SQLite schema (Iran Analytics)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  public_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path TEXT NOT NULL DEFAULT '/',
  title TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT 'desktop',
  country TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  view_id TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  scroll_depth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '/',
  props TEXT NOT NULL DEFAULT '{}',
  session_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pageviews_site_created ON pageviews (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pageviews_site_path ON pageviews (site_id, path);
CREATE INDEX IF NOT EXISTS idx_pageviews_site_referrer ON pageviews (site_id, referrer_host);
CREATE INDEX IF NOT EXISTS idx_pageviews_session ON pageviews (site_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_site_created ON events (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_site_name ON events (site_id, name);
