import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const sessions = new Map();

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(id);
  }
}

setInterval(pruneSessions, 60_000).unref?.();

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

export async function verifyPassword(password) {
  return bcrypt.compare(password, adminHash());
}

export function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

export function destroySession(id) {
  if (id) sessions.delete(id);
}

export function isValidSession(id) {
  if (!id) return false;
  const s = sessions.get(id);
  if (!s) return false;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(id);
    return false;
  }
  // sliding expiry
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
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
