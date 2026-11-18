import { dialect } from './db.js';
import { normalizePath } from './path.js';
import {
  parseUserDate,
  tehranDayStartUtc,
  tehranTodayGregorian,
  formatUtcForDialect,
} from './jalali.js';

export function sourceSqlExpr(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `(CASE
    WHEN LOWER(${a}utm_source) = 'google' OR LOWER(${a}referrer_host) LIKE '%google.%' THEN 'google'
    WHEN LOWER(${a}utm_source) LIKE '%yektanet%' OR LOWER(${a}referrer_host) LIKE '%yektanet%' THEN 'yektanet'
    WHEN LOWER(${a}utm_source) IN ('instagram','ig') OR LOWER(${a}referrer_host) LIKE '%instagram%' THEN 'instagram'
    WHEN LOWER(${a}utm_source) IN ('telegram','tg') OR LOWER(${a}referrer_host) LIKE '%t.me%' OR LOWER(${a}referrer_host) LIKE '%telegram%' THEN 'telegram'
    WHEN ${a}utm_source <> '' THEN LOWER(${a}utm_source)
    WHEN ${a}referrer_host <> '' THEN LOWER(${a}referrer_host)
    ELSE 'direct'
  END)`;
}

export function dayExpr(col = 'created_at') {
  if (dialect === 'sqlite') {
    return `strftime('%Y-%m-%d', datetime(${col}, '+210 minutes'))`;
  }
  return `to_char(${col} + INTERVAL '210 minutes', 'YYYY-MM-DD')`;
}

function addGregorianDays(g, deltaDays) {
  const d = new Date(Date.UTC(g.gy, g.gm - 1, g.gd + deltaDays));
  return {
    gy: d.getUTCFullYear(),
    gm: d.getUTCMonth() + 1,
    gd: d.getUTCDate(),
  };
}

export function parseDateRange(req) {
  const fromRaw = String(req.query.from || '').trim();
  const toRaw = String(req.query.to || '').trim();
  const parsedFrom = fromRaw ? parseUserDate(fromRaw) : null;
  const parsedTo = toRaw ? parseUserDate(toRaw) : null;

  let startG;
  let endGExclusive;
  let days;

  if (parsedFrom && parsedTo) {
    const startMs = Date.UTC(parsedFrom.gy, parsedFrom.gm - 1, parsedFrom.gd);
    const endMs = Date.UTC(parsedTo.gy, parsedTo.gm - 1, parsedTo.gd);
    if (startMs <= endMs) {
      startG = parsedFrom;
      endGExclusive = addGregorianDays(parsedTo, 1);
      days = Math.max(1, Math.min(365, Math.round((endMs - startMs) / 86400000) + 1));
    }
  }

  if (!startG) {
    days = Math.min(Math.max(Number(req.query.days) || 7, 1), 365);
    const today = tehranTodayGregorian();
    startG = addGregorianDays(today, -(days - 1));
    endGExclusive = addGregorianDays(today, 1);
  }

  const startUtc = tehranDayStartUtc(startG.gy, startG.gm, startG.gd);
  const endUtc = tehranDayStartUtc(endGExclusive.gy, endGExclusive.gm, endGExclusive.gd);
  const spanMs = endUtc.getTime() - startUtc.getTime();
  const prevStartUtc = new Date(startUtc.getTime() - spanMs);
  const prevEndUtc = startUtc;

  return {
    days,
    startStr: formatUtcForDialect(startUtc, dialect),
    endStr: formatUtcForDialect(endUtc, dialect),
    prevStartStr: formatUtcForDialect(prevStartUtc, dialect),
    prevEndStr: formatUtcForDialect(prevEndUtc, dialect),
  };
}

/**
 * Build SQL WHERE clauses and parameter arrays for pageviews (`p`) and events (`e`).
 * Supports: site, from/to (Jalali or Gregorian) / days, source, campaign, path, device.
 */
export function buildFilters(req, opts = {}) {
  const range = parseDateRange(req);
  const siteId = String(req.query.site || 'all').trim();
  const source = String(req.query.source || 'all').trim().toLowerCase();
  const campaign = String(req.query.campaign || 'all').trim();
  const device = String(req.query.device || 'all').trim().toLowerCase();
  const rawPath = req.query.path != null && String(req.query.path).trim() !== ''
    ? normalizePath(String(req.query.path))
    : '';
  const includePath = opts.includePath !== false;

  const pvParams = [range.startStr, range.endStr];
  const pvParts = ['p.created_at >= $1', 'p.created_at < $2'];

  const prevParams = [range.prevStartStr, range.prevEndStr];
  const prevParts = ['p.created_at >= $1', 'p.created_at < $2'];

  const evParams = [range.startStr, range.endStr];
  const evParts = ['e.created_at >= $1', 'e.created_at < $2'];

  const pushBoth = (pvExpr, evExpr, val) => {
    const pvIdx = pvParams.push(val);
    pvParts.push(pvExpr(pvIdx));
    const prevIdx = prevParams.push(val);
    prevParts.push(pvExpr(prevIdx));
    if (evExpr) {
      const evIdx = evParams.push(val);
      evParts.push(evExpr(evIdx));
    }
  };

  if (siteId && siteId !== 'all') {
    pushBoth(
      (i) => `p.site_id = $${i}`,
      (i) => `e.site_id = $${i}`,
      siteId
    );
  }

  if (source && source !== 'all') {
    const idx = pvParams.push(source);
    pvParts.push(`${sourceSqlExpr('p')} = $${idx}`);
    const pidx = prevParams.push(source);
    prevParts.push(`${sourceSqlExpr('p')} = $${pidx}`);
  }

  if (campaign && campaign !== 'all') {
    const idx = pvParams.push(campaign);
    pvParts.push(`p.utm_campaign = $${idx}`);
    const pidx = prevParams.push(campaign);
    prevParts.push(`p.utm_campaign = $${pidx}`);
  }

  if (device && device !== 'all') {
    const idx = pvParams.push(device);
    pvParts.push(`p.device = $${idx}`);
    const pidx = prevParams.push(device);
    prevParts.push(`p.device = $${pidx}`);
  }

  if (includePath && rawPath) {
    pushBoth(
      (i) => `p.path = $${i}`,
      (i) => `e.path = $${i}`,
      rawPath
    );
  }

  // Attribute events to sessions matching source / campaign / device filters.
  const needSessionJoin =
    (source && source !== 'all') ||
    (campaign && campaign !== 'all') ||
    (device && device !== 'all');

  if (needSessionJoin) {
    const subParts = ['sp.site_id = e.site_id', "sp.session_id = e.session_id", "sp.session_id <> ''"];
    const d1 = evParams.push(range.startStr);
    const d2 = evParams.push(range.endStr);
    subParts.push(`sp.created_at >= $${d1}`, `sp.created_at < $${d2}`);
    if (source && source !== 'all') {
      const i = evParams.push(source);
      subParts.push(`${sourceSqlExpr('sp')} = $${i}`);
    }
    if (campaign && campaign !== 'all') {
      const i = evParams.push(campaign);
      subParts.push(`sp.utm_campaign = $${i}`);
    }
    if (device && device !== 'all') {
      const i = evParams.push(device);
      subParts.push(`sp.device = $${i}`);
    }
    evParts.push(`EXISTS (SELECT 1 FROM pageviews sp WHERE ${subParts.join(' AND ')})`);
  }

  return {
    range,
    siteId,
    source,
    campaign,
    device,
    path: rawPath,
    pvWhere: pvParts.join(' AND '),
    pvParams,
    prevWhere: prevParts.join(' AND '),
    prevParams,
    evWhere: evParts.join(' AND '),
    evParams,
  };
}
