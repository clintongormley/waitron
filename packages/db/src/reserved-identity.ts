import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
 * Owner-role: `nodes` grants app_user SELECT only (`drizzle/0001_db_baseline_sql.sql`), so these writes need the
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
 * Returns the node's endorsement, or null when the row or endorsement is absent.
 * A provisioned primary with no endorsement trusts its own key; mirror promotion includes a
 * stored endorsement when signing its new membership document.
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
      .where(eq(nodes.id, nodeId))
      .limit(1);
    return row?.endorsement ?? null;
  });
}

/**
 * The id of a node's LIVE standard-purpose invoice series, inside the caller's tenant transaction.
 * Reads only `retired_at IS NULL` rows — a retired series is history, never the one to number from.
 * Caps the read at TWO rows and fails LOUD on a second live standard series rather than picking one
 * silently: nothing enforces one standard series per node (the natural key is `(tenant_id, node_id,
 * code)`, not purpose), and two would make the invoice number non-deterministic. Reachable only by a
 * corrupt write; a plain `Error`, not a code, because it is a programming-level invariant.
 */
export async function readStandardSeriesIdTx(
  tx: Transaction,
  tenantId: string,
  nodeId: string,
): Promise<string> {
  const rows = await tx
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.tenantId, tenantId),
        eq(invoiceSeries.nodeId, nodeId),
        eq(invoiceSeries.purpose, "standard"),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .limit(2);
  const [row, extra] = rows;
  if (row === undefined) {
    throw new AppError("series.no_standard_for_node", { tenantId, nodeId });
  }
  if (extra !== undefined) {
    throw new Error(`invoice_series: node ${nodeId} has more than one standard series`);
  }
  return row.id;
}

/** {@link readStandardSeriesIdTx} under its own `withTenant` (app_user SELECT suffices). */
export function readStandardSeriesId(
  db: Database,
  tenantId: string,
  nodeId: string,
): Promise<string> {
  return withTenant(db, brandTenantId(tenantId), (tx) =>
    readStandardSeriesIdTx(tx, tenantId, nodeId),
  );
}

/**
 * Retire every LIVE series of a node (`retired_at = now()`), returning how many were retired.
 * Owner-role only: `app_user`'s UPDATE on this table is column-scoped to `next_number`
 * (`drizzle/0001_db_baseline_sql.sql`), and no runtime path retires a series — a restore does, on its
 * privileged connection, before opening the node's replacement series.
 */
export async function retireNodeSeriesTx(
  tx: Transaction,
  tenantId: string,
  nodeId: string,
): Promise<number> {
  const rows = await tx
    .update(invoiceSeries)
    .set({ retiredAt: sql`now()` })
    .where(
      and(
        eq(invoiceSeries.tenantId, tenantId),
        eq(invoiceSeries.nodeId, nodeId),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .returning({ id: invoiceSeries.id });
  return rows.length;
}

/**
 * Open fresh series for a node at `next_number = 1`. Refuses — `series.code_collision` — a code the
 * node already holds, live or retired, or a duplicate within the batch. The existing-row check
 * covers the sequential restore path; concurrent callers can still hit the unique key.
 * A no-op on an empty list.
 */
export async function insertNodeSeriesTx(
  tx: Transaction,
  tenantId: string,
  nodeId: string,
  series: readonly { code: string; purpose: string }[],
): Promise<void> {
  if (series.length === 0) return;
  const codes = new Set<string>();
  for (const { code } of series) {
    if (codes.has(code)) throw new AppError("series.code_collision", { code });
    codes.add(code);
  }
  const [held] = await tx
    .select({ code: invoiceSeries.code })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.tenantId, tenantId),
        eq(invoiceSeries.nodeId, nodeId),
        inArray(
          invoiceSeries.code,
          series.map((s) => s.code),
        ),
      ),
    )
    .limit(1);
  if (held !== undefined) {
    throw new AppError("series.code_collision", { code: held.code });
  }
  await insertReservedSeriesTx(
    tx,
    series.map((s) => ({ tenantId, nodeId, code: s.code, purpose: s.purpose })),
  );
}
