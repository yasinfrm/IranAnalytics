// Exact Jalaali <-> Gregorian conversion (Borkowski algorithm) + Asia/Tehran (+03:30) ranges.

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

function div(a, b) {
  return ~~(a / b);
}

function mod(a, b) {
  return a - ~~(a / b) * b;
}

function jalCal(jy) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;

  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm;
  let jd;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export function isValidJalali(jy, jm, jd) {
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1) return false;
  const maxD = jm <= 6 ? 31 : jm <= 11 ? 30 : jalCal(jy).leap === 0 ? 30 : 29;
  return jd <= maxD;
}

export function jalaliToGregorian(jy, jm, jd) {
  return d2g(j2d(jy, jm, jd));
}

export function gregorianToJalali(gy, gm, gd) {
  return d2j(g2d(gy, gm, gd));
}

const TEHRAN_OFFSET_MS = 210 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeDigits(str) {
  return String(str || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Parse either Jalali ("1405-08-27" / "1405/08/27") or Gregorian ("2026-11-18")
 * and return { gy, gm, gd } representing a Tehran calendar day.
 */
export function parseUserDate(raw) {
  const s = normalizeDigits(raw).trim();
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y >= 1300 && y <= 1550) {
    if (!isValidJalali(y, mo, d)) return null;
    return jalaliToGregorian(y, mo, d);
  }
  if (y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
    return { gy: y, gm: mo, gd: d };
  }
  return null;
}

/** Convert Tehran local day {gy,gm,gd} 00:00:00 -> UTC Date. */
export function tehranDayStartUtc(gy, gm, gd) {
  return new Date(Date.UTC(gy, gm - 1, gd, 0, 0, 0) - TEHRAN_OFFSET_MS);
}

/** Current calendar day in Asia/Tehran (+03:30). */
export function tehranTodayGregorian() {
  const tehran = new Date(Date.now() + TEHRAN_OFFSET_MS);
  return {
    gy: tehran.getUTCFullYear(),
    gm: tehran.getUTCMonth() + 1,
    gd: tehran.getUTCDate(),
  };
}

export function formatUtcForDialect(date, dialect) {
  const iso = date.toISOString();
  if (dialect === 'sqlite') {
    return iso.slice(0, 19).replace('T', ' ');
  }
  return iso;
}

/** Format a Gregorian "YYYY-MM-DD" (already in Tehran day) as Jalali "1405/08/27". */
export function gregorianDayToJalaliStr(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(ymd || '');
  const j = gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
}

/** Format a UTC timestamp string from SQLite/Postgres to Tehran Jalali date+time. */
export function formatTimestampJalali(ts) {
  if (!ts) return '';
  const raw = String(ts);
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return raw;
  const t = new Date(d.getTime() + TEHRAN_OFFSET_MS);
  const j = gregorianToJalali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}
