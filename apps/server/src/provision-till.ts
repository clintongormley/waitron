// The STANDALONE node-provisioning path: a node with no fiscal identity, or a reimaged one getting a
// fresh chain. `waitron-provision venue` covers a fresh venue, seeding its first node as it stands
// the venue up. `scripts/register-till.ts` is the argv/stdout shim over this module.
import { eq } from "drizzle-orm";
import { nodes, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { SeedReport, WaitronModule } from "@waitron/module";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { NodeId, TenantId } from "@waitron/shared";
import "./errors.js";

export interface ProvisionNodeParams {
  tenantId: TenantId;
  nodeId: NodeId;
}

/**
 * Returns an existing node's location, throwing `node.not_found` when the id matches no node. One
 * tenant per database, so the id alone names the node.
 */
async function nodeLocation(tx: Transaction, nodeId: NodeId): Promise<string> {
  const [row] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, nodeId));
  if (row === undefined) throw new AppError("node.not_found", { id: nodeId });
  return row.locationId;
}

/**
 * Runs every module's per-node seed for an EXISTING node — a node with no fiscal identity yet, or a
 * reimaged one: the fiscal seed mints a fresh installation number and starts a new chain, which is
 * what a reimaged node needs. One transaction; the caller decides whether re-running is wanted.
 */
export async function provisionNode(
  db: Database,
  params: ProvisionNodeParams,
  modules: readonly WaitronModule[],
): Promise<readonly SeedReport[]> {
  return withTransaction(db, async (tx) => {
    const locationId = await nodeLocation(tx, params.nodeId);
    const node = {
      tenantId: params.tenantId,
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
