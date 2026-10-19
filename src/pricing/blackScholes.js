// @ts-check
// Black-Scholes-Merton for European options on an asset with a continuous dividend
// yield q. Inputs are annualised: T in years, r, q and sigma as decimals.

import { normCdf, normPdf } from "./normal.js";

/** @typedef {"call" | "put"} OptionType */

/**
 * @typedef {object} OptionParams
 * @property {number} S      Spot price.
 * @property {number} K      Strike.
 * @property {number} T      Time to expiry in years.
 * @property {number} r      Risk-free rate (continuous).
 * @property {number} [q]    Dividend yield (continuous). Defaults to 0.
 * @property {number} sigma  Volatility.
 * @property {OptionType} type
 */

/**
 * @typedef {object} Greeks
 * @property {number} delta  ∂V/∂S
 * @property {number} gamma  ∂²V/∂S²
 * @property {number} vega   ∂V/∂σ per 1 volatility point (0.01).
 * @property {number} theta  ∂V/∂t per calendar day (negative means decay).
 * @property {number} rho    ∂V/∂r per 1 rate point (0.01).
 */

/** Value of an option at expiry. */
export const intrinsic = (
  /** @type {OptionType} */ type,
  /** @type {number} */ S,
  /** @type {number} */ K
) => (type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0));

/**
 * @param {OptionParams} p
 * @returns {{ d1: number, d2: number }}
 */
export function d1d2({ S, K, T, r, q = 0, sigma }) {
  const volSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / volSqrtT;
  return { d1, d2: d1 - volSqrtT };
}

/** True when there is no time or no volatility left, so the payoff is known. */
const degenerate = (/** @type {OptionParams} */ p) => p.T <= 0 || p.sigma <= 0;

/**
 * Black-Scholes-Merton price.
 *
 * @param {OptionParams} p
 * @returns {number}
 */
export function bsPrice(p) {
  const { S, K, T, r, q = 0, type } = p;
  if (T <= 0) return intrinsic(type, S, K);
  if (p.sigma <= 0) {
    // No uncertainty: the option is worth its discounted intrinsic value on the forward.
    const forward = S * Math.exp((r - q) * T);
    return Math.exp(-r * T) * intrinsic(type, forward, K);
  }

  const { d1, d2 } = d1d2(p);
  const discS = S * Math.exp(-q * T);
  const discK = K * Math.exp(-r * T);
  return type === "call"
    ? discS * normCdf(d1) - discK * normCdf(d2)
    : discK * normCdf(-d2) - discS * normCdf(-d1);
}

/**
 * Closed-form Greeks.
 *
 * @param {OptionParams} p
 * @returns {Greeks}
 */
export function bsGreeks(p) {
  const { S, K, T, r, q = 0, sigma, type } = p;

  if (degenerate(p)) {
    const itm = type === "call" ? S > K : S < K;
    return { delta: itm ? (type === "call" ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  }

  const { d1, d2 } = d1d2(p);
  const sqrtT = Math.sqrt(T);
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);
  const pdf = normPdf(d1);
  const call = type === "call";

  const delta = call ? dq * normCdf(d1) : dq * (normCdf(d1) - 1);
  const gamma = (dq * pdf) / (S * sigma * sqrtT);
  const vega = S * dq * pdf * sqrtT;
  const decay = -(S * dq * pdf * sigma) / (2 * sqrtT);
  const theta = call
    ? decay - r * K * dr * normCdf(d2) + q * S * dq * normCdf(d1)
    : decay + r * K * dr * normCdf(-d2) - q * S * dq * normCdf(-d1);
  const rho = call ? K * T * dr * normCdf(d2) : -K * T * dr * normCdf(-d2);

  return { delta, gamma, vega: vega / 100, theta: theta / 365, rho: rho / 100 };
}
