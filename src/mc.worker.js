// Runs Monte Carlo off the main thread. Work is done in chunks with a yield between
// them, so progress can be reported and a newer request can cancel an older one.

import { NormalSampler, accumulate, emptyAccumulator, summarize } from "./pricing/monteCarlo.js";

const CHUNK = 25_000;
let latest = 0;

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

self.onmessage = async ({ data }) => {
  const { id, params, paths, seed, antithetic } = data;
  latest = id;

  const sampler = new NormalSampler(seed);
  const acc = emptyAccumulator();
  const convergence = [];
  let nextCheckpoint = 1000;
  let sinceUpdate = 0;

  while (acc.count < paths) {
    const n = Math.min(CHUNK, paths - acc.count, Math.max(nextCheckpoint - acc.count, 1));
    accumulate(params, n, sampler, acc, antithetic);
    sinceUpdate += n;

    if (acc.count >= nextCheckpoint || acc.count === paths) {
      convergence.push(summarize(acc));
      nextCheckpoint = Math.round(nextCheckpoint * 1.5);
    }

    if (sinceUpdate >= CHUNK || acc.count === paths) {
      sinceUpdate = 0;
      postMessage({ id, type: "progress", done: acc.count, total: paths });
      await pause();
      if (latest !== id) return; // superseded by a newer run
    }
  }

  postMessage({ id, type: "done", result: summarize(acc), convergence });
};
