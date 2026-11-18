import { Router } from 'express';
import crypto from 'crypto';
import { query, newId, dialect } from '../lib/db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

function parseRange(req) {
  return Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
}

function rangeParams(siteId, days, extra = []) {
  if (siteId && siteId !== 'all') {
    return {
      siteClause: 'AND site_id = $1',
      daysP: '$2',
      params: [siteId, String(days), ...extra],
      extraStart: 3,
    };
  }
  return {
    siteClause: '',
    daysP: '$1',
    params: [String(days), ...extra],
    extraStart: 2,
  };
}

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

router.get('/stats/overview', async (req, res) => {
  try {
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const { siteClause, daysP, params } = rangeParams(siteId, days);

    const r = await query(
      `SELECT
         COUNT(*)::int AS pageviews,
         COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions,
         COUNT(DISTINCT path)::int AS unique_pages,
         AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) AS avg_ms,
         AVG(CASE WHEN duration_ms > 0 OR scroll_depth > 0 THEN scroll_depth END) AS avg_scroll,
         COALESCE(SUM(CASE
           WHEN utm_source <> '' OR utm_medium <> '' OR utm_campaign <> '' THEN 1
           ELSE 0
         END), 0)::int AS campaign_views
       FROM pageviews
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval
         ${siteClause}`,
      params
    );

    const prev = await query(
      `SELECT COUNT(*)::int AS pageviews
       FROM pageviews
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval * 2
         AND created_at < NOW() - (${daysP} || ' days')::interval
         ${siteClause}`,
      params
    );

    const events = await query(
      `SELECT COUNT(*)::int AS c FROM events
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval
         ${siteClause}`,
      params
    );

    const clicks = await query(
      `SELECT COUNT(*)::int AS c FROM events
       WHERE name = 'click'
         AND created_at >= NOW() - (${daysP} || ' days')::interval
         ${siteClause}`,
      params
    );

    const conversions = await query(
      `SELECT COUNT(*)::int AS c,
              COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions
       FROM events
       WHERE name = 'conversion'
         AND created_at >= NOW() - (${daysP} || ' days')::interval
         ${siteClause}`,
      params
    );

    res.json({
      days,
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
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const { siteClause, daysP, params } = rangeParams(siteId, days);

    const { rows } = await query(
      `SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
              COUNT(*)::int AS pageviews,
              COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions
       FROM pageviews
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval
         ${siteClause}
       GROUP BY 1
       ORDER BY 1 ASC`,
      params
    );
    res.json({ days, series: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/pages', async (req, res) => {
  try {
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { siteClause, daysP, params, extraStart } = rangeParams(siteId, days, [limit]);
    const limP = `$${extraStart}`;

    const { rows } = await query(
      `SELECT path,
              MAX(NULLIF(title, '')) AS title,
              COUNT(*)::int AS views,
              COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions
       FROM pageviews
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval
         ${siteClause}
       GROUP BY path
       ORDER BY views DESC
       LIMIT ${limP}`,
      params
    );
    res.json({ pages: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/referrers', async (req, res) => {
  try {
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { siteClause, daysP, params, extraStart } = rangeParams(siteId, days, [limit]);
    const limP = `$${extraStart}`;

    const { rows } = await query(
      `SELECT COALESCE(NULLIF(referrer_host, ''), '(direct)') AS referrer,
              COUNT(*)::int AS views
       FROM pageviews
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval
         ${siteClause}
       GROUP BY 1
       ORDER BY views DESC
       LIMIT ${limP}`,
      params
    );
    res.json({ referrers: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/devices', async (req, res) => {
  try {
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const { siteClause, daysP, params } = rangeParams(siteId, days);

    const devices = await query(
      `SELECT device AS name, COUNT(*)::int AS views
       FROM pageviews
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval ${siteClause}
       GROUP BY device ORDER BY views DESC`,
      params
    );
    const browsers = await query(
      `SELECT browser AS name, COUNT(*)::int AS views
       FROM pageviews
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval ${siteClause}
       GROUP BY browser ORDER BY views DESC LIMIT 10`,
      params
    );
    const os = await query(
      `SELECT os AS name, COUNT(*)::int AS views
       FROM pageviews
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval ${siteClause}
       GROUP BY os ORDER BY views DESC LIMIT 10`,
      params
    );
    res.json({ devices: devices.rows, browsers: browsers.rows, os: os.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

function clickSelect() {
  if (dialect === 'sqlite') {
    return `SELECT
      COALESCE(NULLIF(json_extract(props, '$.text'), ''), NULLIF(json_extract(props, '$.name'), ''), '(بدون متن)') AS label,
      COALESCE(json_extract(props, '$.href'), '') AS href,
      COALESCE(json_extract(props, '$.outbound'), 0) AS outbound,
      COUNT(*)::int AS count`;
  }
  return `SELECT
      COALESCE(NULLIF(props->>'text', ''), NULLIF(props->>'name', ''), '(بدون متن)') AS label,
      COALESCE(props->>'href', '') AS href,
      COALESCE(props->>'outbound', '0') AS outbound,
      COUNT(*)::int AS count`;
}

router.get('/stats/behavior', async (req, res) => {
  try {
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const base = rangeParams(siteId, days);
    const limited = rangeParams(siteId, days, [limit]);
    const { siteClause, daysP } = base;
    const limP = `$${limited.extraStart}`;
    const where = `created_at >= NOW() - (${daysP} || ' days')::interval ${siteClause}`;

    const scroll = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN scroll_depth < 25 THEN 1 ELSE 0 END), 0)::int AS b0,
         COALESCE(SUM(CASE WHEN scroll_depth >= 25 AND scroll_depth < 50 THEN 1 ELSE 0 END), 0)::int AS b25,
         COALESCE(SUM(CASE WHEN scroll_depth >= 50 AND scroll_depth < 75 THEN 1 ELSE 0 END), 0)::int AS b50,
         COALESCE(SUM(CASE WHEN scroll_depth >= 75 AND scroll_depth < 100 THEN 1 ELSE 0 END), 0)::int AS b75,
         COALESCE(SUM(CASE WHEN scroll_depth >= 100 THEN 1 ELSE 0 END), 0)::int AS b100
       FROM pageviews
       WHERE ${where}`,
      base.params
    );

    const pages = await query(
      `SELECT path,
              MAX(NULLIF(title, '')) AS title,
              COUNT(*)::int AS views,
              AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) AS avg_ms,
              AVG(CASE WHEN duration_ms > 0 OR scroll_depth > 0 THEN scroll_depth END) AS avg_scroll
       FROM pageviews
       WHERE ${where}
       GROUP BY path
       ORDER BY views DESC
       LIMIT ${limP}`,
      limited.params
    );

    const campaigns = await query(
      `SELECT
         utm_campaign AS campaign,
         utm_source AS source,
         utm_medium AS medium,
         utm_term AS term,
         utm_content AS content,
         COUNT(*)::int AS views,
         COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions,
         AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) AS avg_ms,
         AVG(CASE WHEN duration_ms > 0 OR scroll_depth > 0 THEN scroll_depth END) AS avg_scroll
       FROM pageviews
       WHERE ${where}
         AND (utm_source <> '' OR utm_medium <> '' OR utm_campaign <> '' OR utm_content <> '' OR utm_term <> '')
       GROUP BY utm_campaign, utm_source, utm_medium, utm_term, utm_content
       ORDER BY views DESC
       LIMIT ${limP}`,
      limited.params
    );

    const clicks = await query(
      `${clickSelect()}
       FROM events
       WHERE name = 'click' AND ${where}
       GROUP BY 1, 2, 3
       ORDER BY count DESC
       LIMIT ${limP}`,
      limited.params
    );

    res.json({
      days,
      scroll: scroll.rows[0] || {},
      pages: pages.rows,
      campaigns: campaigns.rows,
      clicks: clicks.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/events', async (req, res) => {
  try {
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const { siteClause, daysP, params } = rangeParams(siteId, days);

    const { rows } = await query(
      `SELECT name, COUNT(*)::int AS count
       FROM events
       WHERE created_at >= NOW() - (${daysP} || ' days')::interval ${siteClause}
       GROUP BY name
       ORDER BY count DESC
       LIMIT 50`,
      params
    );
    res.json({ events: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

function eventProp(field) {
  return dialect === 'sqlite'
    ? `COALESCE(json_extract(props, '$.${field}'), '')`
    : `COALESCE(props->>'${field}', '')`;
}

router.get('/stats/conversions', async (req, res) => {
  try {
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const base = rangeParams(siteId, days);
    const limited = rangeParams(siteId, days, [limit]);
    const { siteClause, daysP } = base;
    const limP = `$${limited.extraStart}`;
    const where = `created_at >= NOW() - (${daysP} || ' days')::interval ${siteClause}`;
    const goalExpr = eventProp('goal');
    const sourceExpr = eventProp('source');
    const mediumExpr = eventProp('medium');
    const campaignExpr = eventProp('campaign');

    const totals = await query(
      `SELECT COUNT(*)::int AS conversions,
              COUNT(DISTINCT NULLIF(session_id, ''))::int AS converting_sessions
       FROM events
       WHERE name = 'conversion' AND ${where}`,
      base.params
    );

    const sessions = await query(
      `SELECT COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions
       FROM pageviews
       WHERE ${where}`,
      base.params
    );

    const campaignSessions = await query(
      `SELECT
         utm_campaign AS campaign,
         utm_source AS source,
         utm_medium AS medium,
         COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions,
         COUNT(*)::int AS views
       FROM pageviews
       WHERE ${where}
         AND (utm_source <> '' OR utm_medium <> '' OR utm_campaign <> '')
       GROUP BY utm_campaign, utm_source, utm_medium
       ORDER BY sessions DESC
       LIMIT ${limP}`,
      limited.params
    );

    const campaignConversions = await query(
      `SELECT
         ${campaignExpr} AS campaign,
         ${sourceExpr} AS source,
         ${mediumExpr} AS medium,
         COUNT(*)::int AS conversions,
         COUNT(DISTINCT NULLIF(session_id, ''))::int AS converting_sessions
       FROM events
       WHERE name = 'conversion' AND ${where}
       GROUP BY 1, 2, 3
       ORDER BY conversions DESC
       LIMIT ${limP}`,
      limited.params
    );

    const goals = await query(
      `SELECT
         COALESCE(NULLIF(${goalExpr}, ''), 'goal') AS goal,
         COUNT(*)::int AS conversions,
         COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions
       FROM events
       WHERE name = 'conversion' AND ${where}
       GROUP BY 1
       ORDER BY conversions DESC
       LIMIT ${limP}`,
      limited.params
    );

    const series = await query(
      `SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
              COUNT(*)::int AS conversions,
              COUNT(DISTINCT NULLIF(session_id, ''))::int AS sessions
       FROM events
       WHERE name = 'conversion' AND ${where}
       GROUP BY 1
       ORDER BY 1 ASC`,
      base.params
    );

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
      days,
      conversions: Number(totals.rows[0]?.conversions) || 0,
      converting_sessions: convertingSessions,
      sessions: sessionCount,
      cvr: sessionCount > 0 ? Math.round((convertingSessions / sessionCount) * 1000) / 10 : 0,
      goals: goals.rows,
      campaigns,
      series: series.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/stats/journeys', async (req, res) => {
  try {
    const days = parseRange(req);
    const siteId = req.query.site || 'all';
    const limit = Math.min(Number(req.query.limit) || 25, 80);
    const base = rangeParams(siteId, days);
    const { siteClause, daysP } = base;
    const where = `created_at >= NOW() - (${daysP} || ' days')::interval ${siteClause}`;

    const sessions = await query(
      `SELECT session_id,
              MIN(created_at) AS started_at,
              COUNT(*)::int AS pages,
              MAX(utm_source) AS source,
              MAX(utm_medium) AS medium,
              MAX(utm_campaign) AS campaign
       FROM pageviews
       WHERE ${where}
         AND session_id <> ''
       GROUP BY session_id
       ORDER BY started_at DESC
       LIMIT ${limit}`,
      [...base.params]
    );

    const sidList = sessions.rows.map((r) => r.session_id).filter(Boolean);
    if (!sidList.length) {
      return res.json({ days, journeys: [], funnels: [] });
    }

    // Fetch paths / conversions for these sessions (chunked IN list).
    const placeholders = sidList.map((_, i) => `$${base.params.length + i + 1}`).join(',');
    const sidParams = [...base.params, ...sidList];

    const pageRows = await query(
      `SELECT session_id, path, title, created_at, utm_source, utm_medium, utm_campaign
       FROM pageviews
       WHERE ${where}
         AND session_id IN (${placeholders})
       ORDER BY created_at ASC`,
      sidParams
    );

    const convRows = await query(
      `SELECT session_id, created_at, props
       FROM events
       WHERE name = 'conversion'
         AND ${where}
         AND session_id IN (${placeholders})
       ORDER BY created_at ASC`,
      sidParams
    );

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
      convBySid.get(row.session_id).push({
        at: row.created_at,
        goal: props?.goal || 'goal',
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

    // Landing page → conversion funnel (sessions that started on a path).
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

    res.json({ days, journeys, funnels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
