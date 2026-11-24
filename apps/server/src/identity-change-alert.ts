import type { AlertSource } from "@waitron/module";
import type { IdentityChangeRefusal } from "./identity-change-opening.js";
import type { StartClockState } from "./start-clock-check.js";
import "./errors.js";

/** Whether a new fiscal installation waits for something other than the box's time: its time is
 * confirmed, and the opening's latest refusal does not pass by itself. */
export function identityChangeBlocked(deps: {
  state: Pick<StartClockState, "heldConfirmation">;
  latestRefusal: () => IdentityChangeRefusal | null;
}): boolean {
  return deps.state.heldConfirmation !== null && deps.latestRefusal()?.kind === "blocked";
}

export function identityChangeBlockedAlertSource(blocked: () => boolean): AlertSource {
  return {
    area: "box",
    permission: "system.manage",
    read() {
      if (!blocked()) return Promise.resolve([]);
      return Promise.resolve([
        {
          key: "sif.identity_change_blocked",
          code: "sif.identity_change_blocked",
          severity: "error",
          since: null,
          screen: "box-status",
          params: {},
        },
      ]);
    },
  };
}
