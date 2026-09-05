// The STANDALONE node-provisioning path: a node with no fiscal identity, or a reimaged one getting a
// fresh chain. `waitron-provision venue` covers a fresh venue, seeding its first node as it stands
// the venue up. `scripts/register-till.ts` is the argv/stdout shim over this module.
import { and, eq } from "drizzle-orm";
import { nodes, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { NodeId, TenantId } from "@waitron/shared";
import "./errors.js";

export interface ProvisionNodeParams {
  tenantId: TenantId;
  nodeId: NodeId;
}

/**
 * Refuses a node this tenant does not own, and returns its location. `registro_sif` carries separate
 * foreign keys onto `tenants` and `nodes` and no composite one, so a row naming tenant A and a node of
 * tenant B satisfies both — and RLS's WITH CHECK only constrains `tenant_id`. Matching on
 * `nodes.tenant_id` explicitly is what makes this hold for a superuser too.
 */
async function ownedNodeLocation(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<string> {
  const [row] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.tenantId, tenantId)));
  if (row === undefined) throw new AppError("node.not_found", { id: nodeId, tenantId });
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
): Promise<{ module: string; report: string }[]> {
  return withTenant(db, params.tenantId, async (tx) => {
    const locationId = await ownedNodeLocation(tx, params.tenantId, params.nodeId);
    const node = {
      tenantId: params.tenantId,
      locationId: brandLocationId(locationId),
      nodeId: params.nodeId,
    };
    const seeded: { module: string; report: string }[] = [];
    for (const m of modules) {
      if (m.provisioning?.seed === undefined) continue;
      seeded.push({ module: m.name, report: await m.provisioning.seed.run(tx, node) });
    }
    return seeded;
  });
}
