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
  }

  function trackEvent(name, props) {
    if (!name || isNoisePath()) return;
    send(
      payload({
        type: 'event',
        n: String(name).slice(0, 120),
        props: props && typeof props === 'object' ? props : {},
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
    };
  }

  function tick() {
    if (!view || !view.lastTick) return;
    view.acc += Date.now() - view.lastTick;
    if (view.acc > MAX_MS) view.acc = MAX_MS;
    view.lastTick = document.hidden ? 0 : Date.now();
  }

  function measureScroll() {
    if (!view) return;
    var doc = document.documentElement;
    var body = document.body;
    var height = Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0);
    var max = height - window.innerHeight;
    var pct = max <= 8 ? 100 : Math.round((window.scrollY / max) * 100);
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    if (pct > view.scroll) view.scroll = pct;
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
          },
          props && typeof props === 'object' ? props : {}
        ),
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
    if (!goal) return;

    trackConversion(goal, {
      el: 'form',
      text: clip(form.getAttribute('name') || form.id || 'form', 80),
      href: clip(form.getAttribute('action') || location.pathname, 300),
    });
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
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
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
  window.addEventListener('load', measureScroll);
})();
