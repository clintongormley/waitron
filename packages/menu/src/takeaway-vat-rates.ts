import { asc, eq, inArray, or, sql } from "drizzle-orm";
import { vatRatesFor, type AreaVatRates } from "@waitron/country-packs";
import {
  products,
  productTakeawayVatRates,
  readTaxpayer,
  readVenue,
  readVenueSettings,
  type Transaction,
  type VenueSettings,
} from "@waitron/db";
import {
  AppError,
  basisPointsToDecimal,
  classifySavedTimeZone,
  localCalendarDate,
  rateOn,
  stringToBasisPoints,
  timeZoneOffsetMinutes,
  type DatedRate,
} from "@waitron/shared";
import "./errors.js";

/**
 * The VAT rates of the venue's area: the taxpayer's country with the venue's fiscal territory. A
 * caller that has already read the venue's settings passes them as `venue`.
 */
export async function readVenueVatRates(
  tx: Transaction,
  venue?: VenueSettings,
): Promise<AreaVatRates> {
  const taxpayer = await readTaxpayer(tx);
  const territory = (venue ?? (await readVenueSettings(tx)).doc).fiscalTerritory;
  return vatRatesOfArea(taxpayer?.country ?? null, territory);
}

/** The VAT rates of `country` (null: no taxpayer saved) with `territory`, for a caller that has
 * already read both. */
export function vatRatesOfArea(country: string | null, territory: string): AreaVatRates {
  const rates = country === null ? undefined : vatRatesFor(country, territory);
  if (rates === undefined) throw new AppError("vat_rate.area_unsupported", { country, territory });
  return rates;
}

/** Refuses, as `product.invalid`, a rate that is not one of the area's pickable rates. */
export function checkPickableTakeawayVatRate(rate: unknown, rates: AreaVatRates): string {
  if (typeof rate !== "string" || !rates.pickable.includes(rate))
    throw new AppError("product.invalid", { field: "takeawayVatRate" });
  return rate;
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
  } else checkPickableTakeawayVatRate(rate, rates ?? (await readVenueVatRates(tx)));
  await tx.delete(productTakeawayVatRates).where(eq(productTakeawayVatRates.productId, productId));
  if (rate !== null) await insertFirstTakeawayVatRate(tx, productId, rate);
}

/** Writes the one row from the beginning of time of a product created in this transaction, which
 * has no rows yet. The caller has checked `rate` with {@link checkPickableTakeawayVatRate}. */
export async function insertFirstTakeawayVatRate(
  tx: Transaction,
  productId: string,
  rate: string,
): Promise<void> {
  await tx
    .insert(productTakeawayVatRates)
    .values({ productId, startsOn: null, rate: stringToBasisPoints(rate) });
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

/** Each named product's OWN takeaway rates, oldest first; a product with no rows of its own (a
 * variant taking its parent's) is absent from the map. */
export async function readOwnTakeawayVatSchedules(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, readonly DatedRate[]>> {
  const schedules = new Map<string, DatedRate[]>();
  if (productIds.length === 0) return schedules;
  const rows = await tx
    .select({
      productId: productTakeawayVatRates.productId,
      startsOn: productTakeawayVatRates.startsOn,
      rate: productTakeawayVatRates.rate,
    })
    .from(productTakeawayVatRates)
    .where(inArray(productTakeawayVatRates.productId, [...productIds]))
    .orderBy(asc(productTakeawayVatRates.startsOn));
  for (const row of rows) {
    const list = schedules.get(row.productId) ?? [];
    list.push({ from: row.startsOn, rate: basisPointsToDecimal(row.rate) });
    schedules.set(row.productId, list);
  }
  return schedules;
}

/**
 * The rate each schedule holds on the venue's local date today (plan D14), keyed as given. The
 * venue's date is read only when some schedule has a dated row: without one, each schedule is its
 * one row from the beginning of time.
 */
export async function takeawayVatRatesToday(
  tx: Transaction,
  schedules: ReadonlyMap<string, readonly DatedRate[]>,
): Promise<Map<string, string>> {
  const dated = [...schedules.values()].some((schedule) =>
    schedule.some((entry) => entry.from !== null),
  );
  const today = dated ? await venueToday(tx) : null;
  const rates = new Map<string, string>();
  for (const [productId, schedule] of schedules) {
    // A product with no rows at all, which no venue reaches (plan D3), is refused as `rateOn`
    // refuses an empty list.
    if (schedule.length === 0)
      throw new AppError("vat_rate.schedule_invalid", {
        caller: "rateOn",
        reason: "first_entry_missing_or_dated",
      });
    rates.set(productId, today === null ? schedule[0]!.rate : rateOn(schedule, today));
  }
  return rates;
}

/** The area's dine-in rate in force on the venue's local date today (plan D14). */
export async function dineInVatRateToday(tx: Transaction, rates: AreaVatRates): Promise<string> {
  return rateOn(rates.dineIn, await venueToday(tx));
}

async function venueToday(tx: Transaction): Promise<string> {
  const zone = classifySavedTimeZone((await readVenue(tx)).timeZone);
  if (zone.kind !== "valid") throw new AppError("venue.time_zone_invalid", { reason: zone.kind });
  const instant = new Date();
  return localCalendarDate(instant, timeZoneOffsetMinutes(zone.timeZone, instant));
}
