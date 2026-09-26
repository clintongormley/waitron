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

/** One pick as a request names it, read leniently: a malformed one is left to the validator. */
function namedPicks(requested: unknown): { listId: string; productId: string; quantity: number }[] {
  if (!Array.isArray(requested)) return [];
  return requested.flatMap((entry: unknown) => {
    const { listId, picks } = (entry ?? {}) as { listId?: unknown; picks?: unknown };
    if (typeof listId !== "string" || !Array.isArray(picks)) return [];
    return picks.flatMap((pick: unknown) => {
      const { productId, quantity } = (pick ?? {}) as { productId?: unknown; quantity?: unknown };
      return typeof productId === "string" && typeof quantity === "number"
        ? [{ listId: listId.toLowerCase(), productId: productId.toLowerCase(), quantity }]
        : [];
    });
  });
}

/**
 * The extras answer to an edit of a SAVED line (plan D10). A pick that names a stored child's list,
 * product and per-dish quantity keeps that child, and is accepted even where its list no longer
 * offers it at that quantity, or at all (spec §11.7 example 7). Every other pick is NEW: it must be
 * offered by an active list in `offered` now, and it is priced from that list. A stored child no pick
 * keeps is removed. The lists' own rules apply to the kept and new picks together, except that the
 * kept picks alone may exceed a cap the list has since lowered.
 *
 * `dishQuantity` is the STORED dish count; a child's stored quantity is it times the per-dish picks.
 */
export function editLineExtras<
  Child extends { productId: string | null; extraListId: string | null; quantity: string },
>(
  offered: readonly ResolvedExtraList[],
  products: ReadonlyMap<string, ExtraProductFacts>,
  requested: unknown,
  stored: { children: readonly Child[]; dishQuantity: string },
): { kept: { child: Child; perDish: number }[]; added: ExtraChild[]; removed: Child[] } {
  const dish = decimal(stored.dishQuantity);
  const remaining = [...stored.children];
  const kept = new Map<string, { child: Child; perDish: number }>();
  for (const pick of namedPicks(requested)) {
    const index = remaining.findIndex(
      (child) =>
        child.extraListId === pick.listId &&
        child.productId === pick.productId &&
        compareDecimal(
          multiplyDecimal(dish, decimal(String(pick.quantity))),
          decimal(child.quantity),
        ) === 0,
    );
    if (index < 0) continue;
    kept.set(`${pick.listId}\u0000${pick.productId}`, {
      child: remaining[index]!,
      perDish: pick.quantity,
    });
    remaining.splice(index, 1);
  }

  // The lists the picks are checked against: the live ones, plus each kept pick where the live list
  // no longer offers it as the line holds it.
  const lists = offered.map((list) => ({ ...list, items: [...list.items] }));
  for (const { child, perDish } of kept.values()) {
    let list = lists.find((candidate) => candidate.active && candidate.id === child.extraListId);
    if (list === undefined) {
      list = {
        id: child.extraListId!,
        name: "",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [],
      };
      lists.push(list);
    }
    const index = list.items.findIndex((item) => item.productId === child.productId);
    if (index < 0) {
      list.items.push({
        id: "",
        productId: child.productId!,
        maxQuantity: perDish,
        preselected: false,
        price: "0.00",
      });
    } else {
      const item = list.items[index]!;
      list.items[index] = { ...item, maxQuantity: Math.max(item.maxQuantity, perDish) };
    }
    const keptOnList = [...kept.values()]
      .filter((entry) => entry.child.extraListId === list.id)
      .reduce((total, entry) => total + entry.perDish, 0);
    if (list.maxPicks !== null && keptOnList > list.maxPicks) list.maxPicks = keptOnList;
  }

  const added: ExtraChild[] = [];
  for (const selection of validateExtraSelections(lists, requested ?? [])) {
    for (const pick of selection.picks) {
      if (kept.has(`${selection.listId}\u0000${pick.productId}`)) continue;
      // A list or item added above holds only kept picks, so a new pick names a live one.
      const list = offered.find(
        (candidate) => candidate.active && candidate.id === selection.listId,
      )!;
      const item = list.items.find((candidate) => candidate.productId === pick.productId)!;
      // `products` holds every product a live list offers.
      const product = products.get(pick.productId)!;
      added.push({
        productId: product.id,
        name: product.name,
        descriptions: product.descriptions,
        kitchenName: product.kitchenName,
        price: item.price,
        listId: list.id,
        vatClass: product.vatClass,
        quantity: pick.quantity,
      });
    }
  }
  return { kept: [...kept.values()], added, removed: remaining };
}
