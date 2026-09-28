import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";

/** Times each phase of a test's steps, so a test that outlives its bound can say which phase it was in. */
export function createStepWatch({
  now = () => performance.now(),
  resources = () => process.getActiveResourcesInfo(),
} = {}) {
  const finished = [];
  let current;
  const lines = (phases) => phases.map(({ label, ms }) => `${label}: ${ms} ms`).join("\n");
  const summary = (limit) => {
    if (limit === undefined) return lines(finished);
    const total = finished.reduce((sum, { ms }) => sum + ms, 0);
    const slowest = [...finished].sort((a, b) => b.ms - a.ms).slice(0, limit);
    return `${finished.length} phases, ${total} ms in all; the slowest:\n${lines(slowest)}`;
  };
  return {
    async phase(label, run) {
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
        ? `in phase ${current.label} after ${Math.round(now() - current.startedAt)} ms`
        : "between phases";
      const active = resources();
      return [
        `Stalled ${where}. Active resources: ${active.length > 0 ? active.join(", ") : "none"}.`,
        "Phases finished before it:",
        finished.length > 0 ? summary() : "(none)",
      ].join("\n");
    },
  };
}

/** Set `ms` below the test's own timeout, so this report fails the test before the bare timeout does. */
export async function reportStallAfter(
  watch,
  ms,
  body,
  { setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error("The deadline must be a positive finite number of milliseconds");
  }
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
