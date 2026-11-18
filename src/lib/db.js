import pg from 'pg';
import crypto from 'crypto';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

const rawUrl = process.env.DATABASE_URL || '';
export const dialect = detectDialect(rawUrl);

/** @type {'better-sqlite3'|'sql.js'|'postgres'} */
export let engine = 'postgres';

let pgPool = null;
let sqlite = null; // better-sqlite3 Database or sql.js wrapper
let sqlJsPersistPath = null;
let sqlJsDirty = false;
let sqlJsFlushTimer = null;

function detectDialect(url) {
  if (!url) return 'postgres';
  const u = url.trim().toLowerCase();
  if (u.startsWith('sqlite:') || u.startsWith('sqlite3:')) return 'sqlite';
  return 'postgres';
}

export function newId() {
  return crypto.randomUUID();
}

export function parseSqlitePath(url) {
  // sqlite:./data.db | sqlite:///abs/path.db | sqlite:/rel/path.db
  let path = url.replace(/^sqlite3?:/i, '');
  if (path.startsWith('///')) path = path.slice(2); // sqlite:///tmp/x.db → /tmp/x.db
  else if (path.startsWith('//')) path = path.slice(1);
  if (!path || path === '/') path = './data/iran-analytics.db';
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

async function openBetterSqlite(filePath) {
  const mod = await import('better-sqlite3');
  const Database = mod.default;
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return {
    kind: 'better-sqlite3',
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    get(sql, params = []) {
      return db.prepare(sql).get(...params);
    },
    close() {
      db.close();
    },
  };
}

async function openSqlJs(filePath) {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs({
    locateFile: (file) => join(rootDir, 'node_modules/sql.js/dist', file),
  });
  mkdirSync(dirname(filePath), { recursive: true });
  let db;
  if (existsSync(filePath)) {
    db = new SQL.Database(readFileSync(filePath));
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  sqlJsPersistPath = filePath;

  function persist() {
    if (!sqlJsPersistPath) return;
    const data = db.export();
    writeFileSync(sqlJsPersistPath, Buffer.from(data));
    sqlJsDirty = false;
  }

  function schedulePersist() {
    sqlJsDirty = true;
    if (sqlJsFlushTimer) return;
    sqlJsFlushTimer = setTimeout(() => {
      sqlJsFlushTimer = null;
      try {
        persist();
      } catch (err) {
        console.error('sql.js persist error', err);
      }
    }, 50);
    sqlJsFlushTimer.unref?.();
  }

  return {
    kind: 'sql.js',
    exec(sql) {
      db.run(sql);
      schedulePersist();
    },
    run(sql, params = []) {
      db.run(sql, params);
      schedulePersist();
      const changes = db.getRowsModified();
      return { changes, lastInsertRowid: null };
    },
    all(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    get(sql, params = []) {
      const rows = this.all(sql, params);
      return rows[0];
    },
    close() {
      if (sqlJsFlushTimer) {
        clearTimeout(sqlJsFlushTimer);
        sqlJsFlushTimer = null;
      }
      if (sqlJsDirty) persist();
      db.close();
    },
    flush: persist,
  };
}

export async function initDb() {
  if (dialect === 'sqlite') {
    const filePath = parseSqlitePath(rawUrl || 'sqlite:./data/iran-analytics.db');
    const forceSqlJs = process.env.IA_FORCE_SQLJS === '1';
    if (!forceSqlJs) {
      try {
        sqlite = await openBetterSqlite(filePath);
        engine = 'better-sqlite3';
        console.log(`SQLite (better-sqlite3): ${filePath}`);
        return;
      } catch (err) {
        console.warn('better-sqlite3 unavailable, falling back to sql.js:', err.message);
      }
    } else {
      console.warn('IA_FORCE_SQLJS=1 — using sql.js');
    }
    sqlite = await openSqlJs(filePath);
    engine = 'sql.js';
    console.log(`SQLite (sql.js): ${filePath}`);
    return;
  }

  pgPool = new Pool({
    connectionString:
      rawUrl || 'postgres://iran_analytics:iran_analytics_dev@127.0.0.1:5432/iran_analytics',
    max: Number(process.env.DB_POOL_MAX || 10),
  });
  engine = 'postgres';
}

/** @deprecated use ping(); kept for older imports */
export const pool = {
  async query(text, params) {
    return query(text, params);
  },
  async end() {
    if (pgPool) await pgPool.end();
    if (sqlite) sqlite.close();
  },
};

/** Expand $1/$2… to ? and duplicate bound values when a $n is reused (PG-style). */
function pgToSqlitePlaceholders(text, params = []) {
  const ordered = [];
  const sql = text.replace(/\$(\d+)/g, (_, n) => {
    ordered.push(params[Number(n) - 1]);
    return '?';
  });
  return { sql, params: ordered };
}

function normalizeSqliteSql(text) {
  let s = text;
  s = s.replace(/::int\b/gi, '');
  s = s.replace(/::integer\b/gi, '');
  s = s.replace(/::date\b/gi, '');
  s = s.replace(/::jsonb\b/gi, '');
  s = s.replace(/::json\b/gi, '');
  s = s.replace(/\bTRUE\b/g, '1');
  s = s.replace(/\bFALSE\b/g, '0');
  s = s.replace(/\bNOW\(\)/gi, "datetime('now')");
  // NOW() - INTERVAL '1 day'
  s = s.replace(
    /datetime\('now'\)\s*-\s*INTERVAL\s+'(\d+)\s+days?'/gi,
    (_m, d) => `datetime('now', '-${d} days')`
  );
  s = s.replace(/NOW\(\)\s*-\s*INTERVAL\s+'(\d+)\s+days?'/gi, (_m, d) => `datetime('now', '-${d} days')`);
  // NOW() - ($n || ' days')::interval * 2
  s = s.replace(
    /datetime\('now'\)\s*-\s*\((\?|\$\d+)\s*\|\|\s*' days'\)::interval\s*\*\s*2/gi,
    (_m, p) => `datetime('now', '-' || (${p} * 2) || ' days')`
  );
  s = s.replace(
    /NOW\(\)\s*-\s*\((\?|\$\d+)\s*\|\|\s*' days'\)::interval\s*\*\s*2/gi,
    (_m, p) => `datetime('now', '-' || (${p} * 2) || ' days')`
  );
  // NOW() - ($n || ' days')::interval
  s = s.replace(
    /datetime\('now'\)\s*-\s*\((\?|\$\d+)\s*\|\|\s*' days'\)::interval/gi,
    (_m, p) => `datetime('now', '-' || ${p} || ' days')`
  );
  s = s.replace(
    /NOW\(\)\s*-\s*\((\?|\$\d+)\s*\|\|\s*' days'\)::interval/gi,
    (_m, p) => `datetime('now', '-' || ${p} || ' days')`
  );
  // date_trunc('day', created_at AT TIME ZONE 'UTC')::date
  s = s.replace(
    /date_trunc\(\s*'day'\s*,\s*([a-zA-Z0-9_.]+)\s*AT TIME ZONE\s*'UTC'\s*\)(::date)?/gi,
    "strftime('%Y-%m-%d', $1)"
  );
  s = s.replace(
    /date_trunc\(\s*'day'\s*,\s*([a-zA-Z0-9_.]+)\s*\)(::date)?/gi,
    "strftime('%Y-%m-%d', $1)"
  );
  return s;
}

function normalizeRow(row) {
  if (!row) return row;
  const out = { ...row };
  if ('is_active' in out) {
    out.is_active = out.is_active === true || out.is_active === 1 || out.is_active === '1';
  }
  return out;
}

function adaptParams(params) {
  return (params || []).map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

export async function query(text, params = []) {
  if (dialect === 'sqlite') {
    if (!sqlite) await initDb();
    let sql = normalizeSqliteSql(text);
    const converted = pgToSqlitePlaceholders(sql, adaptParams(params));
    sql = converted.sql;
    const bound = converted.params;
    const trimmed = sql.trim().toLowerCase();
    const wantsRows =
      trimmed.startsWith('select') ||
      trimmed.includes(' returning ') ||
      trimmed.startsWith('with');

    if (wantsRows) {
      const rows = sqlite.all(sql, bound).map(normalizeRow);
      return { rows, rowCount: rows.length };
    }
    const info = sqlite.run(sql, bound);
    return { rows: [], rowCount: info.changes || 0 };
  }

  if (!pgPool) await initDb();
  return pgPool.query(text, params);
}

const PAGEVIEW_EXTRA_COLUMNS = [
  ['view_id', "TEXT NOT NULL DEFAULT ''"],
  ['utm_source', "TEXT NOT NULL DEFAULT ''"],
  ['utm_medium', "TEXT NOT NULL DEFAULT ''"],
  ['utm_campaign', "TEXT NOT NULL DEFAULT ''"],
  ['utm_term', "TEXT NOT NULL DEFAULT ''"],
  ['utm_content', "TEXT NOT NULL DEFAULT ''"],
  ['duration_ms', 'INTEGER NOT NULL DEFAULT 0'],
  ['scroll_depth', 'INTEGER NOT NULL DEFAULT 0'],
];

/** Add engagement/UTM columns on databases created before this release. */
async function ensurePageviewColumns() {
  if (dialect === 'sqlite') {
    const have = new Set(sqlite.all('PRAGMA table_info(pageviews)').map((row) => row.name));
    for (const [name, ddl] of PAGEVIEW_EXTRA_COLUMNS) {
      if (!have.has(name)) sqlite.exec(`ALTER TABLE pageviews ADD COLUMN ${name} ${ddl}`);
    }
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_pageviews_view ON pageviews (site_id, view_id)');
    sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_pageviews_campaign ON pageviews (site_id, utm_campaign, utm_source)'
    );
    if (sqlite.flush) sqlite.flush();
    return;
  }

  for (const [name, ddl] of PAGEVIEW_EXTRA_COLUMNS) {
    await pgPool.query(`ALTER TABLE pageviews ADD COLUMN IF NOT EXISTS ${name} ${ddl}`);
  }
  await pgPool.query('CREATE INDEX IF NOT EXISTS idx_pageviews_view ON pageviews (site_id, view_id)');
  await pgPool.query(
    'CREATE INDEX IF NOT EXISTS idx_pageviews_campaign ON pageviews (site_id, utm_campaign, utm_source)'
  );
}

/** Rewrite stored paths that still carry ad/UTM junk or percent-encoded Persian. */
async function cleanupStoredPaths() {
  const { normalizePath } = await import('./path.js');
  const { rows } = await query('SELECT DISTINCT path FROM pageviews LIMIT 2000');
  for (const row of rows) {
    const next = normalizePath(row.path);
    if (!next || next === row.path) continue;
    await query('UPDATE pageviews SET path = $1 WHERE path = $2', [next, row.path]);
    await query('UPDATE events SET path = $1 WHERE path = $2', [next, row.path]);
  }
}

export async function migrate() {
  if (!pgPool && !sqlite) await initDb();
  if (dialect === 'sqlite') {
    const sqlPath = join(rootDir, 'sql/schema.sqlite.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    sqlite.exec(sql);
  } else {
    const sqlPath = join(rootDir, 'sql/schema.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    await pgPool.query(sql);
  }
  await ensurePageviewColumns();
  await cleanupStoredPaths();
}

export async function ping() {
  if (dialect === 'sqlite') {
    if (!sqlite) await initDb();
    sqlite.get('SELECT 1 AS ok');
    return true;
  }
  if (!pgPool) await initDb();
  await pgPool.query('SELECT 1');
  return true;
}

export async function closeDb() {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (sqlite) {
    sqlite.close();
    sqlite = null;
  }
}

// silence unused in some bundlers
void pathToFileURL;
