-- Iran Analytics schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  public_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pageviews (
  id BIGSERIAL PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '/',
  props JSONB NOT NULL DEFAULT '{}',
  session_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pageviews_site_created ON pageviews (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pageviews_site_path ON pageviews (site_id, path);
CREATE INDEX IF NOT EXISTS idx_pageviews_site_referrer ON pageviews (site_id, referrer_host);
CREATE INDEX IF NOT EXISTS idx_pageviews_session ON pageviews (site_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_site_created ON events (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_site_name ON events (site_id, name);
