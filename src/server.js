import express from 'express';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb, migrate, ping, dialect, engine } from './lib/db.js';
import { initAuthSecret } from './lib/auth.js';
import trackRoutes from './routes/track.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '../public');
const PORT = Number(process.env.PORT || 3000);
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false';

async function main() {
  await initDb();
  await migrate();
  await initAuthSecret();
  console.log(`Database migrated (${dialect}/${engine})`);

  const app = express();
  // LiteSpeed/nginx → Node: trust X-Forwarded-For / X-Real-IP so visitor IPs aren't blank.
  if (TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY_HOPS);
    app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : true);
  }

  app.use(express.json({ limit: '32kb' }));
  app.use(express.text({ type: ['text/plain', 'text/*'], limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use((req, _res, next) => {
    if (typeof req.body === 'string' && req.body.length) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        /* leave as string; routes will reject */
      }
    }
    next();
  });
  app.use(cookieParser());

  app.use('/', trackRoutes);

  app.get('/t.js', (req, res) => {
    const host = String(req.get('host') || '').replace(/[^A-Za-z0-9.:\-[\]]/g, '');
    const origin = host ? `${req.protocol}://${host}` : '';
    const js = readFileSync(join(publicDir, 't.js'), 'utf8').replaceAll('__IA_ORIGIN__', origin);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(js);
  });

  // Login lives at /auth/*; also alias under /api/* (before the authed API router)
  // so POST /api/login is not swallowed by requireAuth → {"error":"unauthorized"}.
  app.use('/auth', authRoutes);
  app.use('/api', authRoutes);
  app.use('/api', apiRoutes);

  app.use('/admin', express.static(join(publicDir, 'admin'), { index: 'index.html' }));
  app.get('/', (_req, res) => res.redirect('/admin/'));

  app.get('/healthz', async (_req, res) => {
    try {
      await ping();
      res.json({ ok: true, dialect, engine });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Iran Analytics listening on :${PORT} (${dialect}/${engine})`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
