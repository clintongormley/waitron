import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { vatRatesFor, type AreaVatRates } from "@waitron/country-packs";
import {
  products,
  productTakeawayVatRates,
  readTaxpayer,
  readVenueSettings,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  basisPointsToDecimal,
  stringToBasisPoints,
  type DatedRate,
} from "@waitron/shared";
import "./errors.js";

/** The VAT rates of the venue's area: the taxpayer's country with the venue's fiscal territory. */
export async function readVenueVatRates(tx: Transaction): Promise<AreaVatRates> {
  const taxpayer = await readTaxpayer(tx);
  const territory = (await readVenueSettings(tx)).doc.fiscalTerritory;
  const rates = taxpayer === null ? undefined : vatRatesFor(taxpayer.country, territory);
  if (rates === undefined) {
    throw new AppError("vat_rate.area_unsupported", {
      country: taxpayer?.country ?? null,
      territory,
    });
  }
  return rates;
}

/**
 * Replaces the product's takeaway rates with one row from the beginning of time at `rate`, one of
 * the area's pickable rates. Null clears a variant's rows, so it takes its parent's; a top-level
 * product always keeps a rate, so null is refused there. A caller saving several products passes
 * `rates` from one {@link readVenueVatRates}; without it the area is read here.
 */
export async function setTakeawayVatRate(
  tx: Transaction,
  productId: string,
  rate: string | null,
  rates?: AreaVatRates,
): Promise<void> {
  const [product] = await tx
    .select({ parentId: products.parentId })
    .from(products)
    .where(eq(products.id, productId));
  if (product === undefined) throw new AppError("product.not_found", { productId });
  if (rate === null) {
    if (product.parentId === null) {
      throw new AppError("product.invalid", { field: "takeawayVatRate" });
    }
  } else if (!(rates ?? (await readVenueVatRates(tx))).pickable.includes(rate)) {
    throw new AppError("product.invalid", { field: "takeawayVatRate" });
  }
  await tx.delete(productTakeawayVatRates).where(eq(productTakeawayVatRates.productId, productId));
  if (rate !== null) {
    await tx
      .insert(productTakeawayVatRates)
      .values({ productId, startsOn: null, rate: stringToBasisPoints(rate) });
  }
}

/**
 * Each named product's takeaway rates, oldest first, in one query. A variant without rows has its
 * parent's; a product left with none is absent from the map.
 */
export async function readTakeawayVatSchedules(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, readonly DatedRate[]>> {
  const schedules = new Map<string, readonly DatedRate[]>();
  if (productIds.length === 0) return schedules;
  const rows = await tx
    .select({
      productId: products.id,
      ownerId: productTakeawayVatRates.productId,
      startsOn: productTakeawayVatRates.startsOn,
      rate: productTakeawayVatRates.rate,
    })
    .from(products)
    .innerJoin(
      productTakeawayVatRates,
      or(
        eq(productTakeawayVatRates.productId, products.id),
        eq(productTakeawayVatRates.productId, products.parentId),
      ),
    )
    .where(inArray(products.id, sql`(select value from json_each(${JSON.stringify(productIds)}))`))
    // Nulls sort first, so each list starts with its row from the beginning of time.
    .orderBy(asc(productTakeawayVatRates.startsOn));
  const own = new Map<string, DatedRate[]>();
  const inherited = new Map<string, DatedRate[]>();
  for (const row of rows) {
    const lists = row.ownerId === row.productId ? own : inherited;
    const list = lists.get(row.productId) ?? [];
    list.push({ from: row.startsOn, rate: basisPointsToDecimal(row.rate) });
    lists.set(row.productId, list);
  }
  for (const productId of new Set(rows.map((row) => row.productId))) {
    schedules.set(productId, own.get(productId) ?? inherited.get(productId)!);
  }
  return schedules;
}
