import { and, eq } from "drizzle-orm";
import type { Endorsement } from "@waitron/membership";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import "./errors.js";
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
  await tx.insert(nodes).values(node);
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
  await tx.insert(invoiceSeries).values([...series]);
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
      // `nodes` is FORCE-RLS and this read runs inside `withTenant`, so the tenant GUC policy already
      // scopes it — no `eq(nodes.tenantId, …)` needed (matches sibling `readMembershipTrustSet`).
      .where(eq(nodes.id, nodeId))
      .limit(1);
    return row?.endorsement ?? null;
  });
}

/**
 * The id of a node's standard-purpose invoice series, read under `withTenant` (invoice_series is
 * FORCE-RLS; rides app_user's SELECT, like `readNodeEndorsement`). R3b's mirror→primary promote reads
 * the cloud's OWN reserved standard series here and points `config.till.seriesId` at it, so the promoted
 * cloud numbers under its disjoint `<primaryCode>-<numeroInstalacion>` series, never the primary's.
 * Throws `series.no_standard_for_node` rather than returning null — every caller needs one.
 *
 * Selects WITHOUT `limit(1)` and fails LOUD on more than one row rather than picking one silently:
 * nothing enforces one standard series per node — the natural key is `(tenant_id, node_id, code)`, NOT
 * `(…, purpose)` (`schema/series.ts`) — so two standard series would make the promoted cloud's
 * `NumSerieFactura` non-deterministic, a fiscal hazard. Unreachable today (R2's `insertReservedSeriesTx`
 * mints exactly one standard series per node), so this is a can't-happen data-integrity invariant, the
 * same shape and `v8 ignore` as `writeReservedSif`'s "insert returned no row" guard.
 */
export function readStandardSeriesId(
  db: Database,
  tenantId: string,
  nodeId: string,
): Promise<string> {
  return withTenant(db, brandTenantId(tenantId), async (tx) => {
    const rows = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, nodeId), eq(invoiceSeries.purpose, "standard")));
    const [row, extra] = rows;
    if (row === undefined) {
      throw new AppError("series.no_standard_for_node", { tenantId, nodeId });
    }
    /* v8 ignore start */
    if (extra !== undefined) {
      throw new Error(`invoice_series: node ${nodeId} has more than one standard series`);
    }
    /* v8 ignore stop */
    return row.id;
  });
}
