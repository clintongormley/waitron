import { stringToCents, type Decimal } from "@waitron/shared";
import type { MenuPriceRow, Setting } from "../api/client.js";

export type Inherited = { state: "price"; low: string; high: string } | { state: "clash" };
/** The product's price as its field reads now: undefined while untouched or holding text that is
 * not a price (no draft), null once emptied, else the price typed. */
export type ParentPrice = string | null | undefined;

type Priced = Extract<Inherited, { state: "price" }>;

const CLASH: Inherited = { state: "clash" };
const price = (value: string): Priced => ({ state: "price", low: value, high: value });
const single = (setting: Setting<Decimal>): Inherited =>
  setting.state === "decided" ? price(setting.value) : CLASH;

/** The setting without this menu's own decision on it. */
export function withoutOwn(setting: Setting<Decimal>): Setting<Decimal> {
  return setting.state === "decided" && setting.source.kind === "own"
    ? (setting.otherwise ?? setting)
    : setting;
}

function parentPrice(row: MenuPriceRow, parent: ParentPrice): Inherited {
  if (parent === undefined) return single(row.combined.price);
  return parent === null ? single(withoutOwn(row.combined.price)) : price(parent);
}

const sizeSetting = (row: MenuPriceRow, variantId: string) =>
  row.combined.variants.find((v) => v.variantId === variantId)!.price;

export function variantInherited(
  row: MenuPriceRow,
  variantId: string,
  parent: ParentPrice,
): Inherited {
  const setting = withoutOwn(sizeSetting(row, variantId));
  return setting.state === "decided" && setting.source.kind === "parent"
    ? parentPrice(row, parent)
    : single(setting);
}

/** An Active size's own price clashes, which a price for the product would not settle. */
export function sizeClash(row: MenuPriceRow): boolean {
  return (
    row.combined.price.state === "decided" &&
    row.variants.some((v) => v.active && sizeSetting(row, v.variantId).state === "clash")
  );
}

/** What the product charges across its Active sizes if this menu sets no price for the product. */
export function productInherited(row: MenuPriceRow): Inherited {
  const active = row.variants.filter((v) => v.active);
  if (active.length === 0) return single(withoutOwn(row.combined.price));
  const each = active.map(({ variantId }) => {
    const setting = sizeSetting(row, variantId);
    return setting.state === "decided" && setting.source.kind === "own"
      ? price(setting.value)
      : variantInherited(row, variantId, null);
  });
  const prices = each.filter((value): value is Priced => value.state === "price");
  if (prices.length < each.length) return CLASH;
  // Each size's price is one amount, so its `low` is its whole price.
  const amounts = prices.map(({ low: value }) => ({ value, cents: stringToCents(value) }));
  const low = amounts.reduce((least, next) => (next.cents < least.cents ? next : least));
  const high = amounts.reduce((most, next) => (next.cents > most.cents ? next : most));
  return { state: "price", low: low.value, high: high.value };
}
