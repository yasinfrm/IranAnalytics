/*! Iran Analytics — first-party tracker (no CDN deps)
 * Collects pageviews, campaign (UTM), active time, scroll depth, and clicks
 * on links/buttons. Does not read form field values, keystrokes, or passwords.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) {
    var list = document.getElementsByTagName('script');
    script = list[list.length - 1];
  }
  var key = script && script.getAttribute('data-site');
  if (!key) return;

  // Filled in when /t.js is served. Survives cache plugins that copy the file
  // onto the site's own domain and would otherwise post to the wrong host.
  var baked = '__IA_ORIGIN__';
  var endpoint = '';
  if (script && script.getAttribute('data-api')) {
    endpoint = script.getAttribute('data-api').replace(/\/$/, '');
  } else if (baked.indexOf('http') === 0) {
    endpoint = baked.replace(/\/$/, '');
  } else {
    var src = script && script.src ? script.src : '';
    try {
      endpoint = new URL(src).origin;
    } catch (e) {
      endpoint = '';
    }
  }
  if (!endpoint) return;

  var MAX_MS = 30 * 60 * 1000;
  var MAX_CLICKS = 40;
  var sidKey = 'ia_sid';
  var utmKey = 'ia_utm';
  var goalsKey = 'ia_goals_' + key;
  var customGoals = [];
  var UTM_FIELDS = [
    ['source', 'utm_source'],
    ['medium', 'utm_medium'],
    ['campaign', 'utm_campaign'],
    ['term', 'utm_term'],
    ['content', 'utm_content'],
  ];

  var view = null;

  function getSid() {
    try {
      var s = localStorage.getItem(sidKey);
      if (s && s.length < 64) return s;
      s =
        Math.random().toString(36).slice(2) +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2);
      localStorage.setItem(sidKey, s);
      return s;
    } catch (e) {
      return '';
    }
  }

  function newVid() {
    return (
      Math.random().toString(36).slice(2) +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function clip(value, max) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function emptyUtm() {
    return { source: '', medium: '', campaign: '', term: '', content: '' };
  }

  function readStoredUtm() {
    try {
      var parsed = JSON.parse(sessionStorage.getItem(utmKey) || '{}');
      var out = emptyUtm();
      for (var i = 0; i < UTM_FIELDS.length; i++) {
        var short = UTM_FIELDS[i][0];
        out[short] = clip(parsed[short], 120);
      }
      return out;
    } catch (e) {
      return emptyUtm();
    }
  }

  /** A new tagged landing replaces the session campaign. Otherwise the last one sticks. */
  function syncUtm() {
    var current = readStoredUtm();
    var q;
    try {
      q = new URLSearchParams(location.search);
    } catch (e) {
      return current;
    }
    var found = false;
    var next = emptyUtm();
    for (var i = 0; i < UTM_FIELDS.length; i++) {
      var pair = UTM_FIELDS[i];
      var value = clip(q.get(pair[1]), 120);
      if (value) found = true;
      next[pair[0]] = value;
    }
    var ynPlat = clip(q.get('utm_yn_plt') || q.get('yn_plt'), 120);
    var ynData = q.get('utm_yn_data') || q.get('yn_data');
    if (ynPlat || ynData) {
      found = true;
      if (!next.source) next.source = ynPlat || 'yektanet';
      if (!next.medium) next.medium = 'native';
    }
    if (!found) return current;
    try {
      sessionStorage.setItem(utmKey, JSON.stringify(next));
    } catch (e) {}
    return next;
  }

  function isNoisePath() {
    var p = (location.pathname || '').toLowerCase();
    return (
      p.indexOf('/wp-admin') === 0 ||
      p.indexOf('/wp-login') === 0 ||
      p.indexOf('/wp-json') === 0
    );
  }

  function payload(extra) {
    var data = {
      k: key,
      p: location.pathname + location.search,
      t: document.title || '',
      r: document.referrer || '',
      sid: getSid(),
      ua: navigator.userAgent || '',
      vid: view ? view.id : '',
      utm: syncUtm(),
    };
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) data[k] = extra[k];
    }
    return data;
  }

  function send(body) {
    var url = endpoint + '/collect';
    var json = JSON.stringify(body);
    // text/plain avoids a CORS preflight. application/json beacons often die
    // silently when the page is on another domain (WordPress / LiteSpeed copy).
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([json], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(url, blob)) return;
      }
    } catch (e) {}
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: json,
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function () {
        pixel(body);
      });
    } catch (e) {
      pixel(body);
    }
  }

  function pixel(body) {
    try {
      var q = [];
      for (var k in body) {
        if (!Object.prototype.hasOwnProperty.call(body, k)) continue;
        var v = body[k];
        if (v == null) continue;
        if (typeof v === 'object') v = JSON.stringify(v);
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
      }
      var img = new Image(1, 1);
      img.referrerPolicy = 'no-referrer-when-downgrade';
      img.src = endpoint + '/e.gif?' + q.join('&');
    } catch (e) {}
  }

  function trackPageview() {
    if (isNoisePath()) return;
    send(payload({ type: 'pageview' }));
    checkUrlGoals();
  }

  function checkUrlGoals() {
    if (!view || !customGoals.length || isNoisePath()) return;
    var full = (location.pathname + location.search).toLowerCase();
    var decoded = full;
    try {
      decoded = decodeURIComponent(full);
    } catch (e) {}
    for (var i = 0; i < customGoals.length; i++) {
      var g = customGoals[i];
      if (!g || g.match_type !== 'url_contains' || !g.match_value) continue;
      var needle = String(g.match_value).toLowerCase();
      if (full.indexOf(needle) >= 0 || decoded.indexOf(needle) >= 0) {
        trackConversion(g.goal_key, {
          text: clip(g.name, 80),
          href: clip(location.pathname, 300),
          el: 'url',
        });
      }
    }
  }

  function loadCustomGoals() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(goalsKey) || 'null');
      if (cached && cached.ts && Date.now() - cached.ts < 60000 && Array.isArray(cached.goals)) {
        customGoals = cached.goals;
        checkUrlGoals();
        return;
      }
    } catch (e) {}
    try {
      fetch(endpoint + '/site-goals?k=' + encodeURIComponent(key), {
        mode: 'cors',
        credentials: 'omit',
      })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.goals)) return;
          customGoals = data.goals;
          try {
            sessionStorage.setItem(goalsKey, JSON.stringify({ ts: Date.now(), goals: customGoals }));
          } catch (e) {}
          checkUrlGoals();
        })
        .catch(function () {});
    } catch (e) {}
  }

  function trackEvent(name, props) {
    if (!name || isNoisePath()) return;
    var p = props && typeof props === 'object' ? Object.assign({}, props) : {};
    if (p.ms == null) p.ms = elapsedMs();
    send(
      payload({
        type: 'event',
        n: String(name).slice(0, 120),
        props: p,
      })
    );
  }

  function makeView() {
    return {
      id: newVid(),
      acc: 0,
      lastTick: document.hidden ? 0 : Date.now(),
      scroll: 0,
      sentMs: -1,
      sentScroll: -1,
      clicks: 0,
      goals: {},
      scrollMarks: {},
      formsStarted: {},
      videoMarks: {},
    };
  }

  function elapsedMs() {
    if (!view) return 0;
    var extra = view.lastTick && !document.hidden ? Date.now() - view.lastTick : 0;
    var total = view.acc + extra;
    return total > MAX_MS ? MAX_MS : total < 0 ? 0 : total;
  }

  function tick() {
    if (!view || !view.lastTick) return;
    view.acc += Date.now() - view.lastTick;
    if (view.acc > MAX_MS) view.acc = MAX_MS;
    view.lastTick = document.hidden ? 0 : Date.now();
  }

  var SCROLL_STEPS = [20, 40, 60, 80, 100];

  function elScrollPct(el) {
    if (!el) return 0;
    var max = (el.scrollHeight || 0) - (el.clientHeight || 0);
    if (max <= 8) return 0;
    var top = el.scrollTop || 0;
    var pct = Math.round((top / max) * 100);
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return pct;
  }

  /** Window + Elementor/overflow containers — many WP themes never move window.scrollY. */
  function computeScrollPct() {
    var doc = document.documentElement;
    var body = document.body;
    var se = document.scrollingElement || doc;
    var height = Math.max(
      se ? se.scrollHeight : 0,
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0
    );
    var maxWin = height - window.innerHeight;
    var winPct = maxWin <= 8 ? 100 : Math.round(((window.scrollY || se.scrollTop || 0) / maxWin) * 100);
    var best = winPct;
    var nodes = [se, doc, body];
    try {
      var extras = document.querySelectorAll(
        '.elementor, .elementor-location-single, .elementor-section, .e-con, main, #content, #page, .site-content, [data-elementor-type]'
      );
      for (var i = 0; i < extras.length && i < 40; i++) nodes.push(extras[i]);
    } catch (e) {}
    for (var j = 0; j < nodes.length; j++) {
      var p = elScrollPct(nodes[j]);
      if (p > best) best = p;
    }
    if (best < 0) best = 0;
    if (best > 100) best = 100;
    return best;
  }

  function measureScroll() {
    if (!view) return;
    var pct = computeScrollPct();
    if (pct > view.scroll) view.scroll = pct;

    if (view.scroll >= 20 && !isNoisePath()) {
      for (var i = 0; i < SCROLL_STEPS.length; i++) {
        var step = SCROLL_STEPS[i];
        if (view.scroll >= step && !view.scrollMarks[step]) {
          view.scrollMarks[step] = 1;
          send(
            payload({
              type: 'event',
              n: 'scroll',
              auto: 1,
              props: { pct: step, ms: elapsedMs() },
            })
          );
        }
      }
    }
  }

  function flush() {
    if (!view) return;
    tick();
    if (view.acc === view.sentMs && view.scroll === view.sentScroll) return;
    if (view.acc < 400 && view.scroll <= 0) return;
    view.sentMs = view.acc;
    view.sentScroll = view.scroll;
    send(
      payload({
        type: 'engage',
        ms: view.acc,
        scroll: view.scroll,
      })
    );
  }

  function rotate() {
    flush();
    view = makeView();
    syncUtm();
    measureScroll();
    trackPageview();
  }

  function clickLabel(el) {
    var named = el.getAttribute('data-ia');
    if (named) return clip(named, 80);
    var aria = el.getAttribute('aria-label');
    if (aria) return clip(aria, 80);
    if (el.tagName === 'INPUT') return clip(el.value, 80);
    return clip(el.innerText || el.textContent, 80);
  }

  function detectGoal(el, hrefFull) {
    var custom = clip(el.getAttribute('data-ia-goal'), 40);
    if (custom) return custom;
    var h = String(hrefFull || '').toLowerCase();
    if (h.indexOf('tel:') === 0) return 'contact_phone';
    if (h.indexOf('mailto:') === 0) return 'contact_email';
    if (
      h.indexOf('wa.me/') >= 0 ||
      h.indexOf('api.whatsapp.com') >= 0 ||
      h.indexOf('whatsapp.com') >= 0 ||
      h.indexOf('whatsapp:') === 0
    ) {
      return 'contact_whatsapp';
    }
    var path = '';
    try {
      path = new URL(hrefFull || el.href || '', location.href).pathname.toLowerCase();
    } catch (err) {}
    if (path.indexOf('/consultation') >= 0 || path.indexOf('/contact') >= 0) return 'consultation';
    var text = clickLabel(el);
    if (/مشاوره|تماس\s*با\s*مشاور|درخواست\s*ارزیابی|تماس\s*بگیر|واتساپ|whatsapp/i.test(text)) {
      return 'consultation_cta';
    }
    return '';
  }

  function trackConversion(goal, props) {
    if (!goal || isNoisePath()) return;
    var g = String(goal).slice(0, 40);
    if (!view.goals) view.goals = {};
    if (view.goals[g]) return;
    view.goals[g] = 1;
    var utm = syncUtm();
    send(
      payload({
        type: 'event',
        n: 'conversion',
        auto: 1,
        props: Object.assign(
          {
            goal: g,
            source: utm.source || '',
            medium: utm.medium || '',
            campaign: utm.campaign || '',
            term: utm.term || '',
            content: utm.content || '',
            ms: elapsedMs(),
          },
          props && typeof props === 'object' ? props : {}
        ),
      })
    );
  }

  function videoInfo(el) {
    if (!el) return { title: 'ویدیو', src: '' };
    var src = el.currentSrc || el.getAttribute('src') || '';
    if (!src) {
      var sourceEl = el.querySelector && el.querySelector('source[src], iframe[src], video[src]');
      if (sourceEl) src = sourceEl.getAttribute('src') || '';
    }
    var widget = el.closest && el.closest('.elementor-widget-video');
    if (!src && widget) {
      var ifrm = widget.querySelector('iframe[src], video[src]');
      if (ifrm) src = ifrm.getAttribute('src') || '';
      if (!src) {
        try {
          var ds = JSON.parse(widget.getAttribute('data-settings') || '{}');
          src = ds.youtube_url || ds.vimeo_url || (ds.hosted_url && ds.hosted_url.url) || ds.dailymotion_url || '';
        } catch (e) {}
      }
    }
    var title =
      clip(
        el.getAttribute('data-ia-video') ||
          (widget && widget.getAttribute('data-ia-video')) ||
          el.getAttribute('title') ||
          el.getAttribute('aria-label'),
        80
      ) || '';
    if (!title && src) {
      try {
        var clean = src.split('?')[0].split('/').pop();
        if (clean) title = clip(decodeURIComponent(clean), 80);
      } catch (e) {}
    }
    return { title: title || 'ویدیو', src: clip(src, 200) };
  }

  function formLabel(form) {
    if (!form) return 'فرم';
    var named = clip(form.getAttribute('data-ia') || form.getAttribute('aria-label') || form.getAttribute('name'), 80);
    if (named) return named;
    if (form.id) return clip(form.id, 60);
    var heading = form.querySelector && form.querySelector('h1,h2,h3,h4,legend');
    if (heading) return clip(heading.innerText || heading.textContent, 60);
    var sub = form.querySelector && form.querySelector('button[type="submit"], input[type="submit"]');
    if (sub) return clip(sub.innerText || sub.value || sub.textContent, 60);
    return 'فرم صفحه';
  }

  function fieldLabel(el) {
    if (!el) return '';
    var placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || el.id;
    return clip(placeholder, 60);
  }

  function onVideoEvent(action, e) {
    if (!view || isNoisePath()) return;
    var el = e.target;
    if (!el || !el.tagName || el.tagName.toLowerCase() !== 'video') return;
    var info = videoInfo(el);
    var markKey = action + ':' + (info.src || info.title);
    if (action === 'pause' && (el.currentTime || 0) < 1) return;
    if (action !== 'pause' && view.videoMarks[markKey]) return;
    view.videoMarks[markKey] = 1;
    send(
      payload({
        type: 'event',
        n: 'video',
        auto: 1,
        props: {
          action: action,
          title: info.title,
          src: info.src,
          sec: Math.round(el.currentTime || 0),
          ms: elapsedMs(),
        },
      })
    );
  }

  function onFocusIn(e) {
    if (!view || isNoisePath()) return;
    var t = e.target;
    if (!t || !t.tagName) return;
    var tag = t.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    var type = (t.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'search') return;
    if (t.closest('[data-ia-ignore], #wpadminbar, .wp-admin')) return;
    var form = t.closest('form');
    if (!form) return;
    var fKey = form.id || form.getAttribute('name') || form.getAttribute('action') || String(Array.prototype.indexOf.call(document.forms, form));
    if (view.formsStarted[fKey]) return;
    view.formsStarted[fKey] = 1;
    send(
      payload({
        type: 'event',
        n: 'form_start',
        auto: 1,
        props: {
          form: formLabel(form),
          field: fieldLabel(t),
          ms: elapsedMs(),
        },
      })
    );
  }

  function onClick(e) {
    if (!view || view.clicks >= MAX_CLICKS || isNoisePath()) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-ia-ignore], #wpadminbar, .wp-admin')) return;
    var field = t.closest('input, textarea, select, [contenteditable="true"]');
    if (field) {
      var submit = t.closest('button, input[type="submit"], input[type="button"]');
      if (!submit) return;
      t = submit;
    }
    var videoEl = t.closest('video, .elementor-video, .elementor-custom-embed-image-overlay, .elementor-custom-embed-play, .wp-video, .plyr, [data-ia-video]');
    if (videoEl) {
      var vInfo = videoInfo(videoEl);
      send(
        payload({
          type: 'event',
          n: 'video',
          auto: 1,
          props: {
            action: 'click',
            title: vInfo.title,
            src: vInfo.src,
            sec: 0,
            ms: elapsedMs(),
          },
        })
      );
    }

    var el = t.closest('a, button, [role="button"], input[type="submit"], input[type="button"], summary, [data-ia]');
    if (!el || el.closest('[data-ia-ignore]')) return;

    var href = '';
    var hrefFull = '';
    var outbound = 0;
    if (el.href) {
      try {
        var u = new URL(el.href, location.href);
        hrefFull = u.href;
        if (u.protocol === 'tel:' || u.protocol === 'mailto:') {
          href = u.href.slice(0, 300);
        } else {
          href = (u.host + u.pathname).slice(0, 300);
          if (u.host !== location.host) outbound = 1;
        }
      } catch (err) {}
    }

    view.clicks += 1;
    var label = clickLabel(el);
    send(
      payload({
        type: 'event',
        n: 'click',
        auto: 1,
        props: {
          el: (el.tagName || '').toLowerCase().slice(0, 20),
          text: label,
          href: href,
          id: clip(el.id, 80),
          name: clip(el.getAttribute('data-ia'), 80),
          outbound: outbound,
          ms: elapsedMs(),
        },
      })
    );

    var goal = detectGoal(el, hrefFull);
    if (goal) {
      trackConversion(goal, {
        text: label,
        href: href,
        el: (el.tagName || '').toLowerCase().slice(0, 20),
      });
    }

    // Panel-configured click rules
    for (var i = 0; i < customGoals.length; i++) {
      var cg = customGoals[i];
      if (!cg || !cg.match_value) continue;
      var mv = String(cg.match_value);
      var hit = false;
      if (cg.match_type === 'click_text') {
        hit = label.toLowerCase().indexOf(mv.toLowerCase()) >= 0;
      } else if (cg.match_type === 'href_contains') {
        hit = String(hrefFull || href).toLowerCase().indexOf(mv.toLowerCase()) >= 0;
      } else if (cg.match_type === 'click_selector') {
        try {
          hit = !!(el.matches && el.matches(mv)) || !!(el.closest && el.closest(mv));
        } catch (errSel) {}
      }
      if (hit) {
        trackConversion(cg.goal_key, {
          text: label || clip(cg.name, 80),
          href: href,
          el: (el.tagName || '').toLowerCase().slice(0, 20),
        });
      }
    }
  }

  var pushState = history.pushState;
  if (pushState) {
    history.pushState = function () {
      var ret = pushState.apply(this, arguments);
      setTimeout(rotate, 0);
      return ret;
    };
  }
  window.addEventListener('popstate', function () {
    setTimeout(rotate, 0);
  });

  function onSubmit(e) {
    if (!view || isNoisePath()) return;
    var form = e.target;
    if (!form || !form.tagName || form.tagName.toLowerCase() !== 'form') return;
    if (form.closest('[data-ia-ignore], #wpadminbar, .wp-admin')) return;

    var goal = clip(form.getAttribute('data-ia-goal'), 40);
    if (!goal) {
      var action = '';
      try {
        action = (form.getAttribute('action') || '').toLowerCase();
      } catch (err) {}
      var idName = ((form.id || '') + ' ' + (form.getAttribute('name') || '')).toLowerCase();
      var text = '';
      try {
        text = (form.innerText || form.textContent || '').slice(0, 200);
      } catch (err2) {}
      if (
        /consult|contact|lead|مشاوره|تماس|ارزیابی/.test(action + ' ' + idName) ||
        /مشاوره|درخواست\s*ارزیابی|تماس\s*بگیر/.test(text)
      ) {
        goal = 'form_consultation';
      } else if (
        form.querySelector(
          'input[type="tel"], input[name*="phone"], input[name*="Phone"], input[name*="mobile"], input[name*="Mobile"]'
        )
      ) {
        goal = 'form_lead';
      }
    }
    var fName = formLabel(form);
    send(
      payload({
        type: 'event',
        n: 'form_submit',
        auto: 1,
        props: {
          form: fName,
          action: clip(form.getAttribute('action') || location.pathname, 200),
          ms: elapsedMs(),
        },
      })
    );

    if (goal) {
      trackConversion(goal, {
        el: 'form',
        text: fName,
        href: clip(form.getAttribute('action') || location.pathname, 300),
      });
    }

    for (var i = 0; i < customGoals.length; i++) {
      var cg = customGoals[i];
      if (!cg || cg.match_type !== 'form_submit' || !cg.match_value) continue;
      var mv = String(cg.match_value).toLowerCase();
      var hay = (
        (form.id || '') +
        ' ' +
        (form.className || '') +
        ' ' +
        (form.getAttribute('name') || '') +
        ' ' +
        (form.getAttribute('action') || '')
      ).toLowerCase();
      var matched = hay.indexOf(mv) >= 0;
      if (!matched && (mv.charAt(0) === '.' || mv.charAt(0) === '#')) {
        try {
          matched = !!(form.matches && form.matches(cg.match_value));
        } catch (e2) {}
      }
      if (matched) {
        trackConversion(cg.goal_key, {
          el: 'form',
          text: clip(cg.name, 80),
          href: clip(form.getAttribute('action') || location.pathname, 300),
        });
      }
    }
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('play', function (e) { onVideoEvent('play', e); }, true);
  document.addEventListener('pause', function (e) { onVideoEvent('pause', e); }, true);
  document.addEventListener('ended', function (e) { onVideoEvent('ended', e); }, true);
  // capture:true catches Elementor/overflow containers that don't scroll the window
  document.addEventListener('scroll', measureScroll, { passive: true, capture: true });
  window.addEventListener('scroll', measureScroll, { passive: true });
  window.addEventListener('resize', measureScroll);
  document.addEventListener('visibilitychange', function () {
    if (!view) return;
    if (document.hidden) {
      tick();
      view.lastTick = 0;
      flush();
    } else {
      view.lastTick = Date.now();
    }
  });
  window.addEventListener('pagehide', flush);

  setInterval(function () {
    if (document.hidden) return;
    measureScroll();
    flush();
  }, 15000);

  window.iranAnalytics = {
    track: trackEvent,
    convert: trackConversion,
    pageview: function () {
      rotate();
    },
  };

  function boot() {
    view = makeView();
    syncUtm();
    measureScroll();
    trackPageview();
    loadCustomGoals();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
  window.addEventListener('load', measureScroll);
})();
