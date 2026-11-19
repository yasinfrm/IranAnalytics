import { Router } from 'express';
import crypto from 'crypto';
import { query, newId, dialect } from '../lib/db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { normalizePath } from '../lib/path.js';
import { buildFilters, sourceSqlExpr, dayExpr } from '../lib/filters.js';
import { gregorianDayToJalaliStr, formatTimestampJalali } from '../lib/jalali.js';

const router = Router();
router.use(requireAuth);

function eventProp(field, alias = 'e') {
  const col = alias ? `${alias}.props` : 'props';
  return dialect === 'sqlite'
    ? `COALESCE(json_extract(${col}, '$.${field}'), '')`
    : `COALESCE(${col}->>'${field}', '')`;
}

function clickSelect(alias = 'e') {
  const col = alias ? `${alias}.props` : 'props';
  if (dialect === 'sqlite') {
    return `SELECT
      COALESCE(NULLIF(json_extract(${col}, '$.text'), ''), NULLIF(json_extract(${col}, '$.name'), ''), '(بدون متن)') AS label,
      COALESCE(json_extract(${col}, '$.href'), '') AS href,
      COALESCE(json_extract(${col}, '$.outbound'), 0) AS outbound,
      COUNT(*)::int AS count`;
  }
  return `SELECT
      COALESCE(NULLIF(${col}->>'text', ''), NULLIF(${col}->>'name', ''), '(بدون متن)') AS label,
      COALESCE(${col}->>'href', '') AS href,
      COALESCE(${col}->>'outbound', '0') AS outbound,
      COUNT(*)::int AS count`;
}

async function customGoalNamesMap(siteId) {
  const { rows } =
    siteId && siteId !== 'all'
      ? await query('SELECT goal_key, name FROM goals WHERE site_id = $1', [siteId])
      : await query('SELECT goal_key, name FROM goals');
  const map = {};
  for (const r of rows) {
    if (r.goal_key && r.name) map[r.goal_key] = r.name;
  }
  return map;
}

// —— Sites ——

router.get('/sites', async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.domain, s.public_key, s.created_at, s.is_active,
              (SELECT COUNT(*)::int FROM pageviews p WHERE p.site_id = s.id
                AND p.created_at >= NOW() - INTERVAL '1 day') AS views_today
       FROM sites s
       ORDER BY s.created_at ASC`
    );
    res.json({ sites: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/sites', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const domain = String(req.body?.domain || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .slice(0, 253);
    if (!name) return res.status(400).json({ error: 'name_required' });

    const publicKey = 'ia_' + crypto.randomBytes(12).toString('hex');
    const id = newId();
    const { rows } = await query(
      `INSERT INTO sites (id, name, domain, public_key)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, domain, public_key, created_at, is_active`,
      [id, name, domain, publicKey]
    );
    res.status(201).json({ site: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.patch('/sites/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const name = req.body?.name != null ? String(req.body.name).trim().slice(0, 120) : null;
    const domain =
      req.body?.domain != null
        ? String(req.body.domain)
            .trim()
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, '')
            .slice(0, 253)
        : null;
    const isActive = typeof req.body?.is_active === 'boolean' ? req.body.is_active : null;

    const { rows } = await query(
      `UPDATE sites SET
         name = COALESCE($2, name),
         domain = COALESCE($3, domain),
         is_active = COALESCE($4, is_active)
       WHERE id = $1
       RETURNING id, name, domain, public_key, created_at, is_active`,
      [id, name, domain, isActive]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ site: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.delete('/sites/:id', async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM sites WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Configurable Goals ——

const GOAL_MATCH_TYPES = new Set([
  'click_text',
  'click_selector',
  'href_contains',
  'url_contains',
  'form_submit',
]);

router.get('/goals', async (req, res) => {
  try {
    const siteId = String(req.query.site || 'all').trim();
    const { rows } =
      siteId && siteId !== 'all'
        ? await query(
            `SELECT g.id, g.site_id, s.name AS site_name, g.name, g.goal_key, g.match_type, g.match_value, g.is_active, g.created_at
             FROM goals g
             JOIN sites s ON s.id = g.site_id
             WHERE g.site_id = $1
             ORDER BY g.created_at DESC`,
            [siteId]
          )
        : await query(
            `SELECT g.id, g.site_id, s.name AS site_name, g.name, g.goal_key, g.match_type, g.match_value, g.is_active, g.created_at
             FROM goals g
             JOIN sites s ON s.id = g.site_id
             ORDER BY g.created_at DESC`
          );
    res.json({ goals: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/goals', async (req, res) => {
  try {
    const siteId = String(req.body?.site_id || '').trim();
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const matchType = String(req.body?.match_type || 'click_text').trim();
    const matchValue = String(req.body?.match_value || '').trim().slice(0, 200);

    if (!siteId) return res.status(400).json({ error: 'site_required' });
    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!GOAL_MATCH_TYPES.has(matchType)) return res.status(400).json({ error: 'invalid_match_type' });
    if (!matchValue) return res.status(400).json({ error: 'match_value_required' });

    const { rows: siteRows } = await query('SELECT id FROM sites WHERE id = $1 LIMIT 1', [siteId]);
    if (!siteRows[0]) return res.status(404).json({ error: 'site_not_found' });

    const id = newId();
    const rawKey = String(req.body?.goal_key || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 36);
    const goalKey = rawKey || 'goal_' + id.replace(/-/g, '').slice(0, 8);

    const { rows } = await query(
      `INSERT INTO goals (id, site_id, name, goal_key, match_type, match_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, site_id, name, goal_key, match_type, match_value, is_active, created_at`,
      [id, siteId, name, goalKey, matchType, matchValue]
    );
    res.status(201).json({ goal: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.patch('/goals/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const name = req.body?.name != null ? String(req.body.name).trim().slice(0, 80) : null;
    const matchType =
      req.body?.match_type != null && GOAL_MATCH_TYPES.has(String(req.body.match_type))
        ? String(req.body.match_type)
        : null;
    const matchValue =
      req.body?.match_value != null ? String(req.body.match_value).trim().slice(0, 200) : null;
    const isActive = typeof req.body?.is_active === 'boolean' ? req.body.is_active : null;

    const { rows } = await query(
      `UPDATE goals SET
         name = COALESCE($2, name),
         match_type = COALESCE($3, match_type),
         match_value = COALESCE($4, match_value),
         is_active = COALESCE($5, is_active)
       WHERE id = $1
       RETURNING id, site_id, name, goal_key, match_type, match_value, is_active, created_at`,
      [id, name, matchType, matchValue, isActive]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ goal: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.delete('/goals/:id', async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM goals WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Filter options ——

router.get('/stats/filters', async (req, res) => {
  try {
    const f = buildFilters(req, { includePath: false });
    const srcExpr = sourceSqlExpr('p');
    const sources = await query(
      `SELECT ${srcExpr} AS source, COUNT(*)::int AS views
       FROM pageviews p
       WHERE ${f.pvWhere}
       GROUP BY 1
       ORDER BY views DESC
       LIMIT 40`,
      f.pvParams
    );
    const campaigns = await query(
      `SELECT p.utm_campaign AS campaign, COUNT(*)::int AS views
       FROM pageviews p
       WHERE ${f.pvWhere} AND p.utm_campaign <> ''
       GROUP BY 1
       ORDER BY views DESC
       LIMIT 40`,
      f.pvParams
    );
    res.json({
      sources: sources.rows,
      campaigns: campaigns.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Overview & core stats ——

router.get('/stats/overview', async (req, res) => {
  try {
    const f = buildFilters(req);

    const r = await query(
      `SELECT
         COUNT(*)::int AS pageviews,
         COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
         COUNT(DISTINCT p.path)::int AS unique_pages,
         AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
         AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll,
         COALESCE(SUM(CASE
           WHEN p.utm_source <> '' OR p.utm_medium <> '' OR p.utm_campaign <> '' THEN 1
           ELSE 0
         END), 0)::int AS campaign_views
       FROM pageviews p
       WHERE ${f.pvWhere}`,
      f.pvParams
    );

    const prev = await query(
      `SELECT COUNT(*)::int AS pageviews
       FROM pageviews p
       WHERE ${f.prevWhere}`,
      f.prevParams
    );

    const events = await query(
      `SELECT COUNT(*)::int AS c FROM events e WHERE ${f.evWhere}`,
      f.evParams
    );

    const clicks = await query(
      `SELECT COUNT(*)::int AS c FROM events e WHERE e.name = 'click' AND ${f.evWhere}`,
      f.evParams
    );

    const conversions = await query(
      `SELECT COUNT(*)::int AS c,
              COUNT(DISTINCT NULLIF(e.session_id, ''))::int AS sessions
       FROM events e
       WHERE e.name = 'conversion' AND ${f.evWhere}`,
      f.evParams
    );

    res.json({
      days: f.range.days,
      ...r.rows[0],
      events: events.rows[0].c,
      clicks: clicks.rows[0].c,
      conversions: conversions.rows[0].c,
      converting_sessions: conversions.rows[0].sessions,
      previous_pageviews: prev.rows[0].pageviews,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/timeseries', async (req, res) => {
  try {
    const f = buildFilters(req);
    const dExpr = dayExpr('p.created_at');
    const eDayExpr = dayExpr('e.created_at');

    const pv = await query(
      `SELECT ${dExpr} AS day,
              COUNT(*)::int AS pageviews,
              COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions
       FROM pageviews p
       WHERE ${f.pvWhere}
       GROUP BY 1
       ORDER BY 1 ASC`,
      f.pvParams
    );

    const conv = await query(
      `SELECT ${eDayExpr} AS day,
              COUNT(*)::int AS conversions
       FROM events e
       WHERE e.name = 'conversion' AND ${f.evWhere}
       GROUP BY 1
       ORDER BY 1 ASC`,
      f.evParams
    );

    const convMap = new Map(conv.rows.map((r) => [String(r.day), Number(r.conversions) || 0]));
    const series = pv.rows.map((row) => {
      const day = String(row.day);
      return {
        day,
        jalali: gregorianDayToJalaliStr(day),
        pageviews: Number(row.pageviews) || 0,
        sessions: Number(row.sessions) || 0,
        conversions: convMap.get(day) || 0,
      };
    });

    res.json({ days: f.range.days, series });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/pages', async (req, res) => {
  try {
    const f = buildFilters(req, { includePath: false });
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const limP = `$${f.pvParams.length + 1}`;

    const { rows } = await query(
      `SELECT p.path,
              MAX(NULLIF(p.title, '')) AS title,
              COUNT(*)::int AS views,
              COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
              AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
              AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll
       FROM pageviews p
       WHERE ${f.pvWhere}
       GROUP BY p.path
       ORDER BY views DESC
       LIMIT ${limP}`,
      [...f.pvParams, limit]
    );
    res.json({ pages: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/referrers', async (req, res) => {
  try {
    const f = buildFilters(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const limP = `$${f.pvParams.length + 1}`;

    const { rows } = await query(
      `SELECT COALESCE(NULLIF(p.referrer_host, ''), '(direct)') AS referrer,
              COUNT(*)::int AS views
       FROM pageviews p
       WHERE ${f.pvWhere}
       GROUP BY 1
       ORDER BY views DESC
       LIMIT ${limP}`,
      [...f.pvParams, limit]
    );
    res.json({ referrers: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/devices', async (req, res) => {
  try {
    const f = buildFilters(req);

    const devices = await query(
      `SELECT p.device AS name, COUNT(*)::int AS views
       FROM pageviews p WHERE ${f.pvWhere}
       GROUP BY p.device ORDER BY views DESC`,
      f.pvParams
    );
    const browsers = await query(
      `SELECT p.browser AS name, COUNT(*)::int AS views
       FROM pageviews p WHERE ${f.pvWhere}
       GROUP BY p.browser ORDER BY views DESC LIMIT 10`,
      f.pvParams
    );
    const os = await query(
      `SELECT p.os AS name, COUNT(*)::int AS views
       FROM pageviews p WHERE ${f.pvWhere}
       GROUP BY p.os ORDER BY views DESC LIMIT 10`,
      f.pvParams
    );
    res.json({ devices: devices.rows, browsers: browsers.rows, os: os.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Sources breakdown (channels + scroll + duration + conversions) ——

async function computeSources(f, limit = 30) {
  const srcExpr = sourceSqlExpr('p');
  const pvLim = `$${f.pvParams.length + 1}`;
  const pvRows = await query(
    `SELECT ${srcExpr} AS source,
            COUNT(*)::int AS views,
            COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
            AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
            AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll
     FROM pageviews p
     WHERE ${f.pvWhere}
     GROUP BY 1
     ORDER BY views DESC
     LIMIT ${pvLim}`,
    [...f.pvParams, limit]
  );

  // Attribute session conversions to the first source of each session (or pageview source if matched)
  const convRows = await query(
    `SELECT ${srcExpr} AS source,
            COUNT(DISTINCT e.id)::int AS conversions,
            COUNT(DISTINCT NULLIF(e.session_id, ''))::int AS converting_sessions
     FROM events e
     JOIN pageviews p
       ON p.site_id = e.site_id
      AND p.session_id = e.session_id
      AND p.session_id <> ''
      AND ${f.pvWhere}
     WHERE e.name = 'conversion'
       AND ${f.evWhere.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + f.pvParams.length}`)}
     GROUP BY 1`,
    [...f.pvParams, ...f.evParams]
  );

  const convMap = new Map(convRows.rows.map((r) => [r.source, r]));
  return pvRows.rows.map((row) => {
    const conv = convMap.get(row.source) || { conversions: 0, converting_sessions: 0 };
    const sess = Number(row.sessions) || 0;
    const converting = Number(conv.converting_sessions) || 0;
    return {
      source: row.source,
      views: Number(row.views) || 0,
      sessions: sess,
      avg_ms: row.avg_ms,
      avg_scroll: row.avg_scroll,
      conversions: Number(conv.conversions) || 0,
      converting_sessions: converting,
      cvr: sess > 0 ? Math.round((converting / sess) * 1000) / 10 : 0,
    };
  });
}

router.get('/stats/sources', async (req, res) => {
  try {
    const f = buildFilters(req);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const sources = await computeSources(f, limit);
    res.json({ days: f.range.days, sources });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Behavior ——

router.get('/stats/behavior', async (req, res) => {
  try {
    const f = buildFilters(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const pvLim = `$${f.pvParams.length + 1}`;
    const evLim = `$${f.evParams.length + 1}`;

    const scroll = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN p.scroll_depth < 25 THEN 1 ELSE 0 END), 0)::int AS b0,
         COALESCE(SUM(CASE WHEN p.scroll_depth >= 25 AND p.scroll_depth < 50 THEN 1 ELSE 0 END), 0)::int AS b25,
         COALESCE(SUM(CASE WHEN p.scroll_depth >= 50 AND p.scroll_depth < 75 THEN 1 ELSE 0 END), 0)::int AS b50,
         COALESCE(SUM(CASE WHEN p.scroll_depth >= 75 AND p.scroll_depth < 100 THEN 1 ELSE 0 END), 0)::int AS b75,
         COALESCE(SUM(CASE WHEN p.scroll_depth >= 100 THEN 1 ELSE 0 END), 0)::int AS b100
       FROM pageviews p
       WHERE ${f.pvWhere}`,
      f.pvParams
    );

    const pages = await query(
      `SELECT p.path,
              MAX(NULLIF(p.title, '')) AS title,
              COUNT(*)::int AS views,
              COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
              AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
              AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll
       FROM pageviews p
       WHERE ${f.pvWhere}
       GROUP BY p.path
       ORDER BY views DESC
       LIMIT ${pvLim}`,
      [...f.pvParams, limit]
    );

    const campaigns = await query(
      `SELECT
         p.utm_campaign AS campaign,
         p.utm_source AS source,
         p.utm_medium AS medium,
         p.utm_term AS term,
         p.utm_content AS content,
         COUNT(*)::int AS views,
         COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
         AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
         AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll
       FROM pageviews p
       WHERE ${f.pvWhere}
         AND (p.utm_source <> '' OR p.utm_medium <> '' OR p.utm_campaign <> '' OR p.utm_content <> '' OR p.utm_term <> '')
       GROUP BY p.utm_campaign, p.utm_source, p.utm_medium, p.utm_term, p.utm_content
       ORDER BY views DESC
       LIMIT ${pvLim}`,
      [...f.pvParams, limit]
    );

    const clicks = await query(
      `${clickSelect('e')}
       FROM events e
       WHERE e.name = 'click' AND ${f.evWhere}
       GROUP BY 1, 2, 3
       ORDER BY count DESC
       LIMIT ${evLim}`,
      [...f.evParams, limit]
    );

    const sources = await computeSources(f, limit);

    res.json({
      days: f.range.days,
      scroll: scroll.rows[0] || {},
      pages: pages.rows,
      campaigns: campaigns.rows,
      clicks: clicks.rows,
      sources,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Single Page Drilldown ——

async function computePageDetail(req) {
  const rawPath = String(req.query.path || '/').trim();
  const targetPath = normalizePath(rawPath);
  const reqWithPath = {
    query: { ...req.query, path: targetPath },
  };
  const f = buildFilters(reqWithPath);
  const dExpr = dayExpr('p.created_at');
  const eDayExpr = dayExpr('e.created_at');
  const goalExpr = eventProp('goal', 'e');

  const summaryRes = await query(
    `SELECT MAX(NULLIF(p.title, '')) AS title,
            COUNT(*)::int AS views,
            COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
            AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
            AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll
     FROM pageviews p
     WHERE ${f.pvWhere}`,
    f.pvParams
  );

  const convSummary = await query(
    `SELECT COUNT(*)::int AS conversions,
            COUNT(DISTINCT NULLIF(e.session_id, ''))::int AS converting_sessions
     FROM events e
     WHERE e.name = 'conversion' AND ${f.evWhere}`,
    f.evParams
  );

  const clickSummary = await query(
    `SELECT COUNT(*)::int AS clicks FROM events e WHERE e.name = 'click' AND ${f.evWhere}`,
    f.evParams
  );

  const scroll = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN p.scroll_depth < 25 THEN 1 ELSE 0 END), 0)::int AS b0,
       COALESCE(SUM(CASE WHEN p.scroll_depth >= 25 AND p.scroll_depth < 50 THEN 1 ELSE 0 END), 0)::int AS b25,
       COALESCE(SUM(CASE WHEN p.scroll_depth >= 50 AND p.scroll_depth < 75 THEN 1 ELSE 0 END), 0)::int AS b50,
       COALESCE(SUM(CASE WHEN p.scroll_depth >= 75 AND p.scroll_depth < 100 THEN 1 ELSE 0 END), 0)::int AS b75,
       COALESCE(SUM(CASE WHEN p.scroll_depth >= 100 THEN 1 ELSE 0 END), 0)::int AS b100
     FROM pageviews p
     WHERE ${f.pvWhere}`,
    f.pvParams
  );

  const pvSeries = await query(
    `SELECT ${dExpr} AS day,
            COUNT(*)::int AS pageviews,
            COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions
     FROM pageviews p
     WHERE ${f.pvWhere}
     GROUP BY 1
     ORDER BY 1 ASC`,
    f.pvParams
  );

  const convSeries = await query(
    `SELECT ${eDayExpr} AS day,
            COUNT(*)::int AS conversions
     FROM events e
     WHERE e.name = 'conversion' AND ${f.evWhere}
     GROUP BY 1
     ORDER BY 1 ASC`,
    f.evParams
  );

  const convDayMap = new Map(convSeries.rows.map((r) => [String(r.day), Number(r.conversions) || 0]));
  const series = pvSeries.rows.map((r) => {
    const day = String(r.day);
    return {
      day,
      jalali: gregorianDayToJalaliStr(day),
      pageviews: Number(r.pageviews) || 0,
      sessions: Number(r.sessions) || 0,
      conversions: convDayMap.get(day) || 0,
    };
  });

  const sources = await computeSources(f, 30);

  const campaigns = await query(
    `SELECT p.utm_campaign AS campaign,
            p.utm_source AS source,
            p.utm_medium AS medium,
            COUNT(*)::int AS views,
            COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
            AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
            AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll
     FROM pageviews p
     WHERE ${f.pvWhere}
       AND (p.utm_source <> '' OR p.utm_medium <> '' OR p.utm_campaign <> '')
     GROUP BY 1, 2, 3
     ORDER BY views DESC
     LIMIT 30`,
    f.pvParams
  );

  const clicks = await query(
    `${clickSelect('e')}
     FROM events e
     WHERE e.name = 'click' AND ${f.evWhere}
     GROUP BY 1, 2, 3
     ORDER BY count DESC
     LIMIT 30`,
    f.evParams
  );

  const goalsRaw = await query(
    `SELECT COALESCE(NULLIF(${goalExpr}, ''), 'goal') AS goal,
            COUNT(*)::int AS conversions,
            COUNT(DISTINCT NULLIF(e.session_id, ''))::int AS sessions
     FROM events e
     WHERE e.name = 'conversion' AND ${f.evWhere}
     GROUP BY 1
     ORDER BY conversions DESC`,
    f.evParams
  );
  const nameMap = await customGoalNamesMap(f.siteId);
  const goals = goalsRaw.rows.map((g) => ({
    ...g,
    goal_name: nameMap[g.goal] || '',
  }));

  const sRow = summaryRes.rows[0] || {};
  const sessions = Number(sRow.sessions) || 0;
  const converting = Number(convSummary.rows[0]?.converting_sessions) || 0;

  return {
    path: targetPath,
    title: sRow.title || '',
    days: f.range.days,
    summary: {
      views: Number(sRow.views) || 0,
      sessions,
      avg_ms: sRow.avg_ms,
      avg_scroll: sRow.avg_scroll,
      clicks: Number(clickSummary.rows[0]?.clicks) || 0,
      conversions: Number(convSummary.rows[0]?.conversions) || 0,
      converting_sessions: converting,
      cvr: sessions > 0 ? Math.round((converting / sessions) * 1000) / 10 : 0,
    },
    scroll: scroll.rows[0] || {},
    series,
    sources,
    campaigns: campaigns.rows,
    clicks: clicks.rows,
    goals,
  };
}

router.get('/stats/page', async (req, res) => {
  try {
    const detail = await computePageDetail(req);
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Events & Conversions ——

router.get('/stats/events', async (req, res) => {
  try {
    const f = buildFilters(req);
    const { rows } = await query(
      `SELECT e.name, COUNT(*)::int AS count
       FROM events e
       WHERE ${f.evWhere}
       GROUP BY e.name
       ORDER BY count DESC
       LIMIT 50`,
      f.evParams
    );
    res.json({ events: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/conversions', async (req, res) => {
  try {
    const f = buildFilters(req);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const pvLim = `$${f.pvParams.length + 1}`;
    const evLim = `$${f.evParams.length + 1}`;
    const goalExpr = eventProp('goal', 'e');
    const sourceExpr = eventProp('source', 'e');
    const mediumExpr = eventProp('medium', 'e');
    const campaignExpr = eventProp('campaign', 'e');
    const eDayExpr = dayExpr('e.created_at');

    const totals = await query(
      `SELECT COUNT(*)::int AS conversions,
              COUNT(DISTINCT NULLIF(e.session_id, ''))::int AS converting_sessions
       FROM events e
       WHERE e.name = 'conversion' AND ${f.evWhere}`,
      f.evParams
    );

    const sessions = await query(
      `SELECT COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions
       FROM pageviews p
       WHERE ${f.pvWhere}`,
      f.pvParams
    );

    const campaignSessions = await query(
      `SELECT
         p.utm_campaign AS campaign,
         p.utm_source AS source,
         p.utm_medium AS medium,
         COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
         COUNT(*)::int AS views
       FROM pageviews p
       WHERE ${f.pvWhere}
         AND (p.utm_source <> '' OR p.utm_medium <> '' OR p.utm_campaign <> '')
       GROUP BY p.utm_campaign, p.utm_source, p.utm_medium
       ORDER BY sessions DESC
       LIMIT ${pvLim}`,
      [...f.pvParams, limit]
    );

    const campaignConversions = await query(
      `SELECT
         ${campaignExpr} AS campaign,
         ${sourceExpr} AS source,
         ${mediumExpr} AS medium,
         COUNT(*)::int AS conversions,
         COUNT(DISTINCT NULLIF(e.session_id, ''))::int AS converting_sessions
       FROM events e
       WHERE e.name = 'conversion' AND ${f.evWhere}
       GROUP BY 1, 2, 3
       ORDER BY conversions DESC
       LIMIT ${evLim}`,
      [...f.evParams, limit]
    );

    const goalsRaw = await query(
      `SELECT
         COALESCE(NULLIF(${goalExpr}, ''), 'goal') AS goal,
         COUNT(*)::int AS conversions,
         COUNT(DISTINCT NULLIF(e.session_id, ''))::int AS sessions
       FROM events e
       WHERE e.name = 'conversion' AND ${f.evWhere}
       GROUP BY 1
       ORDER BY conversions DESC
       LIMIT ${evLim}`,
      [...f.evParams, limit]
    );

    const nameMap = await customGoalNamesMap(f.siteId);
    const goals = goalsRaw.rows.map((g) => ({
      ...g,
      goal_name: nameMap[g.goal] || '',
    }));

    const seriesRaw = await query(
      `SELECT ${eDayExpr} AS day,
              COUNT(*)::int AS conversions,
              COUNT(DISTINCT NULLIF(e.session_id, ''))::int AS sessions
       FROM events e
       WHERE e.name = 'conversion' AND ${f.evWhere}
       GROUP BY 1
       ORDER BY 1 ASC`,
      f.evParams
    );

    const series = seriesRaw.rows.map((r) => ({
      day: String(r.day),
      jalali: gregorianDayToJalaliStr(r.day),
      conversions: Number(r.conversions) || 0,
      sessions: Number(r.sessions) || 0,
    }));

    const keyOf = (row) =>
      [row.source || '', row.medium || '', row.campaign || ''].join('\u0001');
    const convMap = new Map(campaignConversions.rows.map((row) => [keyOf(row), row]));
    const seen = new Set();
    const campaigns = [];

    for (const row of campaignSessions.rows) {
      const k = keyOf(row);
      seen.add(k);
      const conv = convMap.get(k) || { conversions: 0, converting_sessions: 0 };
      const sess = Number(row.sessions) || 0;
      const converting = Number(conv.converting_sessions) || 0;
      campaigns.push({
        source: row.source,
        medium: row.medium,
        campaign: row.campaign,
        views: row.views,
        sessions: sess,
        conversions: Number(conv.conversions) || 0,
        converting_sessions: converting,
        cvr: sess > 0 ? Math.round((converting / sess) * 1000) / 10 : 0,
      });
    }
    for (const row of campaignConversions.rows) {
      const k = keyOf(row);
      if (seen.has(k)) continue;
      if (!row.source && !row.medium && !row.campaign) continue;
      const converting = Number(row.converting_sessions) || 0;
      campaigns.push({
        source: row.source,
        medium: row.medium,
        campaign: row.campaign,
        views: 0,
        sessions: 0,
        conversions: Number(row.conversions) || 0,
        converting_sessions: converting,
        cvr: 0,
      });
    }
    campaigns.sort((a, b) => b.conversions - a.conversions || b.sessions - a.sessions);

    const sessionCount = Number(sessions.rows[0]?.sessions) || 0;
    const convertingSessions = Number(totals.rows[0]?.converting_sessions) || 0;

    res.json({
      days: f.range.days,
      conversions: Number(totals.rows[0]?.conversions) || 0,
      converting_sessions: convertingSessions,
      sessions: sessionCount,
      cvr: sessionCount > 0 ? Math.round((convertingSessions / sessionCount) * 1000) / 10 : 0,
      goals,
      campaigns,
      series,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/journeys', async (req, res) => {
  try {
    const f = buildFilters(req);
    const limit = Math.min(Number(req.query.limit) || 25, 80);

    const sessions = await query(
      `SELECT p.session_id,
              MIN(p.created_at) AS started_at,
              COUNT(*)::int AS pages,
              MAX(p.utm_source) AS source,
              MAX(p.utm_medium) AS medium,
              MAX(p.utm_campaign) AS campaign
       FROM pageviews p
       WHERE ${f.pvWhere}
         AND p.session_id <> ''
       GROUP BY p.session_id
       ORDER BY started_at DESC
       LIMIT ${limit}`,
      [...f.pvParams]
    );

    const sidList = sessions.rows.map((r) => r.session_id).filter(Boolean);
    if (!sidList.length) {
      return res.json({ days: f.range.days, journeys: [], funnels: [] });
    }

    const placeholdersPv = sidList.map((_, i) => `$${f.pvParams.length + i + 1}`).join(',');
    const pageRows = await query(
      `SELECT p.session_id, p.path, p.title, p.created_at, p.utm_source, p.utm_medium, p.utm_campaign
       FROM pageviews p
       WHERE ${f.pvWhere}
         AND p.session_id IN (${placeholdersPv})
       ORDER BY p.created_at ASC`,
      [...f.pvParams, ...sidList]
    );

    const placeholdersEv = sidList.map((_, i) => `$${f.evParams.length + i + 1}`).join(',');
    const convRows = await query(
      `SELECT e.session_id, e.created_at, e.props
       FROM events e
       WHERE e.name = 'conversion'
         AND ${f.evWhere}
         AND e.session_id IN (${placeholdersEv})
       ORDER BY e.created_at ASC`,
      [...f.evParams, ...sidList]
    );

    const nameMap = await customGoalNamesMap(f.siteId);
    const pagesBySid = new Map();
    for (const row of pageRows.rows) {
      if (!pagesBySid.has(row.session_id)) pagesBySid.set(row.session_id, []);
      pagesBySid.get(row.session_id).push(row);
    }
    const convBySid = new Map();
    for (const row of convRows.rows) {
      if (!convBySid.has(row.session_id)) convBySid.set(row.session_id, []);
      let props = row.props;
      if (typeof props === 'string') {
        try {
          props = JSON.parse(props);
        } catch {
          props = {};
        }
      }
      const goal = props?.goal || 'goal';
      convBySid.get(row.session_id).push({
        at: row.created_at,
        jalali_at: formatTimestampJalali(row.created_at),
        goal,
        goal_name: nameMap[goal] || '',
        source: props?.source || '',
        medium: props?.medium || '',
        campaign: props?.campaign || '',
      });
    }

    const journeys = sessions.rows.map((s) => {
      const rawPages = pagesBySid.get(s.session_id) || [];
      const pages = rawPages.map((p) => ({
        path: p.path,
        title: p.title || '',
        at: p.created_at,
      }));
      const conversions = convBySid.get(s.session_id) || [];
      const landing = pages[0] || null;
      const tagged = rawPages.find((p) => p.utm_source || p.utm_medium || p.utm_campaign);
      return {
        session_id: s.session_id,
        started_at: s.started_at,
        started_jalali: formatTimestampJalali(s.started_at),
        pages_count: Number(s.pages) || pages.length,
        source: s.source || tagged?.utm_source || '',
        medium: s.medium || tagged?.utm_medium || '',
        campaign: s.campaign || tagged?.utm_campaign || '',
        landing: landing ? { path: landing.path, title: landing.title || '' } : null,
        path: pages.map((p) => p.path),
        conversions,
        converted: conversions.length > 0,
      };
    });

    const landMap = new Map();
    for (const j of journeys) {
      const landPath = j.landing?.path || '(unknown)';
      if (!landMap.has(landPath)) {
        landMap.set(landPath, {
          path: landPath,
          title: j.landing?.title || '',
          sessions: 0,
          converted: 0,
        });
      }
      const bucket = landMap.get(landPath);
      bucket.sessions += 1;
      if (j.converted) bucket.converted += 1;
      if (!bucket.title && j.landing?.title) bucket.title = j.landing.title;
    }
    const funnels = [...landMap.values()]
      .map((row) => ({
        ...row,
        cvr: row.sessions > 0 ? Math.round((row.converted / row.sessions) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions || b.converted - a.converted)
      .slice(0, 30);

    res.json({ days: f.range.days, journeys, funnels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Visitor Sessions & Step-by-Step Timeline ——

function parseProps(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function computeVisitorsList(req) {
  const f = buildFilters(req);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const search = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
  const onlyConv = req.query.only_converted === '1' || req.query.only_converted === 'true';

  const params = [...f.pvParams];
  const extraParts = [];
  if (search) {
    const idx = params.push(`%${search}%`);
    extraParts.push(
      `(LOWER(p.ip) LIKE $${idx} OR LOWER(p.session_id) LIKE $${idx} OR LOWER(p.path) LIKE $${idx} OR LOWER(p.utm_source) LIKE $${idx} OR LOWER(p.utm_campaign) LIKE $${idx} OR LOWER(p.referrer_host) LIKE $${idx})`
    );
  }
  const whereClause = extraParts.length ? `${f.pvWhere} AND ${extraParts.join(' AND ')}` : f.pvWhere;

  const sessionsRes = await query(
    `SELECT p.session_id,
            MIN(p.created_at) AS started_at,
            MAX(p.created_at) AS last_at,
            COUNT(*)::int AS pages_count,
            COALESCE(SUM(p.duration_ms), 0)::int AS total_ms,
            COALESCE(MAX(p.scroll_depth), 0)::int AS max_scroll,
            MAX(NULLIF(p.ip, '')) AS ip,
            MAX(NULLIF(p.device, '')) AS device,
            MAX(NULLIF(p.browser, '')) AS browser,
            MAX(NULLIF(p.os, '')) AS os,
            MAX(NULLIF(p.utm_source, '')) AS utm_source,
            MAX(NULLIF(p.utm_medium, '')) AS utm_medium,
            MAX(NULLIF(p.utm_campaign, '')) AS utm_campaign,
            MAX(NULLIF(p.referrer_host, '')) AS referrer_host
     FROM pageviews p
     WHERE ${whereClause}
       AND p.session_id <> ''
     GROUP BY p.session_id
     ORDER BY last_at DESC
     LIMIT ${onlyConv ? 200 : limit}`,
    params
  );

  const sids = sessionsRes.rows.map((r) => r.session_id).filter(Boolean);
  if (!sids.length) return { days: f.range.days, visitors: [] };

  const pvPlaceholders = sids.map((_, i) => `$${f.pvParams.length + i + 1}`).join(',');
  const pageRows = await query(
    `SELECT p.session_id, p.path, p.title, ${sourceSqlExpr('p')} AS channel, p.created_at, p.id
     FROM pageviews p
     WHERE ${f.pvWhere} AND p.session_id IN (${pvPlaceholders})
     ORDER BY p.created_at ASC, p.id ASC`,
    [...f.pvParams, ...sids]
  );

  const evPlaceholders = sids.map((_, i) => `$${f.evParams.length + i + 1}`).join(',');
  const evRows = await query(
    `SELECT e.session_id, e.name, e.props
     FROM events e
     WHERE ${f.evWhere} AND e.session_id IN (${evPlaceholders})`,
    [...f.evParams, ...sids]
  );

  const pagesBySid = new Map();
  for (const row of pageRows.rows) {
    if (!pagesBySid.has(row.session_id)) pagesBySid.set(row.session_id, []);
    pagesBySid.get(row.session_id).push(row);
  }

  const statsBySid = new Map();
  const nameMap = await customGoalNamesMap(f.siteId);
  for (const row of evRows.rows) {
    if (!statsBySid.has(row.session_id)) {
      statsBySid.set(row.session_id, {
        clicks: 0,
        videos: 0,
        forms: 0,
        conversions: 0,
        goals: new Set(),
      });
    }
    const st = statsBySid.get(row.session_id);
    if (row.name === 'click') st.clicks += 1;
    else if (row.name === 'video') st.videos += 1;
    else if (row.name === 'form_start' || row.name === 'form_submit') st.forms += 1;
    else if (row.name === 'conversion') {
      st.conversions += 1;
      const props = parseProps(row.props);
      const gk = props.goal || 'goal';
      st.goals.add(nameMap[gk] || gk);
    }
  }

  let visitors = sessionsRes.rows.map((s) => {
    const pages = pagesBySid.get(s.session_id) || [];
    const first = pages[0];
    const last = pages[pages.length - 1];
    const ev = statsBySid.get(s.session_id) || {
      clicks: 0,
      videos: 0,
      forms: 0,
      conversions: 0,
      goals: new Set(),
    };
    const channel = first?.channel || s.utm_source || s.referrer_host || 'direct';
    return {
      session_id: s.session_id,
      ip: s.ip || '',
      device: s.device || 'desktop',
      browser: s.browser || '',
      os: s.os || '',
      source: channel,
      medium: s.utm_medium || '',
      campaign: s.utm_campaign || '',
      referrer_host: s.referrer_host || '',
      started_at: s.started_at,
      started_jalali: formatTimestampJalali(s.started_at),
      last_jalali: formatTimestampJalali(s.last_at),
      pages_count: Number(s.pages_count) || pages.length,
      total_ms: Number(s.total_ms) || 0,
      max_scroll: Number(s.max_scroll) || 0,
      landing_path: first?.path || '/',
      landing_title: first?.title || '',
      last_path: last?.path || '/',
      clicks: ev.clicks,
      videos: ev.videos,
      forms: ev.forms,
      conversions: ev.conversions,
      goals: [...ev.goals],
    };
  });

  if (onlyConv) {
    visitors = visitors.filter((v) => v.conversions > 0);
  }
  return { days: f.range.days, visitors: visitors.slice(0, limit) };
}

async function computeVisitorTimeline(req) {
  const sid = String(req.query.sid || '').trim().slice(0, 64);
  if (!sid) return null;
  const siteId = String(req.query.site || 'all').trim();

  const pvParams = [sid];
  let pvWhere = 'p.session_id = $1';
  if (siteId && siteId !== 'all') {
    pvParams.push(siteId);
    pvWhere += ' AND p.site_id = $2';
  }

  const pvRes = await query(
    `SELECT p.id, p.site_id, p.path, p.title, p.referrer, p.referrer_host,
            p.browser, p.os, p.device, p.ip, p.view_id,
            p.utm_source, p.utm_medium, p.utm_campaign, p.utm_term, p.utm_content,
            p.duration_ms, p.scroll_depth, p.created_at,
            ${sourceSqlExpr('p')} AS channel
     FROM pageviews p
     WHERE ${pvWhere}
     ORDER BY p.created_at ASC, p.id ASC
     LIMIT 200`,
    pvParams
  );

  if (!pvRes.rows.length) return { profile: null, chapters: [], steps: [] };

  const evParams = [sid];
  let evWhere = 'e.session_id = $1';
  if (siteId && siteId !== 'all') {
    evParams.push(siteId);
    evWhere += ' AND e.site_id = $2';
  }

  const evRes = await query(
    `SELECT e.id, e.name, e.path, e.props, e.view_id, e.created_at
     FROM events e
     WHERE ${evWhere}
       AND e.name <> 'engage'
     ORDER BY e.created_at ASC, e.id ASC
     LIMIT 600`,
    evParams
  );

  const nameMap = await customGoalNamesMap(siteId);
  const byViewId = new Map();
  const orphanEvents = [];

  for (const row of evRes.rows) {
    const props = parseProps(row.props);
    const evObj = {
      id: row.id,
      name: row.name,
      path: row.path,
      props,
      view_id: row.view_id || '',
      created_at: row.created_at,
      jalali_at: formatTimestampJalali(row.created_at),
      ms: Number.isFinite(Number(props.ms)) ? Number(props.ms) : null,
      goal_name: row.name === 'conversion' ? nameMap[props.goal] || '' : '',
    };
    if (evObj.view_id) {
      if (!byViewId.has(evObj.view_id)) byViewId.set(evObj.view_id, []);
      byViewId.get(evObj.view_id).push(evObj);
    } else {
      orphanEvents.push(evObj);
    }
  }

  const chapters = pvRes.rows.map((pv) => {
    let events = [];
    if (pv.view_id && byViewId.has(pv.view_id)) {
      events = [...byViewId.get(pv.view_id)];
      byViewId.delete(pv.view_id);
    }
    return {
      id: pv.id,
      view_id: pv.view_id || '',
      path: pv.path,
      title: pv.title || '',
      source: pv.channel || 'direct',
      utm_source: pv.utm_source || '',
      utm_medium: pv.utm_medium || '',
      utm_campaign: pv.utm_campaign || '',
      referrer_host: pv.referrer_host || '',
      duration_ms: Number(pv.duration_ms) || 0,
      scroll_depth: Number(pv.scroll_depth) || 0,
      created_at: pv.created_at,
      jalali_at: formatTimestampJalali(pv.created_at),
      events,
    };
  });

  // Any leftover view_id-tagged events (rare race) fall into orphan attachment.
  for (const leftover of byViewId.values()) {
    orphanEvents.push(...leftover);
  }
  byViewId.clear();

  // Attach any events without view_id to the latest matching-path chapter at/before event time.
  for (const ev of orphanEvents) {
    let target = chapters[0];
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (chapters[i].created_at <= ev.created_at && (chapters[i].path === ev.path || i === 0)) {
        target = chapters[i];
        break;
      }
    }
    if (target) target.events.push(ev);
  }

  const steps = [];
  for (const ch of chapters) {
    const scrollEvMax = ch.events
      .filter((e) => e.name === 'scroll')
      .reduce((m, e) => Math.max(m, Number(e.props?.pct) || 0), 0);
    if (scrollEvMax > ch.scroll_depth) ch.scroll_depth = scrollEvMax;

    // Older visits / engage-only: still show "اسکرول تا X٪" like a normal step.
    if (ch.scroll_depth >= 10 && !ch.events.some((e) => e.name === 'scroll')) {
      ch.events.push({
        id: 0,
        name: 'scroll',
        path: ch.path,
        props: { pct: ch.scroll_depth, ms: ch.duration_ms || null },
        view_id: ch.view_id,
        created_at: ch.created_at,
        jalali_at: ch.jalali_at,
        ms: ch.duration_ms || null,
        goal_name: '',
      });
    }

    ch.events.sort((a, b) => {
      if (a.ms != null && b.ms != null && a.ms !== b.ms) return a.ms - b.ms;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return (a.id || 0) - (b.id || 0);
    });

    steps.push({
      kind: 'pageview',
      jalali_at: ch.jalali_at,
      offset_ms: 0,
      path: ch.path,
      title: ch.title,
      source: ch.source,
      campaign: ch.utm_campaign,
      duration_ms: ch.duration_ms,
      scroll_depth: ch.scroll_depth,
    });

    for (const ev of ch.events) {
      steps.push({
        kind: ev.name,
        jalali_at: ev.jalali_at,
        offset_ms: ev.ms,
        path: ev.path,
        props: ev.props,
        goal_name: ev.goal_name,
      });
    }
  }

  const first = pvRes.rows[0];
  const last = pvRes.rows[pvRes.rows.length - 1];
  const tagged = pvRes.rows.find((p) => p.utm_source || p.utm_medium || p.utm_campaign) || first;

  const profile = {
    session_id: sid,
    ip: pvRes.rows.find((p) => p.ip)?.ip || '',
    device: first.device || 'desktop',
    browser: first.browser || '',
    os: first.os || '',
    source: tagged.channel || first.channel || 'direct',
    medium: tagged.utm_medium || '',
    campaign: tagged.utm_campaign || '',
    referrer_host: first.referrer_host || '',
    started_jalali: formatTimestampJalali(first.created_at),
    last_jalali: formatTimestampJalali(last.created_at),
    pages_count: chapters.length,
    total_ms: chapters.reduce((sum, c) => sum + c.duration_ms, 0),
    max_scroll: chapters.reduce((m, c) => Math.max(m, c.scroll_depth), 0),
    clicks_count: evRes.rows.filter((e) => e.name === 'click').length,
    videos_count: evRes.rows.filter((e) => e.name === 'video').length,
    forms_count: evRes.rows.filter((e) => e.name === 'form_start' || e.name === 'form_submit').length,
    conversions_count: evRes.rows.filter((e) => e.name === 'conversion').length,
  };

  return { profile, chapters, steps };
}

router.get('/stats/visitors', async (req, res) => {
  try {
    const result = await computeVisitorsList(req);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/visitor', async (req, res) => {
  try {
    const data = await computeVisitorTimeline(req);
    if (!data) return res.status(400).json({ error: 'sid_required' });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

// —— Clarity-like Click & Scroll Heatmaps ——

function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

async function computeHeatmap(req) {
  const path = normalizePath(String(req.query.path || '').trim() || '/');
  if (!path) return null;

  const reqWithPath = { query: { ...req.query, path } };
  const f = buildFilters(reqWithPath);

  const [pvRes, clickRes, siteRes] = await Promise.all([
    query(
      `SELECT p.scroll_depth, p.title, p.site_id
       FROM pageviews p
       WHERE ${f.pvWhere}
       LIMIT 25000`,
      f.pvParams
    ),
    query(
      `SELECT e.props
       FROM events e
       WHERE e.name = 'click' AND ${f.evWhere}
       LIMIT 25000`,
      f.evParams
    ),
    f.siteId && f.siteId !== 'all'
      ? query('SELECT domain, name FROM sites WHERE id = $1 LIMIT 1', [f.siteId])
      : query(
          `SELECT s.domain, s.name, COUNT(*)::int AS c
           FROM pageviews p
           JOIN sites s ON s.id = p.site_id
           WHERE ${f.pvWhere}
           GROUP BY s.domain, s.name
           ORDER BY c DESC
           LIMIT 1`,
          f.pvParams
        ),
  ]);

  const views = pvRes.rows.length;
  const title =
    pvRes.rows.map((r) => r.title).find((t) => t && String(t).trim()) || '';
  const domain = (siteRes.rows[0]?.domain || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');

  const grid = new Map();
  const elements = new Map();
  const foldRatios = [];
  const viewWidths = [];
  let maxDh = 0;
  let clicksWithCoords = 0;
  let clickTotal = 0;

  for (const row of clickRes.rows) {
    clickTotal += 1;
    const p = parseProps(row.props);
    const text = String(p.text || p.name || '').trim() || '(بدون متن)';
    const href = String(p.href || '').trim();
    const sel = String(p.sel || '').trim();
    const elKey = `${text}\n${href}\n${sel}`;
    const prev = elements.get(elKey) || { text, href, sel, count: 0 };
    prev.count += 1;
    elements.set(elKey, prev);

    const xp = Number(p.xp);
    const yp = Number(p.yp);
    if (!Number.isFinite(xp) || !Number.isFinite(yp)) continue;
    clicksWithCoords += 1;

    const bx = Math.max(0, Math.min(98, Math.floor(xp / 2) * 2));
    const by = Math.max(0, Math.min(98, Math.floor(yp / 2) * 2));
    const gKey = `${bx},${by}`;
    const cell = grid.get(gKey) || { xp: bx + 1, yp: by + 1, w: 0 };
    cell.w += 1;
    grid.set(gKey, cell);

    const dh = Number(p.dh);
    const vh = Number(p.vh);
    const vw = Number(p.vw);
    if (Number.isFinite(dh) && dh > maxDh) maxDh = dh;
    if (Number.isFinite(vw) && vw >= 280 && vw <= 3000) viewWidths.push(vw);
    if (Number.isFinite(dh) && dh > 0 && Number.isFinite(vh) && vh > 0) {
      foldRatios.push(Math.min(100, (vh / dh) * 100));
    }
  }

  const clicks = [...grid.values()].sort((a, b) => b.w - a.w).slice(0, 5000);
  const topElements = [...elements.values()].sort((a, b) => b.count - a.count).slice(0, 20);

  const scrollBands = [];
  for (let depth = 10; depth <= 100; depth += 10) {
    const reached = pvRes.rows.filter((r) => Number(r.scroll_depth) >= depth).length;
    scrollBands.push({
      depth,
      pct: views ? Math.round((reached / views) * 1000) / 10 : 0,
      count: reached,
    });
  }

  const avgFold = median(foldRatios);
  const deviceDefault =
    f.device === 'mobile' ? 390 : f.device === 'tablet' ? 768 : 1280;
  const medVw = median(viewWidths);
  const renderWidth = Math.round(Math.max(320, Math.min(1600, medVw || deviceDefault)));

  return {
    days: f.range.days,
    path,
    meta: {
      path,
      title,
      domain,
      preview_url: domain ? `https://${domain}${path}` : '',
      views,
      click_count: clickTotal,
      clicks_with_coords: clicksWithCoords,
      max_dh: maxDh || 0,
      avg_fold: avgFold != null ? Math.round(avgFold * 10) / 10 : 60,
      device: f.device || 'all',
      // Preview must match click viewport width or responsive layout shifts heat dots.
      render_width: renderWidth,
    },
    clicks,
    elements: topElements,
    scroll: scrollBands,
  };
}

router.get('/stats/heatmap', async (req, res) => {
  try {
    const path = String(req.query.path || '').trim();
    if (!path) return res.status(400).json({ error: 'path_required' });
    const data = await computeHeatmap(req);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

/** Registered site hostnames only — prevents SSRF via heatmap preview proxy. */
async function allowedSiteHosts() {
  const { rows } = await query(`SELECT domain FROM sites WHERE is_active = TRUE AND domain <> ''`);
  const hosts = new Set();
  for (const row of rows) {
    const host = String(row.domain || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
    if (host) {
      hosts.add(host);
      hosts.add('www.' + host);
    }
  }
  return hosts;
}

function isBlockedPreviewHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '0.0.0.0' || h === '::1') return true;
  if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h)) return true;
  return false;
}

function rewritePreviewMedia(html, baseHref) {
  let out = String(html || '');
  let base;
  try {
    base = new URL(baseHref);
  } catch {
    return out;
  }

  const toAbs = (raw) => {
    const v = String(raw || '').trim();
    if (!v || v.startsWith('data:') || v.startsWith('blob:') || v.startsWith('#') || v.startsWith('javascript:')) {
      return v;
    }
    try {
      return new URL(v, base).toString();
    } catch {
      return v;
    }
  };

  const toProxy = (raw) => {
    const abs = toAbs(raw);
    if (!/^https?:\/\//i.test(abs)) return raw;
    return `/api/heatmap-asset?u=${encodeURIComponent(abs)}`;
  };

  const rewriteSrcset = (value) =>
    String(value)
      .split(',')
      .map((part) => {
        const bits = part.trim().split(/\s+/);
        if (!bits[0]) return part.trim();
        bits[0] = toProxy(bits[0]);
        return bits.join(' ');
      })
      .join(', ');

  const rewriteAttrs = (attrs) => {
    let next = attrs;
    next = next.replace(
      /\s(src|data-src|data-lazy-src|data-original|data-bg|data-large_image|data-thumb|poster)=(["'])([^"']*)\2/gi,
      (_m, attr, q, val) => ` ${attr}=${q}${toProxy(val)}${q}`
    );
    next = next.replace(/\s(srcset|data-srcset)=(["'])([^"']*)\2/gi, (_m, attr, q, val) => {
      return ` ${attr}=${q}${rewriteSrcset(val)}${q}`;
    });
    // Inline background images only (do NOT touch <style>/@font-face globally).
    next = next.replace(/\sstyle=(["'])([\s\S]*?)\1/gi, (_m, q, style) => {
      const rewritten = String(style).replace(
        /url\(\s*(['"]?)(https?:\/\/[^)'"\s]+)\1\s*\)/gi,
        (_u, _uq, url) => `url(${toProxy(url)})`
      );
      return ` style=${q}${rewritten}${q}`;
    });
    return next;
  };

  // Only media tags — never rewrite <script src> or stylesheet font urls.
  out = out.replace(/<(img|source|video|audio|image)\b([^>]*)>/gi, (_m, tag, attrs) => {
    return `<${tag}${rewriteAttrs(attrs)}>`;
  });
  return out;
}

function sanitizePreviewHtml(html, baseHref, renderWidth) {
  let out = String(html || '');
  const vw = Math.round(Math.max(320, Math.min(1600, Number(renderWidth) || 1280)));
  // Drop framing locks so the document can render inside our admin iframe.
  out = out.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, (tag) =>
    /frame-ancestors/i.test(tag) ? '' : tag
  );
  out = out.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '');
  out = out.replace(/<meta[^>]+name=["']?viewport["']?[^>]*>/gi, '');
  // Prefer a single base so CSS/JS resolve against the live site.
  out = out.replace(/<base\b[^>]*>/gi, '');
  // LiteSpeed hotlink: Referer=stats.* → 403, empty Referer → 200.
  // Rely on iframe referrerpolicy=no-referrer + meta below (do not rewrite img src).
  const inject = `<meta name="viewport" content="width=${vw}">
<meta name="referrer" content="no-referrer">
<base href="${baseHref.replace(/"/g, '&quot;')}">
<style id="ia-hm-preview">html,body{scroll-behavior:auto!important;max-width:100%!important} a,button{cursor:default!important}</style>
<script id="ia-hm-height">(function(){function s(){try{var doc=document.documentElement,body=document.body;var h=Math.max(doc?doc.scrollHeight:0,doc?doc.offsetHeight:0,body?body.scrollHeight:0,body?body.offsetHeight:0,800);var nodes=body?body.children:[];for(var i=0;i<nodes.length&&i<80;i++){var r=nodes[i].getBoundingClientRect();if(r&&r.bottom)h=Math.max(h,Math.ceil(r.bottom+(window.scrollY||0)));}parent.postMessage({source:'ia-heatmap',height:h,width:${vw}},'*');}catch(e){}}window.addEventListener('load',s);window.addEventListener('resize',s);setInterval(s,1200);setTimeout(s,400);setTimeout(s,1200);setTimeout(s,3000);s();})();</script>`;
  if (/<head[\s>]/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
  } else {
    out = inject + out;
  }
  return out;
}

function hostAllowedForPreview(hostname, allowed) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (!host || isBlockedPreviewHost(host)) return false;
  for (const d of allowed) {
    const base = String(d || '')
      .toLowerCase()
      .replace(/^www\./, '');
    if (!base) continue;
    if (host === base || host.endsWith('.' + base)) return true;
  }
  return false;
}

router.get('/heatmap-preview', async (req, res) => {
  try {
    const path = normalizePath(String(req.query.path || '/').trim() || '/');
    const siteId = String(req.query.site || 'all').trim();
    let domain = '';

    if (siteId && siteId !== 'all') {
      const { rows } = await query('SELECT domain FROM sites WHERE id = $1 LIMIT 1', [siteId]);
      domain = String(rows[0]?.domain || '')
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');
    }
    if (!domain) {
      const f = buildFilters({ query: { ...req.query, path } });
      const { rows } = await query(
        `SELECT s.domain, COUNT(*)::int AS c
         FROM pageviews p
         JOIN sites s ON s.id = p.site_id
         WHERE ${f.pvWhere} AND s.domain <> ''
         GROUP BY s.domain
         ORDER BY c DESC
         LIMIT 1`,
        f.pvParams
      );
      domain = String(rows[0]?.domain || '')
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');
    }
    if (!domain) return res.status(404).send('domain_not_found');

    const allowed = await allowedSiteHosts();
    const hostNoWww = domain.toLowerCase().replace(/^www\./, '');
    if (isBlockedPreviewHost(hostNoWww) || (!allowed.has(hostNoWww) && !allowed.has('www.' + hostNoWww) && !allowed.has(domain.toLowerCase()))) {
      return res.status(403).send('domain_not_allowed');
    }

    const target = new URL(path || '/', `https://${domain}`);
    if (isBlockedPreviewHost(target.hostname)) return res.status(403).send('host_blocked');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; IranAnalyticsHeatmap/1.0; +https://stats.homamigration.net)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      return res.status(502).send(`upstream_${upstream.status}`);
    }
    const ctype = String(upstream.headers.get('content-type') || '');
    if (!/text\/html|application\/xhtml/i.test(ctype) && ctype) {
      return res.status(415).send('not_html');
    }

    const raw = await upstream.text();
    if (raw.length > 2_500_000) return res.status(413).send('too_large');

    const finalUrl = upstream.url || target.toString();
    let baseHref = `https://${domain}/`;
    try {
      const u = new URL(finalUrl);
      const dir = u.pathname.endsWith('/') ? u.pathname : u.pathname.replace(/\/[^/]*$/, '/') || '/';
      baseHref = u.origin + dir;
    } catch {
      /* keep domain root */
    }

    const renderWidth = Math.round(
      Math.max(320, Math.min(1600, Number(req.query.vw) || Number(req.query.render_width) || 1280))
    );
    const html = sanitizePreviewHtml(raw, baseHref, renderWidth);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.removeHeader('X-Frame-Options');
    res.send(html);
  } catch (err) {
    console.error('heatmap-preview', err);
    res.status(502).send('preview_failed');
  }
});

/** Proxy site images with a same-site Referer so hotlink protection does not blank logos. */
router.get('/heatmap-asset', async (req, res) => {
  try {
    const raw = String(req.query.u || '').trim();
    let url;
    try {
      url = new URL(raw);
    } catch {
      return res.status(400).send('bad_url');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return res.status(400).send('bad_protocol');
    }
    const allowed = await allowedSiteHosts();
    if (!hostAllowedForPreview(url.hostname, allowed)) {
      return res.status(403).send('domain_not_allowed');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let upstream;
    try {
      upstream = await fetch(url.toString(), {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: `${url.origin}/`,
          Origin: url.origin,
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) return res.status(502).send('upstream_error');
    const ctype = String(upstream.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const path = url.pathname.toLowerCase();
    const looksImage =
      /^image\//i.test(ctype) ||
      /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(path);
    if (!looksImage && !/^application\/octet-stream$/i.test(ctype)) {
      return res.status(415).send('unsupported_type');
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 8_000_000) return res.status(413).send('too_large');
    res.setHeader('Content-Type', /^image\//i.test(ctype) ? ctype : 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  } catch (err) {
    console.error('heatmap-asset', err);
    res.status(502).send('asset_failed');
  }
});

// —— Excel-friendly CSV Export (UTF-8 BOM) ——

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

function fmtSec(ms) {
  if (ms == null || ms === '') return '0';
  return String(Math.round(Number(ms || 0) / 1000));
}

function fmtPct(v) {
  if (v == null || v === '') return '0';
  return String(Math.round(Number(v || 0)));
}

router.get('/export.csv', async (req, res) => {
  try {
    const report = String(req.query.report || 'pages').trim();
    const f = buildFilters(req);
    let csv = '';

    if (report === 'sources') {
      const rows = await computeSources(f, 500);
      csv = toCsv(
        ['منبع', 'بازدید', 'نشست', 'میانگین زمان (ثانیه)', 'میانگین اسکرول (%)', 'تبدیل', 'نرخ تبدیل (%)'],
        rows.map((r) => [
          r.source,
          r.views,
          r.sessions,
          fmtSec(r.avg_ms),
          fmtPct(r.avg_scroll),
          r.converting_sessions,
          r.cvr,
        ])
      );
    } else if (report === 'campaigns') {
      const { rows } = await query(
        `SELECT p.utm_campaign AS campaign,
                p.utm_source AS source,
                p.utm_medium AS medium,
                p.utm_term AS term,
                p.utm_content AS content,
                COUNT(*)::int AS views,
                COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
                AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
                AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll
         FROM pageviews p
         WHERE ${f.pvWhere}
           AND (p.utm_source <> '' OR p.utm_medium <> '' OR p.utm_campaign <> '')
         GROUP BY 1, 2, 3, 4, 5
         ORDER BY views DESC
         LIMIT 500`,
        f.pvParams
      );
      csv = toCsv(
        ['کمپین', 'منبع', 'مدیوم', 'کلیدواژه', 'محتوا', 'بازدید', 'نشست', 'زمان (ثانیه)', 'اسکرول (%)'],
        rows.map((r) => [
          r.campaign,
          r.source,
          r.medium,
          r.term,
          r.content,
          r.views,
          r.sessions,
          fmtSec(r.avg_ms),
          fmtPct(r.avg_scroll),
        ])
      );
    } else if (report === 'clicks') {
      const { rows } = await query(
        `${clickSelect('e')}
         FROM events e
         WHERE e.name = 'click' AND ${f.evWhere}
         GROUP BY 1, 2, 3
         ORDER BY count DESC
         LIMIT 500`,
        f.evParams
      );
      csv = toCsv(
        ['عنوان دکمه/لینک', 'آدرس مقصد', 'خروجی', 'تعداد کلیک'],
        rows.map((r) => [r.label, r.href, Number(r.outbound) === 1 ? 'بله' : 'خیر', r.count])
      );
    } else if (report === 'visitors') {
      const data = await computeVisitorsList(req);
      csv = toCsv(
        ['آی‌پی', 'شروع (شمسی)', 'منبع', 'کمپین', 'دستگاه', 'مرورگر', 'صفحات', 'زمان کل (ثانیه)', 'بیشترین اسکرول (%)', 'کلیک', 'ویدیو', 'فرم', 'تبدیل', 'صفحه ورود'],
        data.visitors.map((v) => [
          v.ip || 'نامشخص',
          v.started_jalali,
          v.source,
          v.campaign,
          v.device,
          v.browser,
          v.pages_count,
          fmtSec(v.total_ms),
          v.max_scroll,
          v.clicks,
          v.videos,
          v.forms,
          v.conversions,
          v.landing_path,
        ])
      );
    } else if (report === 'visitor') {
      const data = await computeVisitorTimeline(req);
      const steps = data?.steps || [];
      csv = toCsv(
        ['زمان (شمسی)', 'ثانیه در صفحه', 'نوع', 'صفحه', 'جزئیات'],
        steps.map((st) => {
          let detail = '';
          if (st.kind === 'pageview') detail = `ورود به صفحه (${fmtSec(st.duration_ms)} ثانیه، اسکرول ${st.scroll_depth}%)`;
          else if (st.kind === 'scroll') detail = `اسکرول تا ${st.props?.pct || 0}%`;
          else if (st.kind === 'video') detail = `ویدیو (${st.props?.action || 'play'}): ${st.props?.title || ''}`;
          else if (st.kind === 'form_start') detail = `شروع فرم: ${st.props?.form || ''}`;
          else if (st.kind === 'form_submit') detail = `ارسال فرم: ${st.props?.form || ''}`;
          else if (st.kind === 'click') detail = `کلیک: ${st.props?.text || ''} ${st.props?.href || ''}`.trim();
          else if (st.kind === 'conversion') detail = `تبدیل: ${st.goal_name || st.props?.goal || ''} ${st.props?.text || ''}`.trim();
          else detail = `${st.kind}: ${JSON.stringify(st.props || {})}`;
          return [
            st.jalali_at,
            st.offset_ms != null ? Math.round(st.offset_ms / 1000) : '',
            st.kind,
            st.path,
            detail,
          ];
        })
      );
    } else if (report === 'page_detail') {
      const detail = await computePageDetail(req);
      csv = toCsv(
        ['صفحه', 'منبع ورودی', 'بازدید', 'نشست', 'میانگین زمان (ثانیه)', 'میانگین اسکرول (%)', 'تبدیل', 'نرخ تبدیل (%)'],
        detail.sources.map((s) => [
          detail.path,
          s.source,
          s.views,
          s.sessions,
          fmtSec(s.avg_ms),
          fmtPct(s.avg_scroll),
          s.converting_sessions,
          s.cvr,
        ])
      );
    } else if (report === 'conversions') {
      const goalExpr = eventProp('goal', 'e');
      const sourceExpr = eventProp('source', 'e');
      const mediumExpr = eventProp('medium', 'e');
      const campaignExpr = eventProp('campaign', 'e');
      const hrefExpr = eventProp('href', 'e');
      const textExpr = eventProp('text', 'e');
      const nameMap = await customGoalNamesMap(f.siteId);
      const { rows } = await query(
        `SELECT e.created_at, e.path, e.session_id,
                ${goalExpr} AS goal,
                ${sourceExpr} AS source,
                ${mediumExpr} AS medium,
                ${campaignExpr} AS campaign,
                ${textExpr} AS text,
                ${hrefExpr} AS href
         FROM events e
         WHERE e.name = 'conversion' AND ${f.evWhere}
         ORDER BY e.created_at DESC
         LIMIT 1000`,
        f.evParams
      );
      csv = toCsv(
        ['تاریخ شمسی', 'هدف', 'صفحه', 'منبع', 'مدیوم', 'کمپین', 'متن/برچسب', 'لینک', 'نشست'],
        rows.map((r) => [
          formatTimestampJalali(r.created_at),
          nameMap[r.goal] || r.goal,
          r.path,
          r.source,
          r.medium,
          r.campaign,
          r.text,
          r.href,
          r.session_id,
        ])
      );
    } else if (report === 'heatmap') {
      const data = await computeHeatmap(req);
      if (!data) {
        csv = toCsv(['خطا'], [['path_required']]);
      } else {
        csv = toCsv(
          ['نوع', 'مقدار1', 'مقدار2', 'وزن/درصد', 'برچسب'],
          [
            ...data.clicks.map((c) => ['click', c.xp, c.yp, c.w, '']),
            ...data.scroll.map((s) => ['scroll', s.depth, '', s.pct, 'رسیده‌اند']),
            ...data.elements.map((el) => ['element', el.href, el.sel, el.count, el.text]),
          ]
        );
      }
    } else {
      const { rows } = await query(
        `SELECT p.path,
                MAX(NULLIF(p.title, '')) AS title,
                COUNT(*)::int AS views,
                COUNT(DISTINCT NULLIF(p.session_id, ''))::int AS sessions,
                AVG(CASE WHEN p.duration_ms > 0 THEN p.duration_ms END) AS avg_ms,
                AVG(CASE WHEN p.duration_ms > 0 OR p.scroll_depth > 0 THEN p.scroll_depth END) AS avg_scroll
         FROM pageviews p
         WHERE ${f.pvWhere}
         GROUP BY p.path
         ORDER BY views DESC
         LIMIT 500`,
        f.pvParams
      );
      csv = toCsv(
        ['عنوان صفحه', 'مسیر', 'بازدید', 'نشست', 'میانگین زمان (ثانیه)', 'میانگین اسکرول (%)'],
        rows.map((r) => [
          r.title || '',
          r.path,
          r.views,
          r.sessions,
          fmtSec(r.avg_ms),
          fmtPct(r.avg_scroll),
        ])
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="iran-analytics-${report}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
