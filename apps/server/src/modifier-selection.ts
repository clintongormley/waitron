import { validateExtraSelections, validateOptionSelections } from "@waitron/catalogue";
import type { OptionList, ResolvedExtraList, VatClass } from "@waitron/catalogue";
import { AppError } from "@waitron/shared";
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
