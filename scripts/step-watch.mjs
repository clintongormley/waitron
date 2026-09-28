import { writeSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";
import { Worker } from "node:worker_threads";

const lines = (phases) => phases.map(({ label, ms }) => `${label}: ${ms} ms`).join("\n");

function describeStall({ current, finished, active }) {
  const where = current ? `in phase ${current.label} after ${current.ms} ms` : "between phases";
  const resources =
    active === undefined
      ? ""
      : ` Active resources: ${active.length > 0 ? active.join(", ") : "none"}.`;
  return [
    `Stalled ${where}.${resources}`,
    "Phases finished before it:",
    finished.length > 0 ? lines(finished) : "(none)",
  ].join("\n");
}

/** Times each phase of a test's steps, so a test that outlives its bound can say which phase it was in. */
export function createStepWatch({
  now = () => performance.now(),
  resources = () => process.getActiveResourcesInfo(),
} = {}) {
  const finished = [];
  const observers = new Set();
  let current;
  const summary = (limit) => {
    if (limit === undefined) return lines(finished);
    const total = finished.reduce((sum, { ms }) => sum + ms, 0);
    const slowest = [...finished].sort((a, b) => b.ms - a.ms).slice(0, limit);
    const count = `${finished.length} phase${finished.length === 1 ? "" : "s"}`;
    return `${count}, ${total} ms in all; the slowest:\n${lines(slowest)}`;
  };
  return {
    async phase(label, run) {
      const startedAt = now();
      current = { label, startedAt, at: Date.now() };
      for (const observer of observers) observer({ started: label, at: current.at });
      try {
        return await run();
      } finally {
        const done = { label, ms: Math.round(now() - startedAt) };
        finished.push(done);
        current = undefined;
        for (const observer of observers) observer({ finished: done });
      }
    },
    /** Replays what has happened so far to `observer`, then tells it each phase as it starts and ends. */
    observe(observer) {
      for (const done of finished) observer({ finished: done });
      if (current) observer({ started: current.label, at: current.at });
      observers.add(observer);
      return () => observers.delete(observer);
    },
    summary,
    stalled() {
      return describeStall({
        current: current && { label: current.label, ms: Math.round(now() - current.startedAt) },
        finished,
        active: resources(),
      });
    },
  };
}

/**
 * Runs in the watchdog thread. It writes with `writeSync` because a worker's `process.stderr` is
 * relayed through the test's thread, which is the thread being held.
 */
export function watchFromAnotherThread(
  port,
  { dueAt, ms, graceMs, answered, reportTo },
  { write = writeSync, now = Date.now, setTimer = setTimeout } = {},
) {
  const finished = [];
  let current;
  port.on("message", (event) => {
    if (event.finished) {
      finished.push(event.finished);
      current = undefined;
    } else {
      current = { label: event.started, at: event.at };
    }
  });
  setTimer(() => {
    if (Atomics.load(answered, 0) === 1) return;
    const stall = describeStall({
      current: current && { label: current.label, ms: now() - current.at },
      finished,
    });
    write(
      reportTo,
      `The test's thread has not run its ${ms} ms deadline timer ${graceMs} ms after it fell due: something synchronous is holding it. ${stall}\n`,
    );
  }, dueAt - now());
}

const WATCHDOG = `
const { parentPort, workerData } = require("node:worker_threads");
import(workerData.helper).then(({ watchFromAnotherThread }) =>
  watchFromAnotherThread(parentPort, workerData.settings),
);`;

/**
 * Set `ms` below the test's own timeout, so this report fails the test before the bare timeout does.
 * The database engine is synchronous, so a stall inside one call holds this thread's timers too; a
 * second thread watches as well, and writes its report to `reportTo` (a file descriptor, standard
 * error by default) while the call still holds this one.
 */
export async function reportStallAfter(
  watch,
  ms,
  body,
  {
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = () => performance.now(),
    graceMs = 1000,
    reportTo = 2,
  } = {},
) {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error("The deadline must be a positive finite number of milliseconds");
  }
  const startedAt = now();
  const answered = new Int32Array(new SharedArrayBuffer(4));
  const watchdog = new Worker(WATCHDOG, {
    eval: true,
    workerData: {
      helper: import.meta.url,
      settings: { dueAt: Date.now() + ms + graceMs, ms, graceMs, answered, reportTo },
    },
  });
  watchdog.unref();
  const stopObserving = watch.observe((event) => watchdog.postMessage(event));
  const took = () => Math.round(now() - startedAt);
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimer(() => {
      Atomics.store(answered, 0, 1);
      reject(
        new Error(
          `Still running after ${took()} ms, past the ${ms} ms deadline. ${watch.stalled()}`,
        ),
      );
    }, ms);
  });
  try {
    const result = await Promise.race([body(), expired]);
    const finishedAfter = took();
    if (finishedAfter >= ms) {
      throw new Error(
        `Finished after ${finishedAfter} ms, past the ${ms} ms deadline. ${watch.summary(5)}`,
      );
    }
    return result;
  } finally {
    Atomics.store(answered, 0, 1);
    clearTimer(timer);
    stopObserving();
    void watchdog.terminate();
  }
}
