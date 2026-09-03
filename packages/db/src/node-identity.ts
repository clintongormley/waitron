import { eq } from "drizzle-orm";
import type { TrustSet } from "@waitron/membership";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { nodes } from "./schema/nodes.js";
import { withTenant } from "./tenancy.js";

/**
 * Stamp a node's membership identity PUBLIC key (design §4) on a caller-provided transaction whose
 * tenant GUC is already set. Factored from `setNodePublicKey` so a caller that must stamp atomically
 * WITH another write shares one transaction rather than opening a second: `establishNodeIdentity`
 * seals the matching private key and calls this in the SAME `withTenant`, so the private/public pair
 * lands together or not at all (CLAUDE.md §3 — `withTenant` IS that transaction; a write-path helper
 * takes a `tx`). `nodes` is FORCE-RLS, so the tx must carry the tenant GUC (its `withTenant` sets it),
 * and the connection's role must hold UPDATE on `nodes` — owner-role, since app_user holds none.
 *
 * No-op-safe on a non-matching id (0 rows updated): callers pass a just-minted id, so a 0-row update
 * would be a bug — but this accessor does not assert it, because the id is fresh by construction and a
 * guard here would only add a read the caller does not need.
 */
export async function setNodePublicKeyTx(
  tx: Transaction,
  nodeId: string,
  publicKey: string,
): Promise<void> {
  await tx.update(nodes).set({ publicKey }).where(eq(nodes.id, nodeId));
}

/**
 * Stamp a node's membership identity PUBLIC key on the owner connection, opening its own tenant
 * transaction (design §4). The standalone form, for a lone stamp (a test seeding a source node; the
 * adopt proof); a caller that must stamp atomically alongside another write uses `setNodePublicKeyTx`
 * inside one shared `withTenant` instead. Owner-role, per `setNodePublicKeyTx`.
 */
export function setNodePublicKey(
  db: Database,
  tenantId: string,
  nodeId: string,
  publicKey: string,
): Promise<void> {
  return withTenant(db, brandTenantId(tenantId), (tx) => setNodePublicKeyTx(tx, nodeId, publicKey));
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
