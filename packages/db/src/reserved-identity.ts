import { and, eq } from "drizzle-orm";
import type { Endorsement } from "@waitron/membership";
import { tenantId as brandTenantId } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { nodes } from "./schema/nodes.js";
import { invoiceSeries } from "./schema/series.js";
import { withTenant } from "./tenancy.js";

export interface ReservedNodeInput {
  id: string; // the standby's own nodeId
  tenantId: string;
  locationId: string;
  name: string;
  filingModule: string | null;
  taxModule: string | null;
  publicKey: string; // base64 SPKI
  endorsement: Endorsement;
}

/**
 * Insert the standby's OWN dormant node row (design §6 R2): its distinct nodeId, its public key, and
 * the primary's endorsement of that key, all in one INSERT so public_key and endorsement land together.
 * Owner-role: `nodes` grants app_user SELECT only (`0017_nodes_rls.sql`), so these writes need the
 * owner (adopt already runs on ownerDb). Caller supplies a `withTenant` tx so this commits with the
 * reserved SIF + sealed key in one transaction (CLAUDE.md §3 — a write-path helper takes a `tx`).
 */
export async function insertReservedNodeTx(
  tx: Transaction,
  node: ReservedNodeInput,
): Promise<void> {
  await tx.insert(nodes).values({
    id: node.id,
    tenantId: node.tenantId,
    locationId: node.locationId,
    name: node.name,
    filingModule: node.filingModule,
    taxModule: node.taxModule,
    publicKey: node.publicKey,
    endorsement: node.endorsement,
  });
}

export interface ReservedSeriesInput {
  tenantId: string;
  nodeId: string;
  code: string;
  purpose: string; // "standard" | "rectificative"
}

/**
 * Insert the standby's reserved invoice series (next_number defaults to 1). Owner-role under the
 * caller's tenant tx, alongside the reserved node + SIF (see `insertReservedNodeTx`). A no-op on an
 * empty list rather than emitting an INSERT with no rows.
 */
export async function insertReservedSeriesTx(
  tx: Transaction,
  series: readonly ReservedSeriesInput[],
): Promise<void> {
  if (series.length === 0) return;
  await tx.insert(invoiceSeries).values(
    series.map((s) => ({
      tenantId: s.tenantId,
      nodeId: s.nodeId,
      code: s.code,
      purpose: s.purpose,
    })),
  );
}

/**
 * The endorsement stored on a node's row, or null for a node that carries none (a self-trusted
 * primary). The R3 promote-signer reads it to attach to the membership document it mints. Read under
 * `withTenant`, mirroring `readMembershipTrustSet` (its sibling reader of `nodes`): `nodes` is
 * FORCE-RLS, so the read must carry the tenant GUC and rides app_user's SELECT.
 */
export function readNodeEndorsement(
  db: Database,
  tenantId: string,
  nodeId: string,
): Promise<Endorsement | null> {
  return withTenant(db, brandTenantId(tenantId), async (tx) => {
    const [row] = await tx
      .select({ endorsement: nodes.endorsement })
      .from(nodes)
      .where(and(eq(nodes.tenantId, tenantId), eq(nodes.id, nodeId)))
      .limit(1);
    return row?.endorsement ?? null;
  });
}
