import type { Transaction } from "@waitron/db";
import type { ClockWitness, FiscalBackend, TrustedReading } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";

export interface ClockStartUp {
  /** True until a reader of the stop sees none holding; never true again in this process. Created
   * closed on a node that is not the primary at its start. */
  open(): boolean;
  noStop(): void;
  authorityAsked(answered: boolean): void;
  /** `canAskAuthority`: the box files records and the seat reads AEAT's time. */
  tillMayOffer(input: { stopped: boolean; unusable: boolean; canAskAuthority: boolean }): boolean;
  /** For the till route's staff branch: `not_start_up` once closed; `authority_pending` while AEAT
   * is not asked and the box can ask; null otherwise, `answered` included. */
  admit(input: {
    unusable: boolean;
    canAskAuthority: boolean;
  }): "not_start_up" | "authority_pending" | null;
}

/** This server process's start-up window and what AEAT has said during it (plan decision 14). */
export function clockStartUp(input: { primaryAtStart: boolean }): ClockStartUp {
  let open = input.primaryAtStart;
  let authority: "not_asked" | "unanswered" | "answered" = "not_asked";
  return {
    open: () => open,
    noStop: () => {
      open = false;
    },
    authorityAsked: (answered) => {
      if (answered) authority = "answered";
      else if (authority === "not_asked") authority = "unanswered";
    },
    tillMayOffer: ({ stopped, unusable, canAskAuthority }) =>
      open && (stopped || unusable) && (unusable || !canAskAuthority || authority === "unanswered"),
    admit: ({ unusable, canAskAuthority }) => {
      if (!open) return "not_start_up";
      if (authority === "not_asked" && canAskAuthority && !unusable) return "authority_pending";
      return null;
    },
  };
}

/** The tills' notice source's check: whether to offer "Check the time" at this reading. A read
 * that sees no stop holding closes the window. */
export function tillClockCheck(deps: {
  startUp: Pick<ClockStartUp, "open" | "noStop" | "tillMayOffer">;
  backend: Pick<FiscalBackend, "assertRecordableAt" | "clockStopState" | "readAuthorityTime">;
  witnesses: () => readonly ClockWitness[];
  filesRecords: () => boolean;
}): (
  tx: Transaction,
  reading: Pick<TrustedReading, "instant" | "offsetMinutes">,
) => Promise<boolean> {
  return async (tx, reading) => {
    if (!deps.startUp.open()) return false;
    const witnesses = deps.witnesses();
    const state =
      deps.backend.clockStopState === undefined
        ? null
        : await deps.backend.clockStopState(tx, reading, witnesses);
    let unusable = false;
    if (state === null) {
      try {
        deps.backend.assertRecordableAt(reading);
      } catch (error) {
        if (codeOf(error) !== "clock.unusable") throw error;
        unusable = true;
      }
    }
    if ((state === null && !unusable) || state?.proof === "confirmed") {
      deps.startUp.noStop();
      return false;
    }
    return deps.startUp.tillMayOffer({
      stopped: state !== null,
      unusable,
      canAskAuthority: deps.filesRecords() && deps.backend.readAuthorityTime !== undefined,
    });
  };
}
