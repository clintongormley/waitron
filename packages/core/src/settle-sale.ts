// Side-effect import registers this package's sale.* codes (mirrors record-sale.ts).
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { isUniqueViolation, saleSettlements, saleVoids, sales, tenders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import type { SaleId, TenantId } from "@waitron/shared";
import type { RecordSaleTender } from "./record-sale.js";

export interface SettleSaleInput {
  tenantId: TenantId;
  saleId: SaleId;
  tenders: RecordSaleTender[];
}

/**
 * The deferred half of the sale write path, and the single implementation of
 * settlement (recordSale's `immediate` mode calls this in the same transaction,
 * so the two cannot drift — design D6). Payment is not a fiscal event: this
 * touches no chain, takes no chain-head lock, and submits nothing (design §4).
 */
export async function settleSale(tx: Transaction, input: SettleSaleInput): Promise<void> {
  // The sale's fiscal total, and every rectificativa correcting it netted in a correlated scalar
  // subquery (design §2) — the same correlated corrections-sum subquery approach listOutstandingSales
  // uses for its correctionTotal, and, since both files carry explicit belt-and-suspenders tenant
  // predicates, its inner subquery now carries the same explicit `c.tenant_id` this one does.
  // Both the outer sale lookup and the corrective sum filter by tenant.
  // `${sales}.id` (not `${sales.id}`) so the column renders table-qualified — inside a select-list
  // sql template Drizzle emits a bare `"id"`, which the subquery's own `sales c` would capture.
  const [sale] = await tx
    .select({
      tillId: sales.tillId,
      total: sales.total,
      corrections: sql<string>`coalesce((select sum(c.total) from sales c where c.corrects_sale_id = ${sales}.id and c.tenant_id = ${input.tenantId}), 0)::numeric(12, 2)::text`,
    })
    .from(sales)
    .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, input.tenantId)));
  if (sale === undefined) {
    throw new AppError("sale.not_found", { saleId: input.saleId });
  }

  // A voided sale cannot be settled. Reachable only now that invoice-first lets a
  // sale exist unsettled and therefore be voided before any payment lands.
  const [voided] = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(and(eq(saleVoids.saleId, input.saleId), eq(saleVoids.tenantId, input.tenantId)));
  if (voided !== undefined) {
    throw new AppError("sale.voided", { saleId: input.saleId });
  }

  // Clean `already_settled` for the sequential retry. The concurrent race is caught by the
  // constraints below, not by this SELECT: two callers both pass it (the other's uncommitted
  // settlement is invisible), and whichever the loser reaches first arbitrates — the `tenders`
  // post-settlement trigger (WT002) when the winner has already committed, otherwise the
  // `sale_settlements` UNIQUE. Both are translated to `sale.already_settled` below; the loser's
  // whole transaction, tenders included, rolls back.
  const [existing] = await tx
    .select({ saleId: saleSettlements.saleId })
    .from(saleSettlements)
    .where(
      and(eq(saleSettlements.saleId, input.saleId), eq(saleSettlements.tenantId, input.tenantId)),
    );
  if (existing !== undefined) {
    throw new AppError("sale.already_settled", { saleId: input.saleId });
  }

  const unsettled = input.tenders.filter((t) => t.settledAt === null);
  if (unsettled.length > 0) {
    throw new AppError("sale.tender_unsettled", {
      tillId: sale.tillId,
      saleId: input.saleId,
      unsettledCount: unsettled.length,
    });
  }

  // Due = the printed total, net of every rectificativa (folded into `sale.corrections` by the
  // subquery above), plus tips — summed in the decimal domain, exactly as listOutstandingSales reads
  // its amountDue.
  const due = sumDecimals([
    decimal(sale.total),
    decimal(sale.corrections),
    ...input.tenders.map((t) => decimal(t.tipAmount)),
  ]);
  const charged = sumDecimals(input.tenders.map((t) => decimal(t.amount)));
  if (compareDecimal(charged, due) !== 0) {
    throw new AppError("sale.tender_shortfall", {
      tillId: sale.tillId,
      saleId: input.saleId,
      due,
      charged,
    });
  }

  // settled_at = the moment the LAST tender landed (design decision 5). A fully-comped sale is €0
  // and has NO payment — `tenders_amount_ck` forbids a €0 tender, so a comp is genuinely tenderless
  // — and the schema permits settling it: `sales_total_ck` allows a total of 0, and the coverage
  // trigger's `coalesce(sum(amount),0)` makes `0 = 0 + 0` hold, so the shortfall check above passes.
  // With no tender to time it by, the settlement stamps its OWN instant — `new Date()`, exactly as
  // `record-void.ts` does (settlement is not a fiscal event: this takes no chain-head lock). It must
  // NOT borrow the sale's `issued_at`: in invoice-first mode `settleSale` runs long after issuance,
  // so `issued_at` is when the invoice printed, not when the comp was finalised, and backdating an
  // append-only `sale_settlements` row to it cannot be corrected later. On a present tender,
  // `settledAt` is guaranteed non-null by the guard above; `!` reflects that rather than asserting
  // blind.
  const settledAt =
    input.tenders.length === 0
      ? new Date()
      : input.tenders.map((t) => t.settledAt!).reduce((a, b) => (b > a ? b : a));

  // Skipped entirely when tenderless: a comped sale has no payments to record, and Drizzle rejects
  // `insert().values([])` outright — the empty case is written by its `sale_settlements` row alone.
  if (input.tenders.length > 0) {
    try {
      await tx.insert(tenders).values(
        input.tenders.map((tender) => ({
          tenantId: input.tenantId,
          saleId: input.saleId,
          method: tender.method as (typeof tenders.$inferInsert)["method"],
          amount: tender.amount,
          tipAmount: tender.tipAmount,
          settledAt: tender.settledAt!.toISOString(),
        })),
      );
    } catch (error) {
      // The other concurrent-loser interleaving. When the winner has already COMMITTED its
      // settlement, this INSERT trips the `tenders_reject_post_settlement` trigger, which raises
      // SQLSTATE WT002 (`packages/db/drizzle/0001_db_baseline_sql.sql`). That trigger fires iff a
      // `sale_settlements` row already exists for the sale, so WT002 here ALWAYS means "already
      // settled" — translate it to the same code the `sale_settlements` UNIQUE path maps to below,
      // so a retry/idempotency caller keying on `sale.already_settled` recognises the loser
      // whichever insert it reached.
      if (isPostSettlementViolation(error)) {
        throw new AppError("sale.already_settled", { saleId: input.saleId });
      }
      throw error;
    }
  }

  try {
    await tx.insert(saleSettlements).values({
      tenantId: input.tenantId,
      saleId: input.saleId,
      settledAt: settledAt.toISOString(),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("sale.already_settled", { saleId: input.saleId });
    }
    throw error;
  }
}

// SQLSTATE raised by the `tenders_reject_post_settlement` trigger
// (`packages/db/drizzle/0001_db_baseline_sql.sql`) when a tender INSERT lands after the sale is
// already settled. `WT001` is `reject_mutation`; `WT002` is this guard specifically.
const POST_SETTLEMENT_VIOLATION = "WT002";

/**
 * Is this (or anything it wraps) the `tenders_reject_post_settlement` guard (SQLSTATE WT002)?
 *
 * Walks the cause chain for the same reason `@waitron/db`'s `isUniqueViolation` does — Drizzle wraps
 * every failed query in a `DrizzleQueryError` whose own `.code` is undefined, the real SQLSTATE
 * living on `.cause.code` (node-postgres), or nested one level deeper under PGlite. Stops at a fixed
 * depth so a self-referential `cause` cannot spin forever. A local predicate rather than a shared
 * helper because `@waitron/db` exports only the 23505-specific `isUniqueViolation`, and this is the
 * one place that needs WT002 — mirrors that predicate's shape rather than reaching for the test-only
 * `pgErrorCode`.
 */
function isPostSettlementViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === POST_SETTLEMENT_VIOLATION
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
}
