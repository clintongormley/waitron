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
 * Answers the matched candidates IN ENTRY ORDER, or `null` — either because the two sides are
 * different lengths, or because an entry found nothing left to pair with.
 *
 * Greedy is EXACT for both callers here because each one's `matches` is equality of a KEY derived
 * from the two sides: two entries that could take the same candidate match exactly the same set of
 * candidates, so no early choice can strand a later entry. A predicate that merely OVERLAPS —
 * "close enough", a range — would need a real bipartite matching, and this helper would be wrong
 * for it.
 *
 * Exact is not the same as MEANINGFUL, and the difference is a caller's problem, not this helper's:
 * when two candidates share a key but differ in something the key leaves out, either pairing is
 * exact and only one of them is right. {@link matchExtraChildren} rules that case out before it
 * asks.
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
 * Whether a line's freshly rebuilt options answers say the same thing as the ones it froze — the
 * question `updateHeldOrder` asks to decide that an edit is quantity-only.
 *
 * Compared BY VALUE and without regard to either side's order, because the order both sides are
 * built in is a stored position somebody can move: see {@link matchExtraChildren} for where each
 * one comes from.
 *
 * A RENAMED list still differs, and that is a settled decision rather than an oversight — the
 * reason, and the test that pins it, are in `docs/developers/modifiers.md`.
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
 * Neither side's ORDER is part of the pairing. The order both sides come back in is a stored
 * position, and THREE columns hold parts of it, each re-numbered from the body of a save — the full
 * list, with what writes each one, is in `docs/developers/modifiers.md`. Two of the three are
 * reachable from a shipping route today.
 *
 * A PICKED PRODUCT THAT MORE THAN ONE OF THE DISH'S ACTIVE LISTS OFFERS REFUSES THE PAIRING. A
 * child line records the product it is, its quantity and the price it was sold at, and never the
 * list that offered it (spec §3.4). So when two lists offer the same product at two prices, nothing
 * on the stored side says which row belongs to which list, and the pairing cannot tell a quantity
 * change from a pick that MOVED between the two — it keeps the price of whichever row it lands on.
 * That is a real bill: measured on this branch and, with the same fixture, on `main` at
 * `68e36c6aa`, one pick moved off a 1.00 list onto a 3.00 one went on being charged 1.00. Such an
 * edit now takes the replacement path and is re-priced from today's offers, which is correct at the
 * cost of the line's price lock whenever a dish offers one product twice. Pinned by "replaces the
 * line when a pick moves to another list offering the same product" and "replaces the line when two
 * lists offering the same product have their picks swapped" (working-order.test.ts).
 *
 * Two picks naming the same product are the same rule, not a second one: `extra_list_items` holds
 * each product at most once per list (`extra_list_items_list_product_uq`, which
 * `packages/catalogue/src/extras.ts` names in `writeItems`), so a product picked twice is a product
 * two lists offer. A separate check for it was written, then deleted once removing it left every
 * case of these two suites green.
 *
 * The pairing is what the caller needs, not just its truth value: it updates each child's quantity
 * from its own pick, and the two sides are no longer index-aligned.
 */
export function matchExtraChildren<Child extends { productId: string | null; quantity: string }>(
  offered: readonly ResolvedExtraList[],
  picks: readonly ExtraChild[],
  children: readonly Child[],
  dishQuantity: string,
): { pick: ExtraChild; child: Child }[] | null {
  const offerCounts = new Map<string, number>();
  for (const list of offered) {
    if (!list.active) continue;
    for (const item of list.items) {
      offerCounts.set(item.productId, (offerCounts.get(item.productId) ?? 0) + 1);
    }
  }
  if (picks.some((pick) => (offerCounts.get(pick.productId) ?? 0) > 1)) return null;
  // Each pick's expected stored quantity, computed once rather than once per probe.
  const dish = decimal(dishQuantity);
  const wanted = picks.map((pick) => ({
    productId: pick.productId,
    quantity: multiplyDecimal(dish, decimal(String(pick.quantity))),
  }));
  const matched = pairOff(
    wanted,
    children,
    (want, child) =>
      child.productId === want.productId &&
      compareDecimal(want.quantity, decimal(child.quantity)) === 0,
  );
  return matched === null ? null : picks.map((pick, index) => ({ pick, child: matched[index]! }));
}
