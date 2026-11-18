(function () {
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');
  const siteFilter = document.getElementById('site-filter');
  const daysFilter = document.getElementById('days-filter');
  const siteFilterB = document.getElementById('site-filter-b');
  const daysFilterB = document.getElementById('days-filter-b');
  const sitesList = document.getElementById('sites-list');
  const modalRoot = document.getElementById('modal-root');
  const addSiteBtn = document.getElementById('add-site-btn');

  let sites = [];
  let origin = location.origin;

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('unauthorized');
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'request_failed');
      err.data = data;
      throw err;
    }
    return data;
  }

  function faNum(n) {
    return Number(n || 0).toLocaleString('fa-IR');
  }

  function showLogin() {
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
  }

  function showApp() {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
  }

  function setView(name) {
    document.querySelectorAll('.nav button').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === name);
    });
    document.getElementById('view-dashboard').classList.toggle('hidden', name !== 'dashboard');
    document.getElementById('view-behavior').classList.toggle('hidden', name !== 'behavior');
    document.getElementById('view-sites').classList.toggle('hidden', name !== 'sites');
    if (name === 'sites') renderSites();
    if (name === 'dashboard') loadDashboard();
    if (name === 'behavior') loadBehavior();
  }

  document.querySelectorAll('.nav button').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    try {
      // Must be /auth/login (or /api/login alias) — not a protected /api/* route.
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
        }),
      });
      showApp();
      await bootstrap();
    } catch (err) {
      loginError.textContent =
        err && err.message === 'unauthorized'
          ? 'نشست ذخیره نشد. اگر با HTTP باز کرده‌اید، COOKIE_SECURE=false بگذارید و سرویس را ری‌استارت کنید.'
          : 'نام کاربری یا رمز عبور نادرست است.';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      /* ignore */
    }
    showLogin();
  });

  siteFilter.addEventListener('change', () => {
    siteFilterB.value = siteFilter.value;
    loadDashboard();
  });
  daysFilter.addEventListener('change', () => {
    daysFilterB.value = daysFilter.value;
    loadDashboard();
  });
  siteFilterB.addEventListener('change', () => {
    siteFilter.value = siteFilterB.value;
    loadBehavior();
  });
  daysFilterB.addEventListener('change', () => {
    daysFilter.value = daysFilterB.value;
    loadBehavior();
  });
  addSiteBtn.addEventListener('click', () => openSiteModal());

  function fillSiteFilter() {
    const current = siteFilter.value || 'all';
    const options =
      `<option value="all">همه سایت‌ها</option>` +
      sites
        .map(
          (s) =>
            `<option value="${s.id}">${escapeHtml(s.name)}${s.domain ? ' — ' + escapeHtml(s.domain) : ''}</option>`
        )
        .join('');
    siteFilter.innerHTML = options;
    siteFilterB.innerHTML = options;
    const next = sites.some((s) => s.id === current) ? current : 'all';
    siteFilter.value = next;
    siteFilterB.value = siteFilterB.value && (siteFilterB.value === 'all' || sites.some((s) => s.id === siteFilterB.value))
      ? siteFilterB.value
      : next;
  }

  function faDuration(ms) {
    const s = Math.max(0, Math.round(Number(ms || 0) / 1000));
    if (s < 60) return faNum(s) + ' ثانیه';
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (r === 0) return faNum(m) + ' دقیقه';
    return faNum(m) + ' دقیقه و ' + faNum(r) + ' ثانیه';
  }

  function faPct(n) {
    return faNum(Math.round(Number(n || 0))) + '٪';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function embedSnippet(publicKey) {
    return `<script defer src="${origin}/t.js" data-site="${publicKey}"><\/script>`;
  }

  function renderRankTable(el, rows, labelKey, valueKey) {
    if (!rows.length) {
      el.innerHTML = '<p class="empty">داده‌ای نیست.</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => r[valueKey] || 0), 1);
    el.innerHTML = `<table class="table"><thead><tr><th>عنوان</th><th>تعداد</th></tr></thead><tbody>${rows
      .map((r) => {
        const pct = Math.max(8, Math.round(((r[valueKey] || 0) / max) * 100));
        return `<tr>
          <td>${escapeHtml(r[labelKey])}</td>
          <td><div class="bar-cell"><span>${faNum(r[valueKey])}</span><span class="bar" style="width:${pct}%"></span></div></td>
        </tr>`;
      })
      .join('')}</tbody></table>`;
  }

  async function loadDashboard() {
    const site = siteFilter.value || 'all';
    const days = daysFilter.value || '7';
    const q = `site=${encodeURIComponent(site)}&days=${encodeURIComponent(days)}`;

    const [overview, series, pages, referrers, devices, events] = await Promise.all([
      api(`/api/stats/overview?${q}`),
      api(`/api/stats/timeseries?${q}`),
      api(`/api/stats/pages?${q}`),
      api(`/api/stats/referrers?${q}`),
      api(`/api/stats/devices?${q}`),
      api(`/api/stats/events?${q}`),
    ]);

    document.getElementById('stat-pageviews').textContent = faNum(overview.pageviews);
    document.getElementById('stat-sessions').textContent = faNum(overview.sessions);
    document.getElementById('stat-pages').textContent = faNum(overview.unique_pages);
    document.getElementById('stat-events').textContent = faNum(overview.events);
    document.getElementById('stat-time').textContent = overview.avg_ms == null ? '—' : faDuration(overview.avg_ms);
    document.getElementById('stat-scroll').textContent = overview.avg_scroll == null ? '—' : faPct(overview.avg_scroll);
    document.getElementById('stat-clicks').textContent = faNum(overview.clicks);
    document.getElementById('stat-campaigns').textContent = faNum(overview.campaign_views);

    const deltaEl = document.getElementById('stat-delta');
    const prev = overview.previous_pageviews || 0;
    const curr = overview.pageviews || 0;
    if (prev === 0 && curr === 0) {
      deltaEl.textContent = 'مقایسه با دوره قبل: بدون تغییر';
      deltaEl.className = 'stat-delta';
    } else if (prev === 0) {
      deltaEl.textContent = 'رشد نسبت به دوره قبل';
      deltaEl.className = 'stat-delta up';
    } else {
      const pct = Math.round(((curr - prev) / prev) * 100);
      deltaEl.textContent = `${pct >= 0 ? '+' : ''}${faNum(pct)}٪ نسبت به دوره قبل`;
      deltaEl.className = 'stat-delta ' + (pct >= 0 ? 'up' : 'down');
    }

    const chartPoints = (series.series || []).map((row) => {
      const d = String(row.day).slice(5, 10);
      return { label: d, y: row.pageviews };
    });
    IACharts.lineChart(document.getElementById('chart-series'), chartPoints);

    const deviceSlices = (devices.devices || []).map((d) => ({
      label: deviceLabel(d.name),
      value: d.views,
    }));
    IACharts.donutChart(document.getElementById('chart-devices'), deviceSlices);

    renderRankTable(document.getElementById('top-pages'), pages.pages || [], 'path', 'views');
    renderRankTable(
      document.getElementById('top-referrers'),
      (referrers.referrers || []).map((r) => ({
        ...r,
        referrer: r.referrer === '(direct)' ? 'ورود مستقیم' : r.referrer,
      })),
      'referrer',
      'views'
    );
    renderRankTable(document.getElementById('top-browsers'), devices.browsers || [], 'name', 'views');

    void events;
  }

  function campaignTitle(row) {
    if (row.campaign) return row.campaign;
    if (row.source) return row.source;
    if (row.medium) return row.medium;
    return 'کمپین بدون نام';
  }

  function campaignSub(row) {
    const bits = [];
    if (row.campaign && row.source) bits.push(row.source);
    if (row.medium) bits.push(row.medium);
    if (row.term) bits.push(row.term);
    return bits.join(' · ');
  }

  async function loadBehavior() {
    const site = siteFilterB.value || siteFilter.value || 'all';
    const days = daysFilterB.value || daysFilter.value || '7';
    const q = `site=${encodeURIComponent(site)}&days=${encodeURIComponent(days)}`;
    const errEl = document.getElementById('behavior-error');
    errEl.textContent = '';

    let behavior;
    try {
      behavior = await api(`/api/stats/behavior?${q}`);
    } catch (err) {
      if (!err || err.message !== 'unauthorized') errEl.textContent = 'بارگذاری رفتار ناموفق بود.';
      return;
    }

    const buckets = [
      { key: 'b0', label: 'زیر ۲۵٪' },
      { key: 'b25', label: '۲۵ تا ۵۰٪' },
      { key: 'b50', label: '۵۰ تا ۷۵٪' },
      { key: 'b75', label: '۷۵ تا ۹۹٪' },
      { key: 'b100', label: 'تا انتهای صفحه' },
    ];
    const scroll = behavior.scroll || {};
    const counts = buckets.map((b) => Number(scroll[b.key] || 0));
    const maxScroll = Math.max(...counts, 1);
    const totalScroll = counts.reduce((sum, n) => sum + n, 0);
    const meter = document.getElementById('depth-meter');
    if (!totalScroll) {
      meter.innerHTML = '';
    } else {
      meter.innerHTML = counts
        .map((n, i) =>
          n > 0 ? `<span class="${i === buckets.length - 1 ? 'tone-end' : ''}" style="flex:${n} 1 0"></span>` : ''
        )
        .join('');
    }
    document.getElementById('scroll-legend').innerHTML = buckets
      .map((b, i) => {
        const pct = counts[i] === 0 ? 0 : Math.max(8, Math.round((counts[i] / maxScroll) * 100));
        return `<div class="scroll-row">
          <span>${b.label}</span>
          <span class="scroll-track"><span class="bar" style="width:${pct}%"></span></span>
          <span>${faNum(counts[i])}</span>
        </div>`;
      })
      .join('');

    const campaigns = behavior.campaigns || [];
    const campaignEl = document.getElementById('campaign-table');
    if (!campaigns.length) {
      campaignEl.innerHTML = '<p class="empty">هنوز ورودی کمپینی ثبت نشده.</p>';
    } else {
      campaignEl.innerHTML = `<table class="table wide"><thead><tr>
        <th>کمپین</th><th>بازدید</th><th>نشست</th><th>زمان</th><th>اسکرول</th>
      </tr></thead><tbody>${campaigns
        .map((row) => {
          const sub = campaignSub(row);
          return `<tr>
            <td>${escapeHtml(campaignTitle(row))}${sub ? `<span class="cell-sub">${escapeHtml(sub)}</span>` : ''}</td>
            <td>${faNum(row.views)}</td>
            <td>${faNum(row.sessions)}</td>
            <td>${row.avg_ms == null ? '—' : faDuration(row.avg_ms)}</td>
            <td>${row.avg_scroll == null ? '—' : faPct(row.avg_scroll)}</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
    }

    const clicks = behavior.clicks || [];
    const clickEl = document.getElementById('click-table');
    if (!clicks.length) {
      clickEl.innerHTML = '<p class="empty">هنوز کلیکی ثبت نشده.</p>';
    } else {
      const maxClick = Math.max(...clicks.map((c) => Number(c.count) || 0), 1);
      clickEl.innerHTML = `<table class="table"><thead><tr><th>عنصر</th><th>تعداد</th></tr></thead><tbody>${clicks
        .map((row) => {
          const pct = Math.max(8, Math.round((Number(row.count) / maxClick) * 100));
          const href = row.href ? String(row.href) : '';
          const outbound = Number(row.outbound) === 1;
          const sub = href
            ? `<span class="cell-sub" dir="ltr">${escapeHtml(href)}${outbound ? ' · خروجی' : ''}</span>`
            : '';
          return `<tr>
            <td>${escapeHtml(row.label || 'بدون متن')}${sub}</td>
            <td><div class="bar-cell"><span>${faNum(row.count)}</span><span class="bar" style="width:${pct}%"></span></div></td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
    }

    const pages = behavior.pages || [];
    const engageEl = document.getElementById('engage-table');
    if (!pages.length) {
      engageEl.innerHTML = '<p class="empty">بازدیدی در این بازه نیست.</p>';
    } else {
      engageEl.innerHTML = `<table class="table wide"><thead><tr>
        <th>صفحه</th><th>بازدید</th><th>زمان فعال</th><th>اسکرول</th>
      </tr></thead><tbody>${pages
        .map((row) => {
          const timed = Number(row.avg_ms) > 0;
          const scrolled = row.avg_scroll != null && row.avg_scroll !== '' && Number.isFinite(Number(row.avg_scroll));
          return `<tr>
            <td dir="ltr">${escapeHtml(row.path)}</td>
            <td>${faNum(row.views)}</td>
            <td>${timed ? faDuration(row.avg_ms) : '—'}</td>
            <td>${scrolled ? faPct(row.avg_scroll) : '—'}</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
    }
  }

  function deviceLabel(name) {
    const map = {
      desktop: 'دسکتاپ',
      mobile: 'موبایل',
      tablet: 'تبلت',
      smarttv: 'تلویزیون',
    };
    return map[name] || name || 'نامشخص';
  }

  function renderSites() {
    if (!sites.length) {
      sitesList.innerHTML =
        '<p class="empty">هنوز سایتی ندارید. با «افزودن سایت» شروع کنید.</p>';
      return;
    }
    sitesList.innerHTML = sites
      .map((s) => {
        return `<article class="site-row">
          <div>
            <h3>${escapeHtml(s.name)}${s.is_active ? '' : ' (غیرفعال)'}</h3>
            <p class="site-meta">${escapeHtml(s.domain || 'بدون دامنه')} · امروز ${faNum(s.views_today)} بازدید · کلید: <code dir="ltr">${escapeHtml(s.public_key)}</code></p>
            <pre class="code-block">${escapeHtml(embedSnippet(s.public_key))}</pre>
          </div>
          <div class="site-actions">
            <button type="button" class="btn btn-ghost" data-copy="${escapeHtml(s.public_key)}">کپی کلید</button>
            <button type="button" class="btn btn-danger" data-del="${s.id}">حذف</button>
          </div>
        </article>`;
      })
      .join('');

    sitesList.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.copy);
          btn.textContent = 'کپی شد';
          setTimeout(() => (btn.textContent = 'کپی کلید'), 1200);
        } catch {
          btn.textContent = 'ناموفق';
        }
      });
    });

    sitesList.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('این سایت و همه داده‌هایش حذف شود؟')) return;
        await api(`/api/sites/${btn.dataset.del}`, { method: 'DELETE' });
        await refreshSites();
        renderSites();
      });
    });
  }

  function openSiteModal() {
    modalRoot.className = 'modal-backdrop';
    modalRoot.innerHTML = `
      <form class="modal" id="site-modal-form">
        <h2>افزودن سایت</h2>
        <div class="field">
          <label for="site-name">نام سایت</label>
          <input id="site-name" required placeholder="مثلاً وبلاگ من" />
        </div>
        <div class="field">
          <label for="site-domain">دامنه (اختیاری)</label>
          <input id="site-domain" placeholder="example.ir" dir="ltr" />
        </div>
        <p class="form-error" id="site-modal-error"></p>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary" style="width:auto">ایجاد</button>
          <button type="button" class="btn btn-ghost" id="site-modal-cancel">انصراف</button>
        </div>
      </form>`;

    document.getElementById('site-modal-cancel').onclick = closeModal;
    modalRoot.onclick = (e) => {
      if (e.target === modalRoot) closeModal();
    };
    document.getElementById('site-modal-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('site-modal-error');
      err.textContent = '';
      try {
        await api('/api/sites', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('site-name').value,
            domain: document.getElementById('site-domain').value,
          }),
        });
        closeModal();
        await refreshSites();
        setView('sites');
      } catch {
        err.textContent = 'ثبت سایت ناموفق بود.';
      }
    };
  }

  function closeModal() {
    modalRoot.className = 'hidden';
    modalRoot.innerHTML = '';
  }

  async function refreshSites() {
    const data = await api('/api/sites');
    sites = data.sites || [];
    fillSiteFilter();
  }

  async function bootstrap() {
    await refreshSites();
    setView('dashboard');
  }

  async function init() {
    try {
      const me = await api('/auth/me');
      if (me.authenticated) {
        showApp();
        await bootstrap();
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  window.addEventListener('resize', () => {
    if (!appView.classList.contains('hidden')) {
      // redraw on resize if dashboard visible
      if (!document.getElementById('view-dashboard').classList.contains('hidden')) {
        loadDashboard().catch(() => {});
      }
      if (!document.getElementById('view-behavior').classList.contains('hidden')) {
        loadBehavior().catch(() => {});
      }
    }
  });

  init();
})();
