import { isDeepStrictEqual } from "node:util";
import { validateExtraSelections, validateOptionSelections } from "@waitron/catalogue";
import type { OptionList, ResolvedExtraList, VatClass } from "@waitron/catalogue";
import { AppError, compareDecimal, decimal, multiplyDecimal } from "@waitron/shared";
import type { OptionSnapshot } from "@waitron/shared";

/**
 * A product offered as an extra, read from the `products` row (and, for a variant that leaves its
 * VAT blank, its parent's), never from the `extra_list_items` row that offers it.
 */
export interface ExtraProductFacts {
  id: string;
  /** The plain staff name. */
  name: string;
  /** locale -> customer-facing text. */
  descriptions: Record<string, string>;
  kitchenName: string | null;
  vatClass: VatClass;
}

/**
 * One child line to be, per picked product. Every field is a copied value, so deleting a list or an
 * item cannot rewrite the order.
 */
export interface ExtraChild {
  productId: string;
  name: string;
  descriptions: Record<string, string>;
  kitchenName: string | null;
  /** GROSS, already resolved. */
  price: string;
  /** The list the pick was taken from, stored on the child line as `extra_list_id`. */
  listId: string;
  /** The extra PRODUCT's own class, never the dish's. */
  vatClass: VatClass;
  /**
   * The picks for ONE dish, NOT multiplied by the dish count: `priceBasketWithOptions`
   * (`packages/catalogue/src/pricing.ts`) does that multiplication.
   */
  quantity: number;
}

/**
 * Validate one line's answers to the extras and options lists its dish offers, and freeze them:
 * options into `OptionSnapshot`s for the dish line's own column, extras into child lines.
 *
 * `defaultLanguage` is the language the plain staff names widen under, because an `OptionSnapshot`
 * holds locale -> text maps where an `OptionList`/`OptionLabel` holds a `string`.
 *
 * `products` must hold every product an ACTIVE list in `offered.extras` offers. A missing one is
 * refused with `product.not_found` rather than skipped, because dropping a picked extra would serve
 * it unbilled.
 */
export function buildLineExtras(
  offered: { extras: readonly ResolvedExtraList[]; options: readonly OptionList[] },
  products: ReadonlyMap<string, ExtraProductFacts>,
  requested: { extras?: unknown; options?: unknown },
  defaultLanguage: string,
): { extraChildren: ExtraChild[]; optionSnapshots: OptionSnapshot[] } {
  // Both validators answer with ids drawn from the lists they were handed, so every lookup below
  // that re-finds one of those ids resolves.
  const optionSnapshots = validateOptionSelections(offered.options, requested.options ?? []).map(
    (selection): OptionSnapshot => {
      const list = offered.options.find((candidate) => candidate.id === selection.listId)!;
      const label = list.labels.find((candidate) => candidate.id === selection.labelId)!;
      return {
        listName: { [defaultLanguage]: list.name },
        listCustomerName: list.customerName,
        listKitchenName: list.kitchenName,
        labelName: { [defaultLanguage]: label.name },
        labelCustomerName: label.customerName,
        labelKitchenName: label.kitchenName,
      };
    },
  );

  const extraChildren = validateExtraSelections(offered.extras, requested.extras ?? []).flatMap(
    (selection): ExtraChild[] => {
      const list = offered.extras.find((candidate) => candidate.id === selection.listId)!;
      return selection.picks.map((pick): ExtraChild => {
        const item = list.items.find((candidate) => candidate.productId === pick.productId)!;
        const product = products.get(pick.productId);
        if (product === undefined) {
          throw new AppError("product.not_found", { productId: pick.productId });
        }
        return {
          productId: product.id,
          name: product.name,
          descriptions: product.descriptions,
          kitchenName: product.kitchenName,
          price: item.price,
          listId: list.id,
          vatClass: product.vatClass,
          quantity: pick.quantity,
        };
      });
    },
  );

  return { extraChildren, optionSnapshots };
}

/**
 * Answers the matched candidates IN ENTRY ORDER, or `null`.
 *
 * Greedy is exact only because every caller's `matches` is equality of a derived KEY: two entries
 * that could take the same candidate match the same set, so no early choice strands a later entry.
 * A merely overlapping predicate would need a real bipartite matching.
 */
function pairOff<Entry, Candidate>(
  entries: readonly Entry[],
  candidates: readonly Candidate[],
  matches: (entry: Entry, candidate: Candidate) => boolean,
): Candidate[] | null {
  if (entries.length !== candidates.length) return null;
  const remaining = [...candidates];
  const matched: Candidate[] = [];
  for (const entry of entries) {
    const index = remaining.findIndex((candidate) => matches(entry, candidate));
    if (index < 0) return null;
    matched.push(remaining[index]!);
    remaining.splice(index, 1);
  }
  return matched;
}

/**
 * Compared BY VALUE — not by JSON key order, send order or offered order, because the offered
 * order is a stored position a save re-numbers. A RENAMED list still differs, deliberately.
 * Receipt: docs/developers/modifiers.md.
 */
export function sameOptionSelections(
  frozen: readonly OptionSnapshot[],
  stored: readonly OptionSnapshot[],
): boolean {
  return pairOff(frozen, stored, isDeepStrictEqual) !== null;
}

/**
 * Pair each rebuilt pick with the stored child line that froze it, or `null` when the edit is not
 * quantity-only. A pick and a child match on their list, product and quantity; neither side's ORDER
 * is part of the pairing. `dishQuantity` is the STORED dish count, since a child's stored quantity is
 * `dishQuantity × picksPerDish`. A child that records no list matches no pick.
 */
export function matchExtraChildren<
  Child extends { productId: string | null; extraListId: string | null; quantity: string },
>(
  picks: readonly ExtraChild[],
  children: readonly Child[],
  dishQuantity: string,
): { pick: ExtraChild; child: Child }[] | null {
  const dish = decimal(dishQuantity);
  const wanted = picks.map((pick) => ({
    listId: pick.listId,
    productId: pick.productId,
    quantity: multiplyDecimal(dish, decimal(String(pick.quantity))),
  }));
  const matched = pairOff(
    wanted,
    children,
    (want, child) =>
      child.extraListId === want.listId &&
      child.productId === want.productId &&
      compareDecimal(want.quantity, decimal(child.quantity)) === 0,
  );
  return matched === null ? null : picks.map((pick, index) => ({ pick, child: matched[index]! }));
}
