import type { Database, NodeDatabase } from "@waitron/db";
import { READY_TO_PROMOTE, readHandoverActivation } from "@waitron/handover";
import { readNodeMode, readOpenHandoverOperation } from "@waitron/node-db";
import { advanceHandover } from "./handover-store.js";

/**
 * Finishes a destination's activation whose venue save committed and whose `node.db` record was
 * lost. It takes the save as committed from a `handover_activations` row that names this operation,
 * its scenario, its source and this box as destination; with no such row it records nothing.
 */
export async function finishInterruptedActivation(deps: {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
}): Promise<void> {
  const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
  if (open === null || open.role !== "destination") return;
  if (!READY_TO_PROMOTE.includes(open.state)) return;
  if ((await readNodeMode(deps.node, deps.nodeId)).mode === "mirror") return;
  const row = await readHandoverActivation(deps.db, open.operationId);
  if (
    row === null ||
    row.scenario !== open.scenario ||
    row.sourceNodeId !== open.sourceNodeId ||
    row.destinationNodeId !== open.destinationNodeId ||
    row.destinationNodeId !== deps.nodeId
  )
    return;
  await advanceHandover(deps, open.operationId, "activated", {});
}
