// Seeds the retained option-group examples and the four canonical modifier types. The coffee also
// demonstrates defaults, caps, an unavailable choice, a direct dietary invalidation and a menu price
// that differs from the product definition.
//
// The deployment holds one tenant per database. `seedOptions` runs inside the CALLER's
// transaction, under the app_user role the caller selected with `withTransaction`/`asAppUser` — the same posture
// `seedCatalogues` uses in this database.
// `createOptionGroup`/`createOptionGroupItem`/`setProductOptionGroups` (`@waitron/catalogue`) are
// plain catalogue operations, not session-gated the way `createPerson` (`@waitron/identity`) is,
// so — like `seedCatalogues`'s `createProduct` — this calls them directly rather than
// raw-inserting.
//
import { randomUUID } from "node:crypto";
import {
  createModifier,
  createOptionGroup,
  createOptionGroupItem,
  setMenuItemOptionGroups,
  setProductOptionGroups,
} from "@waitron/catalogue";
import type { TenantId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { PRODUCT_OPTION_GROUPS, type SeedLocale } from "./menu.js";

export interface SeedOptionsInput {
  /** image basename -> product id, from `seedCatalogues`. */
  productsByImage: Map<string, string>;
  menuItemsByProduct: Map<string, string>;
  /** Which of the two authored locales each group/item name is created under (feature B "author bare,
   *  file/display full-tag" — content authored bare here, single-locale on the row, like `SeedProduct`
   *  descriptions in `seedCatalogues`). */
  locale: SeedLocale;
}

/**
 * Create every group in `PRODUCT_OPTION_GROUPS` and attach it to its named product, in order. The
 * coffee also receives one text, extras, options and yes/no modifier through the canonical contract.
 */
export async function seedOptions(
  tx: Transaction,
  tenantId: TenantId,
  { productsByImage, menuItemsByProduct, locale }: SeedOptionsInput,
): Promise<void> {
  for (const { productImage, groups } of PRODUCT_OPTION_GROUPS) {
    const productId = productsByImage.get(productImage);
    if (productId === undefined) {
      throw new Error(`seedOptions: no seeded product for image '${productImage}'`);
    }
    const groupIds: string[] = [];
    const menuGroups: { groupId: string; options: { optionId: string; priceDelta: string }[] }[] =
      [];
    for (const group of groups) {
      const created = await createOptionGroup(tx, tenantId, {
        name: { [locale]: group.name[locale] },
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        required: group.required,
      });
      // `sort` defaults to 0 for every row, so the read-back order (`listOptionGroupItems`,
      // `listAvailableProducts`) would otherwise fall back to the tiebreaker `id` — a random uuid —
      // rather than the authored order. Pass the array index explicitly so "Small" sorts before
      // "Large", "Rare" before "Medium" before "Well done", etc.
      const menuOptions: { optionId: string; priceDelta: string }[] = [];
      for (const [index, item] of group.items.entries()) {
        const createdItem = await createOptionGroupItem(tx, tenantId, created.id, {
          name: { [locale]: item.name[locale] },
          priceDelta: item.priceDelta,
          vatClass: item.vatClass,
          sort: index,
        });
        menuOptions.push({ optionId: createdItem.id, priceDelta: item.priceDelta });
      }
      groupIds.push(created.id);
      menuGroups.push({ groupId: created.id, options: menuOptions });
    }
    if (productImage === "cafe-solo.png") {
      const demoModifiers = [
        await createModifier(
          tx,
          tenantId,
          {
            type: "text",
            name: { en: "Demo preparation note", es: "Nota de preparación demo" },
            available: true,
          },
          locale,
        ),
        await createModifier(
          tx,
          tenantId,
          {
            type: "extras",
            name: { en: "Demo add-ons", es: "Extras demo" },
            available: true,
            required: false,
            maxTotalQuantity: 3,
            choices: [
              {
                id: randomUUID(),
                name: { en: "Extra shot", es: "Café extra" },
                available: true,
                priceDelta: "1.00",
                maxQuantity: 2,
                preselected: true,
                suitableFor: ["vegan", "vegetarian"],
              },
              {
                id: randomUUID(),
                name: { en: "Marshmallows", es: "Nubes" },
                available: true,
                priceDelta: "0.60",
                maxQuantity: 1,
                preselected: false,
                suitableFor: ["vegetarian"],
              },
              {
                id: randomUUID(),
                name: { en: "Seasonal syrup", es: "Sirope de temporada" },
                available: false,
                priceDelta: "0.75",
                maxQuantity: 1,
                preselected: false,
                suitableFor: ["vegan", "vegetarian"],
              },
            ],
          },
          locale,
        ),
        await createModifier(
          tx,
          tenantId,
          {
            type: "options",
            name: { en: "Demo cup", es: "Taza demo" },
            available: true,
            defaultChoiceId: null,
            choices: [
              {
                id: randomUUID(),
                name: { en: "Ceramic cup", es: "Taza de cerámica" },
                available: true,
                suitableFor: [],
              },
              {
                id: randomUUID(),
                name: { en: "Takeaway cup", es: "Vaso para llevar" },
                available: true,
                suitableFor: [],
              },
            ],
          },
          locale,
        ),
      ];
      for (const modifier of demoModifiers) {
        groupIds.push(modifier.id);
        const options =
          modifier.type === "extras"
            ? modifier.choices
                .filter((choice) => choice.available)
                .map((choice) => ({
                  optionId: choice.id,
                  priceDelta: choice.name.en === "Extra shot" ? "1.25" : choice.priceDelta,
                }))
            : modifier.type === "options"
              ? modifier.choices
                  .filter((choice) => choice.available)
                  .map((choice) => ({ optionId: choice.id, priceDelta: "0.00" }))
              : [];
        menuGroups.push({
          groupId: modifier.id,
          options,
        });
      }
    }
    await setProductOptionGroups(tx, tenantId, productId, groupIds);
    const menuItemId = menuItemsByProduct.get(productId);
    if (menuItemId === undefined) {
      throw new Error(`seedOptions: no menu item for product '${productId}'`);
    }
    await setMenuItemOptionGroups(tx, menuItemId, menuGroups);
  }
}
