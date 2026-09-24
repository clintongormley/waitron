// Side-effect only: registers this package's error codes (./errors.ts).
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
  rawCentsToDecimal,
  stringToCents,
  sumDecimals,
} from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import type { RecordSaleTender } from "./record-sale.js";

export interface SettleSaleInput {
  saleId: SaleId;
  tenders: RecordSaleTender[];
}

/**
 * The only implementation of settlement: the deferred half of the sale write path, which
 * `recordSale`'s immediate mode also calls in its own transaction. Payment is not a fiscal event,
 * so this touches no chain and files nothing.
 */
export async function settleSale(tx: Transaction, input: SettleSaleInput): Promise<void> {
  // `${sales}.id`, not `${sales.id}`: inside a select-list template Drizzle emits a bare `"id"`,
  // which the subquery's own `sales c` would capture. The subquery's cents are cast to text for
  // `rawCentsToDecimal` (see its doc comment); `sales.total` is a typed column and needs no cast.
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

  const [voided] = await tx
    .select({ saleId: saleVoids.saleId })
    .from(saleVoids)
    .where(eq(saleVoids.saleId, input.saleId));
  if (voided !== undefined) {
    throw new AppError("sale.voided", { saleId: input.saleId });
  }

  // Refuses a second settlement, whether a retry or one started at the same time (both cases are
  // in settle-sale.test.ts). A writer that gets past this read is refused by the
  // `tenders_reject_post_settlement` trigger or the `sale_settlements` unique key, and the catches
  // below turn both into `sale.already_settled`.
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

  // The printed total, net of every corrective invoice, plus the tips.
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

  // The moment the last tender landed. A fully comped sale has no tender (`tenders_amount_ck`
  // refuses a zero one), so it stamps its own instant; never the sale's `issued_at`, which in
  // invoice-first mode can be long before, on an append-only row that cannot be corrected later.
  // The unsettled-tender check above makes every `settledAt` here non-null.
  const settledAt =
    input.tenders.length === 0
      ? new Date()
      : input.tenders.map((t) => t.settledAt!).reduce((a, b) => (b > a ? b : a));

  // Drizzle refuses `insert().values([])`; a comped sale is recorded by its settlement row alone.
  if (input.tenders.length > 0) {
    try {
      // Money columns take whole cents. An undefined `cashTendered` lets the column take its
      // default; null stores null.
      await tx.insert(tenders).values(
        input.tenders.map((tender) => ({
          saleId: input.saleId,
          method: tender.method as (typeof tenders.$inferInsert)["method"],
          amount: stringToCents(tender.amount),
          cashTendered:
            tender.cashTendered == null ? tender.cashTendered : stringToCents(tender.cashTendered),
          tipAmount: stringToCents(tender.tipAmount),
          settledAt: tender.settledAt!.toISOString(),
        })),
      );
    } catch (error) {
      // The trigger fires only when a settlement row already exists, so its refusal always means
      // the sale is already settled.
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
