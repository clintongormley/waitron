import { readNodeMembership, type Transaction } from "@waitron/db";
import type {
  FiscalBackend,
  IdentityChangeNote,
  IdentityChangeRefusalReason,
} from "@waitron/fiscal";
import { servingPrimaryNodeId } from "@waitron/membership";
import { codeOf } from "@waitron/server-kit";
import { firstCodeInCauseChain, isAppError, type NodeId } from "@waitron/shared";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";
import type { StartClockState } from "./start-clock-check.js";

/** `clock` takes the held confirmation back; `retry` passes by itself; `blocked` is anything else. */
type RefusalKind = "clock" | "retry" | "blocked";

export interface IdentityChangeRefusal {
  readonly kind: RefusalKind;
  readonly reason: string;
}

const REFUSAL_KINDS: Readonly<Record<IdentityChangeRefusalReason, RefusalKind>> = {
  clock_unconfirmed: "clock",
  second_clock_missing: "clock",
  clock_disagreement: "clock",
  confirmation_stale: "clock",
  clock_corrected: "clock",
  head_moved: "retry",
  minute_in_use: "retry",
  history_invalid: "blocked",
  not_sole_primary: "blocked",
};

/** An error other than the opening's own refusal is logged by its class and code, never its text,
 * which may hold a record's. */
function refusalOf(error: unknown): {
  refusal: IdentityChangeRefusal;
  logged?: { errorClass: string; errno: string | null };
} {
  if (isAppError(error) && error.code === "sif.identity_change_waiting") {
    const { reason } = error.params as { reason: string };
    const kinds: Readonly<Record<string, RefusalKind | undefined>> = REFUSAL_KINDS;
    return { refusal: { kind: kinds[reason] ?? "blocked", reason } };
  }
  return {
    refusal: { kind: "blocked", reason: errnoOf(error) ?? codeOf(error) },
    logged: {
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      errno: firstCodeInCauseChain(error, (code) => /^[A-Z][A-Z0-9_]*$/.test(code)),
    },
  };
}

interface NoteDeps {
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

/** Whether the saved chart names this box the venue's serving primary and lists no other box that
 * has not been evicted. A box that holds no chart does not serve alone. */
export async function servesAlone(tx: Transaction, nodeId: NodeId): Promise<boolean> {
  const held = await readNodeMembership(tx);
  if (held === null || servingPrimaryNodeId(held) !== nodeId) return false;
  return held.body.nodes.filter(({ standing }) => standing !== "evicted").length === 1;
}

/** Opens the installation a note names once a confirmation of the box's time is held. */
export function identityChangeOpening(
  deps: NoteDeps & {
    readonly backend: Pick<FiscalBackend, "openIdentityChange">;
    readonly nodeId: NodeId;
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
  let lastLogged: string | undefined;

  function refuse({ refusal, logged }: ReturnType<typeof refusalOf>): void {
    latest = refusal;
    if (refusal.kind === "clock") deps.state.dropHeldConfirmation();
    const fields = { ...refusal, ...logged };
    const failure = JSON.stringify(fields);
    if (failure !== lastLogged) deps.log("warn", "identity_change.refused", fields);
    lastLogged = failure;
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
          refuse({ refusal: { kind: "blocked", reason: "not_named" } });
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
 * and the note's deletion. Never throws. */
export async function deleteLeftoverIdentityChangeNote(deps: NoteDeps): Promise<void> {
  if (await deleteNote(deps))
    deps.log("info", "identity_change.leftover_note_deleted", { release: deps.note.release });
}
