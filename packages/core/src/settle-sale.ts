// Side-effect import registers this package's sale.* codes (mirrors record-sale.ts).
import "./errors.js";
import { eq } from "drizzle-orm";
import { isUniqueViolation, saleSettlements, saleVoids, sales, tenders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, addDecimal, compareDecimal, decimal, sumDecimals } from "@waitron/shared";
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
  // The sale's fiscal total, and fail-closed on cross-tenant: RLS hides another
  // tenant's row, so it is genuinely not-found rather than forbidden (as record-void).
  const [sale] = await tx
    .select({ tillId: sales.tillId, total: sales.total, issuedAt: sales.issuedAt })
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

  // Clean `already_settled` for the sequential retry. The concurrent race is caught
  // by the UNIQUE violation below (two callers both pass this SELECT, both insert
  // tenders — the other's uncommitted settlement is invisible — and the sale_settlements
  // UNIQUE arbitrates; the loser's whole transaction, tenders included, rolls back).
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

  const due = addDecimal(
    decimal(sale.total),
    sumDecimals(input.tenders.map((t) => decimal(t.tipAmount))),
  );
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
  // With no tender to time it by, the settlement takes the sale's own issuance instant rather than
  // crashing on an empty `reduce`. On a present tender, `settledAt` is guaranteed non-null by the
  // guard above; `!` reflects that rather than asserting blind.
  const settledAt =
    input.tenders.length === 0
      ? new Date(sale.issuedAt)
      : input.tenders.map((t) => t.settledAt!).reduce((a, b) => (b > a ? b : a));

  // Skipped entirely when tenderless: a comped sale has no payments to record, and Drizzle rejects
  // `insert().values([])` outright — the empty case is written by its `sale_settlements` row alone.
  if (input.tenders.length > 0) {
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
