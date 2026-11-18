import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from './db.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const revoked = new Map();

let dbSecret = process.env.SESSION_SECRET || '';

function pruneRevoked() {
  const now = Date.now();
  for (const [jti, exp] of revoked) {
    if (exp <= now) revoked.delete(jti);
  }
}

setInterval(pruneRevoked, 600_000).unref?.();

export function getAdminPasswordHash() {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (hash) return hash;
  const plain = process.env.ADMIN_PASSWORD || 'changeme';
  // Sync hash for env plain password (dev/simple deploy). Prefer ADMIN_PASSWORD_HASH in production.
  return bcrypt.hashSync(plain, 10);
}

let cachedHash = null;
export function adminHash() {
  if (!cachedHash) cachedHash = getAdminPasswordHash();
  return cachedHash;
}

let cachedPwFingerprint = null;
function passwordFingerprint() {
  if (!cachedPwFingerprint) {
    const raw = process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD || 'changeme';
    cachedPwFingerprint = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }
  return cachedPwFingerprint;
}

/** Load or generate a durable signing secret in DB so logins survive restarts. */
export async function initAuthSecret() {
  if (process.env.SESSION_SECRET) {
    dbSecret = process.env.SESSION_SECRET;
    return;
  }
  try {
    const { rows } = await query('SELECT value FROM settings WHERE key = $1 LIMIT 1', ['session_secret']);
    if (rows[0]?.value) {
      dbSecret = rows[0].value;
      return;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['session_secret', generated]);
    dbSecret = generated;
  } catch (err) {
    console.warn('initAuthSecret fallback:', err.message);
    if (!dbSecret) dbSecret = crypto.randomBytes(32).toString('hex');
  }
}

function signingKey() {
  const base = dbSecret || process.env.SESSION_SECRET || 'fallback-dev-secret';
  return crypto
    .createHash('sha256')
    .update(base + ':' + passwordFingerprint())
    .digest();
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', signingKey()).update(payloadB64).digest('base64url');
}

export async function verifyPassword(password) {
  return bcrypt.compare(password, adminHash());
}

export function createSession() {
  const payload = {
    jti: crypto.randomBytes(12).toString('hex'),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

function parseToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return null;

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.exp !== 'number' || !parsed.jti) return null;
    if (parsed.exp <= Date.now()) return null;
    if (revoked.has(parsed.jti)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function destroySession(token) {
  const parsed = parseToken(token);
  if (parsed) revoked.set(parsed.jti, parsed.exp);
}

export function isValidSession(token) {
  return !!parseToken(token);
}

export function shouldRefreshSession(token) {
  const parsed = parseToken(token);
  if (!parsed) return false;
  // Refresh cookie if less than 20 days remain so active admins stay signed in.
  return parsed.exp - Date.now() < 1000 * 60 * 60 * 24 * 20;
}

export function cookieOptions() {
  // Explicit COOKIE_SECURE wins. false keeps session cookies on plain HTTP (:3000).
  const flag = process.env.COOKIE_SECURE;
  const secure =
    flag === 'true' ? true : flag === 'false' ? false : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export function hashPasswordCli(password) {
  return bcrypt.hashSync(password, 12);
}
