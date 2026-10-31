import type { AlertSource } from "@waitron/module";
import type { ClockServiceStatus } from "./box-host-client.js";
import type { ErrorParams } from "@waitron/shared";
import "./errors.js";

type Reason = ErrorParams["clock.sync_off"]["reason"];

/** Raised while the box's time service is off, stopped or not synchronised, and, in production
 * only, while the box's clock service does not answer. */
export function clockSyncAlertSource(deps: {
  status: () => Promise<ClockServiceStatus>;
  production: boolean;
}): AlertSource {
  return {
    area: "box",
    permission: "system.manage",
    async read() {
      const status = await deps.status();
      let reason: Reason | null;
      if (!status.available) reason = deps.production ? "unreachable" : null;
      else if (status.service !== "on") reason = status.service;
      else reason = status.synchronised ? null : "unsynchronised";
      if (reason === null) return [];
      return [
        {
          key: "clock.sync_off",
          code: "clock.sync_off",
          severity: "warning",
          since: null,
          screen: "box-status",
          params: { reason },
        },
      ];
    },
  };
}
