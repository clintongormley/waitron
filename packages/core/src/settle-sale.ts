// Side-effect import registers this package's sale.* codes (mirrors record-sale.ts).
import "./errors.js";
import { eq, sql } from "drizzle-orm";
import {
  isUniqueViolation,
  POST_SETTLEMENT_REFUSAL,
  saleSettlements,
  saleVoids,
  sales,
  tenders,
  triggerRaised,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  rawCentsToDecimal,
  sumDecimals,
} from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import type { RecordSaleTender } from "./record-sale.js";

export interface SettleSaleInput {
  /** Inert: nothing here reads it. apps/server still supplies it; the field goes when that does. */
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
  // Net the sale's fiscal total with every correction in a correlated scalar subquery,
  // as listOutstandingSales does for correctionTotal.
  // `${sales}.id` (not `${sales.id}`) so the column renders table-qualified — inside a select-list
  // sql template Drizzle emits a bare `"id"`, which the subquery's own `sales c` would capture.
  //
  // The subquery is a count of whole cents read raw, cast to text and converted by
  // `rawCentsToDecimal` — see its doc comment for why it is text and not an integer cast.
  // `sales.total` beside it is a typed drizzle column, so the column's own mapping converts that
  // one and it needs no cast.
  const [sale] = await tx
    .select({
      tillId: sales.tillId,
      total: sales.total,
      corrections: sql<string>`cast(coalesce((select sum(c.total) from sales c where c.corrects_sale_id = ${sales}.id), 0) as text)`,
    })
    .from(sales)
    .where(eq(sales.id, input.saleId));
  if (sale === undefined) {
    throw new AppError("sale.not_found", { saleId: input.saleId });
  }

  // A voided sale cannot be settled. Reachable only now that invoice-first lets a
  // sale exist unsettled and therefore be voided before any payment lands.
  const [voided] = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(eq(saleVoids.saleId, input.saleId));
  if (voided !== undefined) {
    throw new AppError("sale.voided", { saleId: input.saleId });
  }

  // Clean `already_settled` for the sequential retry. The concurrent race is caught by the
  // constraints below, not by this SELECT: two callers both pass it (the other's uncommitted
  // settlement is invisible), and whichever the loser reaches first arbitrates — the `tenders`
  // post-settlement trigger when the winner has already committed, otherwise the
  // `sale_settlements` UNIQUE. Both are translated to `sale.already_settled` below; the loser's
  // whole transaction, tenders included, rolls back.
  const [existing] = await tx
    .select({ saleId: saleSettlements.saleId })
    .from(saleSettlements)
    .where(eq(saleSettlements.saleId, input.saleId));
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

  // Due = the printed total, net of every corrective invoice (folded into `sale.corrections` by the
  // subquery above), plus tips — summed in the decimal domain, exactly as listOutstandingSales reads
  // its amountDue.
  const due = sumDecimals([
    centsToDecimal(sale.total),
    rawCentsToDecimal(sale.corrections),
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
      // `amount`, `cash_tendered` and `tip_amount` are money columns, so the caller's decimal
      // amounts become counts of whole cents here, at the row. `cashTendered` keeps its own
      // absent-versus-null distinction: undefined lets the column take its default, null stores
      // null, and only a supplied amount is converted.
      await tx.insert(tenders).values(
        input.tenders.map((tender) => ({
          saleId: input.saleId,
          method: tender.method as (typeof tenders.$inferInsert)["method"],
          amount: decimalToCents(decimal(tender.amount)),
          cashTendered:
            tender.cashTendered == null
              ? tender.cashTendered
              : decimalToCents(decimal(tender.cashTendered)),
          tipAmount: decimalToCents(decimal(tender.tipAmount)),
          settledAt: tender.settledAt!.toISOString(),
        })),
      );
    } catch (error) {
      // The other concurrent-loser interleaving. When the winner has already COMMITTED its
      // settlement, this INSERT trips the `tenders_reject_post_settlement` trigger. That trigger
      // fires iff a `sale_settlements` row already exists for the sale, so its refusal here ALWAYS
      // means "already settled" — translate it to the same code the `sale_settlements` UNIQUE path
      // maps to below, so a retry/idempotency caller keying on `sale.already_settled` recognises
      // the loser whichever insert it reached. Every other failure of this INSERT is rethrown as it
      // arrived.
      if (triggerRaised(error, POST_SETTLEMENT_REFUSAL)) {
        throw new AppError("sale.already_settled", { saleId: input.saleId });
      }
      throw error;
    }
  }

  try {
    await tx.insert(saleSettlements).values({
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
