import type { BoxHostClient, TimeServiceOnAnswer } from "./box-host-client.js";
import type { Logger } from "./logger.js";

/** How long one failed switch-on stops the next ones. Each further failure in a row doubles it, up
 * to {@link SWITCH_ON_LONGEST_WAIT_MS}; a reading of the service as not `off`, or a success, ends
 * the run. */
export const SWITCH_ON_FIRST_WAIT_MS = 60_000;
export const SWITCH_ON_LONGEST_WAIT_MS = 60 * 60_000;

/**
 * A box host whose `clockStatus()` switches the host's automatic time back on when it reads it as
 * switched off, waiting longer after each failure in a row, then answers the reading as it was.
 * The reading waits for the switch-on, so a clock set that reads the status next is not refused
 * `busy` by it. A failure is warned once, and again only after a success or a different failure.
 */
export function keepTimeServiceOn(
  host: BoxHostClient,
  log: Logger,
  now: () => Date,
): BoxHostClient {
  let switching: Promise<void> | undefined;
  let lastFailure: string | undefined;
  let failedAtMs: number | undefined;
  let failuresInRow = 0;

  const startAgain = () => {
    failedAtMs = undefined;
    failuresInRow = 0;
  };

  const backingOff = () => {
    if (failedAtMs === undefined) return false;
    const nowMs = now().getTime();
    const waitMs = Math.min(
      SWITCH_ON_FIRST_WAIT_MS * 2 ** (failuresInRow - 1),
      SWITCH_ON_LONGEST_WAIT_MS,
    );
    // A failure from the clock's future does not count: the clock was set back since.
    return failedAtMs <= nowMs && nowMs - failedAtMs < waitMs;
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
      startAgain();
      log("info", "time_service.switched_on");
      return;
    }
    // `busy` is a clock set holding the host's lock, which ends within its own limit.
    if (answer.refusal !== "busy") {
      failedAtMs = now().getTime();
      failuresInRow++;
    }
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
      if (status.available && status.service !== "off") startAgain();
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
    ...(host.retryTimeService === undefined
      ? {}
      : { retryTimeService: () => host.retryTimeService!() }),
  };
}
