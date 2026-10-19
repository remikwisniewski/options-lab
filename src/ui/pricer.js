// The pricer: input sliders, the three model prices, the Greeks, the value-vs-spot
// chart and the implied volatility solver.

import { gsap } from "gsap";
import { bsGreeks, bsPrice, intrinsic } from "../pricing/blackScholes.js";
import { binomialPrice } from "../pricing/binomial.js";
import { impliedVol } from "../pricing/impliedVol.js";
import { createLineChart, css } from "./chart.js";
import { compact, expiryLabel, greek, money, percent } from "./format.js";

export const SLIDERS = [
  { key: "S", label: "Spot price", unit: "$", min: 1, max: 1000, step: 0.5 },
  { key: "K", label: "Strike", unit: "$", min: 1, max: 1000, step: 0.5 },
  { key: "days", label: "Time to expiry", unit: "days", min: 1, max: 1095, step: 1 },
  { key: "vol", label: "Volatility", unit: "%", min: 1, max: 150, step: 0.5 },
  { key: "rate", label: "Risk-free rate", unit: "%", min: 0, max: 15, step: 0.05 },
  { key: "div", label: "Dividend yield", unit: "%", min: 0, max: 10, step: 0.05 },
];

const GREEKS = [
  { key: "delta", symbol: "Δ", name: "Delta", hint: "per $1 in spot" },
  { key: "gamma", symbol: "Γ", name: "Gamma", hint: "Δ change per $1" },
  { key: "theta", symbol: "Θ", name: "Theta", hint: "per day" },
  { key: "vega", symbol: "ν", name: "Vega", hint: "per 1 vol point" },
  { key: "rho", symbol: "ρ", name: "Rho", hint: "per 1 rate point" },
];

const METRICS = [{ key: "value", label: "Value" }, ...GREEKS.map((g) => ({ key: g.key, label: g.name }))];

/** Animates a number in an element from what it showed last to its new value. */
function tweenNumber(el, value, format, reducedMotion) {
  const from = el._value ?? value;
  el._value = value;
  if (reducedMotion || !Number.isFinite(from) || from === value) {
    el.textContent = format(value);
    return;
  }
  const box = { v: from };
  gsap.to(box, {
    v: value,
    duration: 0.35,
    ease: "power2.out",
    overwrite: true,
    onUpdate: () => (el.textContent = format(box.v)),
  });
}

export function createPricer({ root, state, onChange, reducedMotion }) {
  const form = root.querySelector("[data-inputs]");
  const sliderBox = root.querySelector("[data-sliders]");
  const greeksBox = root.querySelector("[data-greeks]");
  const metricBox = root.querySelector("[data-metric]");
  const out = (name) => root.querySelector(`[data-out="${name}"]`);
  const note = (name) => root.querySelector(`[data-note="${name}"]`);

  // ---------- Inputs ----------
  sliderBox.innerHTML = SLIDERS.map(
    (s) => `<div class="slider">
      <label class="slider__label" for="in-${s.key}">${s.label}<small>${s.unit}</small></label>
      <input class="slider__value" id="in-${s.key}" data-num="${s.key}" inputmode="decimal" autocomplete="off" />
      <input type="range" data-range="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}"
        aria-label="${s.label}" />
    </div>`
  ).join("");

  const syncInputs = () => {
    for (const s of SLIDERS) {
      const num = sliderBox.querySelector(`[data-num="${s.key}"]`);
      if (document.activeElement !== num) num.value = String(state[s.key]);
      sliderBox.querySelector(`[data-range="${s.key}"]`).value = String(state[s.key]);
    }
  };

  sliderBox.addEventListener("input", (event) => {
    const key = event.target.dataset.range ?? event.target.dataset.num;
    if (!key) return;
    const spec = SLIDERS.find((s) => s.key === key);
    const value = Number(event.target.value);
    const valid = Number.isFinite(value) && value >= spec.min && value <= spec.max;
    event.target.setAttribute("aria-invalid", String(!valid));
    if (!valid) return;
    state[key] = value;
    syncInputs();
    onChange();
  });

  form.addEventListener("change", (event) => {
    const { name, value } = event.target;
    if (name === "type" || name === "style") state[name] = value;
    if (name === "steps") state.steps = Math.min(2000, Math.max(10, Math.round(Number(value) || 500)));
    if (name === "paths") state.paths = Number(value);
    onChange();
  });

  // ---------- Greeks ----------
  greeksBox.innerHTML = GREEKS.map(
    (g) => `<div class="greek">
      <p class="greek__name"><b aria-hidden="true">${g.symbol}</b>${g.name}</p>
      <p class="greek__value num" data-greek="${g.key}">—</p>
      <p class="greek__hint">${g.hint}</p>
    </div>`
  ).join("");

  // ---------- Chart ----------
  metricBox.innerHTML = METRICS.map(
    (m) =>
      `<button type="button" class="chip" data-metric-key="${m.key}" aria-pressed="${m.key === state.metric}">${m.label}</button>`
  ).join("");
  metricBox.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-metric-key]");
    if (!chip) return;
    state.metric = chip.dataset.metricKey;
    for (const el of metricBox.children) el.setAttribute("aria-pressed", String(el === chip));
    drawChart();
  });

  const chart = createLineChart(root.querySelector('[data-chart="value"]'), {
    xFormat: (v) => `$${Math.round(v)}`,
    yFormat: (v) => (state.metric === "value" ? money(v) : greek(v, Math.abs(v) < 0.1 ? 4 : 2)),
  });

  function drawChart() {
    const p = state.params();
    const lo = Math.max(0.5, Math.min(p.S, p.K) * 0.5);
    const hi = Math.max(p.S, p.K) * 1.5;
    const xs = Array.from({ length: 121 }, (_, i) => lo + ((hi - lo) * i) / 120);
    const american = state.style === "american";
    const metric = state.metric;

    const today = xs.map((S) => {
      if (metric !== "value") return [S, bsGreeks({ ...p, S })[metric]];
      // American value needs the tree; a coarser tree keeps 121 repricings fast.
      return [
        S,
        american ? binomialPrice({ ...p, S, steps: 150, american: true }).price : bsPrice({ ...p, S }),
      ];
    });

    const series = [{ name: "Today", points: today, color: css("--accent") }];
    if (metric === "value") {
      series.push({
        name: "Expiry",
        points: xs.map((S) => [S, intrinsic(p.type, S, p.K)]),
        color: css("--body"),
        dash: [5, 5],
        width: 1.4,
      });
    }
    const current = metric === "value" ? today : null;

    chart.draw({
      xDomain: [lo, hi],
      xName: "Spot",
      series,
      includeZero: true,
      vLines: [
        { x: p.S, label: "Spot", color: css("--muted") },
        { x: p.K, label: "Strike", color: css("--muted"), dash: [2, 3] },
      ],
      dots: current ? [{ x: p.S, y: interpolateAt(today, p.S), color: css("--accent") }] : [],
    });
  }

  const interpolateAt = (points, x) => {
    const i = points.findIndex(([px]) => px >= x);
    if (i <= 0) return points[0][1];
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  };

  // ---------- Implied volatility ----------
  const ivForm = root.querySelector("[data-iv]");
  const ivResult = root.querySelector("[data-iv-result]");
  const ivApply = root.querySelector("[data-iv-apply]");
  let solved = null;

  function solveIv() {
    const text = ivForm.elements.marketPrice.value.trim();
    solved = null;
    ivApply.disabled = true;
    ivResult.classList.remove("is-error");
    if (!text) {
      ivResult.textContent = "—";
      return;
    }
    const price = Number(text);
    if (!Number.isFinite(price)) {
      ivResult.textContent = "Enter a number";
      ivResult.classList.add("is-error");
      return;
    }
    const { sigma: _ignored, ...market } = state.params();
    const result = impliedVol({ ...market, price });
    if (result.sigma === null) {
      ivResult.textContent = result.reason;
      ivResult.classList.add("is-error");
      return;
    }
    solved = result.sigma;
    ivResult.textContent = `σ = ${percent(result.sigma)}`;
    ivApply.disabled = false;
  }

  ivForm.addEventListener("input", solveIv);
  ivForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (solved === null) return;
    state.vol = Math.round(solved * 1000) / 10;
    syncInputs();
    onChange();
  });

  // ---------- Render ----------
  return {
    render() {
      syncInputs();
      const p = state.params();
      const american = state.style === "american";
      const fmt = (v) => money(v, 4);

      tweenNumber(out("bs"), bsPrice(p), fmt, reducedMotion);
      note("bs").innerHTML = american
        ? `European formula · <span class="tag">ignores early exercise</span>`
        : `Closed-form · ${expiryLabel(state.days)}`;

      const tree = binomialPrice({ ...p, steps: state.steps, american });
      tweenNumber(out("binomial"), tree.price, fmt, reducedMotion);
      note("binomial").innerHTML = `CRR · ${compact(state.steps)} steps${
        american
          ? tree.earlyExercise
            ? ` · <span class="tag">early exercise optimal</span>`
            : " · no early exercise"
          : ""
      }`;

      const g = bsGreeks(p);
      for (const { key } of GREEKS) {
        tweenNumber(greeksBox.querySelector(`[data-greek="${key}"]`), g[key], (v) => greek(v), reducedMotion);
      }

      drawChart();
      solveIv();
    },
  };
}
