import { Router } from 'express';
import {
  verifyPassword,
  createSession,
  destroySession,
  isValidSession,
  shouldRefreshSession,
  cookieOptions,
} from '../lib/auth.js';

const router = Router();

router.get('/me', (req, res) => {
  const token = req.cookies?.ia_session;
  const ok = isValidSession(token);
  if (ok && shouldRefreshSession(token)) {
    res.cookie('ia_session', createSession(), cookieOptions());
  }
  res.json({ authenticated: ok });
});

router.post('/login', async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    const username = String(req.body?.username || '').trim();
    const expectedUser = process.env.ADMIN_USERNAME || 'admin';

    if (username && username !== expectedUser) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    if (!password || !(await verifyPassword(password))) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const sid = createSession();
    res.cookie('ia_session', sid, cookieOptions());
    res.json({ ok: true });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies?.ia_session);
  res.clearCookie('ia_session', { path: '/' });
  res.json({ ok: true });
});

export default router;
