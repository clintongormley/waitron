import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";

/** Times a test's steps, so a test that outlives its bound can say which step it was on. */
export function createStepWatch({
  now = () => performance.now(),
  resources = () => process.getActiveResourcesInfo(),
} = {}) {
  const finished = [];
  let current;
  const lines = (steps) => steps.map(({ label, ms }) => `${label}: ${ms} ms`).join("\n");
  /** Every step in the order it ran, or, given a limit, only that many of the slowest. */
  const summary = (limit) => {
    if (limit === undefined) return lines(finished);
    const total = finished.reduce((sum, { ms }) => sum + ms, 0);
    const slowest = [...finished].sort((a, b) => b.ms - a.ms).slice(0, limit);
    return `${finished.length} steps, ${total} ms in all; the slowest:\n${lines(slowest)}`;
  };
  return {
    async step(label, run) {
      const startedAt = now();
      current = { label, startedAt };
      try {
        return await run();
      } finally {
        finished.push({ label, ms: Math.round(now() - startedAt) });
        current = undefined;
      }
    },
    summary,
    stalled() {
      const where = current
        ? `in step ${current.label} after ${Math.round(now() - current.startedAt)} ms`
        : "between steps";
      const waiting = resources();
      return [
        `Stalled ${where}. Waiting on: ${waiting.length > 0 ? waiting.join(", ") : "nothing"}.`,
        "Steps finished before it:",
        finished.length > 0 ? summary() : "(none)",
      ].join("\n");
    },
  };
}

/** Fails with the watch's report when `body` has not settled after `ms`; set `ms` below the test's own timeout. */
export async function withDeadline(
  watch,
  ms,
  body,
  { setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimer(
      () => reject(new Error(`Still running after ${ms} ms. ${watch.stalled()}`)),
      ms,
    );
  });
  try {
    return await Promise.race([body(), expired]);
  } finally {
    clearTimer(timer);
  }
}
