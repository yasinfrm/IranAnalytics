/* Client-side Jalali calendar + Persian date helper (UTC+03:30 Tehran) */
(function (global) {
  const BREAKS = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
    2456, 3178,
  ];
  const MONTHS = [
    'فروردین',
    'اردیبهشت',
    'خرداد',
    'تیر',
    'مرداد',
    'شهریور',
    'مهر',
    'آبان',
    'آذر',
    'دی',
    'بهمن',
    'اسفند',
  ];
  const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  const TEHRAN_MS = 210 * 60 * 1000;

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
    return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
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
    if (k >= 0) {
      if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }

  function monthDays(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return jalCal(jy).leap === 0 ? 30 : 29;
  }

  function todayJalali() {
    const t = new Date(Date.now() + TEHRAN_MS);
    return d2j(g2d(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()));
  }

  function addJalaliDays(j, delta) {
    return d2j(j2d(j.jy, j.jm, j.jd) + delta);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toEnDigits(s) {
    return String(s || '')
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  }

  function toFaDigits(s) {
    return String(s || '').replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
  }

  function formatStr(j) {
    return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
  }

  function parseStr(raw) {
    const m = toEnDigits(raw).trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (!m) return null;
    const jy = Number(m[1]);
    const jm = Number(m[2]);
    const jd = Number(m[3]);
    if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > monthDays(jy, jm)) return null;
    return { jy, jm, jd };
  }

  function cmp(a, b) {
    return j2d(a.jy, a.jm, a.jd) - j2d(b.jy, b.jm, b.jd);
  }

  function firstWeekdayOfMonth(jy, jm) {
    // Saturday = 0 .. Friday = 6
    const g = d2g(j2d(jy, jm, 1));
    const dow = new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay(); // Sun=0..Sat=6
    return (dow + 1) % 7;
  }

  function createRangePicker(mountEl, initial, onChange) {
    let from = initial.from;
    let to = initial.to;
    let viewY = to.jy;
    let viewM = to.jm;
    let pickingStart = null;
    let open = false;

    const wrap = document.createElement('div');
    wrap.className = 'jalali-picker';
    wrap.innerHTML = `
      <button type="button" class="chip-select jalali-trigger" aria-expanded="false"></button>
      <div class="jalali-pop hidden" role="dialog" aria-label="انتخاب تاریخ شمسی">
        <div class="jalali-presets">
          <button type="button" data-preset="today">امروز</button>
          <button type="button" data-preset="yesterday">دیروز</button>
          <button type="button" data-preset="7">۷ روز اخیر</button>
          <button type="button" data-preset="30">۳۰ روز اخیر</button>
          <button type="button" data-preset="month">این ماه</button>
          <button type="button" data-preset="90">۹۰ روز</button>
        </div>
        <div class="jalali-cal-head">
          <button type="button" class="cal-nav" data-dir="1" title="ماه بعد">›</button>
          <span class="cal-title"></span>
          <button type="button" class="cal-nav" data-dir="-1" title="ماه قبل">‹</button>
        </div>
        <div class="jalali-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="jalali-days"></div>
        <div class="jalali-inputs">
          <label>از <input type="text" class="j-from" dir="ltr" placeholder="1405/08/20" /></label>
          <label>تا <input type="text" class="j-to" dir="ltr" placeholder="1405/08/27" /></label>
          <button type="button" class="btn btn-primary j-apply" style="width:auto;padding:7px 14px">اعمال</button>
        </div>
      </div>
    `;
    mountEl.innerHTML = '';
    mountEl.appendChild(wrap);

    const trigger = wrap.querySelector('.jalali-trigger');
    const pop = wrap.querySelector('.jalali-pop');
    const titleEl = wrap.querySelector('.cal-title');
    const daysEl = wrap.querySelector('.jalali-days');
    const fromInput = wrap.querySelector('.j-from');
    const toInput = wrap.querySelector('.j-to');

    function updateTrigger() {
      const f = formatStr(from);
      const t = formatStr(to);
      trigger.textContent = f === t ? `تاریخ: ${toFaDigits(f)}` : `${toFaDigits(f)} تا ${toFaDigits(t)}`;
      fromInput.value = f;
      toInput.value = t;
    }

    function renderCal() {
      titleEl.textContent = `${MONTHS[viewM - 1]} ${toFaDigits(viewY)}`;
      const offset = firstWeekdayOfMonth(viewY, viewM);
      const total = monthDays(viewY, viewM);
      const cells = [];
      for (let i = 0; i < offset; i++) cells.push('<span class="cal-empty"></span>');
      for (let d = 1; d <= total; d++) {
        const cur = { jy: viewY, jm: viewM, jd: d };
        const start = pickingStart || from;
        const end = pickingStart || to;
        const isEdge = cmp(cur, start) === 0 || cmp(cur, end) === 0;
        const inRange = cmp(cur, start) >= 0 && cmp(cur, end) <= 0;
        const cls = ['cal-day', isEdge ? 'is-edge' : '', inRange && !isEdge ? 'in-range' : '']
          .filter(Boolean)
          .join(' ');
        cells.push(`<button type="button" class="${cls}" data-day="${d}">${toFaDigits(d)}</button>`);
      }
      daysEl.innerHTML = cells.join('');
    }

    function commit(newFrom, newTo, closeAfter = true) {
      if (cmp(newFrom, newTo) > 0) {
        from = newTo;
        to = newFrom;
      } else {
        from = newFrom;
        to = newTo;
      }
      pickingStart = null;
      viewY = to.jy;
      viewM = to.jm;
      updateTrigger();
      renderCal();
      if (closeAfter) setOpen(false);
      onChange({ from: formatStr(from), to: formatStr(to) });
    }

    function setOpen(next) {
      open = next;
      pop.classList.toggle('hidden', !open);
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) renderCal();
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!open);
    });

    pop.addEventListener('click', (e) => e.stopPropagation());

    document.addEventListener('click', () => {
      if (open) setOpen(false);
    });

    wrap.querySelectorAll('.cal-nav').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = Number(btn.dataset.dir);
        viewM += dir;
        if (viewM > 12) {
          viewM = 1;
          viewY += 1;
        } else if (viewM < 1) {
          viewM = 12;
          viewY -= 1;
        }
        renderCal();
      });
    });

    daysEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-day]');
      if (!btn) return;
      const picked = { jy: viewY, jm: viewM, jd: Number(btn.dataset.day) };
      if (!pickingStart) {
        pickingStart = picked;
        renderCal();
      } else {
        commit(pickingStart, picked, true);
      }
    });

    wrap.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.preset;
        const today = todayJalali();
        if (p === 'today') return commit(today, today, true);
        if (p === 'yesterday') {
          const y = addJalaliDays(today, -1);
          return commit(y, y, true);
        }
        if (p === 'month') {
          return commit({ jy: today.jy, jm: today.jm, jd: 1 }, today, true);
        }
        const days = Number(p) || 7;
        return commit(addJalaliDays(today, -(days - 1)), today, true);
      });
    });

    wrap.querySelector('.j-apply').addEventListener('click', () => {
      const pf = parseStr(fromInput.value);
      const pt = parseStr(toInput.value);
      if (!pf || !pt) return;
      commit(pf, pt, true);
    });

    updateTrigger();

    return {
      getValue() {
        return { from: formatStr(from), to: formatStr(to) };
      },
      setValue(nextFrom, nextTo) {
        const pf = typeof nextFrom === 'string' ? parseStr(nextFrom) : nextFrom;
        const pt = typeof nextTo === 'string' ? parseStr(nextTo) : nextTo;
        if (!pf || !pt) return;
        from = pf;
        to = pt;
        viewY = to.jy;
        viewM = to.jm;
        updateTrigger();
        if (open) renderCal();
      },
    };
  }

  global.IAJalali = {
    todayJalali,
    addJalaliDays,
    formatStr,
    parseStr,
    toFaDigits,
    createRangePicker,
  };
})(window);
