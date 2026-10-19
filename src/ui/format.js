// @ts-check
// Number formatting for the UI. Pure, so it's unit tested.

/**
 * @param {number} value
 * @param {number} [digits]
 */
export const money = (value, digits = 2) => {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toFixed(digits)}`;
};

/**
 * Profit and loss, with explicit sign and "Unlimited" for unbounded outcomes.
 *
 * @param {number} value
 */
export const pnl = (value) => {
  if (value === Infinity) return "Unlimited";
  if (value === -Infinity) return "Unlimited loss";
  if (Math.abs(value) < 0.005) return "$0.00";
  return `${value > 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;
};

/**
 * @param {number} value A fraction, e.g. 0.2534.
 * @param {number} [digits]
 */
export const percent = (value, digits = 2) => `${(value * 100).toFixed(digits)}%`;

/**
 * Greek values: enough precision to be meaningful, signed, no trailing noise.
 *
 * @param {number} value
 * @param {number} [digits]
 */
export const greek = (value, digits = 4) => {
  const rounded = Number(value.toFixed(digits));
  return `${rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(digits)}`;
};

/**
 * Compact counts: 1500 → "1.5k", 2000000 → "2M".
 *
 * @param {number} n
 */
export const compact = (n) => {
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}k`;
  return String(n);
};

const trim = (/** @type {number} */ x) => String(Number(x.toFixed(1)));

/**
 * Days to a fraction of a year (calendar days / 365).
 *
 * @param {number} days
 */
export const daysToYears = (days) => days / 365;

/**
 * Time-to-expiry label: "45 days", "1 year", "1.5 years".
 *
 * @param {number} days
 */
export const expiryLabel = (days) => {
  if (days < 365) return `${days} day${days === 1 ? "" : "s"}`;
  const years = trim(days / 365);
  return `${years} year${years === "1" ? "" : "s"}`;
};
