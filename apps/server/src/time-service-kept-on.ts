import type { BoxHostClient, TimeServiceOnAnswer } from "./box-host-client.js";
import type { Logger } from "./logger.js";

/**
 * A box host whose `clockStatus()` switches the host's automatic time back on whenever it reads it
 * as switched off, then answers the reading as it was. A failure is warned once, and again only
 * after a success or a different failure, so a host that cannot do it does not warn at every read.
 */
export function keepTimeServiceOn(host: BoxHostClient, log: Logger): BoxHostClient {
  let switching: Promise<void> | undefined;
  let lastFailure: string | undefined;

  const switchOn = async (timeServiceOn: NonNullable<BoxHostClient["timeServiceOn"]>) => {
    const answer = await timeServiceOn
      .call(host)
      .catch((): TimeServiceOnAnswer => ({ available: false, reason: "lost" }));
    if (answer.available) {
      lastFailure = undefined;
      log("info", "time_service.switched_on");
      return;
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
      if (status.available && status.service === "off" && timeServiceOn !== undefined) {
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
