import type { NodeDatabase } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";

interface Turn {
  promotions: number;
  offersBeingRecorded: string[];
}

// By handle, so every route of one running box shares a turn and no route can be wired without it.
const turns = new WeakMap<NodeDatabase, Turn>();

function turnOf(node: NodeDatabase): Turn {
  const existing = turns.get(node);
  if (existing !== undefined) return existing;
  const created: Turn = { promotions: 0, offersBeingRecorded: [] };
  turns.set(node, created);
  return created;
}

/** Checks and records an offer unless an ordinary promotion of this box is running. */
export async function recordOfferInTurn<T>(
  node: NodeDatabase,
  operationId: string,
  checkAndRecord: () => Promise<T>,
): Promise<T> {
  const turn = turnOf(node);
  if (turn.promotions > 0) throw new AppError("handover.promotion_running", {});
  turn.offersBeingRecorded.push(operationId);
  try {
    return await checkAndRecord();
  } finally {
    turn.offersBeingRecorded.splice(turn.offersBeingRecorded.indexOf(operationId), 1);
  }
}

export interface PromotionTurn {
  /** From here until `release`, an offer is refused. */
  claim(): void;
  /** Does nothing unless `claim` succeeded, so a route can always call it. */
  release(): void;
}

/**
 * One promote request's hold. `claim` answers at once rather than waiting for an offer to finish:
 * it runs inside the sign-in's venue.db transaction, and the offer it would wait for needs node.db's
 * write lock, which other code holds while it waits for venue.db's (`withRecoveryKeyAuthority`).
 */
export function promotionTurn(node: NodeDatabase): PromotionTurn {
  const turn = turnOf(node);
  let held = false;
  return {
    claim() {
      if (held) return;
      const [operationId] = turn.offersBeingRecorded;
      if (operationId !== undefined) {
        throw new AppError("handover.operation_in_progress", { operationId });
      }
      turn.promotions += 1;
      held = true;
    },
    release() {
      if (!held) return;
      held = false;
      turn.promotions -= 1;
    },
  };
}
