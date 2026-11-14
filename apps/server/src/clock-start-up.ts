import type { Transaction } from "@waitron/db";
import type { FiscalBackend, TrustedReading } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import type { StartClockState } from "./start-clock-check.js";

export interface ClockStartUp {
  /** True until a reader sees a reading a record could carry; never true again in this process.
   * Created closed on a node that is not the primary at its start. */
  open(): boolean;
  noStop(): void;
  /** For the till route's staff branch: `not_start_up` once closed, otherwise null. */
  admit(): "not_start_up" | null;
}

/** This server process's start-up window (plan decision 14). */
export function clockStartUp(input: { primaryAtStart: boolean }): ClockStartUp {
  let open = input.primaryAtStart;
  return {
    open: () => open,
    noStop: () => {
      open = false;
    },
    admit: () => (open ? null : "not_start_up"),
  };
}

/** The tills' notice source's check: whether to offer "Check the time" at this reading. While the
 * start check waits on a box that files records it is offered whatever the window says (plan
 * A1420 D1); otherwise only during the window at a reading no record could carry, and a read at a
 * reading a record could carry closes the window. */
export function tillClockCheck(deps: {
  startUp: Pick<ClockStartUp, "open" | "noStop">;
  backend: Pick<FiscalBackend, "assertRecordableAt">;
  filesRecords: () => boolean;
  start?: Pick<StartClockState, "status">;
}): (
  tx: Transaction,
  reading: Pick<TrustedReading, "instant" | "offsetMinutes">,
) => Promise<boolean> {
  return async (_tx, reading) => {
    if (deps.start?.status === "waiting" && deps.filesRecords()) return true;
    if (!deps.startUp.open()) return false;
    try {
      deps.backend.assertRecordableAt(reading);
    } catch (error) {
      if (codeOf(error) !== "clock.unusable") throw error;
      return true;
    }
    deps.startUp.noStop();
    return false;
  };
}
