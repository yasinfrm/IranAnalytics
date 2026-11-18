# ایران آنالیتیکس / Iran Analytics

Self-hosted lightweight web analytics for sites in Iran (where Google Analytics is often blocked).  
آنالیتیکس سبک و خودمیزبان برای سایت‌های ایرانی — بدون وابستگی به CDNهای فیلترشده برای اسکریپت رهگیری.

- One first-party `<script>` tag (WordPress & non-WordPress)
- Persian (fa) RTL admin panel — custom UI (no Tailwind/shadcn kit look)
- Docker Compose **or** bare Node 20+ + system Postgres (no Docker)
- Multi-site: each site has an id + public tracking key
- Pageviews + optional custom events
- Simple admin login (env password or bcrypt hash)

> **AlmaLinux / cPanel / Docker+dnf blocked?** Use SQLite — no Postgres packages needed.  
> See [`DEPLOY-NO-DOCKER.md`](./DEPLOY-NO-DOCKER.md).

---

## English — Deploy on a Linux VPS

### Option A — No Docker / SQLite (recommended when dnf & Docker are blocked)

See **[DEPLOY-NO-DOCKER.md](./DEPLOY-NO-DOCKER.md)**.

```bash
cd /opt/iran-analytics && npm install && mkdir -p data && \
export DATABASE_URL='sqlite:./data/iran-analytics.db' \
  ADMIN_USERNAME='admin' ADMIN_PASSWORD='ADMINPASS' PORT=3000 \
  COOKIE_SECURE=false TRUST_PROXY=true NODE_ENV=production && \
npm start
```

Uses `better-sqlite3` if it builds; otherwise pure-JS `sql.js`. Postgres still works via `DATABASE_URL=postgres://…`.

App env vars: `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`, `PORT` (default 3000), `COOKIE_SECURE`, `TRUST_PROXY`.  
Schema: auto on `npm start`, or `npm run db:migrate`.

### Option B — Docker Compose

### Requirements (Docker path)

- Docker + Docker Compose plugin
- A domain or IP pointing to your VPS (optional but recommended)
- Outbound access to pull `postgres:16-alpine` and `node:22-alpine` images once

### 1) Copy the project

```bash
# upload / clone this folder to the server, e.g.
scp -r iran-analytics user@YOUR_VPS:~/iran-analytics
cd ~/iran-analytics
```

### 2) Configure environment

```bash
cp .env.example .env
nano .env
```

Set at least:

- `POSTGRES_PASSWORD` — strong DB password  
- `ADMIN_PASSWORD` **or** `ADMIN_PASSWORD_HASH` — admin login  
- `APP_PORT` — host port (default `3000`)

Generate a bcrypt hash (on any machine with Node):

```bash
npm install
npm run hash-password -- "your-strong-password"
# paste output into ADMIN_PASSWORD_HASH=...
# leave ADMIN_PASSWORD empty when using the hash
```

### 3) Start

```bash
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:3000/healthz
```

Open: `http://YOUR_SERVER:3000/admin/`  
Login with `ADMIN_USERNAME` (default `admin`) and your password.

### 4) HTTPS (recommended)

Put Nginx / Caddy in front and terminate TLS. Example Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name analytics.example.ir;

  # ssl_certificate ...;
  # ssl_certificate_key ...;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then set in `.env`:

```
COOKIE_SECURE=true
TRUST_PROXY=true
```

and `docker compose up -d`.

### Embed snippet

In the admin panel → **سایت‌ها**, create a site and copy the snippet. Sample:

```html
<script defer src="https://analytics.example.ir/t.js" data-site="ia_YOUR_PUBLIC_KEY"></script>
```

Optional custom events (from your page JS):

```html
<script>
  // after t.js loads
  window.iranAnalytics && iranAnalytics.track('signup_click', { plan: 'pro' });
</script>
```

### WordPress

1. **Theme / header**: Appearance → Theme File Editor → `header.php` (or a “Insert Headers” plugin) — paste the snippet before `</head>` or in the footer.  
2. **Or lightweight plugin idea**: create `wp-content/plugins/iran-analytics/iran-analytics.php` that calls `wp_enqueue_script` with your `/t.js` URL and `data-site` attribute via `wp_script_add_data` / inline attrs. No official WP.org plugin ships with this repo; one script tag is enough.

### Local Node (without Docker)

Full guide: **[DEPLOY-NO-DOCKER.md](./DEPLOY-NO-DOCKER.md)**.

```bash
# SQLite (no Postgres)
npm install && mkdir -p data
export DATABASE_URL=sqlite:./data/iran-analytics.db ADMIN_PASSWORD=changeme PORT=3000
npm start

# Or Postgres
export DATABASE_URL=postgres://iran_analytics:pass@127.0.0.1:5432/iran_analytics
npm start
```

Note: stock app does not auto-load `.env`; export vars or use systemd `Environment=`.  
Compose vars `POSTGRES_*` / `APP_PORT` are **not** read by Node.

---

## فارسی — راه‌اندازی روی سرور لینوکس

### بدون داکر / SQLite (AlmaLinux + cPanel — اگر dnf و Docker مسدودند)

راهنمای کامل: **[DEPLOY-NO-DOCKER.md](./DEPLOY-NO-DOCKER.md)**

```bash
cd ~/iran-analytics && npm install && mkdir -p data
export DATABASE_URL='sqlite:./data/iran-analytics.db'
export ADMIN_PASSWORD='ADMINPASS' PORT=3000
npm start
```

نیازی به نصب Postgres نیست. اسکیما با `npm start` اعمال می‌شود.

### با داکر

### پیش‌نیاز

- Docker و Docker Compose
- دامنه یا IP سرور

### مراحل

```bash
cd ~/iran-analytics
cp .env.example .env
nano .env   # رمز دیتابیس و رمز ادمین را عوض کنید
docker compose up -d --build
```

پنل: `http://آدرس-سرور:3000/admin/`  
کاربر پیش‌فرض: `admin`

برای HTTPS پشت Nginx/Caddy، `COOKIE_SECURE=true` بگذارید.

### نمونه کد رهگیری

```html
<script defer src="https://analytics.example.ir/t.js" data-site="ia_YOUR_PUBLIC_KEY"></script>
```

اسکریپت از همان سرور شما سرو می‌شود — نیازی به CDN خارجی یا Google Analytics نیست و از داخل ایران قابل بارگذاری است (مادامی که سرور خودتان در دسترس باشد).

### وردپرس

همان تگ `<script>` را در هدر یا فوتر قالب بچسبانید (یا با افزونه Insert Headers and Footers). یک افزونه رسمی لازم نیست.

---

## API overview

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /collect` | no | pageview / event ingest |
| `GET /e.gif` | no | pixel fallback |
| `GET /t.js` | no | tracker script |
| `POST /auth/login` | no | admin login (alias: `POST /api/login`) |
| `GET /api/sites` | yes | list sites |
| `GET /api/stats/*` | yes | dashboard stats |
| `GET /healthz` | no | health check |

---

## Security notes

- Change default passwords before exposing the port publicly.
- Prefer `ADMIN_PASSWORD_HASH` over plain `ADMIN_PASSWORD`.
- Restrict admin via firewall / VPN if possible; tracker endpoints stay public.
- Data stays on your Postgres volume (`ia_pgdata`).

## License

MIT — build, fork, and host freely.
