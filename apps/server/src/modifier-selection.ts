import { isDeepStrictEqual } from "node:util";
import { validateExtraSelections, validateOptionSelections } from "@waitron/catalogue";
import type { OptionList, ResolvedExtraList, VatClass } from "@waitron/catalogue";
import { AppError, compareDecimal, decimal, multiplyDecimal } from "@waitron/shared";
import type { OptionSnapshot } from "@waitron/shared";

/**
 * What the order path knows about a product offered as an extra: the three names it freezes onto
 * the child line, and the VAT class that line is taxed at. Read from the `products` row, never from
 * the `extra_list_items` row that offers it — the offer holds nothing that duplicates the product
 * (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.1).
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
 * One child line to be, per picked product. Every field is a value copied off the product or the
 * offer, so nothing here points back at a list or an item: deleting either cannot rewrite the order.
 */
export interface ExtraChild {
  productId: string;
  name: string;
  descriptions: Record<string, string>;
  kitchenName: string | null;
  /** GROSS, already resolved — see {@link buildLineExtras}. */
  price: string;
  /** The extra PRODUCT's own class, never the dish's (spec §3.3, decision 9). */
  vatClass: VatClass;
  /**
   * The picks for ONE dish, exactly as sent — NOT multiplied by the dish count. The pricer does
   * that multiplication: a child is priced at dishQuantity × quantity
   * (`priceBasketWithOptions`, `packages/catalogue/src/pricing.ts`), so multiplying here too would
   * charge a dish ×3 with a pick ×2 nine times.
   */
  quantity: number;
}

/**
 * Validate one line's answers to the extras and options lists its dish offers, and freeze them:
 * options into `OptionSnapshot`s for the dish line's own column, extras into the child lines the
 * picks become (spec §2.3, §3.4).
 *
 * Deterministic, and never the wire's order: each validator answers in the OFFERED order, and each
 * extras list's picks come back in that list's own item order. An inactive list is neither asked nor
 * answerable, and an active list answered with no picks contributes no child.
 *
 * Nothing is resolved here. `price` is the offer's already-settled `price` — the projection
 * collapsed the menu → list item → product chain into that field
 * (`packages/catalogue/src/extra-projection.ts`) — and `vatClass` is the extra product's own.
 * `defaultLanguage` is the language the two plain staff names widen under, because an
 * `OptionSnapshot` holds locale -> text maps where an `OptionList`/`OptionLabel` holds a `string`.
 *
 * `products` must hold an entry for every product named by an item of an ACTIVE list in
 * `offered.extras`: a pick can only name one of those (`validateExtraSelections`,
 * `packages/catalogue/src/extra-contract.ts`, refuses any other), so a missing entry means the
 * caller resolved the list definitions without resolving their products. That is refused with
 * `product.not_found` rather than skipped, because dropping a picked extra would serve and cook it
 * unbilled.
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
          vatClass: product.vatClass,
          quantity: pick.quantity,
        };
      });
    },
  );

  return { extraChildren, optionSnapshots };
}

/**
 * Take one entry at a time and give it the first candidate that matches, consuming that candidate.
 * Answers the pairing, or `null` as soon as an entry finds nothing left to pair with.
 *
 * Greedy is EXACT here because every caller's `matches` is an equality test: two entries that could
 * both take the same candidate are interchangeable in it, so no early choice can strand a later
 * entry. A predicate that merely OVERLAPS — "close enough", a range — would need a real bipartite
 * matching, and this helper would be wrong for it.
 */
function pairOff<Entry, Candidate>(
  entries: readonly Entry[],
  candidates: readonly Candidate[],
  matches: (entry: Entry, candidate: Candidate) => boolean,
): { entry: Entry; candidate: Candidate }[] | null {
  if (entries.length !== candidates.length) return null;
  const remaining = [...candidates];
  const paired: { entry: Entry; candidate: Candidate }[] = [];
  for (const entry of entries) {
    const index = remaining.findIndex((candidate) => matches(entry, candidate));
    if (index < 0) return null;
    paired.push({ entry, candidate: remaining[index]! });
    remaining.splice(index, 1);
  }
  return paired;
}

/**
 * Whether a line's freshly rebuilt options answers say the same thing as the ones it froze — the
 * question `updateHeldOrder` asks to decide that an edit is quantity-only.
 *
 * Compared BY VALUE and without regard to either side's order. Order matters because the offered
 * order is not fixed: `readProductModifiers` (`packages/catalogue/src/product-modifiers.ts`) answers
 * in the attachment rows' `sort` order and a product save re-numbers those positions from the body,
 * so a manager reordering a dish's lists changes the order both `buildLineExtras` and every later
 * read produce, while the stored line keeps the order it was written in.
 *
 * A RENAME still differs, and that is the settled behaviour, not an oversight: an options answer
 * freezes the six names and NO ids (spec §2.3), so the wording is the only evidence the line carries
 * about what was chosen, and a renamed list is indistinguishable from a different answer. Such an
 * edit takes the replacement path and is re-priced — pinned by "re-prices a held line when the
 * options list it answered was renamed between the two sends" in working-order.test.ts.
 */
export function sameOptionSelections(
  frozen: readonly OptionSnapshot[],
  stored: readonly OptionSnapshot[],
): boolean {
  return pairOff(frozen, stored, isDeepStrictEqual) !== null;
}

/**
 * Pair each rebuilt pick with the stored child line that froze it, or `null` when no such pairing
 * exists — in which case the edit is not quantity-only and takes the replacement path.
 *
 * A child's stored quantity is `dishQuantity × picksPerDish`, which is how the pricer wrote it
 * (`priceBasketWithOptions`, `packages/catalogue/src/pricing.ts`), so `dishQuantity` here is the
 * STORED dish count — the one the child was written against, not the one being asked for.
 *
 * Order-independent for the same reason {@link sameOptionSelections} is. Unlike the options answer,
 * a child DOES carry an id — the picked product — so a product rename does not disturb it.
 *
 * The pairing is what the caller needs, not just its truth value: it updates each child's quantity
 * from its own pick, and the two sides are no longer index-aligned. (The plan named this
 * `sameExtraSelections` and had it answer a boolean; a boolean would have to be paired up a second
 * time by the caller, and the two rules could then disagree.)
 */
export function matchExtraChildren<Child extends { productId: string | null; quantity: string }>(
  picks: readonly ExtraChild[],
  children: readonly Child[],
  dishQuantity: string,
): { pick: ExtraChild; child: Child }[] | null {
  const paired = pairOff(
    picks,
    children,
    (pick, child) =>
      child.productId === pick.productId &&
      compareDecimal(
        multiplyDecimal(decimal(dishQuantity), decimal(String(pick.quantity))),
        decimal(child.quantity),
      ) === 0,
  );
  return paired === null
    ? null
    : paired.map(({ entry, candidate }) => ({ pick: entry, child: candidate }));
}
