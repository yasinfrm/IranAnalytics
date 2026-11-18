import { Router } from 'express';
import { query } from '../lib/db.js';
import { parseUa, referrerHost } from '../lib/ua.js';
import { normalizePath, isNoisePath } from '../lib/path.js';

const router = Router();

const GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

router.options(['/collect', '/e.gif'], (req, res) => {
  cors(res);
  res.status(204).end();
});

async function resolveSite(publicKey) {
  if (!publicKey) return null;
  const { rows } = await query(
    'SELECT id, domain FROM sites WHERE public_key = $1 AND is_active = TRUE LIMIT 1',
    [publicKey]
  );
  return rows[0] || null;
}

function cleanToken(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanViewId(value) {
  const id = cleanToken(value, 64);
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : '';
}

function queryFromPath(path) {
  try {
    const u = new URL(path, 'http://local');
    return u.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/** Last-touch campaign fields. Explicit body wins; otherwise the page URL. */
function pickUtm(body, rawPath) {
  let src = body?.utm;
  if (typeof src === 'string') {
    try {
      src = JSON.parse(src);
    } catch {
      src = null;
    }
  }
  if (!src || typeof src !== 'object' || Array.isArray(src)) src = body || {};
  const q = queryFromPath(rawPath);
  const read = (short, full) => cleanToken(src[short] || src[full] || q.get(full) || '', 120);
  let source = read('source', 'utm_source');
  let medium = read('medium', 'utm_medium');
  let campaign = read('campaign', 'utm_campaign');
  let term = read('term', 'utm_term');
  let content = read('content', 'utm_content');

  // Yektanet / native Iranian ad networks often skip classic utm_source.
  const ynPlat = cleanToken(q.get('utm_yn_plt') || q.get('yn_plt') || '', 120);
  if (!source && ynPlat) source = ynPlat;
  if (!medium && (q.get('utm_yn_data') || q.get('yn_data'))) medium = 'native';
  if (!source && (q.get('utm_yn_data') || q.get('yn_data'))) source = 'yektanet';

  return { source, medium, campaign, term, content };
}

function cleanHref(value) {
  const raw = cleanToken(value, 500);
  if (!raw) return '';
  try {
    const u = new URL(raw, 'http://local');
    if (/^https?:/i.test(raw)) return `${u.host}${u.pathname}`.slice(0, 300);
  } catch {
    /* fall through */
  }
  return raw.split('?')[0].slice(0, 300);
}

const SENSITIVE_KEY = /pass|pwd|secret|token|authorization|cookie|email|phone|card|cvv/i;

function sanitizeProps(name, raw, autoClick) {
  let props = raw || {};
  if (typeof props === 'string') {
    try {
      props = JSON.parse(props);
    } catch {
      props = {};
    }
  }
  if (typeof props !== 'object' || props === null || Array.isArray(props)) props = {};

  if (name === 'click' && autoClick) {
    return {
      el: cleanToken(props.el, 20),
      text: cleanToken(props.text, 80),
      href: cleanHref(props.href) || cleanToken(props.href, 300),
      id: cleanToken(props.id, 80),
      name: cleanToken(props.name, 80),
      outbound: props.outbound === 1 || props.outbound === '1' || props.outbound === true ? 1 : 0,
    };
  }

  if (name === 'conversion') {
    return {
      goal: cleanToken(props.goal || props.name || 'goal', 40) || 'goal',
      text: cleanToken(props.text, 80),
      href: cleanHref(props.href) || cleanToken(props.href, 300),
      el: cleanToken(props.el, 20),
      source: cleanToken(props.source, 120),
      medium: cleanToken(props.medium, 120),
      campaign: cleanToken(props.campaign, 120),
      term: cleanToken(props.term, 120),
      content: cleanToken(props.content, 120),
    };
  }

  const out = {};
  for (const key of Object.keys(props)) {
    if (Object.keys(out).length >= 12) break;
    if (SENSITIVE_KEY.test(key)) continue;
    const value = props[key];
    if (value == null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key.slice(0, 40)] = value;
    else if (typeof value === 'boolean') out[key.slice(0, 40)] = value;
    else if (typeof value === 'string') out[key.slice(0, 40)] = cleanToken(value, 200);
  }
  return out;
}

async function ingestPageview(body, req) {
  const key = body.k || body.key || body.site;
  const site = await resolveSite(key);
  if (!site) return { ok: false, status: 404, error: 'unknown_site' };

  const rawPath = String(body.p || body.path || body.url || '/');
  if (isNoisePath(rawPath)) return { ok: true };

  const ua = String(body.ua || req.headers['user-agent'] || '').slice(0, 512);
  const { browser, os, device } = parseUa(ua);
  const referrer = String(body.r || body.referrer || '').slice(0, 2048);
  const siteHost = site.domain || '';
  const refHost = referrerHost(referrer, siteHost);
  const utm = pickUtm(body, rawPath);

  await query(
    `INSERT INTO pageviews
      (site_id, path, title, referrer, referrer_host, ua, browser, os, device, session_id,
       view_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      site.id,
      normalizePath(rawPath),
      String(body.t || body.title || '').slice(0, 512),
      referrer,
      refHost,
      ua,
      browser.slice(0, 120),
      os.slice(0, 120),
      device.slice(0, 40),
      String(body.sid || body.session || '').slice(0, 64),
      cleanViewId(body.vid || body.view_id),
      utm.source,
      utm.medium,
      utm.campaign,
      utm.term,
      utm.content,
    ]
  );
  return { ok: true };
}

async function ingestEngage(body) {
  const key = body.k || body.key || body.site;
  const site = await resolveSite(key);
  if (!site) return { ok: false, status: 404, error: 'unknown_site' };

  const vid = cleanViewId(body.vid || body.view_id);
  if (!vid) return { ok: true };

  let ms = Math.round(Number(body.ms));
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  if (ms > 30 * 60 * 1000) ms = 30 * 60 * 1000;

  let scroll = Math.round(Number(body.scroll));
  if (!Number.isFinite(scroll) || scroll < 0) scroll = 0;
  if (scroll > 100) scroll = 100;

  await query(
    `UPDATE pageviews
        SET duration_ms = CASE WHEN duration_ms > $3 THEN duration_ms ELSE $3 END,
            scroll_depth = CASE WHEN scroll_depth > $4 THEN scroll_depth ELSE $4 END
      WHERE site_id = $1 AND view_id = $2`,
    [site.id, vid, ms, scroll]
  );
  return { ok: true };
}

async function ingestEvent(body) {
  const key = body.k || body.key || body.site;
  const site = await resolveSite(key);
  if (!site) return { ok: false, status: 404, error: 'unknown_site' };

  const rawPath = String(body.p || body.path || body.url || '/');
  if (isNoisePath(rawPath)) return { ok: true };

  const name = cleanToken(body.n || body.name || body.event || '', 120);
  if (!name) return { ok: false, status: 400, error: 'missing_event_name' };

  const autoClick = body.auto === 1 || body.auto === '1' || body.auto === true;
  const props = sanitizeProps(name, body.props || body.data || {}, autoClick);
  // WP admin bar / cache plugin clicks are noise for site analytics.
  if (name === 'click' && autoClick) {
    const href = String(props.href || '');
    if (/\/wp-admin(?:\/|$)/i.test(href) || /\/wp-login\.php/i.test(href)) return { ok: true };
  }

  await query(
    `INSERT INTO events (site_id, name, path, props, session_id)
     VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [
      site.id,
      name,
      normalizePath(rawPath),
      JSON.stringify(props),
      String(body.sid || body.session || '').slice(0, 64),
    ]
  );
  return { ok: true };
}

router.post('/collect', async (req, res) => {
  cors(res);
  try {
    const body = req.body || {};
    const type = body.type || (body.n || body.name || body.event ? 'event' : 'pageview');
    const result =
      type === 'event'
        ? await ingestEvent(body)
        : type === 'engage'
          ? await ingestEngage(body)
          : await ingestPageview(body, req);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(204).end();
  } catch (err) {
    console.error('collect error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Pixel fallback for no-JS / img beacons
router.get('/e.gif', async (req, res) => {
  cors(res);
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const q = req.query || {};
    if ((q.type || '') === 'event') {
      await ingestEvent(q);
    } else if ((q.type || '') === 'engage') {
      await ingestEngage(q);
    } else {
      await ingestPageview(q, req);
    }
  } catch (err) {
    console.error('pixel error', err);
  }
  res.status(200).end(GIF);
});

export default router;
