import type { BoxHostClient, TimeServiceOnAnswer } from "./box-host-client.js";
import type { Logger } from "./logger.js";
import type { StartClockState } from "./start-clock-check.js";

/** The least time between two requests, on the steady clock, which a sync does not step. */
export const RETRY_SPACING_MS = 30_000;
const LOG_EVERY = 10;

/**
 * Asks the host to restart its time service, at most once per {@link RETRY_SPACING_MS}, while the
 * start waits for its time with no confirmation held; left alone, the service asks again only after
 * a wait that doubles. Never once a set has been asked of the host in this process, whatever it
 * answered, or a person's confirmation has ended a wait: a restart may move the clock (the host
 * refuses the case it knows of, `saved_time_ahead`).
 */
export function timeServiceRetry(deps: {
  host: Pick<BoxHostClient, "retryTimeService">;
  state: Pick<StartClockState, "status" | "confirmedByPerson" | "heldConfirmation">;
  steps: () => number;
  monotonic: () => number;
  log: Logger;
}): () => Promise<void> {
  let askedAtMs: number | undefined;
  let restarts = 0;
  let lastFailure: string | undefined;

  return async () => {
    const retry = deps.host.retryTimeService;
    if (retry === undefined) return;
    if (deps.state.status !== "waiting" || deps.state.heldConfirmation !== null) return;
    if (deps.state.confirmedByPerson || deps.steps() > 0) return;
    const nowMs = deps.monotonic();
    if (!Number.isFinite(nowMs)) return;
    if (askedAtMs !== undefined && !(nowMs - askedAtMs >= RETRY_SPACING_MS)) return;
    askedAtMs = nowMs;
    let answer: TimeServiceOnAnswer;
    try {
      answer = await retry.call(deps.host);
    } catch {
      answer = { available: false, reason: "lost" };
    }
    if (answer.available) {
      lastFailure = undefined;
      restarts++;
      if (restarts === 1 || restarts % LOG_EVERY === 0) {
        deps.log("info", "time_service.restarted", { count: restarts });
      }
      return;
    }
    const fields = {
      reason: answer.reason,
      ...(answer.refusal === undefined ? {} : { refusal: answer.refusal }),
      ...(answer.detail === undefined ? {} : { detail: answer.detail }),
    };
    const failure = JSON.stringify(fields);
    if (failure !== lastFailure) deps.log("warn", "time_service.restart_failed", fields);
    lastFailure = failure;
  };
}
