// @ts-check
// Monte Carlo pricing under geometric Brownian motion. Draws are seeded, so any run
// can be reproduced exactly, and antithetic variates (pairing each draw z with −z)
// cut the variance of the estimate for free.

import { intrinsic } from "./blackScholes.js";

/** @typedef {import("./blackScholes.js").OptionParams} OptionParams */

/**
 * mulberry32: a small, fast, well-distributed 32-bit generator.
 *
 * @param {number} seed
 * @returns {() => number} Uniform floats in [0, 1).
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws via the Box-Muller transform, two per pair of uniforms. */
export class NormalSampler {
  /** @param {number} seed */
  constructor(seed) {
    this.uniform = mulberry32(seed);
    /** @type {number | null} */
    this.spare = null;
  }

  next() {
    if (this.spare !== null) {
      const z = this.spare;
      this.spare = null;
      return z;
    }
    const u1 = 1 - this.uniform(); // (0, 1], so log never sees 0
    const u2 = this.uniform();
    const radius = Math.sqrt(-2 * Math.log(u1));
    this.spare = radius * Math.sin(2 * Math.PI * u2);
    return radius * Math.cos(2 * Math.PI * u2);
  }
}

/** @typedef {{ sum: number, sumSq: number, count: number }} Accumulator */

/** @returns {Accumulator} */
export const emptyAccumulator = () => ({ sum: 0, sumSq: 0, count: 0 });

/**
 * Adds n discounted payoff samples to an accumulator. With antithetic sampling each
 * sample is the average of the z and −z payoffs.
 *
 * @param {OptionParams} p
 * @param {number} n
 * @param {NormalSampler} sampler
 * @param {Accumulator} acc  Mutated and returned, so work can be done in chunks.
 * @param {boolean} [antithetic]
 */
export function accumulate(p, n, sampler, acc, antithetic = true) {
  const { S, K, T, r, q = 0, sigma, type } = p;
  const drift = (r - q - 0.5 * sigma * sigma) * T;
  const vol = sigma * Math.sqrt(T);
  const discount = Math.exp(-r * T);

  for (let i = 0; i < n; i++) {
    const z = sampler.next();
    let payoff = intrinsic(type, S * Math.exp(drift + vol * z), K);
    if (antithetic) payoff = 0.5 * (payoff + intrinsic(type, S * Math.exp(drift - vol * z), K));
    const x = discount * payoff;
    acc.sum += x;
    acc.sumSq += x * x;
  }
  acc.count += n;
  return acc;
}

/**
 * Turns an accumulator into a price estimate with its standard error and a 95%
 * confidence interval.
 *
 * @param {Accumulator} acc
 */
export function summarize({ sum, sumSq, count }) {
  if (count < 2) throw new Error("Need at least two samples");
  const price = sum / count;
  const variance = Math.max(0, (sumSq - count * price * price) / (count - 1));
  const stdError = Math.sqrt(variance / count);
  return { price, stdError, low: price - 1.96 * stdError, high: price + 1.96 * stdError, count };
}

/**
 * One-shot Monte Carlo price.
 *
 * @param {OptionParams} p
 * @param {{ paths: number, seed?: number, antithetic?: boolean }} options
 */
export function monteCarloPrice(p, { paths, seed = 1, antithetic = true }) {
  return summarize(accumulate(p, paths, new NormalSampler(seed), emptyAccumulator(), antithetic));
}

/**
 * Full price paths for drawing: count paths of `steps` steps, each starting at S.
 *
 * @param {OptionParams} p
 * @param {{ count: number, steps: number, seed?: number }} options
 * @returns {Float64Array[]}
 */
export function samplePaths({ S, T, r, q = 0, sigma }, { count, steps, seed = 1 }) {
  const sampler = new NormalSampler(seed);
  const dt = T / steps;
  const drift = (r - q - 0.5 * sigma * sigma) * dt;
  const vol = sigma * Math.sqrt(dt);

  return Array.from({ length: count }, () => {
    const path = new Float64Array(steps + 1);
    path[0] = S;
    for (let i = 1; i <= steps; i++) path[i] = path[i - 1] * Math.exp(drift + vol * sampler.next());
    return path;
  });
}

/**
 * Histogram of terminal prices S_T, for showing the lognormal distribution.
 *
 * @param {OptionParams} p
 * @param {{ samples: number, bins: number, seed?: number }} options
 * @returns {{ min: number, max: number, counts: number[] }}
 */
export function terminalHistogram({ S, T, r, q = 0, sigma }, { samples, bins, seed = 1 }) {
  const sampler = new NormalSampler(seed);
  const drift = (r - q - 0.5 * sigma * sigma) * T;
  const vol = sigma * Math.sqrt(T);
  // ±3.5 standard deviations in log space covers all but ~0.05% of outcomes.
  const min = S * Math.exp(drift - 3.5 * vol);
  const max = S * Math.exp(drift + 3.5 * vol);
  const counts = new Array(bins).fill(0);
  const width = (max - min) / bins;

  for (let i = 0; i < samples; i++) {
    const ST = S * Math.exp(drift + vol * sampler.next());
    const bin = Math.floor((ST - min) / width);
    if (bin >= 0 && bin < bins) counts[bin]++;
  }
  return { min, max, counts };
}
