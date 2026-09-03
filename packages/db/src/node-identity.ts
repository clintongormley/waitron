import { eq } from "drizzle-orm";
import type { TrustSet } from "@waitron/membership";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "./client.js";
import { nodes } from "./schema/nodes.js";
import { withTenant } from "./tenancy.js";

/**
 * Stamp a node's membership identity PUBLIC key (design §4) on the owner connection. `nodes` is
 * FORCE-RLS, so this runs under `withTenant` with the tenant GUC set — the owner is subject to the
 * policy too. app_user holds no UPDATE on `nodes` (setNodePublicKey is owner-role, like the provision
 * writes it sits beside). The PRIVATE half is sealed in the vault (apps/server/node-identity.ts).
 *
 * No-op-safe on a non-matching id (0 rows updated): the provision path is the only caller and it
 * passes a just-minted id, so a 0-row update would be a bug — but this accessor does not assert it,
 * because the id is fresh by construction and a guard here would only add a read the caller does not
 * need.
 */
export function setNodePublicKey(
  db: Database,
  tenantId: string,
  nodeId: string,
  publicKey: string,
): Promise<void> {
  const tenant = brandTenantId(tenantId);
  return withTenant(db, tenant, async (tx) => {
    await tx.update(nodes).set({ publicKey }).where(eq(nodes.id, nodeId));
  });
}

/**
 * The node's membership trust anchors (design §4): every `nodes` row's `{ id → public_key }`, skipping
 * the keyless ones (bare fixtures, a not-yet-stamped node). Read as the app role under `withTenant`
 * (app_user holds SELECT on `nodes`). Boot reads this into `membershipTrustSet`: a fresh primary gets
 * `{ self }`; a cloud mirror gets `{ primary }` from the node row `adoptVenue` replicated.
 */
export function readMembershipTrustSet(db: Database, tenantId: string): Promise<TrustSet> {
  const tenant = brandTenantId(tenantId);
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx.select({ id: nodes.id, publicKey: nodes.publicKey }).from(nodes);
    const trust: Record<string, string> = {};
    for (const r of rows) if (r.publicKey !== null) trust[r.id] = r.publicKey;
    return trust;
  });
}
