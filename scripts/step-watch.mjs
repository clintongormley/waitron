import { writeSync } from "node:fs";
import { clearTimeout, setTimeout } from "node:timers";
import { receiveMessageOnPort, Worker } from "node:worker_threads";

// Both threads read this clock, not the wall clock, because a wall-clock step would move when the
// watchdog fires.
const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);

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

export function createStepWatch({
  now = monotonicMs,
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
      current = { label, startedAt, at: monotonicMs() };
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
 * relayed through the test's thread, which is the thread being held. The report falls due
 * `idleMs + graceMs` after the last event it has read, the same gap the test's thread's own timer
 * counts from.
 */
export function watchFromAnotherThread(
  port,
  { startedAt, idleMs, graceMs, answered, reportTo },
  {
    write = writeSync,
    now = monotonicMs,
    setTimer = setTimeout,
    receive = receiveMessageOnPort,
  } = {},
) {
  const finished = [];
  let current;
  let lastEventAt = startedAt;
  const read = (event) => {
    lastEventAt = Math.max(lastEventAt, event.at ?? now());
    if (event.finished) {
      finished.push(event.finished);
      current = undefined;
    } else {
      current = { label: event.started, at: event.at };
    }
  };
  port.on("message", read);
  const check = () => {
    if (Atomics.load(answered, 0) === 1) return;
    // A thread that started late finds this timer already due, and it can fire before the
    // messages the test's thread sent are delivered.
    for (let queued = receive(port); queued; queued = receive(port)) read(queued.message);
    const dueAt = lastEventAt + idleMs + graceMs;
    if (now() < dueAt) {
      setTimer(check, dueAt - now());
      return;
    }
    const stall = describeStall({
      current: current && { label: current.label, ms: now() - current.at },
      finished,
    });
    write(
      reportTo,
      `The test's thread has not run its ${idleMs} ms no-progress timer ${graceMs} ms after it fell due: something synchronous is holding it. ${stall}\n`,
    );
  };
  setTimer(check, Math.max(0, startedAt + idleMs + graceMs - now()));
}

// The eval'd source is parsed as a module or a script depending on the parent's flags, so it reaches
// Node's modules through `process.getBuiltinModule`, as `packages/store/src/venue-liveness.ts` does.
const WATCHDOG = `
const { parentPort, workerData } = process.getBuiltinModule("node:worker_threads");
import(workerData.helper).then(({ watchFromAnotherThread }) =>
  watchFromAnotherThread(parentPort, workerData.settings),
);`;

const threadCpuMs = () => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
};

/**
 * Two limits. `workMs` is the body's own processor time on this thread, so a body slowed by other
 * processes on the machine is not failed for their work. `idleMs` is wall time with no phase
 * starting or finishing; set it below the test's own timeout, so this report fails the test before
 * the bare timeout does. Both are checked at every phase event and at the end, before the
 * no-progress timer is re-armed: the database engine is synchronous, so a call that holds this
 * thread holds its timers too, and the timer alone would miss a hold that then lets go. A second
 * thread watches as well, and writes its report to `reportTo` (a file descriptor, standard error by
 * default) while the call still holds this one.
 */
export async function reportStallAfter(
  watch,
  { workMs, idleMs },
  body,
  {
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = monotonicMs,
    cpuNow = threadCpuMs,
    graceMs = 1000,
    reportTo = 2,
    helper = import.meta.url,
  } = {},
) {
  if (!Number.isFinite(workMs) || workMs <= 0) {
    throw new Error("The work budget must be a positive finite number of milliseconds");
  }
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    throw new Error("The no-progress limit must be a positive finite number of milliseconds");
  }
  if (!Number.isFinite(graceMs) || graceMs <= 0) {
    throw new Error("The grace period must be a positive finite number of milliseconds");
  }
  const startedAt = now();
  const cpuStartedAt = cpuNow();
  let lastEventAt = startedAt;
  const answered = new Int32Array(new SharedArrayBuffer(4));
  const watchdog = new Worker(WATCHDOG, {
    eval: true,
    workerData: {
      helper,
      settings: { startedAt: monotonicMs(), idleMs, graceMs, answered, reportTo },
    },
  });
  watchdog.unref();
  // The watchdog is a diagnostic: its own failure must not decide the test's result.
  watchdog.on("error", (error) => process.emitWarning(error.message, "StepWatchWarning"));
  const took = () => Math.round(now() - startedAt);
  const overLimit = (until) => {
    const gap = Math.round(now() - lastEventAt);
    if (gap >= idleMs) {
      return `No phase started or finished for ${gap} ms, past the ${idleMs} ms no-progress limit, ${until}. ${watch.summary(5)}`;
    }
    const used = Math.round(cpuNow() - cpuStartedAt);
    if (used >= workMs) {
      return `Used ${used} ms of processor time, past the ${workMs} ms budget. ${watch.summary(5)}`;
    }
    return undefined;
  };
  let timer;
  let fail;
  const failed = new Promise((_, reject) => {
    fail = (message) => {
      Atomics.store(answered, 0, 1);
      reject(new Error(message));
    };
  });
  const onIdle = () => {
    fail(
      `Still running after ${took()} ms with no phase started or finished for ${Math.round(now() - lastEventAt)} ms, past the ${idleMs} ms no-progress limit. ${watch.stalled()}`,
    );
  };
  timer = setTimer(onIdle, idleMs);
  const stopObserving = watch.observe((event) => {
    watchdog.postMessage(event.at === undefined ? { ...event, at: monotonicMs() } : event);
    if (Atomics.load(answered, 0) === 1) return;
    const label = event.finished
      ? `phase ${event.finished.label} finished`
      : `phase ${event.started} started`;
    const over = overLimit(`until ${label}`);
    if (over) {
      fail(over);
      return;
    }
    lastEventAt = now();
    clearTimer(timer);
    timer = setTimer(onIdle, idleMs);
  });
  try {
    const result = await Promise.race([body(), failed]);
    const over = overLimit("before the body finished");
    if (over) throw new Error(over);
    return result;
  } finally {
    Atomics.store(answered, 0, 1);
    clearTimer(timer);
    stopObserving();
    // A worker holds file descriptors until `terminate()` resolves; `allSettled` keeps a refusal
    // from replacing the body's own error.
    await Promise.allSettled([watchdog.terminate()]);
  }
}
