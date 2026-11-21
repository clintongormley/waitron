import "./errors.js";
import {
  recordActivity,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { readOpenHandoverOperation, type HandoverOperation } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { advanceHandoverTx } from "./handover-store.js";
import { returnDigest } from "./return-records.js";

/** A takeover by this box still waiting for its old main box to return its records. */
export function awaitsReturn(open: HandoverOperation | null): open is HandoverOperation {
  return (
    open !== null &&
    open.role === "destination" &&
    (open.state === "activated" || open.state === "return_pending")
  );
}

export function refuseReturnOutstanding(open: HandoverOperation): never {
  throw new AppError("handover.return_outstanding", {
    operationId: open.operationId,
    sourceNodeId: open.sourceNodeId,
  });
}

/**
 * Closes this box's takeover from `sourceNodeId` as `return_abandoned`. The activity entry commits
 * in venue.db first, inside node.db's write lock; a failure after it leaves the operation open.
 */
export async function abandonReturn(
  deps: { readonly db: Database; readonly node: NodeDatabase; readonly nodeId: string },
  args: { readonly sourceNodeId: string; readonly personId: string },
): Promise<{ operationId: string; state: "return_abandoned" }> {
  return withNodeTransaction(deps.node, async (nodeTx) => {
    const open = await readOpenHandoverOperation(nodeTx, deps.nodeId);
    if (!awaitsReturn(open) || open.sourceNodeId !== args.sourceNodeId) {
      throw new AppError("handover.return_not_outstanding", { sourceNodeId: args.sourceNodeId });
    }
    const { operationId } = open;
    await withTransaction(deps.db, (tx) =>
      recordActivity(tx, {
        id: returnDigest({ kind: "handover.return_abandoned", operationId }),
        kind: "handover.return_abandoned",
        subjectId: args.sourceNodeId,
        personId: args.personId,
        data: { operationId, sourceNodeId: args.sourceNodeId },
      }),
    );
    if (open.state === "activated") {
      await advanceHandoverTx(nodeTx, deps.nodeId, operationId, "return_pending", {});
    }
    await advanceHandoverTx(nodeTx, deps.nodeId, operationId, "return_abandoned", {});
    return { operationId, state: "return_abandoned" };
  });
}
