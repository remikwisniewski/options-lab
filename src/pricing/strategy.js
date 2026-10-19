// @ts-check
// Multi-leg option strategies. A strategy's payoff at expiry is piecewise linear in
// the stock price with kinks only at the strikes, so breakevens and maximum profit
// or loss can be found exactly by looking at the kinks and the slopes beyond them.

import { bsGreeks, bsPrice, intrinsic } from "./blackScholes.js";

/** @typedef {import("./blackScholes.js").Greeks} Greeks */

/**
 * @typedef {object} Leg
 * @property {"call" | "put" | "stock"} kind
 * @property {1 | -1} side      1 = long (bought), −1 = short (sold).
 * @property {number} qty       Number of contracts or shares (per-share units).
 * @property {number} [strike]  Options only.
 * @property {number} premium   Price paid (long) or received (short) per unit.
 */

/** @typedef {{ S: number, T: number, r: number, q?: number, sigma: number }} Market */

/**
 * Prices each leg at Black-Scholes fair value for the given market.
 *
 * @param {Omit<Leg, "premium">[]} legs
 * @param {Market} market
 * @returns {Leg[]}
 */
export function priceLegs(legs, market) {
  return legs.map((leg) => ({
    ...leg,
    premium:
      leg.kind === "stock"
        ? market.S
        : bsPrice({ ...market, K: /** @type {number} */ (leg.strike), type: leg.kind }),
  }));
}

/** Value of one leg at expiry, before premium. */
const legValueAtExpiry = (/** @type {Leg} */ leg, /** @type {number} */ S) =>
  leg.kind === "stock" ? S : intrinsic(leg.kind, S, /** @type {number} */ (leg.strike));

/**
 * Profit or loss at expiry if the stock finishes at S.
 *
 * @param {Leg[]} legs
 * @param {number} S
 */
export function payoffAtExpiry(legs, S) {
  return legs.reduce(
    (total, leg) => total + leg.side * leg.qty * (legValueAtExpiry(leg, S) - leg.premium),
    0
  );
}

/**
 * Profit or loss today (mark to model) if the stock moved to S, with T years left.
 *
 * @param {Leg[]} legs
 * @param {Market} market
 */
export function valueNow(legs, market) {
  return legs.reduce((total, leg) => {
    const value =
      leg.kind === "stock"
        ? market.S
        : bsPrice({ ...market, K: /** @type {number} */ (leg.strike), type: leg.kind });
    return total + leg.side * leg.qty * (value - leg.premium);
  }, 0);
}

/**
 * Cash paid to open the position (negative means a credit was received).
 *
 * @param {Leg[]} legs
 */
export const netPremium = (legs) => legs.reduce((total, leg) => total + leg.side * leg.qty * leg.premium, 0);

/**
 * Position Greeks: the sum of each leg's Greeks, signed and scaled by quantity.
 *
 * @param {Leg[]} legs
 * @param {Market} market
 * @returns {Greeks}
 */
export function netGreeks(legs, market) {
  /** @type {Greeks} */
  const total = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  for (const leg of legs) {
    const g =
      leg.kind === "stock"
        ? { delta: 1, gamma: 0, vega: 0, theta: 0, rho: 0 }
        : bsGreeks({ ...market, K: /** @type {number} */ (leg.strike), type: leg.kind });
    for (const key of /** @type {(keyof Greeks)[]} */ (Object.keys(total)))
      total[key] += leg.side * leg.qty * g[key];
  }
  return total;
}

/**
 * Exact breakevens, maximum profit and maximum loss at expiry.
 *
 * @param {Leg[]} legs
 * @returns {{ breakevens: number[], maxProfit: number, maxLoss: number }}
 *   maxProfit is Infinity when gains are unlimited; maxLoss is −Infinity when losses are.
 */
export function analyze(legs) {
  const strikes = [
    ...new Set(legs.filter((l) => l.kind !== "stock").map((l) => /** @type {number} */ (l.strike))),
  ];
  const kinks = [0, ...strikes.sort((a, b) => a - b)];
  const last = kinks[kinks.length - 1];
  const points = [...kinks, last + 1].map((S) => ({ S, pnl: payoffAtExpiry(legs, S) }));

  // Beyond the highest strike the payoff is a straight line with this slope.
  const slopeUp = points[points.length - 1].pnl - points[points.length - 2].pnl;
  const values = points.map((p) => p.pnl);
  const EPS = 1e-9;
  const maxProfit = slopeUp > EPS ? Infinity : Math.max(...values);
  const maxLoss = slopeUp < -EPS ? -Infinity : Math.min(...values);

  /** @type {number[]} */
  const breakevens = [];
  const segments = [...points.slice(0, -1)];
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    const b = i + 1 < segments.length ? segments[i + 1] : null;
    if (b) {
      if (Math.abs(a.pnl) < EPS) breakevens.push(a.S);
      else if (a.pnl * b.pnl < 0) breakevens.push(a.S + ((b.S - a.S) * -a.pnl) / (b.pnl - a.pnl));
    } else if (Math.abs(a.pnl) < EPS) {
      breakevens.push(a.S);
    } else if (Math.abs(slopeUp) > EPS && Math.sign(slopeUp) === -Math.sign(a.pnl)) {
      breakevens.push(a.S - a.pnl / slopeUp); // crosses zero above the highest strike
    }
  }

  return {
    breakevens: breakevens.filter((b) => b > 0).map((b) => Math.round(b * 1e6) / 1e6),
    maxProfit,
    maxLoss,
  };
}

/**
 * Common strategies around the current price, with strikes on a sensible grid.
 *
 * @param {number} spot
 * @returns {Record<string, { label: string, legs: Omit<Leg, "premium">[] }>}
 */
export function presets(spot) {
  const step = spot >= 200 ? 10 : spot >= 50 ? 5 : 1;
  const atm = Math.round(spot / step) * step;
  const call = (/** @type {1 | -1} */ side, /** @type {number} */ strike) => ({
    kind: /** @type {const} */ ("call"),
    side,
    qty: 1,
    strike,
  });
  const put = (/** @type {1 | -1} */ side, /** @type {number} */ strike) => ({
    kind: /** @type {const} */ ("put"),
    side,
    qty: 1,
    strike,
  });
  const stock = { kind: /** @type {const} */ ("stock"), side: /** @type {const} */ (1), qty: 1 };

  return {
    longCall: { label: "Long call", legs: [call(1, atm)] },
    longPut: { label: "Long put", legs: [put(1, atm)] },
    coveredCall: { label: "Covered call", legs: [stock, call(-1, atm + step)] },
    protectivePut: { label: "Protective put", legs: [stock, put(1, atm - step)] },
    bullCallSpread: { label: "Bull call spread", legs: [call(1, atm), call(-1, atm + 2 * step)] },
    bearPutSpread: { label: "Bear put spread", legs: [put(1, atm), put(-1, atm - 2 * step)] },
    straddle: { label: "Long straddle", legs: [call(1, atm), put(1, atm)] },
    strangle: { label: "Long strangle", legs: [call(1, atm + step), put(1, atm - step)] },
    ironCondor: {
      label: "Iron condor",
      legs: [put(1, atm - 3 * step), put(-1, atm - step), call(-1, atm + step), call(1, atm + 3 * step)],
    },
    butterfly: {
      label: "Call butterfly",
      legs: [call(1, atm - 2 * step), { ...call(-1, atm), qty: 2 }, call(1, atm + 2 * step)],
    },
  };
}
