// A small Canvas 2D line chart: multiple series, confidence bands, reference lines,
// profit/loss shading, an optional log x-axis, and a hover crosshair with a tooltip.
// One instance per canvas; call draw(spec) whenever the data changes.

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Sizes a canvas for the device pixel ratio and returns its CSS size. */
export function fitCanvas(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

/** "Nice" tick values covering [min, max]. */
export function ticks(min, max, target = 5) {
  const span = max - min || 1;
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => span / s <= target) ?? 10 * magnitude;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step)
    out.push(Number(v.toFixed(10)));
  return out;
}

const interpolate = (points, x) => {
  if (!points.length || x < points[0][0] || x > points.at(-1)[0]) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = points[lo];
  const [x1, y1] = points[hi];
  return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
};

export function createLineChart(canvas, defaults = {}) {
  const ctx = canvas.getContext("2d");
  // Axis options can be set once here or overridden per draw() call.
  const opt = (key, fallback) => spec?.[key] ?? defaults[key] ?? fallback;
  let spec = null;
  let hoverX = null;
  let frame = null;

  const pad = { top: 14, right: 16, bottom: 26, left: 64 };

  function layout(width, height) {
    const s = spec;
    const xLog = opt("xLog", false);
    const tx = xLog ? Math.log10 : (v) => v;
    const [x0, x1] = s.xDomain.map(tx);
    let [y0, y1] = s.yDomain ?? autoY();
    if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    return {
      x: (v) => pad.left + ((tx(v) - x0) / (x1 - x0)) * plotW,
      y: (v) => pad.top + (1 - (v - y0) / (y1 - y0)) * plotH,
      invX: (px) => {
        const t = x0 + ((px - pad.left) / plotW) * (x1 - x0);
        return xLog ? 10 ** t : t;
      },
      y0,
      y1,
      plotW,
      plotH,
    };
  }

  function autoY() {
    let min = Infinity;
    let max = -Infinity;
    for (const s of spec.series)
      for (const [, y] of s.points) ((min = Math.min(min, y)), (max = Math.max(max, y)));
    for (const b of spec.bands ?? [])
      for (const [, lo, hi] of b.points) ((min = Math.min(min, lo)), (max = Math.max(max, hi)));
    if (spec.includeZero) ((min = Math.min(min, 0)), (max = Math.max(max, 0)));
    if (!Number.isFinite(min)) return [0, 1];
    const margin = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
    return [min - margin, max + margin];
  }

  function path(points, L, upTo = 1) {
    const count = Math.max(2, Math.ceil(points.length * upTo));
    ctx.beginPath();
    points
      .slice(0, count)
      .forEach(([x, y], i) => (i ? ctx.lineTo(L.x(x), L.y(y)) : ctx.moveTo(L.x(x), L.y(y))));
  }

  function render() {
    frame = null;
    const { width, height } = fitCanvas(canvas, ctx);
    ctx.clearRect(0, 0, width, height);
    if (!spec) return;
    const L = layout(width, height);
    const xLog = opt("xLog", false);
    const xFormat = opt("xFormat", String);
    const yFormat = opt("yFormat", String);
    const muted = css("--muted");
    const line = css("--line");

    // Grid + axes
    ctx.font = `11px ${css("--font-mono")}`;
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    ctx.fillStyle = muted;
    ctx.textAlign = "right";
    for (const t of ticks(L.y0, L.y1)) {
      const py = Math.round(L.y(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, py);
      ctx.lineTo(width - pad.right, py);
      ctx.stroke();
      ctx.fillText(yFormat(t), pad.left - 8, py + 4);
    }
    ctx.textAlign = "center";
    const xTicks = xLog
      ? ticks(Math.log10(spec.xDomain[0]), Math.log10(spec.xDomain[1]), 4).map((t) => 10 ** t)
      : ticks(spec.xDomain[0], spec.xDomain[1], 6);
    for (const t of xTicks) ctx.fillText(xFormat(t), L.x(t), height - 8);

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, L.plotW, L.plotH);
    ctx.clip();

    // Confidence bands
    for (const band of spec.bands ?? []) {
      ctx.beginPath();
      band.points.forEach(([x, , hi], i) => (i ? ctx.lineTo(L.x(x), L.y(hi)) : ctx.moveTo(L.x(x), L.y(hi))));
      [...band.points].reverse().forEach(([x, lo]) => ctx.lineTo(L.x(x), L.y(lo)));
      ctx.closePath();
      ctx.fillStyle = band.color;
      ctx.fill();
    }

    // Profit/loss shading for series that ask for it
    for (const s of spec.series.filter((s) => s.fillSign)) {
      const zero = L.y(0);
      for (const [color, above] of [
        [css("--gain-soft"), true],
        [css("--loss-soft"), false],
      ]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.left, above ? pad.top : zero, L.plotW, above ? zero - pad.top : L.plotH);
        ctx.clip();
        path(s.points, L, spec.progress);
        ctx.lineTo(L.x(s.points.at(-1)[0]), zero);
        ctx.lineTo(L.x(s.points[0][0]), zero);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }
    }

    // Reference lines
    for (const h of spec.hLines ?? []) {
      ctx.setLineDash(h.dash ?? []);
      ctx.strokeStyle = h.color ?? muted;
      ctx.beginPath();
      ctx.moveTo(pad.left, L.y(h.y));
      ctx.lineTo(width - pad.right, L.y(h.y));
      ctx.stroke();
    }
    for (const v of spec.vLines ?? []) {
      ctx.setLineDash(v.dash ?? [3, 4]);
      ctx.strokeStyle = v.color ?? muted;
      ctx.beginPath();
      ctx.moveTo(L.x(v.x), pad.top);
      ctx.lineTo(L.x(v.x), height - pad.bottom);
      ctx.stroke();
      if (v.label) {
        ctx.setLineDash([]);
        ctx.fillStyle = v.color ?? muted;
        ctx.textAlign = "left";
        ctx.fillText(v.label, L.x(v.x) + 4, pad.top + 10);
      }
    }
    ctx.setLineDash([]);

    // Series
    for (const s of spec.series) {
      ctx.setLineDash(s.dash ?? []);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 1.8;
      ctx.lineJoin = "round";
      path(s.points, L, s.animate === false ? 1 : (spec.progress ?? 1));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const d of spec.dots ?? []) {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(L.x(d.x), L.y(d.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (hoverX !== null) drawHover(L, width);
  }

  function drawHover(L, width) {
    const xFormat = opt("xFormat", String);
    const yFormat = opt("yFormat", String);
    const x = L.invX(hoverX);
    if (x < spec.xDomain[0] || x > spec.xDomain[1]) return;
    const rows = spec.series
      .filter((s) => s.name)
      .map((s) => ({ s, y: interpolate(s.points, x) }))
      .filter((r) => r.y !== null);
    if (!rows.length) return;

    ctx.strokeStyle = css("--line-strong");
    ctx.beginPath();
    ctx.moveTo(hoverX, pad.top);
    ctx.lineTo(hoverX, canvas.clientHeight - pad.bottom);
    ctx.stroke();
    for (const { s, y } of rows) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(L.x(x), L.y(y), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const lines = [
      `${spec.xName ?? "x"} ${xFormat(x)}`,
      ...rows.map(({ s, y }) => `${s.name} ${yFormat(y)}`),
    ];
    ctx.font = `11px ${css("--font-mono")}`;
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const boxH = lines.length * 16 + 8;
    const left = hoverX + boxW + 14 > width ? hoverX - boxW - 10 : hoverX + 10;
    ctx.fillStyle = css("--surface-2");
    ctx.strokeStyle = css("--line-strong");
    ctx.beginPath();
    ctx.roundRect(left, pad.top + 4, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    lines.forEach((text, i) => {
      ctx.fillStyle = i === 0 ? css("--muted") : rows[i - 1].s.color;
      ctx.fillText(text, left + 8, pad.top + 20 + i * 16);
    });
  }

  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(render);
  };

  canvas.addEventListener("pointermove", (event) => {
    hoverX = event.clientX - canvas.getBoundingClientRect().left;
    schedule();
  });
  canvas.addEventListener("pointerleave", () => {
    hoverX = null;
    schedule();
  });
  new ResizeObserver(schedule).observe(canvas);

  return {
    draw(next) {
      spec = next;
      schedule();
    },
  };
}
