// `scripts/register-till.ts` is the argv/stdout shim over this module.
import { eq } from "drizzle-orm";
import { nodes, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { SeedReport, WaitronModule } from "@waitron/module";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import "./errors.js";

export interface ProvisionNodeParams {
  nodeId: NodeId;
}

async function nodeLocation(tx: Transaction, nodeId: NodeId): Promise<string> {
  const [row] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, nodeId));
  if (row === undefined) throw new AppError("node.not_found", { id: nodeId });
  return row.locationId;
}

/**
 * Runs every module's per-node seed for an EXISTING node. The fiscal seed mints a fresh installation
 * number and starts a new chain — right for a reimaged node, destructive for a working one, so the
 * caller decides whether re-running is wanted.
 */
export async function provisionNode(
  db: Database,
  params: ProvisionNodeParams,
  modules: readonly WaitronModule[],
): Promise<readonly SeedReport[]> {
  return withTransaction(db, async (tx) => {
    const locationId = await nodeLocation(tx, params.nodeId);
    const node = {
      locationId: brandLocationId(locationId),
      nodeId: params.nodeId,
    };
    const seeded: SeedReport[] = [];
    for (const m of modules) {
      if (m.provisioning?.seed === undefined) continue;
      seeded.push({ module: m.name, report: await m.provisioning.seed.run(tx, node) });
    }
    return seeded;
  });
}
