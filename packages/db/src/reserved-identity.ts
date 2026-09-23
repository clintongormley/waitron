import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Endorsement } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import "./errors.js";
import { now } from "./schema/columns.js";
import { nodes } from "./schema/nodes.js";
import { invoiceSeries } from "./schema/series.js";
import { withTransaction } from "./tenancy.js";

export interface ReservedNodeInput {
  id: string; // the standby's own nodeId
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
 * Nothing in the database refuses another writer this table: an ordinary insert into `nodes`, and
 * an update of `public_key` or `endorsement`, both succeed (measured 2026-09-23 on Node v26.7.0
 * against the core migration set). Adopt is the only writer by convention now. Caller supplies a
 * `withTransaction` tx so this commits with the reserved SIF + sealed key in one transaction
 * (CLAUDE.md §3 — a write-path helper takes a `tx`).
 */
export async function insertReservedNodeTx(
  tx: Transaction,
  node: ReservedNodeInput,
): Promise<void> {
  await tx.insert(nodes).values(node);
}

export interface ReservedSeriesInput {
  nodeId: string;
  code: string;
  purpose: string; // "standard" | "rectificative"
}

/**
 * Insert the standby's reserved invoice series (next_number defaults to 1). Runs under the caller's
 * transaction, alongside the reserved node + SIF (see `insertReservedNodeTx`). A no-op on an
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
export function readNodeEndorsement(db: Database, nodeId: string): Promise<Endorsement | null> {
  return withTransaction(db, async (tx) => {
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
 * silently: nothing enforces one standard series per node (the natural key is `(node_id,
 * code)`, not purpose), and two would make the invoice number non-deterministic. Reachable only by a
 * corrupt write; a plain `Error`, not a code, because it is a programming-level invariant.
 */
export async function readStandardSeriesIdTx(tx: Transaction, nodeId: string): Promise<string> {
  const rows = await tx
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.nodeId, nodeId),
        eq(invoiceSeries.purpose, "standard"),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .limit(2);
  const [row, extra] = rows;
  if (row === undefined) {
    throw new AppError("series.no_standard_for_node", { nodeId });
  }
  if (extra !== undefined) {
    throw new Error(`invoice_series: node ${nodeId} has more than one standard series`);
  }
  return row.id;
}

/** {@link readStandardSeriesIdTx} under its own `withTransaction`. */
export function readStandardSeriesId(db: Database, nodeId: string): Promise<string> {
  return withTransaction(db, (tx) => readStandardSeriesIdTx(tx, nodeId));
}

/**
 * Retire every LIVE series of a node, stamping `retired_at`, and return how many were retired.
 * **Nothing in the database refuses this update.** Stamping `retired_at` succeeds on an ordinary
 * handle, measured 2026-09-23 on Node v26.7.0 against the core migration set. What is still true is
 * the code half: no runtime path retires a series — a restore does, before opening the node's
 * replacement series.
 */
export async function retireNodeSeriesTx(tx: Transaction, nodeId: string): Promise<number> {
  const rows = await tx
    .update(invoiceSeries)
    // A JavaScript `Date`, the way every other converted writer in this package stamps a `ts`
    // column: `sql`now()`` is a PostgreSQL function this engine does not have, and the statement
    // failed outright with `no such function: now` (errcode ERR_SQLITE_ERROR).
    .set({ retiredAt: now() })
    .where(and(eq(invoiceSeries.nodeId, nodeId), isNull(invoiceSeries.retiredAt)))
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
    series.map((s) => ({ nodeId, code: s.code, purpose: s.purpose })),
  );
}
