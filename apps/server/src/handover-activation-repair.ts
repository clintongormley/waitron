import type { Database, NodeDatabase } from "@waitron/db";
import { readHandoverActivation } from "@waitron/handover";
import { readNodeMode, readOpenHandoverOperation } from "@waitron/node-db";
import { advanceHandover } from "./handover-store.js";

/**
 * Finishes a destination's activation whose venue save committed and whose `node.db` record was
 * lost. The row alone says it committed: the activation writes it in the transaction that writes the
 * chart (`handover-activation.ts`), so a box made primary some other way is never recorded.
 */
export async function finishInterruptedActivation(deps: {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
}): Promise<void> {
  const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
  if (open === null || open.role !== "destination") return;
  if (open.state !== "filing_assumed" && open.state !== "emergency_declared") return;
  if ((await readNodeMode(deps.node, deps.nodeId)).mode === "mirror") return;
  if ((await readHandoverActivation(deps.db, open.operationId)) === null) return;
  await advanceHandover(deps, open.operationId, "activated", {});
}
