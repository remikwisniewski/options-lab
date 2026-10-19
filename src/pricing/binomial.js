// @ts-check
// Cox-Ross-Rubinstein binomial tree. Unlike Black-Scholes it can price American
// options, by checking at every node whether exercising now beats holding.

import { intrinsic } from "./blackScholes.js";

/** @typedef {import("./blackScholes.js").OptionParams} OptionParams */

/**
 * @param {OptionParams & { steps: number, american?: boolean }} p
 * @returns {{ price: number, earlyExercise: boolean }} earlyExercise is true if
 *   exercising early was optimal at any node.
 */
export function binomialPrice({ S, K, T, r, q = 0, sigma, type, steps, american = false }) {
  if (!Number.isInteger(steps) || steps < 1) throw new Error("steps must be a positive integer");
  if (T <= 0) return { price: intrinsic(type, S, K), earlyExercise: false };

  const dt = T / steps;
  const u = Math.exp(Math.max(sigma, 1e-12) * Math.sqrt(dt));
  const d = 1 / u;
  const growth = Math.exp((r - q) * dt);
  const p = (growth - d) / (u - d);
  if (p < 0 || p > 1) throw new Error("No-arbitrage condition violated: use more steps or check inputs");
  const discount = Math.exp(-r * dt);

  // Values at expiry, from the lowest node (all down moves) upward.
  const values = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    values[i] = intrinsic(type, S * u ** (2 * i - steps), K);
  }

  let earlyExercise = false;
  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      const hold = discount * (p * values[i + 1] + (1 - p) * values[i]);
      if (american) {
        const exercise = intrinsic(type, S * u ** (2 * i - step), K);
        if (exercise > hold) {
          values[i] = exercise;
          earlyExercise = true;
          continue;
        }
      }
      values[i] = hold;
    }
  }

  return { price: values[0], earlyExercise };
}
