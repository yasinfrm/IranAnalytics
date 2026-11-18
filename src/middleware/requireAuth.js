import { isValidSession } from '../lib/auth.js';

export function requireAuth(req, res, next) {
  const sid = req.cookies?.ia_session;
  if (!isValidSession(sid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
