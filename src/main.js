// Wires the three views to one shared set of inputs. Every input change reprices the
// models synchronously, redraws the charts on the next frame, and restarts the Monte
// Carlo run in the worker.

import { createPricer } from "./ui/pricer.js";
import { createMonteCarloView } from "./ui/monteCarloView.js";
import { createStrategyView } from "./ui/strategyView.js";
import { daysToYears } from "./ui/format.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  type: "call",
  style: "european",
  S: 100,
  K: 105,
  days: 90,
  vol: 25,
  rate: 4.5,
  div: 0.5,
  steps: 500,
  paths: 100_000,
  seed: 20261019,
  metric: "value",
  convergenceView: "mc",
  strategy: { key: "bullCallSpread", label: "", legs: [] },

  /** Market inputs in model units: years and decimals. */
  market() {
    return {
      S: this.S,
      T: daysToYears(this.days),
      r: this.rate / 100,
      q: this.div / 100,
      sigma: this.vol / 100,
    };
  },

  /** Full option parameters for the pricer. */
  params() {
    return { ...this.market(), K: this.K, type: /** @type {"call" | "put"} */ (this.type) };
  },
};

const pricerRoot = document.querySelector("#pricer");
let frame = null;

const pricer = createPricer({ root: pricerRoot, state, reducedMotion, onChange: () => schedule() });
const monteCarlo = createMonteCarloView({
  root: document.querySelector("#montecarlo"),
  pricerRoot,
  state,
  reducedMotion,
});
const strategy = createStrategyView({ root: document.querySelector("#strategies"), state });

/** Batch rapid slider movement into one render per animation frame. */
function schedule() {
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    pricer.render();
    monteCarlo.update();
    strategy.render();
  });
}

pricer.render();
monteCarlo.update({ animate: true });
strategy.render();
