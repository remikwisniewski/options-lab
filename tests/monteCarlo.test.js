import { describe, expect, it } from "vitest";
import { bsPrice } from "../src/pricing/blackScholes.js";
import {
  NormalSampler,
  accumulate,
  emptyAccumulator,
  monteCarloPrice,
  mulberry32,
  samplePaths,
  summarize,
  terminalHistogram,
} from "../src/pricing/monteCarlo.js";

const P = { S: 100, K: 105, T: 0.75, r: 0.04, q: 0.01, sigma: 0.3 };

describe("random numbers", () => {
  it("are reproducible from a seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produce standard normal draws", () => {
    const sampler = new NormalSampler(11);
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    let within1 = 0;
    for (let i = 0; i < n; i++) {
      const z = sampler.next();
      sum += z;
      sumSq += z * z;
      if (Math.abs(z) < 1) within1++;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
    expect(sumSq / n).toBeCloseTo(1, 1);
    expect(within1 / n).toBeCloseTo(0.6827, 2);
  });
});

describe("Monte Carlo pricing", () => {
  it.each(["call", "put"])("brackets the Black-Scholes %s price in its 95% interval", (type) => {
    const exact = bsPrice({ ...P, type });
    const mc = monteCarloPrice({ ...P, type }, { paths: 200_000, seed: 3 });
    expect(mc.low).toBeLessThan(exact);
    expect(mc.high).toBeGreaterThan(exact);
    expect(Math.abs(mc.price - exact) / exact).toBeLessThan(0.01);
  });

  it("is reproducible from a seed", () => {
    const a = monteCarloPrice({ ...P, type: "call" }, { paths: 5000, seed: 9 });
    const b = monteCarloPrice({ ...P, type: "call" }, { paths: 5000, seed: 9 });
    expect(a).toEqual(b);
  });

  it("shrinks its error roughly with the square root of the path count", () => {
    const small = monteCarloPrice({ ...P, type: "call" }, { paths: 10_000, seed: 1 });
    const large = monteCarloPrice({ ...P, type: "call" }, { paths: 160_000, seed: 1 });
    const ratio = small.stdError / large.stdError;
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it("gets a smaller error from antithetic variates for the same work", () => {
    const plain = monteCarloPrice({ ...P, type: "call" }, { paths: 50_000, seed: 2, antithetic: false });
    const anti = monteCarloPrice({ ...P, type: "call" }, { paths: 50_000, seed: 2, antithetic: true });
    expect(anti.stdError).toBeLessThan(plain.stdError);
  });

  it("gives the same answer whether run in one go or in chunks", () => {
    const whole = monteCarloPrice({ ...P, type: "put" }, { paths: 30_000, seed: 4 });
    const sampler = new NormalSampler(4);
    const acc = emptyAccumulator();
    for (let i = 0; i < 3; i++) accumulate({ ...P, type: "put" }, 10_000, sampler, acc);
    expect(summarize(acc).price).toBeCloseTo(whole.price, 12);
  });

  it("needs at least two samples to estimate an error", () => {
    expect(() => summarize({ sum: 1, sumSq: 1, count: 1 })).toThrow("two samples");
  });
});

describe("sample paths", () => {
  it("start at spot and have the requested shape", () => {
    const paths = samplePaths(P, { count: 5, steps: 50, seed: 1 });
    expect(paths).toHaveLength(5);
    for (const path of paths) {
      expect(path).toHaveLength(51);
      expect(path[0]).toBe(P.S);
      expect(Math.min(...path)).toBeGreaterThan(0);
    }
  });

  it("drift at the risk-neutral rate on average", () => {
    const paths = samplePaths({ ...P, sigma: 0.2 }, { count: 20_000, steps: 4, seed: 5 });
    const meanTerminal = paths.reduce((sum, p) => sum + p[4], 0) / paths.length;
    expect(meanTerminal / (P.S * Math.exp((P.r - P.q) * P.T))).toBeCloseTo(1, 2);
  });
});

describe("terminal histogram", () => {
  it("captures nearly every sample and peaks near the forward price", () => {
    const { min, max, counts } = terminalHistogram(P, { samples: 50_000, bins: 40, seed: 6 });
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total / 50_000).toBeGreaterThan(0.999);
    const peak = counts.indexOf(Math.max(...counts));
    const peakPrice = min + ((peak + 0.5) * (max - min)) / counts.length;
    expect(peakPrice).toBeGreaterThan(70);
    expect(peakPrice).toBeLessThan(110);
  });
});
