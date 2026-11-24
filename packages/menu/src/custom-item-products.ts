import { eq, isNull, type SQL } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError, stringToBasisPoints } from "@waitron/shared";
import { createProductSkippingNameCheck } from "./operations.js";
import { clearTakeawayVatRates, readVenueVatRates } from "./takeaway-vat-rates.js";
import "./errors.js";

const UNCHOSEN_KEY = "unchosen";

/** Leaves the hidden products out of a list of products. */
export const notCustomItem: SQL = isNull(products.customItemKey);

/**
 * The id of the hidden product behind a custom item taken away at `takeawayRateBp`, or, for null,
 * one whose takeaway rate nobody chose; created on first use.
 */
export async function customItemProduct(
  tx: Transaction,
  takeawayRateBp: number | null,
): Promise<string> {
  const rate = takeawayRateBp === null ? undefined : await pickableRate(tx, takeawayRateBp);
  const customItemKey = takeawayRateBp === null ? UNCHOSEN_KEY : String(takeawayRateBp);
  const [found] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.customItemKey, customItemKey));
  if (found !== undefined) return found.id;
  const { id } = await createProductSkippingNameCheck(tx, {
    name: "Custom item",
    categoryId: null,
    unitId: null,
    unitPrice: "0.00",
    // The exception to the VAT model: no later dated rate, so the rate staff chose is the one filed.
    takeawayVatRate: rate,
  });
  if (rate === undefined) await clearTakeawayVatRates(tx, id);
  await tx.update(products).set({ customItemKey }).where(eq(products.id, id));
  return id;
}

async function pickableRate(tx: Transaction, takeawayRateBp: number): Promise<string> {
  const { pickable } = await readVenueVatRates(tx);
  const rate = pickable.find((picked) => stringToBasisPoints(picked) === takeawayRateBp);
  if (rate === undefined)
    throw new AppError("management.request_invalid", { field: "takeawayRateBp" });
  return rate;
}
