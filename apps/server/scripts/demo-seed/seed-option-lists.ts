// `createOptionList` and `writeProductModifiers` are not session-gated, so this calls them directly
// rather than raw-inserting.

import { randomUUID } from "node:crypto";
import { createOptionList, writeProductModifiers } from "@waitron/catalogue";
import type { ProductModifierRef } from "@waitron/catalogue";
import type { Transaction } from "@waitron/db";
import type { SeedLocale } from "./menu.js";
import type { DemoDataSet } from "./data-set.js";
import { inLanguages } from "./in-languages.js";

export interface SeedOptionListsInput {
  /** image basename -> product id, from `seedCatalogues`. */
  productsByImage: Map<string, string>;
  /** The `fallbackLanguage` `createOptionList` checks the names against. */
  locale: SeedLocale;
  dataSet: DemoDataSet;
  /** The venue's content languages; every customer-facing name is cut to them. */
  languages: readonly string[];
}

export async function seedOptionLists(
  tx: Transaction,
  { productsByImage, locale, dataSet, languages }: SeedOptionListsInput,
): Promise<void> {
  for (const { productImage, lists } of dataSet.productOptionLists) {
    const productId = productsByImage.get(productImage);
    if (productId === undefined) {
      throw new Error(`seedOptionLists: no seeded product for image '${productImage}'`);
    }
    const refs: ProductModifierRef[] = [];
    for (const list of lists) {
      // The label ids are minted HERE because `defaultLabelId` has to name one of the labels in the
      // same body; `parseOptionListInput` refuses one that does not.
      const labels = list.labels.map((label) => ({ id: randomUUID(), ...label }));
      const created = await createOptionList(
        tx,
        {
          name: list.name,
          customerName: inLanguages(list.customerName, languages),
          kitchenName: list.kitchenName,
          defaultLabelId: labels.find((label) => label.preselected)?.id ?? null,
          active: true,
          // `preselected` is the SEED's own word for which label the default names; it is not a key
          // the contract accepts, and passing it through would be refused as `options.invalid`.
          labels: labels.map(({ id, name, customerName, kitchenName }) => ({
            id,
            name,
            customerName: inLanguages(customerName, languages),
            kitchenName,
            available: true,
          })),
        },
        locale,
      );
      refs.push({ kind: "options", id: created.id });
    }
    // One call per product with every list it carries: this REPLACES the product's whole attachment
    // list.
    await writeProductModifiers(tx, productId, refs);
  }
}
