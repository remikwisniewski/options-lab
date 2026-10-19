// @ts-check
// Implied volatility: the sigma at which Black-Scholes reproduces a market price.
// Newton-Raphson converges in a few steps near the money; bisection takes over
// whenever Newton would leave the bracket, so the solver always terminates.

import { bsGreeks, bsPrice } from "./blackScholes.js";

/** @typedef {import("./blackScholes.js").OptionParams} OptionParams */

const MIN_VOL = 1e-6;
const MAX_VOL = 5; // 500%
const TOLERANCE = 1e-10;

/**
 * The range a European option price must fall in to be arbitrage-free.
 *
 * @param {Omit<OptionParams, "sigma">} p
 * @returns {{ min: number, max: number }}
 */
export function priceBounds({ S, K, T, r, q = 0, type }) {
  const discS = S * Math.exp(-q * T);
  const discK = K * Math.exp(-r * T);
  return type === "call"
    ? { min: Math.max(discS - discK, 0), max: discS }
    : { min: Math.max(discK - discS, 0), max: discK };
}

/**
 * @param {Omit<OptionParams, "sigma"> & { price: number }} p
 * @returns {{ sigma: number, iterations: number } | { sigma: null, reason: string }}
 */
export function impliedVol(p) {
  if (p.T <= 0) return { sigma: null, reason: "No time left, so volatility has no effect on the price" };

  const { min, max } = priceBounds(p);
  if (!(p.price > min && p.price < max)) {
    return {
      sigma: null,
      reason: `Price must be between ${min.toFixed(4)} and ${max.toFixed(4)} to be arbitrage-free`,
    };
  }

  const at = (/** @type {number} */ sigma) => bsPrice({ ...p, sigma }) - p.price;
  let lo = MIN_VOL;
  let hi = MAX_VOL;
  if (at(hi) < 0) return { sigma: null, reason: "Implied volatility would be above 500%" };

  let sigma = 0.3;
  for (let iterations = 1; iterations <= 100; iterations++) {
    const diff = at(sigma);
    if (Math.abs(diff) < TOLERANCE) return { sigma, iterations };

    // Price rises with sigma, so the sign of diff tells us which side the root is on.
    if (diff > 0) hi = sigma;
    else lo = sigma;

    const vega = bsGreeks({ ...p, sigma }).vega * 100; // back to per unit of sigma
    const newton = sigma - diff / vega;
    sigma = vega > 1e-12 && newton > lo && newton < hi ? newton : 0.5 * (lo + hi);
  }
  return { sigma, iterations: 100 };
}
