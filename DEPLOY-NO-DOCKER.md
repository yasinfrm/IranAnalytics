# Deploy without Docker (AlmaLinux / CloudLinux / cPanel)

Use this when Docker Hub / `get.docker.com` / some `dnf` mirrors are blocked (OFAC 451).

**You already have Node 20+.** Prefer **SQLite** (zero system packages). Postgres remains supported if you can install it.

---

## Exact env vars the Node app reads

| Variable | Required | Default | Notes |
|----------|----------|---------|--------|
| `DATABASE_URL` | yes* | postgres localhost URL | See SQLite / Postgres forms below |
| `ADMIN_USERNAME` | no | `admin` | Login username |
| `ADMIN_PASSWORD` | one of these | `changeme` | Plain password |
| `ADMIN_PASSWORD_HASH` | one of these | — | bcrypt; wins if set |
| `PORT` | no | `3000` | Listen port (**not** `APP_PORT`) |
| `COOKIE_SECURE` | no | see note | Explicit `false` wins over `NODE_ENV=production` (needed for plain HTTP `:3000`). Use `true` only behind HTTPS. |
| `TRUST_PROXY` | no | trusted | Set `false` to disable |
| `NODE_ENV` | no | — | Use `production` on VPS |
| `IA_FORCE_SQLJS` | no | — | `1` = skip native `better-sqlite3`, use pure JS |

\*Always set `DATABASE_URL` on the server.

**Compose-only (ignored by `npm start`):** `POSTGRES_*`, `APP_PORT`.

## Schema + start

| Action | Command |
|--------|---------|
| Schema | Automatic on `npm start`, or `npm run db:migrate` |
| Start | `npm start` → `node src/server.js` |

Stock app does **not** auto-load a `.env` file — export vars or use systemd `Environment=`.

---

## A) SQLite — recommended on AlmaLinux+cPanel (no Postgres, no dnf)

`better-sqlite3` is an **optional** native module (used if it builds). If it fails (no compiler / OFAC repos), the app falls back to pure-JS **`sql.js`** automatically.

### One-liner (copy/paste)

```bash
cd /opt/iran-analytics && \
npm install && \
mkdir -p data && \
export DATABASE_URL='sqlite:./data/iran-analytics.db' \
  ADMIN_USERNAME='admin' \
  ADMIN_PASSWORD='CHANGE_ME_ADMIN_PASS' \
  PORT=3000 \
  COOKIE_SECURE=false \
  TRUST_PROXY=true \
  NODE_ENV=production && \
npm start
```

Absolute path form also works:

```bash
export DATABASE_URL='sqlite:/home/USER/iran-analytics/data/iran-analytics.db'
```

Force pure JS (skip native build entirely):

```bash
export IA_FORCE_SQLJS=1
export DATABASE_URL='sqlite:./data/iran-analytics.db'
# …same ADMIN_* / PORT / npm start
```

Health check should show `"dialect":"sqlite"` and `"engine":"better-sqlite3"` or `"sql.js"`:

```bash
curl -s http://127.0.0.1:3000/healthz
```

Admin: `http://YOUR_IP:3000/admin/`

Data file: `./data/iran-analytics.db` (backup this file). Add `data/` to your backup job.

### systemd example (SQLite)

```ini
[Unit]
Description=Iran Analytics
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/iran-analytics
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATABASE_URL=sqlite:./data/iran-analytics.db
Environment=ADMIN_USERNAME=admin
Environment=ADMIN_PASSWORD=CHANGE_ME_ADMIN_PASS
Environment=COOKIE_SECURE=false
Environment=TRUST_PROXY=true
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

---

## B) System Postgres (when `dnf` works)

```bash
sudo dnf install -y postgresql-server postgresql
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER iran_analytics WITH PASSWORD 'CHANGE_ME_DB_PASS';"
sudo -u postgres psql -c "CREATE DATABASE iran_analytics OWNER iran_analytics;"
sudo -u postgres psql -d iran_analytics -c "GRANT ALL ON SCHEMA public TO iran_analytics;"
# ensure host/md5 in pg_hba.conf for 127.0.0.1, then restart postgresql
```

```bash
cd /opt/iran-analytics && npm install && \
export DATABASE_URL='postgres://iran_analytics:CHANGE_ME_DB_PASS@127.0.0.1:5432/iran_analytics' \
  ADMIN_USERNAME='admin' ADMIN_PASSWORD='CHANGE_ME_ADMIN_PASS' \
  PORT=3000 COOKIE_SECURE=false TRUST_PROXY=true NODE_ENV=production && \
npm start
```

---

## cPanel / reverse proxy tip

Proxy `https://analytics.example.ir` → `http://127.0.0.1:3000`, then set `COOKIE_SECURE=true`.
