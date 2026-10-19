import { describe, expect, it } from "vitest";
import { compact, daysToYears, expiryLabel, greek, money, percent, pnl } from "../src/ui/format.js";

describe("format", () => {
  it.each([
    [4.759, 2, "$4.76"],
    [-1.5, 2, "−$1.50"],
    [3.30449, 4, "$3.3045"],
    [Infinity, 2, "—"],
  ])("money(%f, %i) → %s", (value, digits, expected) => {
    expect(money(value, digits)).toBe(expected);
  });

  it.each([
    [Infinity, "Unlimited"],
    [-Infinity, "Unlimited loss"],
    [6.456, "+$6.46"],
    [-3.5, "−$3.50"],
    [0.001, "$0.00"],
  ])("pnl(%f) → %s", (value, expected) => {
    expect(pnl(value)).toBe(expected);
  });

  it("formats percentages and Greeks", () => {
    expect(percent(0.25)).toBe("25.00%");
    expect(greek(-0.030612)).toBe("−0.0306");
    expect(greek(0.4)).toBe("0.4000");
    expect(greek(-0.00001)).toBe("0.0000"); // no "−0.0000"
  });

  it.each([
    [999, "999"],
    [1500, "1.5k"],
    [100000, "100k"],
    [2000000, "2M"],
  ])("compact(%i) → %s", (n, expected) => {
    expect(compact(n)).toBe(expected);
  });

  it("converts and labels time to expiry", () => {
    expect(daysToYears(365)).toBe(1);
    expect(expiryLabel(1)).toBe("1 day");
    expect(expiryLabel(90)).toBe("90 days");
    expect(expiryLabel(365)).toBe("1 year");
    expect(expiryLabel(547)).toBe("1.5 years");
  });
});
