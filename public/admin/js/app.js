(function () {
  const STATE_KEY = 'ia_panel_state_v1';

  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');
  const logoutBtnMobile = document.getElementById('logout-btn-mobile');
  const mainEl = document.querySelector('.main');

  const globalFilterBar = document.getElementById('global-filter-bar');
  const filterBarBody = document.getElementById('filter-bar-body');
  const filterToggleBtn = document.getElementById('filter-toggle-btn');
  const filterMobileMeta = document.getElementById('filter-mobile-meta');
  const fSite = document.getElementById('f-site');
  const fSource = document.getElementById('f-source');
  const fCampaign = document.getElementById('f-campaign');
  const fResetBtn = document.getElementById('f-reset-btn');
  const exportType = document.getElementById('export-report-type');
  const exportBtn = document.getElementById('export-btn');
  const exportBtnMobile = document.getElementById('export-btn-mobile');
  const filterSummary = document.getElementById('active-filter-summary');

  const sitesList = document.getElementById('sites-list');
  const modalRoot = document.getElementById('modal-root');
  const addSiteBtn = document.getElementById('add-site-btn');

  const goalForm = document.getElementById('goal-form');
  const goalSite = document.getElementById('goal-site');
  const goalFormErr = document.getElementById('goal-form-error');
  const goalsList = document.getElementById('goals-list');

  const visitorSearch = document.getElementById('visitor-search');
  const visitorOnlyConv = document.getElementById('visitor-only-conv');
  const visitorsList = document.getElementById('visitors-list');
  const visitorsLayout = document.getElementById('visitors-layout');
  const visitorTimelineRoot = document.getElementById('visitor-timeline-root');
  const visitorsCount = document.getElementById('visitors-count');
  const visitorsError = document.getElementById('visitors-error');
  const visitorBackBtn = document.getElementById('visitor-back-btn');

  const heatmapPage = document.getElementById('heatmap-page');
  const heatmapDevice = document.getElementById('heatmap-device');
  const heatmapError = document.getElementById('heatmap-error');
  const heatmapMeta = document.getElementById('heatmap-meta');
  const heatmapPreviewTitle = document.getElementById('heatmap-preview-title');
  const heatmapStage = document.getElementById('heatmap-stage');
  const heatmapIframe = document.getElementById('heatmap-iframe');
  const heatmapCanvas = document.getElementById('heatmap-canvas');
  const heatmapEmpty = document.getElementById('heatmap-empty');
  const heatmapElements = document.getElementById('heatmap-elements');

  let sites = [];
  let origin = location.origin;
  let currentView = 'dashboard';
  let prevView = 'dashboard';
  let currentPagePath = '';
  let currentVisitorSid = '';
  let visitorsCache = [];
  let visitorSearchTimer = null;
  let pendingDesired = { site: 'all', source: 'all', campaign: 'all' };
  let heatmapPath = '';
  let heatmapMode = 'click';
  let heatmapCache = null;

  function loadSavedState() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    try {
      if (location.hash && location.hash.length > 1) {
        const hp = new URLSearchParams(location.hash.slice(1));
        for (const k of ['site', 'from', 'to', 'source', 'campaign', 'view', 'pagePath', 'sid', 'exportType', 'heatmapPath', 'heatmapMode', 'heatmapDevice']) {
          if (hp.has(k)) saved[k] = hp.get(k);
        }
      }
    } catch {
      /* ignore */
    }
    return saved;
  }

  function saveState() {
    const state = {
      site: fSite.value || 'all',
      from: dateRange.from,
      to: dateRange.to,
      source: fSource.value || 'all',
      campaign: fCampaign.value || 'all',
      view: currentView,
      pagePath: currentPagePath || '',
      sid: currentVisitorSid || '',
      heatmapPath: heatmapPath || '',
      heatmapMode: heatmapMode || 'click',
      heatmapDevice: heatmapDevice ? heatmapDevice.value || 'all' : 'all',
      exportType: exportType.value || 'pages',
    };
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    try {
      const hp = new URLSearchParams();
      hp.set('view', state.view);
      if (state.site !== 'all') hp.set('site', state.site);
      hp.set('from', state.from);
      hp.set('to', state.to);
      if (state.source !== 'all') hp.set('source', state.source);
      if (state.campaign !== 'all') hp.set('campaign', state.campaign);
      if (state.view === 'page' && state.pagePath) hp.set('pagePath', state.pagePath);
      if (state.view === 'visitors' && state.sid) hp.set('sid', state.sid);
      if (state.view === 'heatmap' && state.heatmapPath) hp.set('heatmapPath', state.heatmapPath);
      if (state.view === 'heatmap' && state.heatmapMode) hp.set('heatmapMode', state.heatmapMode);
      history.replaceState(null, '', '#' + hp.toString());
    } catch {
      /* ignore */
    }
  }

  const savedInit = loadSavedState();
  const today = IAJalali.todayJalali();
  const defaultFrom = IAJalali.addJalaliDays(today, -6);
  const parsedFrom = savedInit.from ? IAJalali.parseStr(savedInit.from) : null;
  const parsedTo = savedInit.to ? IAJalali.parseStr(savedInit.to) : null;

  const initFromObj = parsedFrom && parsedTo ? parsedFrom : defaultFrom;
  const initToObj = parsedFrom && parsedTo ? parsedTo : today;
  let dateRange = {
    from: IAJalali.formatStr(initFromObj),
    to: IAJalali.formatStr(initToObj),
  };

  pendingDesired = {
    site: savedInit.site || 'all',
    source: savedInit.source || 'all',
    campaign: savedInit.campaign || 'all',
  };
  if (savedInit.pagePath) currentPagePath = savedInit.pagePath;
  if (savedInit.sid) currentVisitorSid = savedInit.sid;
  if (savedInit.heatmapPath) heatmapPath = savedInit.heatmapPath;
  if (savedInit.heatmapMode === 'scroll' || savedInit.heatmapMode === 'click') heatmapMode = savedInit.heatmapMode;
  if (savedInit.heatmapDevice && heatmapDevice) heatmapDevice.value = savedInit.heatmapDevice;
  if (savedInit.exportType) exportType.value = savedInit.exportType;

  const picker = IAJalali.createRangePicker(
    document.getElementById('f-jalali-mount'),
    { from: initFromObj, to: initToObj },
    (next) => {
      dateRange = next;
      saveState();
      refreshFilterChoices().then(reloadCurrentView);
    }
  );

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

  function faDuration(ms) {
    const s = Math.max(0, Math.round(Number(ms || 0) / 1000));
    if (s < 60) return faNum(s) + ' ثانیه';
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (r === 0) return faNum(m) + ' دقیقه';
    return faNum(m) + ' دقیقه و ' + faNum(r) + ' ثانیه';
  }

  function faPct(n) {
    return faNum(Math.round(Number(n || 0) * 10) / 10) + '٪';
  }

  function escapeHtml(str) {
    return String(str ?? '')
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

  function sourceLabel(src) {
    const map = {
      google: 'گوگل',
      yektanet: 'یکتانت',
      instagram: 'اینستاگرام',
      telegram: 'تلگرام',
      direct: 'ورود مستقیم',
      '(direct)': 'ورود مستقیم',
      bing: 'بینگ',
      aparat: 'آپارات',
      torob: 'ترب',
    };
    return map[String(src || '').toLowerCase()] || src || 'نامشخص';
  }

  function goalLabel(name, customName) {
    if (customName) return customName;
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

  function deviceLabel(name) {
    const map = {
      desktop: 'دسکتاپ',
      mobile: 'موبایل',
      tablet: 'تبلت',
      smarttv: 'تلویزیون',
    };
    return map[name] || name || 'نامشخص';
  }

  function matchTypeLabel(t) {
    const map = {
      click_text: 'متن کلیک',
      href_contains: 'آدرس لینک',
      url_contains: 'آدرس صفحه',
      click_selector: 'سلکتور CSS',
      form_submit: 'ارسال فرم',
    };
    return map[t] || t;
  }

  function filterQuery(extra = {}) {
    const params = new URLSearchParams();
    params.set('site', fSite.value || 'all');
    params.set('from', dateRange.from);
    params.set('to', dateRange.to);
    if (fSource.value && fSource.value !== 'all') params.set('source', fSource.value);
    if (fCampaign.value && fCampaign.value !== 'all') params.set('campaign', fCampaign.value);
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== '') params.set(k, String(v));
    }
    return params.toString();
  }

  function updateFilterUI() {
    const hasCustom =
      (fSite.value && fSite.value !== 'all') ||
      (fSource.value && fSource.value !== 'all') ||
      (fCampaign.value && fCampaign.value !== 'all');
    fResetBtn.classList.toggle('hidden', !hasCustom);

    const bits = [`${IAJalali.toFaDigits(dateRange.from)} تا ${IAJalali.toFaDigits(dateRange.to)}`];
    if (fSource.value && fSource.value !== 'all') bits.push(`منبع: ${sourceLabel(fSource.value)}`);
    if (fCampaign.value && fCampaign.value !== 'all') bits.push(`کمپین: ${fCampaign.value}`);
    const summaryText = bits.join(' · ');
    filterSummary.textContent = summaryText;

    const shortBits = [IAJalali.toFaDigits(dateRange.from.slice(5)) + '–' + IAJalali.toFaDigits(dateRange.to.slice(5))];
    if (fSource.value && fSource.value !== 'all') shortBits.push(sourceLabel(fSource.value));
    if (fCampaign.value && fCampaign.value !== 'all') shortBits.push(fCampaign.value);
    filterMobileMeta.textContent = shortBits.join(' · ');
  }

  function showLogin() {
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
  }

  function showApp() {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
  }

  function setView(name, opts = {}) {
    const valid = new Set(['dashboard', 'behavior', 'page', 'visitors', 'heatmap', 'conversions', 'goals', 'sites']);
    const target = valid.has(name) ? name : 'dashboard';
    if (target === 'page' && !currentPagePath) {
      return setView('dashboard', opts);
    }
    if (target !== 'page' && currentView !== 'page') {
      prevView = currentView;
    }
    currentView = target;
    document.querySelectorAll('.nav button').forEach((b) => {
      const activeTarget = target === 'page' ? prevView : target;
      b.classList.toggle('active', b.dataset.view === activeTarget);
    });
    const showFilters = target !== 'sites' && target !== 'goals';
    globalFilterBar.classList.toggle('hidden', !showFilters);

    document.getElementById('view-dashboard').classList.toggle('hidden', target !== 'dashboard');
    document.getElementById('view-behavior').classList.toggle('hidden', target !== 'behavior');
    document.getElementById('view-page').classList.toggle('hidden', target !== 'page');
    document.getElementById('view-visitors').classList.toggle('hidden', target !== 'visitors');
    document.getElementById('view-heatmap').classList.toggle('hidden', target !== 'heatmap');
    document.getElementById('view-conversions').classList.toggle('hidden', target !== 'conversions');
    document.getElementById('view-goals').classList.toggle('hidden', target !== 'goals');
    document.getElementById('view-sites').classList.toggle('hidden', target !== 'sites');

    if (!opts.keepExport) {
      if (target === 'behavior') exportType.value = 'sources';
      else if (target === 'visitors') exportType.value = 'visitors';
      else if (target === 'heatmap') exportType.value = 'heatmap';
      else if (target === 'conversions') exportType.value = 'conversions';
      else if (target === 'dashboard') exportType.value = 'pages';
    }

    if (target !== 'visitors' && visitorsLayout) visitorsLayout.classList.remove('has-detail');

    document.querySelectorAll('[data-hm-mode]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.hmMode === heatmapMode);
    });

    saveState();
    reloadCurrentView();
  }

  async function reloadCurrentView() {
    updateFilterUI();
    mainEl.classList.add('is-loading');
    try {
      if (currentView === 'dashboard') await loadDashboard();
      else if (currentView === 'behavior') await loadBehavior();
      else if (currentView === 'page') await loadPageDetail(currentPagePath);
      else if (currentView === 'visitors') await loadVisitors();
      else if (currentView === 'heatmap') await loadHeatmap();
      else if (currentView === 'conversions') await loadConversions();
      else if (currentView === 'goals') await loadGoals();
      else if (currentView === 'sites') renderSites();
    } finally {
      mainEl.classList.remove('is-loading');
    }
  }

  function openPageDetail(path) {
    if (!path) return;
    if (currentView !== 'page') prevView = currentView;
    currentPagePath = path;
    setView('page');
  }

  filterToggleBtn.addEventListener('click', () => {
    const open = filterBarBody.classList.toggle('is-open');
    filterToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.querySelectorAll('.nav button').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  document.getElementById('page-back-btn').addEventListener('click', () => {
    setView(prevView || 'dashboard');
  });

  if (visitorSearch) {
    visitorSearch.addEventListener('input', () => {
      clearTimeout(visitorSearchTimer);
      visitorSearchTimer = setTimeout(() => {
        if (currentView === 'visitors') loadVisitors();
      }, 280);
    });
  }
  if (visitorOnlyConv) {
    visitorOnlyConv.addEventListener('change', () => {
      if (currentView === 'visitors') loadVisitors();
    });
  }
  if (visitorBackBtn) {
    visitorBackBtn.addEventListener('click', () => {
      currentVisitorSid = '';
      visitorsLayout.classList.remove('has-detail');
      visitorsList.querySelectorAll('.visitor-card').forEach((btn) => btn.classList.remove('is-active'));
      visitorTimelineRoot.innerHTML =
        '<p class="empty">یک کاربر را از لیست انتخاب کنید تا تایم‌لاین کاملش نمایش داده شود.</p>';
      saveState();
    });
  }

  if (heatmapPage) {
    heatmapPage.addEventListener('change', () => {
      heatmapPath = heatmapPage.value || '/';
      saveState();
      if (currentView === 'heatmap') loadHeatmap();
    });
  }
  if (heatmapDevice) {
    heatmapDevice.addEventListener('change', () => {
      saveState();
      if (currentView === 'heatmap') loadHeatmap();
    });
  }
  document.querySelectorAll('[data-hm-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      heatmapMode = btn.dataset.hmMode === 'scroll' ? 'scroll' : 'click';
      document.querySelectorAll('[data-hm-mode]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.hmMode === heatmapMode);
      });
      saveState();
      paintHeatmap();
    });
  });
  let heatmapResizeTimer = null;
  window.addEventListener('resize', () => {
    if (currentView !== 'heatmap' || !heatmapCache) return;
    clearTimeout(heatmapResizeTimer);
    heatmapResizeTimer = setTimeout(paintHeatmap, 180);
  });

  fSite.addEventListener('change', () => {
    pendingDesired.site = fSite.value;
    saveState();
    refreshFilterChoices().then(reloadCurrentView);
  });
  fSource.addEventListener('change', () => {
    pendingDesired.source = fSource.value;
    saveState();
    reloadCurrentView();
  });
  fCampaign.addEventListener('change', () => {
    pendingDesired.campaign = fCampaign.value;
    saveState();
    reloadCurrentView();
  });
  exportType.addEventListener('change', saveState);

  fResetBtn.addEventListener('click', () => {
    fSite.value = 'all';
    fSource.value = 'all';
    fCampaign.value = 'all';
    pendingDesired = { site: 'all', source: 'all', campaign: 'all' };
    saveState();
    refreshFilterChoices().then(reloadCurrentView);
  });

  function downloadExport() {
    const rep = currentView === 'page' && currentPagePath ? 'page_detail' : exportType.value || 'pages';
    location.href = `/api/export.csv?${filterQuery({
      report: rep,
      path: rep === 'page_detail' ? currentPagePath : rep === 'heatmap' ? heatmapPath || heatmapPage?.value || '' : '',
      sid: rep === 'visitor' ? currentVisitorSid : '',
      q: rep === 'visitors' ? visitorSearch.value || '' : '',
      only_converted: rep === 'visitors' && visitorOnlyConv.checked ? '1' : '',
      device: rep === 'heatmap' && heatmapDevice ? heatmapDevice.value || '' : '',
    })}`;
  }
  exportBtn.addEventListener('click', downloadExport);
  exportBtnMobile.addEventListener('click', downloadExport);

  document.getElementById('page-export-btn').addEventListener('click', () => {
    if (!currentPagePath) return;
    location.href = `/api/export.csv?${filterQuery({ report: 'page_detail', path: currentPagePath })}`;
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
        }),
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        if (data && data.error === 'invalid_credentials') throw new Error('bad_password');
        throw new Error('login_failed');
      }
      showApp();
      await bootstrap();
    } catch (err) {
      loginError.textContent =
        err && err.message === 'bad_password'
          ? 'نام کاربری یا رمز عبور نادرست است. رمز را با ADMIN_PASSWORD در /etc/iran-analytics.env یکی کنید.'
          : 'ورود انجام نشد. اگر سایت با HTTPS است COOKIE_SECURE=true و TRUST_PROXY=true باشد، بعد سرویس را ری‌استارت کنید.';
    }
  });

  async function doLogout() {
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      /* ignore */
    }
    showLogin();
  }
  logoutBtn.addEventListener('click', doLogout);
  logoutBtnMobile.addEventListener('click', doLogout);

  addSiteBtn.addEventListener('click', () => openSiteModal());

  function fillSiteSelectors() {
    const desired = fSite.value || pendingDesired.site || 'all';
    const options =
      `<option value="all">همه سایت‌ها</option>` +
      sites
        .map(
          (s) =>
            `<option value="${s.id}">${escapeHtml(s.name)}${s.domain ? ' — ' + escapeHtml(s.domain) : ''}</option>`
        )
        .join('');
    fSite.innerHTML = options;
    fSite.value = sites.some((s) => s.id === desired) ? desired : 'all';

    const curGoalSite = goalSite.value;
    goalSite.innerHTML = sites.length
      ? sites
          .map(
            (s) =>
              `<option value="${s.id}">${escapeHtml(s.name)}${s.domain ? ' — ' + escapeHtml(s.domain) : ''}</option>`
          )
          .join('')
      : '<option value="">ابتدا سایت بسازید</option>';
    if (sites.some((s) => s.id === curGoalSite)) goalSite.value = curGoalSite;
  }

  async function refreshFilterChoices() {
    try {
      const q = `site=${encodeURIComponent(fSite.value || 'all')}&from=${encodeURIComponent(
        dateRange.from
      )}&to=${encodeURIComponent(dateRange.to)}`;
      const data = await api(`/api/stats/filters?${q}`);
      const curSrc = fSource.value !== 'all' ? fSource.value : pendingDesired.source || 'all';
      const curCamp = fCampaign.value !== 'all' ? fCampaign.value : pendingDesired.campaign || 'all';

      const srcList = data.sources || [];
      fSource.innerHTML =
        `<option value="all">همه منابع</option>` +
        srcList
          .map(
            (s) =>
              `<option value="${escapeHtml(s.source)}">${escapeHtml(sourceLabel(s.source))} (${faNum(s.views)})</option>`
          )
          .join('');
      fSource.value = srcList.some((s) => s.source === curSrc) ? curSrc : 'all';

      const campList = data.campaigns || [];
      fCampaign.innerHTML =
        `<option value="all">همه کمپین‌ها</option>` +
        campList
          .map(
            (c) =>
              `<option value="${escapeHtml(c.campaign)}">${escapeHtml(c.campaign)} (${faNum(c.views)})</option>`
          )
          .join('');
      fCampaign.value = campList.some((c) => c.campaign === curCamp) ? curCamp : 'all';
    } catch {
      /* keep current */
    }
  }

  function embedSnippet(publicKey) {
    return `<script defer src="${origin}/t.js" data-site="${publicKey}" data-api="${origin}" data-no-optimize="1" data-no-minify="1"><\/script>`;
  }

  function wordpressHint(publicKey) {
    return `define('IRAN_ANALYTICS_SRC', '${origin}/t.js');\ndefine('IRAN_ANALYTICS_SITE', '${publicKey}');`;
  }

  function renderRankTable(el, rows, labelKey, valueKey, opts = {}) {
    if (!rows.length) {
      el.innerHTML = '<p class="empty">داده‌ای در این بازه نیست.</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
    el.innerHTML = `<table class="table"><thead><tr><th>عنوان</th><th>تعداد</th></tr></thead><tbody>${rows
      .map((r) => {
        const pct = Math.max(8, Math.round(((Number(r[valueKey]) || 0) / max) * 100));
        let main = r[labelKey];
        let sub = '';
        if (opts.asPages) {
          const label = pageLabel(r);
          main = label.main;
          sub = label.sub;
        }
        const clickable = opts.onClickPath ? ` class="link-row" data-open-page="${escapeHtml(r.path)}"` : '';
        return `<tr${clickable}>
          <td><span class="${opts.onClickPath ? 'link-title' : ''}">${escapeHtml(main)}</span>${
            sub ? `<span class="cell-sub" dir="ltr">${escapeHtml(sub)}</span>` : ''
          }</td>
          <td><div class="bar-cell"><span>${faNum(r[valueKey])}</span><span class="bar" style="width:${pct}%"></span></div></td>
        </tr>`;
      })
      .join('')}</tbody></table>`;

    if (opts.onClickPath) {
      el.querySelectorAll('[data-open-page]').forEach((tr) => {
        tr.addEventListener('click', () => openPageDetail(tr.dataset.openPage));
      });
    }
  }

  function renderSourcesTable(el, sources) {
    if (!sources.length) {
      el.innerHTML = '<p class="empty">داده‌ای برای منابع نیست.</p>';
      return;
    }
    el.innerHTML = `<table class="table wide"><thead><tr>
      <th>منبع</th><th>بازدید</th><th>نشست</th><th>زمان فعال</th><th>اسکرول</th><th>تبدیل</th><th>نرخ</th>
    </tr></thead><tbody>${sources
      .map((s) => {
        const timed = Number(s.avg_ms) > 0;
        const scrolled = s.avg_scroll != null && s.avg_scroll !== '' && Number.isFinite(Number(s.avg_scroll));
        const cvrVal = Number(s.cvr || 0);
        return `<tr>
          <td><strong>${escapeHtml(sourceLabel(s.source))}</strong><span class="cell-sub" dir="ltr">${escapeHtml(s.source)}</span></td>
          <td>${faNum(s.views)}</td>
          <td>${faNum(s.sessions)}</td>
          <td>${timed ? faDuration(s.avg_ms) : '—'}</td>
          <td>${scrolled ? faPct(s.avg_scroll) : '—'}</td>
          <td>${faNum(s.converting_sessions || 0)}</td>
          <td><span class="pill ${cvrVal > 0 ? '' : 'warn'}">${faPct(cvrVal)}</span></td>
        </tr>`;
      })
      .join('')}</tbody></table>`;
  }

  function renderClicksTable(el, clicks) {
    if (!clicks.length) {
      el.innerHTML = '<p class="empty">هنوز کلیکی ثبت نشده.</p>';
      return;
    }
    const maxClick = Math.max(...clicks.map((c) => Number(c.count) || 0), 1);
    el.innerHTML = `<table class="table"><thead><tr><th>عنصر</th><th>تعداد</th></tr></thead><tbody>${clicks
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

  function renderCampaignsTable(el, campaigns) {
    if (!campaigns.length) {
      el.innerHTML = '<p class="empty">هنوز ورودی کمپینی ثبت نشده.</p>';
      return;
    }
    el.innerHTML = `<table class="table wide"><thead><tr>
      <th>کمپین</th><th>بازدید</th><th>نشست</th><th>زمان</th><th>اسکرول</th>
    </tr></thead><tbody>${campaigns
      .map((row) => {
        const title = row.campaign || row.source || row.medium || 'کمپین بدون نام';
        const bits = [];
        if (row.campaign && row.source) bits.push(sourceLabel(row.source));
        if (row.medium) bits.push(row.medium);
        if (row.term) bits.push(row.term);
        const sub = bits.join(' · ');
        return `<tr>
          <td>${escapeHtml(title)}${sub ? `<span class="cell-sub">${escapeHtml(sub)}</span>` : ''}</td>
          <td>${faNum(row.views)}</td>
          <td>${faNum(row.sessions)}</td>
          <td>${row.avg_ms == null ? '—' : faDuration(row.avg_ms)}</td>
          <td>${row.avg_scroll == null ? '—' : faPct(row.avg_scroll)}</td>
        </tr>`;
      })
      .join('')}</tbody></table>`;
  }

  async function loadDashboard() {
    const q = filterQuery();
    const [overview, series, pages, devices, sourcesRes] = await Promise.all([
      api(`/api/stats/overview?${q}`),
      api(`/api/stats/timeseries?${q}`),
      api(`/api/stats/pages?${q}`),
      api(`/api/stats/devices?${q}`),
      api(`/api/stats/sources?${q}&limit=8`),
    ]);

    document.getElementById('stat-pageviews').textContent = faNum(overview.pageviews);
    document.getElementById('stat-sessions').textContent = faNum(overview.sessions);
    document.getElementById('stat-pages-sub').textContent = `${faNum(overview.unique_pages)} صفحه یکتا`;
    document.getElementById('stat-pages').textContent = `${faNum(overview.unique_pages)} / ${faNum(overview.events)}`;
    document.getElementById('stat-events-sub').textContent = `${faNum(overview.events)} رویداد ثبت‌شده`;
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

    const chartPoints = (series.series || []).map((row) => ({
      label: IAJalali.toFaDigits(String(row.jalali || row.day).slice(5)),
      fullLabel: IAJalali.toFaDigits(row.jalali || row.day),
      y: row.pageviews,
      y2: row.conversions || 0,
    }));
    IACharts.lineChart(document.getElementById('chart-series'), chartPoints, {
      label1: 'بازدید',
      label2: 'تبدیل',
    });

    const srcBars = (sourcesRes.sources || []).slice(0, 7).map((s) => ({
      label: sourceLabel(s.source),
      value: s.views,
      sub: `${faNum(s.converting_sessions || 0)} تبدیل`,
    }));
    IACharts.barChart(document.getElementById('chart-sources-bar'), srcBars);

    const deviceSlices = (devices.devices || []).map((d) => ({
      label: deviceLabel(d.name),
      value: d.views,
    }));
    IACharts.donutChart(document.getElementById('chart-devices'), deviceSlices);

    renderRankTable(document.getElementById('top-pages'), pages.pages || [], 'path', 'views', {
      asPages: true,
      onClickPath: true,
    });
    renderRankTable(document.getElementById('top-browsers'), devices.browsers || [], 'name', 'views');
  }

  async function loadBehavior() {
    const q = filterQuery();
    const errEl = document.getElementById('behavior-error');
    errEl.textContent = '';

    let behavior;
    try {
      behavior = await api(`/api/stats/behavior?${q}`);
    } catch (err) {
      if (!err || err.message !== 'unauthorized') errEl.textContent = 'بارگذاری رفتار ناموفق بود.';
      return;
    }

    const scroll = behavior.scroll || {};
    const scrollItems = [
      { label: 'زیر ۲۵٪', value: Number(scroll.b0 || 0) },
      { label: '۲۵-۴۹٪', value: Number(scroll.b25 || 0) },
      { label: '۵۰-۷۴٪', value: Number(scroll.b50 || 0) },
      { label: '۷۵-۹۹٪', value: Number(scroll.b75 || 0) },
      { label: '۱۰۰٪', value: Number(scroll.b100 || 0), accent: true },
    ];
    IACharts.barChart(document.getElementById('chart-scroll-bar'), scrollItems);

    renderSourcesTable(document.getElementById('source-table'), behavior.sources || []);
    renderCampaignsTable(document.getElementById('campaign-table'), behavior.campaigns || []);
    renderClicksTable(document.getElementById('click-table'), behavior.clicks || []);

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
          return `<tr class="link-row" data-open-page="${escapeHtml(row.path)}">
            <td>
              <span class="link-title">${escapeHtml(label.main)}</span>
              ${label.sub ? `<span class="cell-sub" dir="ltr">${escapeHtml(label.sub)}</span>` : ''}
            </td>
            <td>${faNum(row.views)}</td>
            <td>${timed ? faDuration(row.avg_ms) : '—'}</td>
            <td>${scrolled ? faPct(row.avg_scroll) : '—'}</td>
          </tr>`;
        })
        .join('')}</tbody></table>`;

      engageEl.querySelectorAll('[data-open-page]').forEach((tr) => {
        tr.addEventListener('click', () => openPageDetail(tr.dataset.openPage));
      });
    }
  }

  async function loadPageDetail(path) {
    const errEl = document.getElementById('page-error');
    errEl.textContent = '';
    if (!path) return;

    let data;
    try {
      data = await api(`/api/stats/page?${filterQuery({ path })}`);
    } catch (err) {
      if (!err || err.message !== 'unauthorized') errEl.textContent = 'بارگذاری جزئیات صفحه ناموفق بود.';
      return;
    }

    const label = pageLabel({ path: data.path, title: data.title });
    document.getElementById('page-detail-title').textContent = label.main;
    document.getElementById('page-detail-path').textContent = data.path;

    const sum = data.summary || {};
    document.getElementById('pd-views').textContent = faNum(sum.views);
    document.getElementById('pd-sessions').textContent = faNum(sum.sessions);
    document.getElementById('pd-time').textContent = sum.avg_ms == null ? '—' : faDuration(sum.avg_ms);
    document.getElementById('pd-scroll').textContent = sum.avg_scroll == null ? '—' : faPct(sum.avg_scroll);
    document.getElementById('pd-conv').textContent = faNum(sum.conversions);
    document.getElementById('pd-cvr').textContent =
      sum.sessions > 0 ? `نرخ تبدیل: ${faPct(sum.cvr)} · ${faNum(sum.clicks)} کلیک` : '';

    const pts = (data.series || []).map((row) => ({
      label: IAJalali.toFaDigits(String(row.jalali || row.day).slice(5)),
      fullLabel: IAJalali.toFaDigits(row.jalali || row.day),
      y: row.pageviews,
      y2: row.conversions || 0,
    }));
    IACharts.lineChart(document.getElementById('chart-page-series'), pts, {
      label1: 'بازدید',
      label2: 'تبدیل',
    });

    const s = data.scroll || {};
    IACharts.barChart(document.getElementById('chart-page-scroll'), [
      { label: 'زیر ۲۵٪', value: Number(s.b0 || 0) },
      { label: '۲۵-۴۹٪', value: Number(s.b25 || 0) },
      { label: '۵۰-۷۴٪', value: Number(s.b50 || 0) },
      { label: '۷۵-۹۹٪', value: Number(s.b75 || 0) },
      { label: '۱۰۰٪', value: Number(s.b100 || 0), accent: true },
    ]);

    renderSourcesTable(document.getElementById('pd-sources-table'), data.sources || []);
    renderClicksTable(document.getElementById('pd-clicks-table'), data.clicks || []);
    renderCampaignsTable(document.getElementById('pd-campaigns-table'), data.campaigns || []);

    const goalsEl = document.getElementById('pd-goals-table');
    const goals = data.goals || [];
    if (!goals.length) {
      goalsEl.innerHTML = '<p class="empty">هنوز تبدیلی روی این صفحه ثبت نشده.</p>';
    } else {
      goalsEl.innerHTML = `<table class="table"><thead><tr><th>هدف</th><th>تعداد</th><th>نشست</th></tr></thead><tbody>${goals
        .map(
          (g) => `<tr>
            <td>${escapeHtml(goalLabel(g.goal, g.goal_name))}</td>
            <td>${faNum(g.conversions)}</td>
            <td>${faNum(g.sessions)}</td>
          </tr>`
        )
        .join('')}</tbody></table>`;
    }
  }

  function formatOffset(ms) {
    if (ms == null || ms === '') return '';
    const s = Math.max(0, Math.round(Number(ms) / 1000));
    if (s < 60) return 'ثانیه ' + faNum(s);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? faNum(m) + ':' + String(r).padStart(2, '0') : faNum(m) + ' دقیقه';
  }

  function heatColor(t) {
    // cool sea → brass → danger (Clarity-like warm map, brand-aligned)
    const stops = [
      [0, [47, 108, 146]],
      [0.35, [11, 105, 104]],
      [0.65, [195, 154, 95]],
      [1, [163, 59, 45]],
    ];
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        a = stops[i];
        b = stops[i + 1];
        break;
      }
    }
    const span = b[0] - a[0] || 1;
    const u = (t - a[0]) / span;
    const r = Math.round(a[1][0] + (b[1][0] - a[1][0]) * u);
    const g = Math.round(a[1][1] + (b[1][1] - a[1][1]) * u);
    const bl = Math.round(a[1][2] + (b[1][2] - a[1][2]) * u);
    return [r, g, bl];
  }

  function sizeHeatmapStage(meta) {
    const wrap = document.getElementById('heatmap-stage-wrap');
    const width = Math.max(320, wrap?.clientWidth || 800);
    const dh = Number(meta?.max_dh) || 0;
    const finalH =
      dh > 200
        ? Math.max(480, Math.min(4500, Math.round(dh * (width / 1200))))
        : Math.max(520, Math.round(width * 1.35));
    heatmapStage.style.height = finalH + 'px';
    heatmapIframe.style.height = finalH + 'px';
    heatmapCanvas.width = Math.round(width);
    heatmapCanvas.height = finalH;
    heatmapCanvas.style.width = width + 'px';
    heatmapCanvas.style.height = finalH + 'px';
    return { width: Math.round(width), height: finalH };
  }

  function drawClickHeat(clicks, size) {
    const ctx = heatmapCanvas.getContext('2d');
    ctx.clearRect(0, 0, size.width, size.height);
    if (!clicks.length) return;

    const maxW = Math.max(...clicks.map((c) => c.w), 1);
    const radius = Math.max(18, Math.round(size.width * 0.035));
    const acc = document.createElement('canvas');
    acc.width = size.width;
    acc.height = size.height;
    const actx = acc.getContext('2d');

    for (const c of clicks) {
      const x = (Number(c.xp) / 100) * size.width;
      const y = (Number(c.yp) / 100) * size.height;
      const intensity = 0.25 + 0.75 * (c.w / maxW);
      const g = actx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(0,0,0,${0.55 * intensity})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      actx.fillStyle = g;
      actx.beginPath();
      actx.arc(x, y, radius, 0, Math.PI * 2);
      actx.fill();
    }

    const img = actx.getImageData(0, 0, size.width, size.height);
    const out = ctx.createImageData(size.width, size.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const alpha = img.data[i + 3] / 255;
      if (alpha < 0.02) continue;
      const [r, g, b] = heatColor(Math.min(1, alpha * 1.35));
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = Math.round(Math.min(210, alpha * 255));
    }
    ctx.putImageData(out, 0, 0);
  }

  function drawScrollHeat(bands, avgFold, size) {
    const ctx = heatmapCanvas.getContext('2d');
    ctx.clearRect(0, 0, size.width, size.height);
    if (!bands.length) return;
    const bandH = size.height / bands.length;
    for (let i = 0; i < bands.length; i++) {
      const pct = Number(bands[i].pct) || 0;
      const t = Math.min(1, pct / 100);
      const [r, g, b] = heatColor(t);
      ctx.fillStyle = `rgba(${r},${g},${b},${0.18 + t * 0.45})`;
      ctx.fillRect(0, i * bandH, size.width, bandH + 1);
      ctx.fillStyle = 'rgba(22,38,36,0.55)';
      ctx.font = '12px Vazirmatn UI FD, Tahoma, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(faPct(pct) + ' · عمق ' + faNum(bands[i].depth), 10, i * bandH + 16);
    }
    const foldY = ((Number(avgFold) || 60) / 100) * size.height;
    ctx.strokeStyle = 'rgba(163, 59, 45, 0.85)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, foldY);
    ctx.lineTo(size.width, foldY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(163, 59, 45, 0.95)';
    ctx.font = '600 12px Vazirmatn UI FD, Tahoma, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('خط دید اولیه ≈ ' + faPct(avgFold || 60), size.width - 12, Math.max(16, foldY - 6));
  }

  function renderHeatmapElements(list, mode) {
    if (mode === 'scroll') {
      heatmapElements.innerHTML = `<p class="hm-scroll-note">نوارهای رنگی نشان می‌دهند چند درصد بازدیدکنندگان تا آن عمق صفحه رسیده‌اند. خط‌چین قرمز تقریب «بالای صفحه» (fold) است.</p>`;
      return;
    }
    if (!list.length) {
      heatmapElements.innerHTML = '<p class="empty">کلیکی در این بازه ثبت نشده.</p>';
      return;
    }
    heatmapElements.innerHTML = `<div class="hm-el-list">${list
      .map(
        (el) => `<div class="hm-el-row">
          <span class="hm-el-count">${faNum(el.count)}</span>
          <strong>${escapeHtml(el.text || '(بدون متن)')}</strong>
          ${el.href ? `<span class="cell-sub" dir="ltr">${escapeHtml(el.href)}</span>` : ''}
          ${el.sel ? `<span class="cell-sub" dir="ltr">${escapeHtml(el.sel)}</span>` : ''}
        </div>`
      )
      .join('')}</div>`;
  }

  function paintHeatmap() {
    if (!heatmapCache) return;
    const meta = heatmapCache.meta || {};
    const size = sizeHeatmapStage(meta);
    if (heatmapMode === 'scroll') {
      drawScrollHeat(heatmapCache.scroll || [], meta.avg_fold, size);
      heatmapEmpty.classList.add('hidden');
    } else {
      const clicks = heatmapCache.clicks || [];
      drawClickHeat(clicks, size);
      heatmapEmpty.classList.toggle('hidden', clicks.length > 0 || !(meta.views > 0));
    }
    renderHeatmapElements(heatmapCache.elements || [], heatmapMode);
  }

  async function fillHeatmapPages() {
    if (!heatmapPage) return;
    try {
      const data = await api(`/api/stats/pages?${filterQuery({ limit: 80 })}`);
      const pages = data.pages || [];
      const prev = heatmapPath || heatmapPage.value;
      heatmapPage.innerHTML = pages.length
        ? pages
            .map((p) => {
              const label = pageLabel(p);
              return `<option value="${escapeHtml(p.path)}">${escapeHtml(label.main)} (${faNum(p.views || p.pageviews || 0)})</option>`;
            })
            .join('')
        : '<option value="/">/</option>';
      if (prev && [...heatmapPage.options].some((o) => o.value === prev)) heatmapPage.value = prev;
      else if (pages[0]) heatmapPage.value = pages[0].path;
      heatmapPath = heatmapPage.value || '/';
    } catch {
      if (!heatmapPage.options.length) heatmapPage.innerHTML = '<option value="/">/</option>';
      heatmapPath = heatmapPage.value || '/';
    }
  }

  async function loadHeatmap() {
    if (!heatmapPage) return;
    heatmapError.textContent = '';
    await fillHeatmapPages();
    const path = heatmapPage.value || heatmapPath || '/';
    heatmapPath = path;
    saveState();
    try {
      const data = await api(
        `/api/stats/heatmap?${filterQuery({
          path,
          device: heatmapDevice?.value || 'all',
        })}`
      );
      heatmapCache = data;
      const meta = data.meta || {};
      heatmapPreviewTitle.textContent = meta.title ? pageLabel({ path: meta.path, title: meta.title }).main : 'پیش‌نمایش صفحه';
      heatmapMeta.textContent = [
        faNum(meta.views || 0) + ' بازدید',
        faNum(meta.click_count || 0) + ' کلیک',
        meta.clicks_with_coords != null ? faNum(meta.clicks_with_coords) + ' با مختصات' : '',
      ]
        .filter(Boolean)
        .join(' · ');

      const url = meta.preview_url || '';
      if (url && heatmapIframe.getAttribute('src') !== url) {
        heatmapIframe.src = url;
      } else if (!url) {
        heatmapIframe.removeAttribute('src');
      }
      paintHeatmap();
    } catch (err) {
      if (!err || err.message !== 'unauthorized') heatmapError.textContent = 'بارگذاری نقشه حرارتی ناموفق بود.';
    }
  }

  function stepText(step) {
    const p = step.props || {};
    if (step.kind === 'pageview') {
      return `ورود به صفحه · ماندن ${faDuration(step.duration_ms || 0)} · اسکرول تا ${faPct(step.scroll_depth || 0)}`;
    }
    if (step.kind === 'scroll') return `اسکرول صفحه به ${faPct(p.pct || 0)} رسید`;
    if (step.kind === 'video') {
      const act =
        p.action === 'pause' ? 'توقف ویدیو' : p.action === 'ended' ? 'پایان ویدیو' : p.action === 'click' ? 'کلیک روی ویدیو' : 'پخش ویدیو';
      const sec = p.sec ? ` (ثانیه ${faNum(p.sec)})` : '';
      return `${act}: ${p.title || 'ویدیو'}${sec}`;
    }
    if (step.kind === 'form_start') return `شروع پر کردن فرم «${p.form || 'فرم'}»${p.field ? ' · فیلد: ' + p.field : ''}`;
    if (step.kind === 'form_submit') return `ارسال فرم «${p.form || 'فرم'}»`;
    if (step.kind === 'click') {
      const bits = ['کلیک'];
      if (p.text) bits.push(`«${p.text}»`);
      if (p.href) bits.push(p.href);
      if (Number(p.outbound) === 1) bits.push('(خروجی)');
      return bits.join(' ');
    }
    if (step.kind === 'conversion') {
      return `تبدیل: ${goalLabel(p.goal, step.goal_name)}${p.text ? ' · ' + p.text : ''}`;
    }
    return step.kind;
  }

  function renderVisitorTimeline(data) {
    if (!data || !data.profile) {
      visitorTimelineRoot.innerHTML =
        '<p class="empty">تایم‌لاین این کاربر پیدا نشد. ممکن است فیلتر بازه/منبع باعث مخفی شدن جزئیات شده باشد.</p>';
      return;
    }
    const p = data.profile;
    const chapters = data.chapters || [];
    const camp = [p.source ? sourceLabel(p.source) : '', p.medium, p.campaign].filter(Boolean).join(' · ');

    visitorTimelineRoot.innerHTML = `
      <div class="visitor-profile-head">
        <div>
          <div class="visitor-card-top" style="margin-bottom:8px">
            <span class="ip-badge">${escapeHtml(p.ip || 'آی‌پی نامشخص')}</span>
            ${p.conversions_count ? '<span class="pill">تبدیل‌شده</span>' : '<span class="pill warn">بدون تبدیل</span>'}
          </div>
          <div class="visitor-meta">
            <span>${escapeHtml(camp || 'ورود مستقیم')}</span>
            <span>${escapeHtml(deviceLabel(p.device))}</span>
            <span>${escapeHtml(p.browser || 'مرورگر نامشخص')}</span>
            <span>${escapeHtml(p.os || '')}</span>
          </div>
          <p class="site-meta">${escapeHtml(IAJalali.toFaDigits(p.started_jalali || ''))}${
            p.last_jalali ? ' تا ' + escapeHtml(IAJalali.toFaDigits(p.last_jalali)) : ''
          }</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="visitor-export-btn">خروجی Excel تایم‌لاین</button>
      </div>
      <div class="visitor-summary-row">
        <div class="v-mini-stat"><span>صفحات</span><strong>${faNum(p.pages_count)}</strong></div>
        <div class="v-mini-stat"><span>زمان کل</span><strong>${faDuration(p.total_ms)}</strong></div>
        <div class="v-mini-stat"><span>بیشترین اسکرول</span><strong>${faPct(p.max_scroll)}</strong></div>
        <div class="v-mini-stat"><span>کلیک / ویدیو / فرم</span><strong>${faNum(p.clicks_count)} / ${faNum(
      p.videos_count
    )} / ${faNum(p.forms_count)}</strong></div>
      </div>
      <div class="timeline-chapters">${chapters
        .map((ch, idx) => {
          const label = pageLabel({ path: ch.path, title: ch.title });
          const events = ch.events || [];
          return `<article class="tl-chapter">
            <div class="tl-chapter-head">
              <div>
                <div class="tl-chapter-title">${faNum(idx + 1)}. ${escapeHtml(label.main)}</div>
                <span class="cell-sub" dir="ltr">${escapeHtml(ch.path)}</span>
                <div class="visitor-chips" style="margin-top:6px">
                  <span class="v-chip">${escapeHtml(sourceLabel(ch.source))}</span>
                  ${ch.utm_campaign ? `<span class="v-chip brass">${escapeHtml(ch.utm_campaign)}</span>` : ''}
                  <span class="v-chip">ماندن ${faDuration(ch.duration_ms)}</span>
                  <span class="v-chip">اسکرول ${faPct(ch.scroll_depth)}</span>
                </div>
              </div>
              <span class="cell-sub">${escapeHtml(IAJalali.toFaDigits(ch.jalali_at || ''))}</span>
            </div>
            <ul class="tl-events">
              <li class="tl-item kind-pageview">
                <span class="tl-text">ورود به صفحه · ماندن ${faDuration(ch.duration_ms || 0)} · بیشترین اسکرول ${faPct(
                  ch.scroll_depth || 0
                )}</span>
                <span class="tl-offset">شروع</span>
              </li>
              ${events
                .map((ev) => {
                  const fakeStep = {
                    kind: ev.name,
                    props: ev.props,
                    goal_name: ev.goal_name,
                    duration_ms: 0,
                    scroll_depth: 0,
                  };
                  return `<li class="tl-item kind-${escapeHtml(ev.name)}">
                    <span class="tl-text">${escapeHtml(stepText(fakeStep))}</span>
                    <span class="tl-offset">${
                      ev.ms != null
                        ? escapeHtml(formatOffset(ev.ms))
                        : escapeHtml(IAJalali.toFaDigits((ev.jalali_at || '').slice(11) || ''))
                    }</span>
                  </li>`;
                })
                .join('')}
            </ul>
          </article>`;
        })
        .join('')}</div>`;

    const exportBtnLocal = document.getElementById('visitor-export-btn');
    if (exportBtnLocal) {
      exportBtnLocal.addEventListener('click', () => {
        location.href = `/api/export.csv?${filterQuery({ report: 'visitor', sid: p.session_id })}`;
      });
    }
  }

  async function openVisitorTimeline(sid) {
    if (!sid) return;
    currentVisitorSid = sid;
    visitorsLayout.classList.add('has-detail');
    visitorsList.querySelectorAll('.visitor-card').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.sid === sid);
    });
    visitorTimelineRoot.innerHTML = '<p class="empty">در حال بارگذاری تایم‌لاین...</p>';
    saveState();
    try {
      const data = await api(`/api/stats/visitor?${filterQuery({ sid })}`);
      renderVisitorTimeline(data);
    } catch (err) {
      if (!err || err.message !== 'unauthorized') {
        visitorTimelineRoot.innerHTML = '<p class="empty">بارگذاری تایم‌لاین ناموفق بود.</p>';
      }
    }
  }

  function renderVisitorsList(list) {
    visitorsCount.textContent = list.length ? faNum(list.length) + ' نشست' : '';
    if (!list.length) {
      visitorsList.innerHTML = '<p class="empty">در این بازه/فیلتر کاربری نیست.</p>';
      if (!currentVisitorSid) {
        visitorTimelineRoot.innerHTML =
          '<p class="empty">یک کاربر را از لیست انتخاب کنید تا تایم‌لاین کاملش نمایش داده شود.</p>';
      }
      return;
    }

    visitorsList.innerHTML = list
      .map((v) => {
        const camp = [v.source ? sourceLabel(v.source) : '', v.medium, v.campaign].filter(Boolean).join(' · ');
        const landing = pageLabel({ path: v.landing_path, title: v.landing_title });
        return `<button type="button" class="visitor-card ${
          currentVisitorSid === v.session_id ? 'is-active' : ''
        }" data-sid="${escapeHtml(v.session_id)}">
          <div class="visitor-card-top">
            <span class="ip-badge">${escapeHtml(v.ip || 'آی‌پی نامشخص')}</span>
            ${
              v.conversions
                ? `<span class="pill">${escapeHtml(v.goals[0] || 'تبدیل')}</span>`
                : '<span class="pill warn">بدون تبدیل</span>'
            }
          </div>
          <div class="visitor-meta">
            <span>${escapeHtml(camp || 'ورود مستقیم')}</span>
            <span>${escapeHtml(deviceLabel(v.device))}</span>
            <span>${escapeHtml(IAJalali.toFaDigits((v.started_jalali || '').slice(0, 16)))}</span>
          </div>
          <div class="visitor-chips">
            <span class="v-chip">${escapeHtml(landing.main)}</span>
            <span class="v-chip">${faNum(v.pages_count)} صفحه</span>
            <span class="v-chip">${faDuration(v.total_ms)}</span>
            <span class="v-chip">اسکرول ${faPct(v.max_scroll)}</span>
            ${v.clicks ? `<span class="v-chip">${faNum(v.clicks)} کلیک</span>` : ''}
            ${v.videos ? `<span class="v-chip brass">${faNum(v.videos)} ویدیو</span>` : ''}
            ${v.forms ? `<span class="v-chip">${faNum(v.forms)} فرم</span>` : ''}
            ${v.conversions ? `<span class="v-chip good">${faNum(v.conversions)} تبدیل</span>` : ''}
          </div>
        </button>`;
      })
      .join('');

    visitorsList.querySelectorAll('[data-sid]').forEach((btn) => {
      btn.addEventListener('click', () => openVisitorTimeline(btn.dataset.sid));
    });
  }

  async function loadVisitors() {
    visitorsError.textContent = '';
    try {
      const q = filterQuery({
        q: visitorSearch.value || '',
        only_converted: visitorOnlyConv.checked ? '1' : '',
        limit: 50,
      });
      const data = await api(`/api/stats/visitors?${q}`);
      visitorsCache = data.visitors || [];
      renderVisitorsList(visitorsCache);
      if (currentVisitorSid) {
        const stillThere = visitorsCache.some((v) => v.session_id === currentVisitorSid);
        if (stillThere) await openVisitorTimeline(currentVisitorSid);
        else {
          currentVisitorSid = '';
          visitorsLayout.classList.remove('has-detail');
          visitorTimelineRoot.innerHTML =
            '<p class="empty">یک کاربر را از لیست انتخاب کنید تا تایم‌لاین کاملش نمایش داده شود.</p>';
          saveState();
        }
      }
    } catch (err) {
      if (!err || err.message !== 'unauthorized') visitorsError.textContent = 'بارگذاری کاربران ناموفق بود.';
    }
  }

  async function loadConversions() {
    const q = filterQuery();
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
      label: IAJalali.toFaDigits(String(row.jalali || row.day).slice(5)),
      fullLabel: IAJalali.toFaDigits(row.jalali || row.day),
      y: Number(row.conversions) || 0,
    }));
    IACharts.lineChart(document.getElementById('chart-conversions'), chartPoints, { label1: 'تبدیل' });

    const goalSlices = (data.goals || []).map((g) => ({
      label: goalLabel(g.goal, g.goal_name),
      value: Number(g.conversions) || 0,
    }));
    IACharts.donutChart(document.getElementById('chart-goals'), goalSlices);

    const campEl = document.getElementById('conv-campaign-table');
    const campaigns = data.campaigns || [];
    if (!campaigns.length) {
      campEl.innerHTML = '<p class="empty">هنوز کمپینی با تبدیل در این بازه ثبت نشده.</p>';
    } else {
      campEl.innerHTML = `<table class="table wide"><thead><tr>
        <th>کمپین</th><th>نشست</th><th>تبدیل</th><th>نرخ</th>
      </tr></thead><tbody>${campaigns
        .map((row) => {
          const title = row.campaign || sourceLabel(row.source) || 'بدون نام';
          const sub = [sourceLabel(row.source), row.medium].filter(Boolean).join(' · ');
          const cvrVal = Number(row.cvr || 0);
          return `<tr>
            <td>${escapeHtml(title)}${sub ? `<span class="cell-sub">${escapeHtml(sub)}</span>` : ''}</td>
            <td>${faNum(row.sessions)}</td>
            <td>${faNum(row.converting_sessions || row.conversions)}</td>
            <td><span class="pill ${cvrVal > 0 ? '' : 'warn'}">${faPct(cvrVal)}</span></td>
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
            <td>${escapeHtml(goalLabel(g.goal, g.goal_name))}</td>
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
          const cvrVal = Number(row.cvr || 0);
          return `<tr class="link-row" data-open-page="${escapeHtml(row.path)}">
            <td><span class="link-title">${escapeHtml(label.main)}</span>${
              label.sub ? `<span class="cell-sub" dir="ltr">${escapeHtml(label.sub)}</span>` : ''
            }</td>
            <td>${faNum(row.sessions)}</td>
            <td>${faNum(row.converted)}</td>
            <td><span class="pill ${cvrVal > 0 ? '' : 'warn'}">${faPct(cvrVal)}</span></td>
          </tr>`;
        })
        .join('')}</tbody></table>`;
      funnelEl.querySelectorAll('[data-open-page]').forEach((tr) => {
        tr.addEventListener('click', () => openPageDetail(tr.dataset.openPage));
      });
    }

    const journeyEl = document.getElementById('journey-table');
    const journeys = journeysData.journeys || [];
    if (!journeys.length) {
      journeyEl.innerHTML = '<p class="empty">نشستی در این بازه نیست.</p>';
    } else {
      journeyEl.innerHTML = `<div class="journey-list">${journeys
        .slice(0, 20)
        .map((j) => {
          const camp = [j.source ? sourceLabel(j.source) : '', j.medium, j.campaign]
            .filter(Boolean)
            .join(' · ');
          const steps = (j.path || []).map((p) => escapeHtml(prettyPath(p))).join(' ← ');
          const goalsTxt = (j.conversions || [])
            .map((c) => goalLabel(c.goal, c.goal_name))
            .join('، ');
          const when = j.started_jalali ? IAJalali.toFaDigits(j.started_jalali) : '';
          return `<article class="journey-card ${j.converted ? 'is-converted' : ''}">
            <div class="journey-top">
              <span>${j.converted ? 'تبدیل شد' : 'بدون تبدیل'}${when ? ` · ${escapeHtml(when)}` : ''}</span>
              <span class="cell-sub">${camp ? escapeHtml(camp) : 'ورود مستقیم'} · ${faNum(j.pages_count)} صفحه</span>
            </div>
            <p class="journey-path" dir="ltr">${steps || '—'}</p>
            ${goalsTxt ? `<p class="journey-goals">هدف: ${escapeHtml(goalsTxt)}</p>` : ''}
          </article>`;
        })
        .join('')}</div>`;
    }
  }

  async function loadGoals() {
    goalFormErr.textContent = '';
    try {
      const data = await api(`/api/goals?site=${encodeURIComponent(fSite.value || 'all')}`);
      const list = data.goals || [];
      if (!list.length) {
        goalsList.innerHTML = '<p class="empty">هنوز هدف سفارشی نساخته‌اید. از فرم کنار یکی بسازید.</p>';
        return;
      }
      goalsList.innerHTML = `<table class="table wide"><thead><tr>
        <th>نام هدف</th><th>سایت</th><th>شرط</th><th>عملیات</th>
      </tr></thead><tbody>${list
        .map(
          (g) => `<tr>
            <td><strong>${escapeHtml(g.name)}</strong>${
              g.is_active ? '' : '<span class="cell-sub">غیرفعال</span>'
            }</td>
            <td>${escapeHtml(g.site_name)}</td>
            <td>${escapeHtml(matchTypeLabel(g.match_type))}<span class="cell-sub" dir="ltr">${escapeHtml(
              g.match_value
            )}</span></td>
            <td>
              <div style="display:flex;gap:6px">
                <button type="button" class="btn btn-ghost btn-sm" data-toggle-goal="${g.id}" data-active="${
                  g.is_active ? '1' : '0'
                }">${g.is_active ? 'غیرفعال' : 'فعال'}</button>
                <button type="button" class="btn btn-danger btn-sm" data-del-goal="${g.id}">حذف</button>
              </div>
            </td>
          </tr>`
        )
        .join('')}</tbody></table>`;

      goalsList.querySelectorAll('[data-toggle-goal]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const active = btn.dataset.active === '1';
          await api(`/api/goals/${btn.dataset.toggleGoal}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: !active }),
          });
          loadGoals();
        });
      });

      goalsList.querySelectorAll('[data-del-goal]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('این هدف حذف شود؟')) return;
          await api(`/api/goals/${btn.dataset.delGoal}`, { method: 'DELETE' });
          loadGoals();
        });
      });
    } catch {
      goalsList.innerHTML = '<p class="empty">خطا در دریافت هدف‌ها.</p>';
    }
  }

  goalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    goalFormErr.textContent = '';
    try {
      await api('/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          site_id: goalSite.value,
          name: document.getElementById('goal-name').value,
          match_type: document.getElementById('goal-type').value,
          match_value: document.getElementById('goal-value').value,
        }),
      });
      document.getElementById('goal-name').value = '';
      document.getElementById('goal-value').value = '';
      await loadGoals();
    } catch {
      goalFormErr.textContent = 'ثبت هدف ناموفق بود. همه فیلدها را بررسی کنید.';
    }
  });

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
    fillSiteSelectors();
  }

  async function bootstrap() {
    await refreshSites();
    await refreshFilterChoices();
    setView(savedInit.view || 'dashboard', { keepExport: true });
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

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (appView.classList.contains('hidden')) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentView !== 'sites' && currentView !== 'goals') reloadCurrentView();
    }, 150);
  });

  void picker;
  init();
})();
