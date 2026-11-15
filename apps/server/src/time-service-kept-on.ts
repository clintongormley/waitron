import type { BoxHostClient, TimeServiceOnAnswer } from "./box-host-client.js";
import type { Logger } from "./logger.js";

/** How long a failed switch-on stops the next ones, unless the service is read as not `off` in
 * between: a host with no time service installed fails every time. */
export const SWITCH_ON_BACK_OFF_MS = 60 * 60_000;

/**
 * A box host whose `clockStatus()` switches the host's automatic time back on whenever it reads it
 * as switched off, then answers the reading as it was. The reading waits for the switch-on, so a
 * clock set that reads the status next is not refused `busy` by it. A failure is warned once, and
 * again only after a success or a different failure.
 */
export function keepTimeServiceOn(
  host: BoxHostClient,
  log: Logger,
  now: () => Date,
): BoxHostClient {
  let switching: Promise<void> | undefined;
  let lastFailure: string | undefined;
  let failedAtMs: number | undefined;

  const backingOff = () => {
    if (failedAtMs === undefined) return false;
    const nowMs = now().getTime();
    // A failure from the clock's future does not count: the clock was set back since.
    return failedAtMs <= nowMs && nowMs - failedAtMs < SWITCH_ON_BACK_OFF_MS;
  };

  const switchOn = async (timeServiceOn: NonNullable<BoxHostClient["timeServiceOn"]>) => {
    let answer: TimeServiceOnAnswer;
    try {
      answer = await timeServiceOn.call(host);
    } catch {
      answer = { available: false, reason: "lost" };
    }
    if (answer.available) {
      lastFailure = undefined;
      failedAtMs = undefined;
      log("info", "time_service.switched_on");
      return;
    }
    // `busy` is a clock set holding the host's lock, which ends within its own limit.
    if (answer.refusal !== "busy") failedAtMs = now().getTime();
    const fields = {
      reason: answer.reason,
      ...(answer.refusal === undefined ? {} : { refusal: answer.refusal }),
      ...(answer.detail === undefined ? {} : { detail: answer.detail }),
    };
    const failure = JSON.stringify(fields);
    if (failure === lastFailure) return;
    lastFailure = failure;
    log("warn", "time_service.switch_on_failed", fields);
  };

  return {
    async clockStatus() {
      const status = await host.clockStatus();
      const timeServiceOn = host.timeServiceOn;
      if (status.available && status.service !== "off") failedAtMs = undefined;
      if (
        status.available &&
        status.service === "off" &&
        timeServiceOn !== undefined &&
        (switching !== undefined || !backingOff())
      ) {
        switching ??= switchOn(timeServiceOn).finally(() => {
          switching = undefined;
        });
        await switching;
      }
      return status;
    },
    setClock: (input) => host.setClock(input),
  };
}
