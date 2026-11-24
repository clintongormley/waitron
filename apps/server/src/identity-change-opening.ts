import type { Transaction } from "@waitron/db";
import type { FiscalBackend, IdentityChangeNote } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import { isAppError, type NodeId } from "@waitron/shared";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";
import type { StartClockState } from "./start-clock-check.js";

/** `clock` takes the held confirmation back; `retry` passes by itself; `blocked` is anything else. */
export interface IdentityChangeRefusal {
  readonly kind: "clock" | "retry" | "blocked";
  readonly reason: string;
}

/** `sif.identity_change_waiting`'s reasons that mean the clock: `clockRefusal`'s answers in the
 * fiscal module, and what that module's opening finds of the confirmation and the clock since. */
const CLOCK_REASONS: ReadonlySet<string> = new Set([
  "clock_unconfirmed",
  "second_clock_missing",
  "clock_disagreement",
  "confirmation_stale",
  "clock_corrected",
]);
const RETRY_REASONS: ReadonlySet<string> = new Set(["head_moved", "minute_in_use"]);

function refusalOf(error: unknown): IdentityChangeRefusal {
  if (!isAppError(error) || error.code !== "sif.identity_change_waiting")
    return { kind: "blocked", reason: errnoOf(error) ?? codeOf(error) };
  const { reason } = error.params as { reason: string };
  if (CLOCK_REASONS.has(reason)) return { kind: "clock", reason };
  return { kind: RETRY_REASONS.has(reason) ? "retry" : "blocked", reason };
}

interface NoteDeps {
  readonly backend: Pick<FiscalBackend, "openIdentityChange">;
  readonly nodeId: NodeId;
  readonly note: IdentityChangeNote;
  readonly deleteNote: () => Promise<void>;
  readonly log: Logger;
}

async function deleteNote(deps: Pick<NoteDeps, "deleteNote" | "log">): Promise<boolean> {
  try {
    await deps.deleteNote();
    return true;
  } catch (error) {
    deps.log("warn", "identity_change.note_not_deleted", {
      errorCode: errnoOf(error) ?? codeOf(error),
    });
    return false;
  }
}

/** Opens the installation a note names once a confirmation of the box's time is held. */
export function identityChangeOpening(
  deps: NoteDeps & {
    readonly state: StartClockState;
    /** Asks the box's time service itself at each call. */
    readonly synchronised: () => Promise<boolean>;
    readonly mayOpen: (tx: Transaction) => Promise<boolean>;
  },
): {
  /** Never throws. Called in the clock correction's turn, never inside a transaction. */
  attemptIdentityChange(): Promise<void>;
  latestRefusal(): IdentityChangeRefusal | null;
} {
  let latest: IdentityChangeRefusal | null = null;

  function refuse(refusal: IdentityChangeRefusal): void {
    latest = refusal;
    if (refusal.kind === "clock") deps.state.dropHeldConfirmation();
    deps.log("warn", "identity_change.refused", { ...refusal });
  }

  return {
    latestRefusal: () => latest,
    async attemptIdentityChange() {
      if (deps.state.heldConfirmation === null) return;
      try {
        const outcome = await deps.backend.openIdentityChange?.(
          deps.nodeId,
          deps.note,
          { kind: "time-service", read: deps.synchronised },
          deps.mayOpen,
        );
        if (outcome === undefined || outcome === "not-named") {
          refuse({ kind: "blocked", reason: "not_named" });
          return;
        }
        latest = null;
        deps.log("info", "identity_change.done", { outcome, release: deps.note.release });
        await deleteNote(deps);
        deps.state.releaseIdentityChange();
      } catch (error) {
        refuse(refusalOf(error));
      }
    },
  };
}

/** Deletes the note of a change that has nothing left to open, as after a stop between the opening
 * and the note's deletion. It can open nothing: its clock vouches for nothing and its `mayOpen`
 * refuses. Never throws. */
export async function deleteLeftoverIdentityChangeNote(deps: NoteDeps): Promise<void> {
  try {
    const outcome = await deps.backend.openIdentityChange?.(
      deps.nodeId,
      deps.note,
      { kind: "time-service", read: async () => false },
      async () => false,
    );
    if (outcome !== "nothing-to-open") return;
  } catch (error) {
    deps.log("warn", "identity_change.note_not_deleted", { errorCode: codeOf(error) });
    return;
  }
  if (await deleteNote(deps))
    deps.log("info", "identity_change.leftover_note_deleted", { release: deps.note.release });
}
