import type { AlertSource } from "@waitron/module";
import type { ClockWitnessStore } from "./clock-witnesses.js";
import { startClockAgreed, type StartClockState } from "./start-clock-check.js";

export interface StartClockWaiting {
  agreed: number;
  hostAnswers: boolean;
}

/** Null unless this box files records and its start check waits. */
export function startClockWaiting(deps: {
  state: Pick<StartClockState, "unconfirmed" | "hostAnswers">;
  filesRecords: () => boolean;
  witnesses: Pick<ClockWitnessStore, "witnesses">;
}): StartClockWaiting | null {
  if (!deps.filesRecords() || !deps.state.unconfirmed()) return null;
  return {
    agreed: startClockAgreed(deps.witnesses.witnesses()),
    hostAnswers: deps.state.hostAnswers,
  };
}

export function clockUnconfirmedAlertSource(waiting: () => StartClockWaiting | null): AlertSource {
  return {
    area: "box",
    permission: "system.manage",
    read() {
      const now = waiting();
      if (now === null) return Promise.resolve([]);
      return Promise.resolve([
        {
          key: "clock.unconfirmed",
          code: "clock.unconfirmed",
          severity: "error",
          since: null,
          screen: "box-status",
          params: { agreed: now.agreed, hostSilent: !now.hostAnswers },
        },
      ]);
    },
  };
}
