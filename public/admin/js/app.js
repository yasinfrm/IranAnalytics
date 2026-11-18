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
  const siteFilterC = document.getElementById('site-filter-c');
  const daysFilterC = document.getElementById('days-filter-c');
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
    document.getElementById('view-conversions').classList.toggle('hidden', name !== 'conversions');
    document.getElementById('view-sites').classList.toggle('hidden', name !== 'sites');
    if (name === 'sites') renderSites();
    if (name === 'dashboard') loadDashboard();
    if (name === 'behavior') loadBehavior();
    if (name === 'conversions') loadConversions();
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

  function syncFilters(source) {
    const site = source.value;
    [siteFilter, siteFilterB, siteFilterC].forEach((el) => {
      if (el && el !== source) el.value = site;
    });
  }
  function syncDays(source) {
    const days = source.value;
    [daysFilter, daysFilterB, daysFilterC].forEach((el) => {
      if (el && el !== source) el.value = days;
    });
  }

  siteFilter.addEventListener('change', () => {
    syncFilters(siteFilter);
    loadDashboard();
  });
  daysFilter.addEventListener('change', () => {
    syncDays(daysFilter);
    loadDashboard();
  });
  siteFilterB.addEventListener('change', () => {
    syncFilters(siteFilterB);
    loadBehavior();
  });
  daysFilterB.addEventListener('change', () => {
    syncDays(daysFilterB);
    loadBehavior();
  });
  siteFilterC.addEventListener('change', () => {
    syncFilters(siteFilterC);
    loadConversions();
  });
  daysFilterC.addEventListener('change', () => {
    syncDays(daysFilterC);
    loadConversions();
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
    siteFilterC.innerHTML = options;
    const next = sites.some((s) => s.id === current) ? current : 'all';
    siteFilter.value = next;
    const pick = (el) =>
      el.value && (el.value === 'all' || sites.some((s) => s.id === el.value)) ? el.value : next;
    siteFilterB.value = pick(siteFilterB);
    siteFilterC.value = pick(siteFilterC);
  }

  function goalLabel(name) {
    const map = {
      contact_phone: 'تماس تلفنی',
      contact_email: 'ایمیل',
      contact_whatsapp: 'واتساپ',
      consultation: 'صفحه مشاوره',
      consultation_cta: 'دکمه مشاوره/تماس',
      form_consultation: 'ارسال فرم مشاوره',
      form_lead: 'ارسال فرم سرنخ',
    };
    return map[name] || name || 'هدف';
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

  function prettyPath(path) {
    let raw = String(path || '/');
    const q = raw.indexOf('?');
    if (q >= 0) raw = raw.slice(0, q);
    try {
      raw = decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch {
      /* keep */
    }
    raw = raw.replace(/\/{2,}/g, '/');
    if (raw.length > 90) raw = raw.slice(0, 87) + '…';
    return raw || '/';
  }

  function pageLabel(row) {
    const title = String(row.title || '')
      .replace(/\s*[|\-–—].*$/, '')
      .trim();
    const path = prettyPath(row.path);
    if (title && title.length >= 2 && title.toLowerCase() !== path.toLowerCase()) {
      return { main: title.slice(0, 80), sub: path };
    }
    return { main: path, sub: '' };
  }

  function embedSnippet(publicKey) {
    return `<script defer src="${origin}/t.js" data-site="${publicKey}" data-api="${origin}" data-no-optimize="1" data-no-minify="1"><\/script>`;
  }

  function wordpressHint(publicKey) {
    return `define('IRAN_ANALYTICS_SRC', '${origin}/t.js');\ndefine('IRAN_ANALYTICS_SITE', '${publicKey}');`;
  }

  function renderRankTable(el, rows, labelKey, valueKey, opts = {}) {
    if (!rows.length) {
      el.innerHTML = '<p class="empty">داده‌ای نیست.</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => r[valueKey] || 0), 1);
    el.innerHTML = `<table class="table"><thead><tr><th>عنوان</th><th>تعداد</th></tr></thead><tbody>${rows
      .map((r) => {
        const pct = Math.max(8, Math.round(((r[valueKey] || 0) / max) * 100));
        let main = r[labelKey];
        let sub = '';
        if (opts.asPages) {
          const label = pageLabel(r);
          main = label.main;
          sub = label.sub;
        } else if (opts.prettyPath) {
          main = prettyPath(main);
        }
        return `<tr>
          <td>${escapeHtml(main)}${sub ? `<span class="cell-sub" dir="ltr">${escapeHtml(sub)}</span>` : ''}</td>
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
    document.getElementById('stat-conversions').textContent = faNum(overview.conversions);
    const sess = Number(overview.sessions) || 0;
    const converting = Number(overview.converting_sessions) || 0;
    const cvr = sess > 0 ? Math.round((converting / sess) * 1000) / 10 : 0;
    document.getElementById('stat-cvr').textContent =
      sess > 0 ? `نرخ تبدیل نشست: ${faNum(cvr)}٪` : 'تماس / مشاوره / هدف';

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

    renderRankTable(document.getElementById('top-pages'), pages.pages || [], 'path', 'views', {
      asPages: true,
    });
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
          const label = pageLabel(row);
          return `<tr>
            <td>
              ${escapeHtml(label.main)}
              ${label.sub ? `<span class="cell-sub" dir="ltr">${escapeHtml(label.sub)}</span>` : ''}
            </td>
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
            <p class="site-meta">وردپرس (wp-config) + افزونه <code dir="ltr">wordpress/iran-analytics.php</code>:</p>
            <pre class="code-block">${escapeHtml(wordpressHint(s.public_key))}</pre>
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
      if (!document.getElementById('view-conversions').classList.contains('hidden')) {
        loadConversions().catch(() => {});
      }
    }
  });

  async function loadConversions() {
    const site = siteFilterC.value || siteFilter.value || 'all';
    const days = daysFilterC.value || daysFilter.value || '7';
    const q = `site=${encodeURIComponent(site)}&days=${encodeURIComponent(days)}`;
    const errEl = document.getElementById('conversion-error');
    errEl.textContent = '';

    let data;
    let journeysData = { journeys: [], funnels: [] };
    try {
      [data, journeysData] = await Promise.all([
        api(`/api/stats/conversions?${q}`),
        api(`/api/stats/journeys?${q}`),
      ]);
    } catch (err) {
      if (!err || err.message !== 'unauthorized') errEl.textContent = 'بارگذاری گزارش تبدیل ناموفق بود.';
      return;
    }

    document.getElementById('conv-total').textContent = faNum(data.conversions);
    document.getElementById('conv-sessions').textContent = faNum(data.converting_sessions);
    document.getElementById('conv-all-sessions').textContent = faNum(data.sessions);
    document.getElementById('conv-cvr').textContent = faPct(data.cvr);

    const chartPoints = (data.series || []).map((row) => ({
      label: String(row.day).slice(5, 10),
      y: Number(row.conversions) || 0,
    }));
    IACharts.lineChart(document.getElementById('chart-conversions'), chartPoints);

    const goalSlices = (data.goals || []).map((g) => ({
      label: goalLabel(g.goal),
      value: Number(g.conversions) || 0,
    }));
    IACharts.donutChart(document.getElementById('chart-goals'), goalSlices);

    const campEl = document.getElementById('conv-campaign-table');
    const campaigns = data.campaigns || [];
    if (!campaigns.length) {
      campEl.innerHTML =
        '<p class="empty">هنوز کمپینی با تبدیل ثبت نشده. لینک یکتانت/UTM بزنید و روی تماس یا مشاوره کلیک کنید.</p>';
    } else {
      campEl.innerHTML = `<table class="table wide"><thead><tr>
        <th>کمپین</th><th>نشست</th><th>تبدیل</th><th>نرخ</th>
      </tr></thead><tbody>${campaigns
        .map((row) => {
          const title = row.campaign || row.source || 'بدون نام';
          const sub = [row.source, row.medium].filter(Boolean).join(' · ');
          return `<tr>
            <td>${escapeHtml(title)}${sub ? `<span class="cell-sub">${escapeHtml(sub)}</span>` : ''}</td>
            <td>${faNum(row.sessions)}</td>
            <td>${faNum(row.converting_sessions || row.conversions)}</td>
            <td>${faPct(row.cvr)}</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
    }

    const goalEl = document.getElementById('conv-goal-table');
    const goals = data.goals || [];
    if (!goals.length) {
      goalEl.innerHTML = '<p class="empty">هنوز تبدیلی ثبت نشده.</p>';
    } else {
      const max = Math.max(...goals.map((g) => Number(g.conversions) || 0), 1);
      goalEl.innerHTML = `<table class="table"><thead><tr><th>هدف</th><th>تعداد</th><th>نشست</th></tr></thead><tbody>${goals
        .map((g) => {
          const pct = Math.max(8, Math.round((Number(g.conversions) / max) * 100));
          return `<tr>
            <td>${escapeHtml(goalLabel(g.goal))}</td>
            <td><div class="bar-cell"><span>${faNum(g.conversions)}</span><span class="bar" style="width:${pct}%"></span></div></td>
            <td>${faNum(g.sessions)}</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
    }

    const funnelEl = document.getElementById('funnel-table');
    const funnels = journeysData.funnels || [];
    if (!funnels.length) {
      funnelEl.innerHTML = '<p class="empty">هنوز لندینگی برای قیف نیست.</p>';
    } else {
      funnelEl.innerHTML = `<table class="table wide"><thead><tr>
        <th>لندینگ</th><th>نشست</th><th>تبدیل</th><th>نرخ</th>
      </tr></thead><tbody>${funnels
        .map((row) => {
          const label = pageLabel(row);
          return `<tr>
            <td>${escapeHtml(label.main)}${
              label.sub ? `<span class="cell-sub" dir="ltr">${escapeHtml(label.sub)}</span>` : ''
            }</td>
            <td>${faNum(row.sessions)}</td>
            <td>${faNum(row.converted)}</td>
            <td>${faPct(row.cvr)}</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
    }

    const journeyEl = document.getElementById('journey-table');
    const journeys = journeysData.journeys || [];
    if (!journeys.length) {
      journeyEl.innerHTML = '<p class="empty">نشستی در این بازه نیست.</p>';
    } else {
      journeyEl.innerHTML = `<div class="journey-list">${journeys
        .slice(0, 20)
        .map((j) => {
          const camp = [j.source, j.medium, j.campaign].filter(Boolean).join(' · ');
          const steps = (j.path || []).map((p) => escapeHtml(prettyPath(p))).join(' ← ');
          const goals = (j.conversions || []).map((c) => goalLabel(c.goal)).join('، ');
          return `<article class="journey-card ${j.converted ? 'is-converted' : ''}">
            <div class="journey-top">
              <span>${j.converted ? 'تبدیل شد' : 'بدون تبدیل'}</span>
              <span class="cell-sub">${camp ? escapeHtml(camp) : 'ورود مستقیم/بدون UTM'} · ${faNum(
                j.pages_count
              )} صفحه</span>
            </div>
            <p class="journey-path" dir="ltr">${steps || '—'}</p>
            ${goals ? `<p class="journey-goals">هدف: ${escapeHtml(goals)}</p>` : ''}
          </article>`;
        })
        .join('')}</div>`;
    }
  }

  init();
})();
