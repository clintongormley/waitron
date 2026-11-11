import { createJobRunner, type JobDefinition } from "../job-runner.js";
import type { Logger } from "../logger.js";

export function runTestJob(
  job: JobDefinition,
  signal: AbortSignal,
  options: {
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    log?: Logger;
  } = {},
) {
  let at = Date.now();
  const runner = createJobRunner({
    now: () => (options.sleep ? new Date(at) : new Date()),
    log: options.log ?? (() => {}),
    subscribe: () => () => {},
    ...(options.sleep
      ? {
          delay: async (ms: number, stopping: AbortSignal) => {
            if (ms === 0) return;
            await options.sleep!(ms, stopping);
            if (!stopping.aborted) at += ms;
          },
        }
      : {}),
  });
  let stopped!: () => void;
  const aborted = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const abort = () => {
    runner.signalStepdown();
    stopped();
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  runner.add(job);
  const done = aborted.finally(async () => {
    signal.removeEventListener("abort", abort);
    await runner.stopJobs();
  });
  return { runner, done };
}
