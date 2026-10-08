import { createExtraList, readProductModifiers, writeProductModifiers } from "@waitron/catalogue";
import type { ProductModifierRef } from "@waitron/catalogue";
import type { Transaction } from "@waitron/db";
import type { SeedOptionListsInput } from "./seed-option-lists.js";
import { inLanguages } from "./in-languages.js";

export async function seedExtraLists(
  tx: Transaction,
  { productsByImage, locale, dataSet, languages }: SeedOptionListsInput,
): Promise<void> {
  const productFor = (image: string): string => {
    const id = productsByImage.get(image);
    if (id === undefined) throw new Error(`seedExtraLists: no seeded product for image '${image}'`);
    return id;
  };
  for (const { productImage, lists } of dataSet.productExtraLists) {
    const productId = productFor(productImage);
    const held = await readProductModifiers(tx, [productId]);
    const refs: ProductModifierRef[] = [...(held.get(productId) ?? [])];
    for (const list of lists) {
      const created = await createExtraList(
        tx,
        {
          name: list.name,
          customerName: inLanguages(list.customerName, languages),
          kitchenName: list.kitchenName,
          minPicks: list.minPicks,
          maxPicks: list.maxPicks,
          active: true,
          items: list.items.map(({ productImage, price, portion, maxQuantity }) => ({
            productId: productFor(productImage),
            price,
            portion,
            maxQuantity,
            preselected: false,
          })),
        },
        locale,
      );
      refs.push({ kind: "extras", id: created.id });
    }
    // This writer replaces all attachments, so keep options that were seeded first.
    await writeProductModifiers(tx, productId, refs);
  }
}
