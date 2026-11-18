const TRACKING_EXACT = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'ttclid',
  'yclid',
  'dclid',
  'twclid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  'igshid',
  'si',
  'srsltid',
  'gbraid',
  'wbraid',
  '_ga',
  '_gl',
  'ref',
  'referrer',
]);

export function isTrackingParam(key) {
  const k = String(key || '').toLowerCase();
  if (!k) return false;
  if (TRACKING_EXACT.has(k)) return true;
  if (k.startsWith('utm_')) return true;
  if (k.startsWith('utm_yn')) return true;
  if (k.startsWith('yn_')) return true;
  if (k.startsWith('mtm_')) return true;
  if (k.startsWith('pk_')) return true;
  if (k.endsWith('clid')) return true;
  return false;
}

export function decodePathname(pathname) {
  return String(pathname || '/')
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      try {
        return decodeURIComponent(seg.replace(/\+/g, ' '));
      } catch {
        return seg;
      }
    })
    .join('/');
}

/** Pretty label for admin tables: readable Persian, no tracking junk. */
export function displayPath(path) {
  const normalized = normalizePath(path);
  return normalized.length > 120 ? normalized.slice(0, 117) + '…' : normalized;
}

/**
 * Store a stable page path:
 * - decode percent-encoding (Persian slugs)
 * - drop ad/UTM/Yektanet query junk
 * - drop leftover query if still huge
 */
export function normalizePath(p) {
  if (!p || typeof p !== 'string') return '/';
  let raw = p.slice(0, 4096);
  try {
    const u = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://local.invalid');
    for (const key of [...u.searchParams.keys()]) {
      if (isTrackingParam(key)) u.searchParams.delete(key);
    }
    let search = u.searchParams.toString();
    if (search.length > 80) search = '';
    let pathname = decodePathname(u.pathname || '/');
    if (!pathname.startsWith('/')) pathname = '/' + pathname;
    // collapse duplicate slashes, keep a single trailing slash style from source
    pathname = pathname.replace(/\/{2,}/g, '/');
    raw = pathname + (search ? `?${search}` : '');
  } catch {
    try {
      raw = decodePathname(raw.split('?')[0]);
    } catch {
      raw = raw.split('?')[0];
    }
  }
  if (!raw.startsWith('/')) raw = '/' + raw;
  return raw.slice(0, 512);
}

export function isNoisePath(path) {
  const p = normalizePath(path).toLowerCase();
  return (
    p.startsWith('/wp-admin') ||
    p.startsWith('/wp-login') ||
    p.startsWith('/wp-json') ||
    p.startsWith('/xmlrpc.php')
  );
}
