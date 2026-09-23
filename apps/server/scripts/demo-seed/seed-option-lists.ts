// Seeds the demo's reusable OPTIONS LISTS (`PRODUCT_OPTION_LISTS` in menu.ts) and attaches each to
// its named product. This is the generic mechanism that replaced the built-in doneness field: the
// steak carries a cooking options list, `Punto`, where it used to carry a doneness enum. The plan
// that asked for it calls it the "Cooked" list; the seeded staff name is Spanish because every
// other staff-facing name in `menu.ts` is, and a staff name is one plain string that is never
// translated at read time, so an English one would show in English on the Spanish demo.
//
// The till DOES offer this list to an operator. `listAvailableProducts` and `listMenuOffers` carry
// the `product_modifiers` rows this file writes, resolved and in the product's own order, in an
// `offeredModifiers` field (`readOfferedModifiers`,
// `packages/catalogue/src/offered-modifiers.ts`, pinned by "listAvailableProducts carries the
// product-side walk" in its test file), and the till's picker draws that field.
//
// `seedOptionLists` runs inside the CALLER's transaction, opened with `withTransaction` — the same
// posture `seedCatalogues` and `seedOptions` use in this database. `createOptionList` and `writeProductModifiers` (`@waitron/catalogue`) are plain
// catalogue operations, not session-gated the way `createPerson` (`@waitron/identity`) is, so this
// calls them directly rather than raw-inserting.

import { randomUUID } from "node:crypto";
import { createOptionList, writeProductModifiers } from "@waitron/catalogue";
import type { ProductModifierRef } from "@waitron/catalogue";
import type { Transaction } from "@waitron/db";
import { PRODUCT_OPTION_LISTS, type SeedLocale } from "./menu.js";

export interface SeedOptionListsInput {
  /** image basename -> product id, from `seedCatalogues`. */
  productsByImage: Map<string, string>;
  /** The authored locale. Both bare locales go on the row here, unlike the single-locale names
   *  `seedOptions` writes: `seedCatalogues` enables BOTH as content languages, so a list filled in
   *  one alone would show up in the translation-gap report as demo data to finish. This is the
   *  `fallbackLanguage` `createOptionList` checks those maps against. */
  locale: SeedLocale;
}

/**
 * Create every list in `PRODUCT_OPTION_LISTS` and attach it to its named product, in order.
 */
export async function seedOptionLists(
  tx: Transaction,
  { productsByImage, locale }: SeedOptionListsInput,
): Promise<void> {
  for (const { productImage, lists } of PRODUCT_OPTION_LISTS) {
    const productId = productsByImage.get(productImage);
    if (productId === undefined) {
      throw new Error(`seedOptionLists: no seeded product for image '${productImage}'`);
    }
    const refs: ProductModifierRef[] = [];
    for (const list of lists) {
      // The label ids are minted HERE rather than left to `createOptionList`, because
      // `defaultLabelId` has to name one of the labels in the same body. The contract has two
      // different answers for a default that does not, and neither is silent success: one naming no
      // label of the body is REFUSED, `options.invalid` with `field: "defaultLabelId"`
      // (`option-contract.ts:139`), and one naming a label that exists but is unavailable is dropped
      // to null (`:145-147`). A misaligned default here would therefore fail the whole demo seed.
      const labels = list.labels.map((label) => ({ id: randomUUID(), ...label }));
      const created = await createOptionList(
        tx,
        {
          name: list.name,
          customerName: list.customerName,
          kitchenName: list.kitchenName,
          defaultLabelId: labels.find((label) => label.preselected)?.id ?? null,
          active: true,
          // `preselected` is the SEED's own word for which label the default names; it is not a key
          // the contract accepts, and passing it through would be refused as `options.invalid`.
          labels: labels.map(({ id, name, customerName, kitchenName }) => ({
            id,
            name,
            customerName,
            kitchenName,
            available: true,
          })),
        },
        locale,
      );
      refs.push({ kind: "options", id: created.id });
    }
    // One call per product with every list it carries: this REPLACES the product's whole attachment
    // list (`writeProductModifiers`, product-modifiers.ts).
    await writeProductModifiers(tx, productId, refs);
  }
}
