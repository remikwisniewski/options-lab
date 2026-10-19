import { describe, expect, it } from "vitest";
import { bsGreeks, bsPrice } from "../src/pricing/blackScholes.js";
import {
  analyze,
  netGreeks,
  netPremium,
  payoffAtExpiry,
  presets,
  priceLegs,
  valueNow,
} from "../src/pricing/strategy.js";

const MARKET = { S: 100, T: 0.25, r: 0.05, q: 0, sigma: 0.2 };
const leg = (kind, side, strike, premium, qty = 1) => ({ kind, side, qty, strike, premium });

describe("payoff at expiry", () => {
  it("is a hockey stick for a long call, net of premium", () => {
    const legs = [leg("call", 1, 100, 4)];
    expect(payoffAtExpiry(legs, 80)).toBe(-4);
    expect(payoffAtExpiry(legs, 104)).toBe(0);
    expect(payoffAtExpiry(legs, 120)).toBe(16);
  });

  it("mirrors for a short put", () => {
    const legs = [leg("put", -1, 100, 3)];
    expect(payoffAtExpiry(legs, 120)).toBe(3);
    expect(payoffAtExpiry(legs, 90)).toBe(-7);
  });

  it("scales with quantity and includes stock legs", () => {
    const legs = [{ kind: "stock", side: 1, qty: 2, premium: 100 }, leg("call", -1, 110, 1, 2)];
    expect(payoffAtExpiry(legs, 130)).toBe(2 * 30 - 2 * (20 - 1));
  });
});

describe("analyze", () => {
  it("finds the breakeven, capped loss and unlimited gain of a long call", () => {
    expect(analyze([leg("call", 1, 100, 4)])).toEqual({
      breakevens: [104],
      maxProfit: Infinity,
      maxLoss: -4,
    });
  });

  it("flags unlimited loss on a short call", () => {
    expect(analyze([leg("call", -1, 100, 4)])).toEqual({
      breakevens: [104],
      maxProfit: 4,
      maxLoss: -Infinity,
    });
  });

  it("caps both sides of a bull call spread", () => {
    const result = analyze([leg("call", 1, 100, 5), leg("call", -1, 110, 2)]);
    expect(result).toEqual({ breakevens: [103], maxProfit: 7, maxLoss: -3 });
  });

  it("finds both breakevens of a straddle", () => {
    const result = analyze([leg("call", 1, 100, 4), leg("put", 1, 100, 3)]);
    expect(result).toEqual({ breakevens: [93, 107], maxProfit: Infinity, maxLoss: -7 });
  });

  it("finds both breakevens and caps of an iron condor", () => {
    const legs = [
      leg("put", 1, 85, 0.5),
      leg("put", -1, 95, 2),
      leg("call", -1, 105, 2),
      leg("call", 1, 115, 0.5),
    ];
    expect(analyze(legs)).toEqual({ breakevens: [92, 108], maxProfit: 3, maxLoss: -7 });
  });

  it("handles a lone stock position", () => {
    expect(analyze([{ kind: "stock", side: 1, qty: 1, premium: 100 }])).toEqual({
      breakevens: [100],
      maxProfit: Infinity,
      maxLoss: -100,
    });
  });

  it("reports a breakeven that lands exactly on a strike", () => {
    // Long put at 100 bought for 0: zero P&L from 100 upward.
    expect(analyze([leg("put", 1, 100, 0)]).breakevens).toContain(100);
  });
});

describe("pricing a strategy", () => {
  it("prices option legs at Black-Scholes fair value and stock at spot", () => {
    const [stock, call] = priceLegs(
      [
        { kind: "stock", side: 1, qty: 1 },
        { kind: "call", side: -1, qty: 1, strike: 105 },
      ],
      MARKET
    );
    expect(stock.premium).toBe(100);
    expect(call.premium).toBeCloseTo(bsPrice({ ...MARKET, K: 105, type: "call" }), 12);
  });

  it("is worth zero today when every leg was bought at fair value", () => {
    const legs = priceLegs(presets(100).ironCondor.legs, MARKET);
    expect(valueNow(legs, MARKET)).toBeCloseTo(0, 12);
  });

  it("nets premiums: debit for a straddle, credit for an iron condor", () => {
    expect(netPremium(priceLegs(presets(100).straddle.legs, MARKET))).toBeGreaterThan(0);
    expect(netPremium(priceLegs(presets(100).ironCondor.legs, MARKET))).toBeLessThan(0);
  });

  it("sums signed Greeks across legs", () => {
    const legs = priceLegs(presets(100).straddle.legs, MARKET);
    const call = bsGreeks({ ...MARKET, K: 100, type: "call" });
    const put = bsGreeks({ ...MARKET, K: 100, type: "put" });
    const net = netGreeks(legs, MARKET);
    expect(net.delta).toBeCloseTo(call.delta + put.delta, 12);
    expect(net.gamma).toBeCloseTo(call.gamma + put.gamma, 12);
  });

  it("gives a covered call less delta than the stock alone", () => {
    const legs = priceLegs(presets(100).coveredCall.legs, MARKET);
    const { delta } = netGreeks(legs, MARKET);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(1);
  });
});

describe("presets", () => {
  it.each([
    [42, 1],
    [100, 5],
    [415, 10],
  ])("centre strikes on a grid around spot %i (step %i)", (spot, step) => {
    const { straddle, ironCondor } = presets(spot);
    const atm = Math.round(spot / step) * step;
    expect(straddle.legs.every((l) => l.strike === atm)).toBe(true);
    expect(ironCondor.legs.map((l) => l.strike)).toEqual([
      atm - 3 * step,
      atm - step,
      atm + step,
      atm + 3 * step,
    ]);
  });

  it("every preset has a finite worst case or is clearly unlimited", () => {
    for (const { legs } of Object.values(presets(100))) {
      const { maxLoss, maxProfit } = analyze(priceLegs(legs, MARKET));
      expect(Number.isNaN(maxLoss)).toBe(false);
      expect(Number.isNaN(maxProfit)).toBe(false);
    }
  });
});
