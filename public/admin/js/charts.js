/* Minimal canvas charts — no CDN */
(function (global) {
  function clear(ctx) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  function lineChart(canvas, points, opts) {
    const { ctx, w, h } = sizeCanvas(canvas);
    clear(ctx);
    const pad = { t: 16, r: 12, b: 28, l: 36 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const values = points.map((p) => p.y);
    const max = Math.max(1, ...values);
    const min = 0;

    ctx.strokeStyle = 'rgba(26,42,40,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (innerH * i) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#6a7f7a';
    ctx.font = '12px "Vazirmatn UI FD", Tahoma, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(max), 4, pad.t + 4);

    if (!points.length) return;

    const step = points.length === 1 ? innerW : innerW / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = pad.l + i * step;
      const y = pad.t + innerH - ((p.y - min) / (max - min)) * innerH;
      return { x, y, label: p.label };
    });

    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
    grad.addColorStop(0, 'rgba(13,110,110,0.28)');
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
    ctx.strokeStyle = '#0d6e6e';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    coords.forEach((c) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#0a5555';
      ctx.fill();
    });

    ctx.fillStyle = '#6a7f7a';
    ctx.textAlign = 'center';
    const labelEvery = Math.ceil(coords.length / 6) || 1;
    coords.forEach((c, i) => {
      if (i % labelEvery !== 0 && i !== coords.length - 1) return;
      ctx.fillText(c.label || '', c.x, h - 8);
    });
  }

  function donutChart(canvas, slices) {
    const { ctx, w, h } = sizeCanvas(canvas);
    clear(ctx);
    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    const cx = w * 0.38;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.32;
    const ir = r * 0.58;
    const colors = ['#0d6e6e', '#c4a574', '#3d7a6e', '#8f6b3d', '#5a8f88', '#d4b483'];
    let angle = -Math.PI / 2;

    slices.forEach((slice, i) => {
      const sweep = (slice.value / total) * Math.PI * 2;
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
    ctx.fillText(String(total), cx, cy);

    let ly = 24;
    ctx.textAlign = 'right';
    ctx.font = '12px "Vazirmatn UI FD", Tahoma, sans-serif';
    slices.forEach((slice, i) => {
      const x = w - 12;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x - 10, ly - 8, 10, 10);
      ctx.fillStyle = '#3d524e';
      ctx.fillText(`${slice.label} (${slice.value})`, x - 18, ly);
      ly += 22;
    });
  }

  global.IACharts = { lineChart, donutChart };
})(window);
