import { stringToCents, type Decimal } from "@waitron/shared";
import type { MenuPriceRow, Setting } from "../api/client.js";
import { sameValue } from "./product-editor-model.js";

export type Inherited = { state: "price"; low: string; high: string } | { state: "clash" };

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

type VariantSetting = MenuPriceRow["combined"]["variants"][number]["price"];

/** Each row's variant settings by variant id, so a lookup does not search the variants. A row is an
 * answer read from the server and never changed in place, so its index stays right. */
const variantIndex = new WeakMap<MenuPriceRow, ReadonlyMap<string, VariantSetting>>();

export function variantSetting(row: MenuPriceRow, variantId: string): VariantSetting {
  let index = variantIndex.get(row);
  if (index === undefined) {
    index = new Map(row.combined.variants.map((v) => [v.variantId, v.price]));
    variantIndex.set(row, index);
  }
  return index.get(variantId)!;
}

/** Where a variant's blank field takes its price from: `product` when it follows its product. */
function inheritedSetting(
  row: MenuPriceRow,
  variantId: string,
  product: Setting<Decimal>,
): Setting<Decimal> {
  const setting = variantSetting(row, variantId);
  const under = withoutOwn(setting);
  // A variant with no variant price from any source carries its product's setting, a clash included
  // (`parent` in packages/menu/src/menu-combine.ts). Its own override sets its level to
  // "variant", so under one a clash follows the product only when it is the product's clash; the
  // read carries nothing finer, and a variant clash listing exactly the product's candidates reads
  // as following it.
  const follows =
    setting.level === "product" ||
    (under.state === "decided" && under.source.kind === "parent") ||
    (under.state === "clash" && sameValue(under, row.combined.price));
  return follows ? product : under;
}

export function variantInheritedFrom(row: MenuPriceRow, variantId: string): Setting<Decimal> {
  return inheritedSetting(row, variantId, row.combined.price);
}

export function variantInherited(row: MenuPriceRow, variantId: string): Inherited {
  return single(variantInheritedFrom(row, variantId));
}

/** A variant's own price clashes. */
export function variantClash(row: MenuPriceRow): boolean {
  return row.variants.some((v) => {
    const setting = variantSetting(row, v.variantId);
    return setting.state === "clash" && setting.level === "variant";
  });
}

/** What each variant charges if this menu sets no price for the product: its own price on this
 * menu, else what it inherits. */
export function variantsInheritedFrom(row: MenuPriceRow): Setting<Decimal>[] {
  return row.variants.map(({ variantId }) => {
    const setting = variantSetting(row, variantId);
    return setting.state === "decided" && setting.source.kind === "own"
      ? setting
      : inheritedSetting(row, variantId, withoutOwn(row.combined.price));
  });
}

/** What the product charges across its variants if this menu sets no price for the product. */
export function productInherited(row: MenuPriceRow): Inherited {
  const each = variantsInheritedFrom(row).map(single);
  if (each.length === 0) return single(withoutOwn(row.combined.price));
  const prices = each.filter((value): value is Priced => value.state === "price");
  if (prices.length < each.length) return CLASH;
  const amounts = prices.map(({ low: value }) => ({ value, cents: stringToCents(value) }));
  const low = amounts.reduce((least, next) => (next.cents < least.cents ? next : least));
  const high = amounts.reduce((most, next) => (next.cents > most.cents ? next : most));
  return { state: "price", low: low.value, high: high.value };
}
