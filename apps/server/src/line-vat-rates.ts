import type { Transaction } from "@waitron/db";
import { readTakeawayVatSchedules, readVenueVatRates } from "@waitron/menu";
import {
  highestRates,
  isZeroDecimal,
  type DatedRate,
  type Decimal,
  type Dining,
} from "@waitron/shared";
import { recordedProducts, setMenuWeights } from "./takeaway-set-menus.js";

/** What {@link readLineVatRates} reads of a working-order line. */
export interface RatedLine {
  id: string;
  productId: string | null;
  setMenuRole: "set_menu" | "dish" | null;
  setMenuId: string | null;
  /** A set menu's own line: the copy it was sold from. */
  setMenuVersionId: string | null;
  /** A covered dish's line: its set menu's line. */
  setMenuLineId: string | null;
  menuVersionId: string | null;
  /** The product's own price, a variant's own, else its dish's; null on a line with no product. */
  productPrice: Decimal | null;
}

export interface LineVatRates {
  /** Each line's dated rates, at its index. */
  rates: (readonly DatedRate[])[];
  /**
   * Taken away, each covered dish's weight in its set menu's price, at its index, when that set
   * menu's line is among the lines read; null everywhere else.
   */
  weights: (Decimal | null)[];
}

/**
 * Each line's dated rates for an order sold `dining`. Eaten here, every line the area's dine-in
 * rates. Taken away, a product line its product's takeaway rates (an empty list for a product with
 * none, which pricing refuses); a set menu none of whose dishes among the lines has a weight, the
 * highest its recorded copy can hold (S6); any other set menu its first weighted dish's with a rate, which
 * `shareSetMenus` replaces. Every product's rates are read in one query.
 */
export async function readLineVatRates(
  tx: Transaction,
  dining: Dining,
  lines: readonly RatedLine[],
): Promise<LineVatRates> {
  if (lines.length === 0) return { rates: [], weights: [] };
  if (dining === "eat_in") {
    const { dineIn } = await readVenueVatRates(tx);
    return { rates: lines.map(() => dineIn), weights: lines.map(() => null) };
  }
  const menuLineIds = new Set(
    lines.flatMap((line) => (line.setMenuRole === "set_menu" ? [line.id] : [])),
  );
  const weighed = lines.flatMap((line, index) =>
    line.setMenuRole === "dish" &&
    line.productId !== null &&
    line.setMenuLineId !== null &&
    menuLineIds.has(line.setMenuLineId)
      ? [{ index, line }]
      : [],
  );
  const dishWeights = await setMenuWeights(
    tx,
    weighed.map(({ line }) => ({
      productId: line.productId!,
      menuVersionId: line.menuVersionId,
      productPrice: line.productPrice!,
    })),
  );
  const weights: (Decimal | null)[] = lines.map(() => null);
  const weightedDishes = new Map<string, number[]>();
  weighed.forEach(({ index, line }, at) => {
    weights[index] = dishWeights[at]!;
    if (isZeroDecimal(dishWeights[at]!)) return;
    const dishes = weightedDishes.get(line.setMenuLineId!) ?? [];
    weightedDishes.set(line.setMenuLineId!, [...dishes, index]);
  });
  const unweighted = lines.flatMap((line, index) =>
    line.setMenuRole === "set_menu" && !weightedDishes.has(line.id) ? [{ index, line }] : [],
  );
  const held = await recordedProducts(
    tx,
    unweighted.map(({ line }) => ({
      setMenuId: line.setMenuId!,
      versionId: line.setMenuVersionId!,
    })),
  );
  const productIds = [
    ...new Set([
      ...lines.flatMap((line) =>
        line.setMenuRole === "set_menu" || line.productId === null ? [] : [line.productId],
      ),
      ...held.flat(),
    ]),
  ];
  const schedules = await readTakeawayVatSchedules(tx, productIds);
  const ratesOf = (productId: string) => schedules.get(productId) ?? [];
  const rates = lines.map((line) =>
    line.setMenuRole === "set_menu" || line.productId === null ? [] : ratesOf(line.productId),
  );
  unweighted.forEach(({ index }, at) => {
    rates[index] = highestRates(held[at]!.map(ratesOf));
  });
  // A dish with no rate is refused on its own row, not on its set menu's.
  lines.forEach((line, index) => {
    const dishes = weightedDishes.get(line.id);
    if (line.setMenuRole !== "set_menu" || dishes === undefined) return;
    const rated = dishes.find((dish) => rates[dish]!.length > 0) ?? dishes[0]!;
    rates[index] = rates[rated]!;
  });
  return { rates, weights };
}
