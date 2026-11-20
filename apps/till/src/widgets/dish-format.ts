import {
  compareDecimal,
  decimal,
  resolveEnabledContentText,
  resolveSnapshotText,
} from "@waitron/shared";
import { currentContentLanguages, formatDecimalInput } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";

/** "2.000" → "2", "0.320" → "0.32"; a bare integer is untouched. */
export function trimQuantity(quantity: string): string {
  return quantity.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function quantityText(quantity: string): string {
  return formatDecimalInput(trimQuantity(quantity), currentLocale());
}

/** A not-served dish as listed: "Steak", or "2 × Beer" for any other quantity. */
export function unservedDishText(dish: { dishName: string; quantity: string }): string {
  return compareDecimal(decimal(dish.quantity), decimal("1")) === 0
    ? dish.dishName
    : `${quantityText(dish.quantity)} × ${dish.dishName}`;
}

/** Mark served refuses a dish still held in its group (`group.line_held`), so only released
 * dishes are offered. */
export function servableDishes<T extends { released: boolean }>(
  dishes: readonly T[],
  canMarkServed: boolean,
): T[] {
  return canMarkServed ? dishes.filter((dish) => dish.released) : [];
}

/** Mark served for listed dishes: each one's whole listed quantity. */
export function serveListed(
  dishes: readonly { lineId: string; quantity: string }[],
): { lineId: string; quantity: string }[] {
  return dishes.map((dish) => ({ lineId: dish.lineId, quantity: trimQuantity(dish.quantity) }));
}

/** A line counted in Each shows no unit: "2× Croqueta". */
export function dishLine(
  line: {
    quantity: string;
    unitName?: Record<string, string> | null;
    soldInEach?: boolean;
  },
  name: string,
): string {
  const unit =
    line.unitName == null || line.soldInEach === true
      ? ""
      : ` ${snapshotDescriptionFor(line.unitName, "")}`;
  return `${quantityText(line.quantity)}${unit}× ${name}`;
}

/** A measured extra shows its amount and unit, as {@link dishLine} does; a counted one its count. */
export function extraLine(extra: {
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  soldInEach: boolean;
  perDish: number;
}): string {
  if (extra.unitName !== null && !extra.soldInEach)
    return `${extra.name} ${quantityText(extra.quantity)} ${snapshotDescriptionFor(extra.unitName, "")}`;
  return extra.perDish > 1 ? `${extra.name} x${extra.perDish}` : extra.name;
}

/** Resolve live menu text against enabled languages and the configured content default. */
export function descriptionFor(
  descriptions: Record<string, string>,
  fallback: string,
  locale: string = currentLocale(),
): string {
  return resolveEnabledContentText(descriptions, locale, currentContentLanguages()) || fallback;
}

/** Stored order names keep their receipt-language text when content settings change. */
export function snapshotDescriptionFor(
  descriptions: Record<string, string>,
  fallback: string,
  locale: string = currentLocale(),
): string {
  return (
    resolveSnapshotText(descriptions, locale, currentContentLanguages().defaultLanguage) || fallback
  );
}
