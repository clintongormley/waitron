import { onTestFinished } from "vitest";
import { createBoxEmailDuty, boxAlertMailJob } from "../box-alert-email.js";
import { createJobRunner } from "../job-runner.js";
import type { Timer } from "../unref-timer.js";

export function runBoxEmailDuty(
  deps: Parameters<typeof createBoxEmailDuty>[0] & {
    intervalMs: number;
    timer(ms: number, fn: () => void): Timer;
  },
) {
  const duty = createBoxEmailDuty(deps);
  const runner = createJobRunner({
    now: deps.now,
    log: deps.log,
    subscribe: () => () => {},
    delay: (ms, signal) =>
      new Promise<void>((resolve) => {
        const timer = deps.timer(ms, resolve);
        signal.addEventListener(
          "abort",
          () => {
            timer.cancel();
            resolve();
          },
          { once: true },
        );
      }),
  });
  runner.add(boxAlertMailJob(duty, deps.intervalMs));
  onTestFinished(() => runner.stopJobs());
  return { remember: duty.remember, stop: () => runner.stopJobs() };
}
