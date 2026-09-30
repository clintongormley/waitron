import { nowIso, type Transaction } from "@waitron/db";
import { isPercentBp } from "./policy.js";
import { adjustmentSettings } from "./schema/settings.js";

export interface AdjustmentSettings {
  /** The most, in basis points of the bill's price before adjustments, that every discount on one
   * bill takes off together before a manager must approve; null sets no limit. */
  maxBillDiscountBp: number | null;
}

/** The venue's settings; no row reads as no limit. */
export async function readAdjustmentSettings(tx: Transaction): Promise<AdjustmentSettings> {
  const [row] = await tx
    .select({ maxBillDiscount: adjustmentSettings.maxBillDiscount })
    .from(adjustmentSettings);
  return { maxBillDiscountBp: row?.maxBillDiscount ?? null };
}

/** Replaces the venue's settings. A limit outside 1..10000 is the caller's bug: the route screens
 * it first. */
export async function saveAdjustmentSettings(
  tx: Transaction,
  settings: AdjustmentSettings,
): Promise<AdjustmentSettings> {
  const limit = settings.maxBillDiscountBp;
  if (limit !== null && !isPercentBp(limit)) {
    throw new RangeError("maxBillDiscountBp is not a whole count of basis points in 1..10000");
  }
  const values = { maxBillDiscount: limit, updatedAt: nowIso() };
  await tx
    .insert(adjustmentSettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: adjustmentSettings.id, set: values });
  return { maxBillDiscountBp: limit };
}
