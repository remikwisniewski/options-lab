// Monte Carlo: runs the pricing simulation in a Web Worker, draws sample paths with
// the terminal distribution beside them, and charts convergence for both the Monte
// Carlo estimate and the binomial tree.

import { gsap } from "gsap";
import { bsPrice } from "../pricing/blackScholes.js";
import { binomialPrice } from "../pricing/binomial.js";
import { samplePaths, terminalHistogram } from "../pricing/monteCarlo.js";
import { createLineChart, css, fitCanvas, ticks } from "./chart.js";
import { compact, money } from "./format.js";

const PATHS_SHOWN = 60;
const PATH_STEPS = 120;

export function createMonteCarloView({ root, pricerRoot, state, reducedMotion }) {
  const priceEl = pricerRoot.querySelector('[data-out="mc"]');
  const noteEl = pricerRoot.querySelector('[data-note="mc"]');
  const progressEl = pricerRoot.querySelector("[data-mc-progress]");
  const pathsCanvas = root.querySelector('[data-chart="paths"]');
  const viewBox = root.querySelector("[data-convergence]");
  const legendEl = root.querySelector("[data-convergence-legend]");

  const worker = new Worker(new URL("../mc.worker.js", import.meta.url), { type: "module" });
  let runId = 0;
  let startedAt = 0;
  let convergence = [];
  let debounce = null;

  // ---------- Worker ----------
  worker.onmessage = ({ data }) => {
    if (data.id !== runId) return; // a newer run has started
    if (data.type === "progress") {
      progressEl.style.width = `${(data.done / data.total) * 100}%`;
      return;
    }
    const { result } = data;
    convergence = data.convergence;
    priceEl.textContent = money(result.price, 4);
    priceEl._value = result.price;
    const ms = Math.round(performance.now() - startedAt);
    const european = state.style === "american" ? " · European payoff" : "";
    noteEl.textContent = `± ${result.stdError.toFixed(4)} SE · ${compact(result.count)} paths · ${ms} ms${european}`;
    gsap.to(progressEl, { autoAlpha: 0, duration: 0.4, delay: 0.2 });
    if (state.convergenceView === "mc") drawConvergence();
  };

  function runSimulation() {
    runId++;
    startedAt = performance.now();
    gsap.killTweensOf(progressEl);
    gsap.set(progressEl, { autoAlpha: 1, width: "0%" });
    noteEl.textContent = `Simulating ${compact(state.paths)} paths…`;
    worker.postMessage({
      id: runId,
      params: state.params(),
      paths: state.paths,
      seed: state.seed,
      antithetic: true,
    });
  }

  // ---------- Paths + terminal distribution ----------
  const ctx = pathsCanvas.getContext("2d");
  const reveal = { progress: 1 };
  let paths = [];
  let histogram = null;

  function simulatePaths() {
    const p = state.params();
    paths = samplePaths(p, { count: PATHS_SHOWN, steps: PATH_STEPS, seed: state.seed });
    histogram = terminalHistogram(p, { samples: 40_000, bins: 48, seed: state.seed + 1 });
  }

  function drawPaths() {
    const { width, height } = fitCanvas(pathsCanvas, ctx);
    ctx.clearRect(0, 0, width, height);
    if (!paths.length) return;
    const p = state.params();
    const pad = { top: 14, right: 12, bottom: 26, left: 56 };
    const histW = Math.min(110, width * 0.22);
    const plotRight = width - pad.right - histW - 10;

    // Shared price scale for paths and histogram, clipped to the histogram range.
    const lo = Math.min(histogram.min, p.K * 0.9);
    const hi = Math.max(histogram.max, p.K * 1.1);
    const y = (v) => pad.top + (1 - (v - lo) / (hi - lo)) * (height - pad.top - pad.bottom);
    const x = (i) => pad.left + (i / PATH_STEPS) * (plotRight - pad.left);

    ctx.font = `11px ${css("--font-mono")}`;
    ctx.strokeStyle = css("--line");
    ctx.fillStyle = css("--muted");
    ctx.textAlign = "right";
    for (const t of ticks(lo, hi)) {
      const py = Math.round(y(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, py);
      ctx.lineTo(width - pad.right, py);
      ctx.stroke();
      ctx.fillText(`$${Math.round(t)}`, pad.left - 8, py + 4);
    }
    ctx.textAlign = "left";
    ctx.fillText("Today", pad.left, height - 8);
    ctx.textAlign = "right";
    ctx.fillText(`Expiry · ${state.days}d`, plotRight, height - 8);

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, width - pad.left - pad.right, height - pad.top - pad.bottom);
    ctx.clip();

    // Paths: in-the-money finishes in the accent colour.
    const shown = Math.max(1, Math.round(PATH_STEPS * reveal.progress));
    const accent = css("--accent");
    const muted = css("--muted");
    for (const path of paths) {
      const finish = path[PATH_STEPS];
      const itm = p.type === "call" ? finish > p.K : finish < p.K;
      ctx.strokeStyle = itm ? accent : muted;
      ctx.globalAlpha = itm ? 0.55 : 0.28;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= shown; i++) i ? ctx.lineTo(x(i), y(path[i])) : ctx.moveTo(x(i), y(path[i]));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Terminal distribution, drawn sideways against the same price axis.
    const max = Math.max(...histogram.counts);
    const binH = (histogram.max - histogram.min) / histogram.counts.length;
    histogram.counts.forEach((count, i) => {
      const priceLo = histogram.min + i * binH;
      const top = y(priceLo + binH);
      const h = Math.max(1, y(priceLo) - top - 1);
      const w = (count / max) * histW * reveal.progress;
      const mid = priceLo + binH / 2;
      const itm = p.type === "call" ? mid > p.K : mid < p.K;
      ctx.fillStyle = itm ? css("--accent-soft") : "rgba(138, 135, 127, 0.18)";
      ctx.fillRect(plotRight + 10, top, w, h);
    });

    // Strike
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = css("--body");
    ctx.beginPath();
    ctx.moveTo(pad.left, y(p.K));
    ctx.lineTo(width - pad.right, y(p.K));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css("--body");
    ctx.textAlign = "left";
    ctx.fillText(`K ${p.K}`, pad.left + 6, y(p.K) - 6);
    ctx.restore();
  }

  function animatePaths() {
    if (reducedMotion) {
      reveal.progress = 1;
      drawPaths();
      return;
    }
    gsap.fromTo(
      reveal,
      { progress: 0 },
      { progress: 1, duration: 1.4, ease: "power2.out", onUpdate: drawPaths, overwrite: true }
    );
  }

  new ResizeObserver(() => drawPaths()).observe(pathsCanvas);

  root.querySelector("[data-resimulate]").addEventListener("click", () => {
    state.seed = Math.floor(Math.random() * 2 ** 31);
    simulatePaths();
    animatePaths();
    runSimulation();
  });

  // ---------- Convergence ----------
  const VIEWS = [
    { key: "mc", label: "Monte Carlo" },
    { key: "binomial", label: "Binomial" },
  ];
  viewBox.innerHTML = VIEWS.map(
    (v) =>
      `<button type="button" class="chip" data-view="${v.key}" aria-pressed="${v.key === state.convergenceView}">${v.label}</button>`
  ).join("");
  viewBox.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-view]");
    if (!chip) return;
    state.convergenceView = chip.dataset.view;
    for (const el of viewBox.children) el.setAttribute("aria-pressed", String(el === chip));
    drawConvergence();
  });

  const chart = createLineChart(root.querySelector('[data-chart="convergence"]'), {
    yFormat: (v) => money(v, 3),
  });

  function drawConvergence() {
    const p = state.params();
    const exact = bsPrice(p);
    const bsLine = { y: exact, color: css("--blue"), dash: [6, 4] };

    if (state.convergenceView === "mc") {
      legendEl.innerHTML = `<span class="legend__item legend__item--accent">Estimate</span>
        <span class="legend__item legend__item--band">95% confidence interval</span>
        <span class="legend__item legend__item--blue">Black-Scholes</span>`;
      if (convergence.length < 2) return chart.draw(null);
      chart.draw({
        xLog: true,
        xFormat: (v) => compact(Math.round(v)),
        xDomain: [convergence[0].count, convergence.at(-1).count],
        xName: "Paths",
        series: [
          { name: "Estimate", points: convergence.map((c) => [c.count, c.price]), color: css("--accent") },
        ],
        bands: [{ points: convergence.map((c) => [c.count, c.low, c.high]), color: css("--accent-soft") }],
        hLines: [bsLine],
      });
      return;
    }

    const american = state.style === "american";
    legendEl.innerHTML = `<span class="legend__item legend__item--accent">${american ? "American" : "European"} tree price</span>
      <span class="legend__item legend__item--blue">Black-Scholes (European)</span>`;
    const points = [];
    for (let steps = 5; steps <= 300; steps += steps < 60 ? 1 : 5) {
      points.push([steps, binomialPrice({ ...p, steps, american }).price]);
    }
    chart.draw({
      xLog: false,
      xFormat: (v) => String(Math.round(v)),
      xDomain: [5, 300],
      xName: "Steps",
      series: [{ name: "Tree", points, color: css("--accent"), width: 1.4 }],
      hLines: [bsLine],
    });
  }

  return {
    /** Inputs changed: reprice, redraw paths, and restart the simulation shortly. */
    update({ animate = false } = {}) {
      simulatePaths();
      if (animate) animatePaths();
      else drawPaths();
      if (state.convergenceView === "binomial") drawConvergence();
      clearTimeout(debounce);
      debounce = setTimeout(runSimulation, 180);
    },
  };
}
