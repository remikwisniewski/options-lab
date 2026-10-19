# Options Lab

[![CI](https://github.com/remikwisniewski/options-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/remikwisniewski/options-lab/actions/workflows/ci.yml)
![Vanilla JS](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?logo=javascript&logoColor=000)

**Live:** [remikwisniewski.github.io/options-lab](https://remikwisniewski.github.io/options-lab/)

An option pricing simulator that runs entirely in the browser. It prices the same option three ways, with Black-Scholes, a binomial tree and Monte Carlo, and shows them side by side, so you can see where the models agree, where they don't, and why.

## What you can do

- **Price calls and puts, European or American,** with live sliders for spot, strike, time, volatility, rates and dividends.
- **Compare three models.** Black-Scholes-Merton (closed form), a Cox-Ross-Rubinstein binomial tree that flags when early exercise is optimal, and a Monte Carlo estimate with its standard error.
- **Read the Greeks.** Delta, gamma, theta, vega and rho, plus a value-vs-spot chart for each one.
- **Back out implied volatility** from any market price, then apply it to the model.
- **Watch the Monte Carlo.** Animated price paths beside the terminal distribution, plus convergence charts showing the estimate's confidence band tightening onto Black-Scholes and the binomial tree oscillating toward it.
- **Build strategies.** Ten presets (covered call, straddle, iron condor, butterfly and more) or custom legs, with exact breakevens, maximum profit and loss, net Greeks, and P&L at expiry and today.

## The models

| Model                | Handles                          | How                                                                                                                                |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Black-Scholes-Merton | European                         | Closed form with a continuous dividend yield. Normal CDF via Hart's double-precision approximation (~1e-14).                       |
| Binomial (CRR)       | European and American            | Backward induction on a recombining tree, comparing hold vs exercise at every node.                                                |
| Monte Carlo          | European                         | Exact GBM terminal sampling with antithetic variates and a seeded generator; reports SE and a 95% CI.                              |
| Implied volatility   | Any European price               | Newton-Raphson using vega, falling back to bisection whenever a step would leave the bracket. Validates no-arbitrage bounds first. |
| Strategy analysis    | Any mix of calls, puts and stock | Payoff is piecewise linear with kinks at strikes, so breakevens and max P&L are solved exactly, not sampled.                       |

## Engineering

- **Pure, typed pricing library** (`src/pricing`): no DOM, JSDoc types checked by TypeScript in strict mode.
- **86 unit tests** at over 99% line coverage, built around properties rather than snapshots:
  - matches the Hull textbook example (call 4.7594, put 0.8086) to 10 decimal places
  - put-call parity with dividends across strikes
  - every closed-form Greek agrees with a finite-difference bump of the price
  - the binomial tree converges to Black-Scholes; the American put is worth more than the European; an American call without dividends is never exercised early
  - implied volatility round-trips across strikes, types and volatilities
  - the Monte Carlo 95% interval contains the exact price, its error shrinks with √N, and antithetic sampling lowers variance
  - strategy breakevens and limits are checked against hand-calculated values
- **Web Worker** for Monte Carlo: up to 2,000,000 paths in chunks with progress updates, and a newer request cancels an older one, so the sliders never stutter.
- **Canvas charts** written from scratch: multiple series, confidence bands, P&L shading, log axes and hover tooltips.
- **CI and CD:** GitHub Actions lints, type-checks, tests with coverage thresholds and builds on every push, then deploys to GitHub Pages.

## Run it

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

| Script             | What it does                             |
| ------------------ | ---------------------------------------- |
| `npm run dev`      | Start the Vite dev server                |
| `npm test`         | Run the test suite                       |
| `npm run coverage` | Tests with a coverage report             |
| `npm run check`    | Lint, format check, type-check and tests |
| `npm run build`    | Production build to `dist/`              |

## Project layout

```
src/
  pricing/            pure, typed, tested
    normal.js         normal PDF and CDF
    blackScholes.js   prices and Greeks
    binomial.js       CRR tree, European and American
    impliedVol.js     Newton-Raphson with bisection fallback
    monteCarlo.js     seeded GBM sampler, estimates, paths, histograms
    strategy.js       multi-leg payoff, exact breakevens, presets
  mc.worker.js        Monte Carlo off the main thread
  ui/                 pricer, Monte Carlo and strategy views, Canvas chart
  main.js             shared state and rendering
tests/                Vitest suites
```

Educational model. Not investment advice.

## License

MIT © Remigiusz Wisniewski
