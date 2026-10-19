// Strategy builder: preset strategies, an editable table of legs, an exact summary
// (premium, max profit and loss, breakevens, net Greeks) and a P&L chart.

import {
  analyze,
  netGreeks,
  netPremium,
  payoffAtExpiry,
  presets,
  priceLegs,
  valueNow,
} from "../pricing/strategy.js";
import { createLineChart, css } from "./chart.js";
import { greek, money, pnl } from "./format.js";

const MAX_LEGS = 6;

export function createStrategyView({ root, state }) {
  const presetBox = root.querySelector("[data-presets]");
  const tbody = root.querySelector("[data-legs]");
  const summary = root.querySelector("[data-summary]");
  const nameEl = root.querySelector("[data-strategy-name]");
  const addBtn = root.querySelector("[data-add-leg]");

  const chart = createLineChart(root.querySelector('[data-chart="strategy"]'), {
    xFormat: (v) => `$${Math.round(v)}`,
    yFormat: (v) => pnl(v),
  });

  function loadPreset(key) {
    const preset = presets(state.S)[key];
    state.strategy = { key, label: preset.label, legs: preset.legs.map((leg) => ({ ...leg })) };
  }

  function renderPresets() {
    presetBox.innerHTML = Object.entries(presets(state.S))
      .map(
        ([key, { label }]) =>
          `<button type="button" class="chip" data-preset="${key}" aria-pressed="${key === state.strategy.key}">${label}</button>`
      )
      .join("");
  }

  presetBox.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-preset]");
    if (!chip) return;
    loadPreset(chip.dataset.preset);
    render();
  });

  // ---------- Legs table ----------
  const legRow = (leg, i, priced) => {
    const option = leg.kind !== "stock";
    return `<tr data-leg="${i}">
      <td><select name="side" aria-label="Leg ${i + 1} side">
        <option value="1" ${leg.side === 1 ? "selected" : ""}>Buy</option>
        <option value="-1" ${leg.side === -1 ? "selected" : ""}>Sell</option>
      </select></td>
      <td><input name="qty" type="number" min="1" max="100" step="1" value="${leg.qty}" aria-label="Leg ${i + 1} quantity" /></td>
      <td><select name="kind" aria-label="Leg ${i + 1} instrument">
        <option value="call" ${leg.kind === "call" ? "selected" : ""}>Call</option>
        <option value="put" ${leg.kind === "put" ? "selected" : ""}>Put</option>
        <option value="stock" ${leg.kind === "stock" ? "selected" : ""}>Stock</option>
      </select></td>
      <td>${
        option
          ? `<input name="strike" type="number" min="0.5" step="0.5" value="${leg.strike}" aria-label="Leg ${i + 1} strike" />`
          : `<span class="num" style="color:var(--muted)">—</span>`
      }</td>
      <td class="num">${money(priced.premium)}</td>
      <td><button type="button" class="legs__remove" data-remove="${i}" aria-label="Remove leg ${i + 1}">×</button></td>
    </tr>`;
  };

  tbody.addEventListener("change", (event) => {
    const row = event.target.closest("[data-leg]");
    if (!row) return;
    const leg = state.strategy.legs[Number(row.dataset.leg)];
    const { name, value } = event.target;
    if (name === "side") leg.side = Number(value) === -1 ? -1 : 1;
    if (name === "qty") leg.qty = Math.min(100, Math.max(1, Math.round(Number(value) || 1)));
    if (name === "strike" && Number(value) > 0) leg.strike = Number(value);
    if (name === "kind") {
      leg.kind = value;
      if (value === "stock") delete leg.strike;
      else leg.strike ??= Math.round(state.S);
    }
    markCustom();
    render();
  });

  tbody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    state.strategy.legs.splice(Number(button.dataset.remove), 1);
    markCustom();
    render();
  });

  addBtn.addEventListener("click", () => {
    if (state.strategy.legs.length >= MAX_LEGS) return;
    state.strategy.legs.push({ kind: "call", side: 1, qty: 1, strike: Math.round(state.S) });
    markCustom();
    render();
  });

  function markCustom() {
    state.strategy.key = null;
    state.strategy.label = "Custom";
  }

  // ---------- Summary + chart ----------
  function render() {
    renderPresets();
    const market = state.market();
    const legs = priceLegs(state.strategy.legs, market);
    nameEl.textContent = state.strategy.label;
    addBtn.disabled = legs.length >= MAX_LEGS;

    if (!legs.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted)">No legs. Add one or pick a preset.</td></tr>`;
      summary.innerHTML = "";
      chart.draw(null);
      return;
    }

    tbody.innerHTML = state.strategy.legs.map((leg, i) => legRow(leg, i, legs[i])).join("");

    const { breakevens, maxProfit, maxLoss } = analyze(legs);
    const premium = netPremium(legs);
    const g = netGreeks(legs, market);
    const item = (label, value, cls = "") => `<div><dt>${label}</dt><dd class="${cls}">${value}</dd></div>`;
    summary.innerHTML = [
      item(premium >= 0 ? "Net debit" : "Net credit", money(Math.abs(premium))),
      item("Max profit", pnl(maxProfit), "gain"),
      item("Max loss", pnl(maxLoss), "loss"),
      item("Breakeven", breakevens.length ? breakevens.map((b) => money(b)).join(" · ") : "None"),
      item("Net delta", greek(g.delta, 3)),
      item("Net gamma", greek(g.gamma, 4)),
      item("Net theta / day", greek(g.theta, 3)),
      item("Net vega", greek(g.vega, 3)),
    ].join("");

    // Range covers spot and every strike with room either side.
    const strikes = legs.filter((l) => l.kind !== "stock").map((l) => /** @type {number} */ (l.strike));
    const lo = Math.max(0.5, Math.min(state.S, ...strikes) * 0.7);
    const hi = Math.max(state.S, ...strikes) * 1.3;
    const xs = Array.from({ length: 161 }, (_, i) => lo + ((hi - lo) * i) / 160);

    chart.draw({
      xDomain: [lo, hi],
      xName: "Stock",
      includeZero: true,
      series: [
        {
          name: "Expiry",
          points: xs.map((S) => [S, payoffAtExpiry(legs, S)]),
          color: css("--accent"),
          fillSign: true,
        },
        {
          name: "Today",
          points: xs.map((S) => [S, valueNow(legs, { ...market, S })]),
          color: css("--body"),
          dash: [5, 5],
          width: 1.4,
        },
      ],
      hLines: [{ y: 0, color: css("--line-strong") }],
      vLines: [
        { x: state.S, label: "Spot", color: css("--muted"), dash: [2, 3] },
        ...breakevens.filter((b) => b >= lo && b <= hi).map((b) => ({ x: b, color: css("--muted") })),
      ],
    });
  }

  loadPreset(state.strategy.key ?? "bullCallSpread");
  return { render };
}
