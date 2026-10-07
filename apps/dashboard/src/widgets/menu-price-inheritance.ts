import { stringToCents, type Decimal } from "@waitron/shared";
import type { MenuPriceRow, Setting } from "../api/client.js";
import { sameValue } from "./product-editor-model.js";

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

/** Where a blank field takes its price from, and whether that is the product's price, which the
 * size follows. */
export interface InheritedFrom {
  setting: Setting<Decimal>;
  follows: boolean;
}

/** The product's price as its field reads now; a price typed there is this menu's own over
 * whatever the menu would otherwise charge. */
function parentSetting(row: MenuPriceRow, parent: ParentPrice): Setting<Decimal> {
  if (parent === undefined) return row.combined.price;
  const under = withoutOwn(row.combined.price);
  return parent === null
    ? under
    : { state: "decided", value: parent as Decimal, source: { kind: "own" }, otherwise: under };
}

type SizeSetting = MenuPriceRow["combined"]["variants"][number]["price"];

/** Each row's size settings by variant id, so a lookup does not search the sizes. A row is an
 * answer read from the server and never changed in place, so its index stays right. */
const sizeIndex = new WeakMap<MenuPriceRow, ReadonlyMap<string, SizeSetting>>();

export function sizeSetting(row: MenuPriceRow, variantId: string): SizeSetting {
  let index = sizeIndex.get(row);
  if (index === undefined) {
    index = new Map(row.combined.variants.map((v) => [v.variantId, v.price]));
    sizeIndex.set(row, index);
  }
  return index.get(variantId)!;
}

export function variantInheritedFrom(
  row: MenuPriceRow,
  variantId: string,
  parent: ParentPrice,
): InheritedFrom {
  const setting = sizeSetting(row, variantId);
  const under = withoutOwn(setting);
  // A size with no size price from any source carries its product's setting, a clash included
  // (`parent` in packages/catalogue/src/menu-combine.ts). Its own override sets its level to
  // "size", so under one a clash follows the product only when it is the product's clash; the
  // read carries nothing finer, and a size clash listing exactly the product's candidates reads
  // as following it.
  const follows =
    setting.level === "product" ||
    (under.state === "decided" && under.source.kind === "parent") ||
    (under.state === "clash" && sameValue(under, row.combined.price));
  return follows ? { setting: parentSetting(row, parent), follows } : { setting: under, follows };
}

export function variantInherited(
  row: MenuPriceRow,
  variantId: string,
  parent: ParentPrice,
): Inherited {
  return single(variantInheritedFrom(row, variantId, parent).setting);
}

/** An Active size with no price of its own here charges the product's price, as its field reads
 * now, and that price clashes: a price for the product would settle it. */
export function followsClash(row: MenuPriceRow, parent: ParentPrice = undefined): boolean {
  return row.variants.some((v) => {
    if (!v.active || v.price !== null) return false;
    const from = variantInheritedFrom(row, v.variantId, parent);
    return from.follows && from.setting.state === "clash";
  });
}

/** An Active size's own price clashes, which a price for the product would not settle, and no
 * Active size waits on a price for the product. */
export function sizeClash(row: MenuPriceRow, parent: ParentPrice = undefined): boolean {
  return (
    !followsClash(row, parent) &&
    row.variants.some((v) => {
      const setting = sizeSetting(row, v.variantId);
      return v.active && setting.state === "clash" && setting.level === "size";
    })
  );
}

/** What each Active size charges if this menu sets no price for the product: its own price on this
 * menu, else what it inherits. */
export function sizesInheritedFrom(row: MenuPriceRow): (InheritedFrom & { variantId: string })[] {
  return row.variants
    .filter((v) => v.active)
    .map(({ variantId }) => {
      const setting = sizeSetting(row, variantId);
      return setting.state === "decided" && setting.source.kind === "own"
        ? { variantId, setting, follows: false }
        : { variantId, ...variantInheritedFrom(row, variantId, null) };
    });
}

/** What the product charges across its Active sizes if this menu sets no price for the product. */
export function productInherited(row: MenuPriceRow): Inherited {
  const each = sizesInheritedFrom(row).map(({ setting }) => single(setting));
  if (each.length === 0) return single(withoutOwn(row.combined.price));
  const prices = each.filter((value): value is Priced => value.state === "price");
  if (prices.length < each.length) return CLASH;
  const amounts = prices.map(({ low: value }) => ({ value, cents: stringToCents(value) }));
  const low = amounts.reduce((least, next) => (next.cents < least.cents ? next : least));
  const high = amounts.reduce((most, next) => (next.cents > most.cents ? next : most));
  return { state: "price", low: low.value, high: high.value };
}
