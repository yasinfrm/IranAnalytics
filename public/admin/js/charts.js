/* Interactive canvas charts — pure JS, RTL/Persian friendly, zero CDN */
(function (global) {
  function clear(ctx) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  function fa(n) {
    return Number(n || 0).toLocaleString('fa-IR');
  }

  function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(240, rect.width || 300);
    const h = Math.max(160, rect.height || 220);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function ensureTooltip(canvas) {
    const parent = canvas.parentElement;
    if (!parent) return null;
    let tip = parent.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip hidden';
      parent.appendChild(tip);
    }
    return tip;
  }

  function drawEmpty(ctx, w, h, text) {
    ctx.fillStyle = '#6a7f7a';
    ctx.font = '13px "Vazirmatn UI FD", Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text || 'داده‌ای در این بازه نیست.', w / 2, h / 2);
  }

  function lineChart(canvas, points, opts = {}) {
    if (!canvas) return;
    const { ctx, w, h } = sizeCanvas(canvas);
    clear(ctx);
    const tip = ensureTooltip(canvas);
    if (tip) tip.classList.add('hidden');

    if (!points || !points.length) {
      drawEmpty(ctx, w, h, opts.emptyText);
      canvas.onmousemove = null;
      canvas.onmouseleave = null;
      return;
    }

    const pad = { t: 22, r: 16, b: 30, l: 40 };
    const innerW = Math.max(40, w - pad.l - pad.r);
    const innerH = Math.max(40, h - pad.t - pad.b);
    const hasSecond = points.some((p) => p.y2 != null);
    const values = points.flatMap((p) => (p.y2 != null ? [p.y || 0, p.y2 || 0] : [p.y || 0]));
    const max = Math.max(1, ...values);

    ctx.strokeStyle = 'rgba(26,42,40,0.09)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (innerH * i) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      const tickVal = Math.round((max * (3 - i)) / 3);
      ctx.fillStyle = '#6a7f7a';
      ctx.font = '11px "Vazirmatn UI FD", Tahoma, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(fa(tickVal), pad.l - 6, y);
    }

    const step = points.length === 1 ? 0 : innerW / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = points.length === 1 ? pad.l + innerW / 2 : pad.l + i * step;
      const y = pad.t + innerH - ((p.y || 0) / max) * innerH;
      const y2 = p.y2 != null ? pad.t + innerH - ((p.y2 || 0) / max) * innerH : null;
      return { x, y, y2, p };
    });

    if (coords.length > 1) {
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
      grad.addColorStop(0, 'rgba(13,110,110,0.24)');
      grad.addColorStop(1, 'rgba(13,110,110,0.02)');
      ctx.beginPath();
      coords.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
      ctx.lineTo(coords[coords.length - 1].x, pad.t + innerH);
      ctx.lineTo(coords[0].x, pad.t + innerH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      coords.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
      ctx.strokeStyle = opts.color1 || '#0d6e6e';
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    if (hasSecond && coords.length > 1) {
      ctx.beginPath();
      coords.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y2) : ctx.moveTo(c.x, c.y2)));
      ctx.strokeStyle = opts.color2 || '#c4833b';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    coords.forEach((c) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = opts.color1 || '#0a5555';
      ctx.fill();
      if (c.y2 != null) {
        ctx.beginPath();
        ctx.arc(c.x, c.y2, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = opts.color2 || '#c4833b';
        ctx.fill();
      }
    });

    ctx.fillStyle = '#6a7f7a';
    ctx.font = '11px "Vazirmatn UI FD", Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const labelEvery = Math.ceil(coords.length / 6) || 1;
    coords.forEach((c, i) => {
      if (i % labelEvery !== 0 && i !== coords.length - 1) return;
      ctx.fillText(c.p.label || '', c.x, h - 8);
    });

    if (hasSecond) {
      ctx.textAlign = 'right';
      ctx.font = '11px "Vazirmatn UI FD", Tahoma, sans-serif';
      ctx.fillStyle = opts.color1 || '#0d6e6e';
      ctx.fillText('● ' + (opts.label1 || 'بازدید'), w - pad.r, 12);
      ctx.fillStyle = opts.color2 || '#c4833b';
      ctx.fillText('● ' + (opts.label2 || 'تبدیل'), w - pad.r - 68, 12);
    }

    if (tip) {
      canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        let nearest = coords[0];
        let best = Math.abs(mx - nearest.x);
        for (const c of coords) {
          const d = Math.abs(mx - c.x);
          if (d < best) {
            best = d;
            nearest = c;
          }
        }
        const title = nearest.p.fullLabel || nearest.p.label || '';
        const l1 = `${opts.label1 || 'مقدار'}: ${fa(nearest.p.y)}`;
        const l2 = nearest.p.y2 != null ? ` · ${opts.label2 || 'دوم'}: ${fa(nearest.p.y2)}` : '';
        tip.textContent = `${title} — ${l1}${l2}`;
        tip.classList.remove('hidden');
        tip.style.left = Math.min(Math.max(nearest.x, 48), w - 48) + 'px';
        tip.style.top = Math.max(8, nearest.y - 34) + 'px';
      };
      canvas.onmouseleave = () => tip.classList.add('hidden');
    }
  }

  function barChart(canvas, items, opts = {}) {
    if (!canvas) return;
    const { ctx, w, h } = sizeCanvas(canvas);
    clear(ctx);
    const tip = ensureTooltip(canvas);
    if (tip) tip.classList.add('hidden');

    if (!items || !items.length || items.every((it) => !(it.value > 0))) {
      drawEmpty(ctx, w, h, opts.emptyText);
      canvas.onmousemove = null;
      canvas.onmouseleave = null;
      return;
    }

    const pad = { t: 22, r: 12, b: 36, l: 38 };
    const innerW = Math.max(40, w - pad.l - pad.r);
    const innerH = Math.max(40, h - pad.t - pad.b);
    const max = Math.max(1, ...items.map((it) => Number(it.value) || 0));

    ctx.strokeStyle = 'rgba(26,42,40,0.09)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (innerH * i) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = '#6a7f7a';
      ctx.font = '11px "Vazirmatn UI FD", Tahoma, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(fa(Math.round((max * (3 - i)) / 3)), pad.l - 6, y);
    }

    const slot = innerW / items.length;
    const barW = Math.min(44, Math.max(12, slot * 0.56));
    const bars = items.map((it, i) => {
      const val = Number(it.value) || 0;
      const bh = Math.max(val > 0 ? 4 : 0, (val / max) * innerH);
      const x = pad.l + i * slot + (slot - barW) / 2;
      const y = pad.t + innerH - bh;
      return { x, y, w: barW, h: bh, it, cx: x + barW / 2 };
    });

    bars.forEach((b, i) => {
      const isHighlight = b.it.accent;
      ctx.fillStyle = isHighlight ? '#c4833b' : i % 2 === 0 ? '#0d6e6e' : '#2a8580';
      const r = Math.min(6, b.w / 2, b.h);
      ctx.beginPath();
      if (b.h > 0 && ctx.roundRect) {
        ctx.roundRect(b.x, b.y, b.w, b.h, [r, r, 0, 0]);
      } else {
        ctx.rect(b.x, b.y, b.w, b.h);
      }
      ctx.fill();

      ctx.fillStyle = '#1a2a28';
      ctx.font = '600 11px "Vazirmatn UI FD", Tahoma, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      if (b.it.value > 0) {
        ctx.fillText((b.it.suffix ? fa(b.it.value) + b.it.suffix : fa(b.it.value)), b.cx, b.y - 3);
      }

      ctx.fillStyle = '#3d524e';
      ctx.font = '11px "Vazirmatn UI FD", Tahoma, sans-serif';
      ctx.textBaseline = 'top';
      const lbl = String(b.it.label || '');
      const short = lbl.length > 11 ? lbl.slice(0, 10) + '…' : lbl;
      ctx.fillText(short, b.cx, pad.t + innerH + 8);
    });

    if (tip) {
      canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const hit = bars.find((b) => mx >= b.x - 6 && mx <= b.x + b.w + 6);
        if (!hit) {
          tip.classList.add('hidden');
          return;
        }
        const extra = hit.it.sub ? ` (${hit.it.sub})` : '';
        tip.textContent = `${hit.it.label}: ${fa(hit.it.value)}${hit.it.suffix || ''}${extra}`;
        tip.classList.remove('hidden');
        tip.style.left = Math.min(Math.max(hit.cx, 48), w - 48) + 'px';
        tip.style.top = Math.max(8, hit.y - 32) + 'px';
      };
      canvas.onmouseleave = () => tip.classList.add('hidden');
    }
  }

  function donutChart(canvas, slices, opts = {}) {
    if (!canvas) return;
    const { ctx, w, h } = sizeCanvas(canvas);
    clear(ctx);
    const total = (slices || []).reduce((s, x) => s + (Number(x.value) || 0), 0);
    if (!slices || !slices.length || total <= 0) {
      drawEmpty(ctx, w, h, opts.emptyText);
      return;
    }

    const cx = w * 0.34;
    const cy = h / 2;
    const r = Math.min(w * 0.28, h * 0.36);
    const ir = r * 0.58;
    const colors = ['#0d6e6e', '#c4a574', '#3d7a6e', '#8f6b3d', '#5a8f88', '#d4b483'];
    let angle = -Math.PI / 2;

    slices.forEach((slice, i) => {
      const val = Number(slice.value) || 0;
      if (val <= 0) return;
      const sweep = (val / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, angle, angle + sweep);
      ctx.arc(cx, cy, ir, angle + sweep, angle, true);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      angle += sweep;
    });

    ctx.fillStyle = '#1a2a28';
    ctx.font = '600 16px "Vazirmatn UI FD", Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fa(total), cx, cy);

    let ly = 26;
    ctx.textAlign = 'right';
    ctx.font = '12px "Vazirmatn UI FD", Tahoma, sans-serif';
    slices.slice(0, 6).forEach((slice, i) => {
      const x = w - 12;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x - 10, ly - 8, 10, 10);
      ctx.fillStyle = '#3d524e';
      ctx.fillText(`${slice.label} (${fa(slice.value)})`, x - 18, ly);
      ly += 22;
    });
  }

  global.IACharts = { lineChart, barChart, donutChart };
})(window);
