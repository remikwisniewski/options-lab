import { describe, expect, it } from "vitest";
import { normCdf, normPdf } from "../src/pricing/normal.js";
import { bsGreeks, bsPrice, d1d2, intrinsic } from "../src/pricing/blackScholes.js";
import { binomialPrice } from "../src/pricing/binomial.js";
import { impliedVol, priceBounds } from "../src/pricing/impliedVol.js";

// Hull, "Options, Futures, and Other Derivatives", Example 15.6.
const HULL = { S: 42, K: 40, T: 0.5, r: 0.1, q: 0, sigma: 0.2 };
const ATM = { S: 100, K: 100, T: 1, r: 0.05, q: 0.02, sigma: 0.25 };

describe("normal distribution", () => {
  it.each([
    [0, 0.5],
    [1.96, 0.9750021048517796],
    [-1, 0.15865525393145707],
    [3, 0.9986501019683699],
    [0.5, 0.6914624612740131],
    [-6, 9.865876449133282e-10],
  ])("Φ(%f) matches erf to 1e-14", (x, expected) => {
    expect(Math.abs(normCdf(x) - expected)).toBeLessThan(1e-14);
  });

  it("uses the continued fraction in the far tails and saturates beyond ±37", () => {
    const exact = 6.220960574271819e-16; // 0.5·erfc(8/√2)
    expect(Math.abs(normCdf(-8) - exact) / exact).toBeLessThan(1e-7);
    expect(normCdf(40)).toBe(1);
    expect(normCdf(-40)).toBe(0);
  });

  it("is symmetric: Φ(x) + Φ(−x) = 1", () => {
    for (const x of [0.1, 0.7, 1.3, 2.9, 5.5, 8]) expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 14);
  });

  it("has density 1/√(2π) at zero", () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804014327, 15);
  });
});

describe("Black-Scholes", () => {
  it("reproduces the textbook example", () => {
    const { d1, d2 } = d1d2({ ...HULL, type: "call" });
    expect(d1).toBeCloseTo(0.7693, 4);
    expect(d2).toBeCloseTo(0.6278, 4);
    expect(bsPrice({ ...HULL, type: "call" })).toBeCloseTo(4.759422392871535, 10);
    expect(bsPrice({ ...HULL, type: "put" })).toBeCloseTo(0.8085993729000958, 10);
  });

  it("satisfies put-call parity with dividends: C − P = S·e^(−qT) − K·e^(−rT)", () => {
    for (const K of [60, 90, 100, 110, 150]) {
      const p = { ...ATM, K };
      const lhs = bsPrice({ ...p, type: "call" }) - bsPrice({ ...p, type: "put" });
      const rhs = p.S * Math.exp(-p.q * p.T) - K * Math.exp(-p.r * p.T);
      expect(lhs).toBeCloseTo(rhs, 10);
    }
  });

  it("is worth intrinsic value at expiry", () => {
    expect(bsPrice({ ...ATM, S: 110, T: 0, type: "call" })).toBe(10);
    expect(bsPrice({ ...ATM, S: 110, T: 0, type: "put" })).toBe(0);
  });

  it("is worth the discounted forward intrinsic with zero volatility", () => {
    const p = { ...ATM, sigma: 0, type: "call" };
    const forward = p.S * Math.exp((p.r - p.q) * p.T);
    expect(bsPrice(p)).toBeCloseTo(Math.exp(-p.r * p.T) * (forward - p.K), 12);
  });

  it("increases with volatility and stays within arbitrage bounds", () => {
    let last = 0;
    for (const sigma of [0.05, 0.1, 0.2, 0.4, 0.8]) {
      const price = bsPrice({ ...ATM, sigma, type: "call" });
      expect(price).toBeGreaterThan(last);
      expect(price).toBeLessThan(ATM.S * Math.exp(-ATM.q * ATM.T));
      last = price;
    }
  });
});

describe("Greeks", () => {
  // Every closed-form Greek must agree with a central finite difference of the price.
  const bump = (p, key, h) =>
    (bsPrice({ ...p, [key]: p[key] + h }) - bsPrice({ ...p, [key]: p[key] - h })) / (2 * h);

  for (const type of ["call", "put"]) {
    for (const S of [80, 100, 125]) {
      it(`match finite differences for a ${type} with S=${S}`, () => {
        const p = { ...ATM, S, type };
        const g = bsGreeks(p);
        expect(g.delta).toBeCloseTo(bump(p, "S", 1e-3), 6);
        const gammaFd =
          (bsPrice({ ...p, S: S + 1e-2 }) - 2 * bsPrice(p) + bsPrice({ ...p, S: S - 1e-2 })) / 1e-4;
        expect(g.gamma).toBeCloseTo(gammaFd, 5);
        expect(g.vega).toBeCloseTo(bump(p, "sigma", 1e-5) / 100, 6);
        expect(g.rho).toBeCloseTo(bump(p, "r", 1e-5) / 100, 6);
        expect(g.theta).toBeCloseTo(-bump(p, "T", 1e-5) / 365, 6);
      });
    }
  }

  it("give call delta minus put delta = e^(−qT)", () => {
    const call = bsGreeks({ ...ATM, type: "call" }).delta;
    const put = bsGreeks({ ...ATM, type: "put" }).delta;
    expect(call - put).toBeCloseTo(Math.exp(-ATM.q * ATM.T), 12);
  });

  it("collapse to a step function at expiry", () => {
    expect(bsGreeks({ ...ATM, S: 120, T: 0, type: "call" })).toEqual({
      delta: 1,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
    });
    expect(bsGreeks({ ...ATM, S: 80, T: 0, type: "put" }).delta).toBe(-1);
    expect(bsGreeks({ ...ATM, S: 120, T: 0, type: "put" }).delta).toBe(0);
  });
});

describe("binomial tree", () => {
  it("converges to Black-Scholes for European options", () => {
    for (const type of ["call", "put"]) {
      const exact = bsPrice({ ...ATM, type });
      const tree = binomialPrice({ ...ATM, type, steps: 2000 }).price;
      expect(Math.abs(tree - exact)).toBeLessThan(0.005);
    }
  });

  it("gets closer as steps increase", () => {
    const exact = bsPrice({ ...HULL, type: "put" });
    const error = (steps) => Math.abs(binomialPrice({ ...HULL, type: "put", steps }).price - exact);
    expect(error(500)).toBeLessThan(error(20));
  });

  it("prices an American put above the European put, flagging early exercise", () => {
    const p = { ...HULL, q: 0, type: "put", steps: 500 };
    const european = binomialPrice(p);
    const american = binomialPrice({ ...p, american: true });
    expect(american.price).toBeGreaterThan(european.price);
    expect(american.earlyExercise).toBe(true);
    expect(european.earlyExercise).toBe(false);
  });

  it("never exercises an American call early without dividends", () => {
    const p = { ...HULL, q: 0, type: "call", steps: 500 };
    const american = binomialPrice({ ...p, american: true });
    expect(american.price).toBeCloseTo(binomialPrice(p).price, 12);
    expect(american.earlyExercise).toBe(false);
  });

  it("can exercise an American call early when the dividend yield is high", () => {
    const result = binomialPrice({ ...ATM, q: 0.15, type: "call", steps: 300, american: true });
    expect(result.earlyExercise).toBe(true);
  });

  it("returns intrinsic value at expiry", () => {
    expect(binomialPrice({ ...ATM, S: 90, T: 0, type: "put", steps: 10 }).price).toBe(10);
  });

  it("rejects invalid step counts", () => {
    expect(() => binomialPrice({ ...ATM, type: "call", steps: 0 })).toThrow("positive integer");
  });

  it("detects a tree that would allow arbitrage", () => {
    expect(() => binomialPrice({ ...ATM, r: 2, sigma: 0.01, type: "call", steps: 1 })).toThrow(
      "No-arbitrage"
    );
  });
});

describe("implied volatility", () => {
  it("round-trips Black-Scholes across strikes and both types", () => {
    for (const type of ["call", "put"]) {
      for (const K of [70, 95, 100, 105, 140]) {
        for (const sigma of [0.08, 0.25, 0.9]) {
          const p = { ...ATM, K, type };
          const result = impliedVol({ ...p, price: bsPrice({ ...p, sigma }) });
          expect(result.sigma).toBeCloseTo(sigma, 6);
        }
      }
    }
  });

  it("converges in a handful of Newton steps near the money", () => {
    const result = impliedVol({ ...ATM, type: "call", price: bsPrice({ ...ATM, type: "call" }) });
    expect(result.iterations).toBeLessThan(8);
  });

  it("refuses prices outside the no-arbitrage bounds", () => {
    const { min, max } = priceBounds({ ...ATM, type: "call" });
    for (const price of [min - 0.01, max + 0.01, 0]) {
      const result = impliedVol({ ...ATM, type: "call", price });
      expect(result.sigma).toBeNull();
      expect(result.reason).toContain("arbitrage-free");
    }
  });

  it("explains why there is no answer at expiry", () => {
    expect(impliedVol({ ...ATM, T: 0, type: "put", price: 1 }).reason).toContain("No time left");
  });

  it("reports volatility beyond the search range", () => {
    const { max } = priceBounds({ ...ATM, type: "call" });
    expect(impliedVol({ ...ATM, type: "call", price: max - 1e-9 }).reason).toContain("above 500%");
  });

  it("gives put bounds based on the discounted strike", () => {
    const { max } = priceBounds({ ...ATM, type: "put" });
    expect(max).toBeCloseTo(ATM.K * Math.exp(-ATM.r * ATM.T), 12);
  });
});

describe("intrinsic", () => {
  it.each([
    ["call", 110, 100, 10],
    ["call", 90, 100, 0],
    ["put", 90, 100, 10],
    ["put", 110, 100, 0],
  ])("%s with S=%i, K=%i is %i", (type, S, K, value) => {
    expect(intrinsic(type, S, K)).toBe(value);
  });
});
