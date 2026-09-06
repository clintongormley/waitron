// `seedOptions` — the demo-seed's option-group step (Phase 4, Task 13). Attaches the demo modifier
// groups authored in `menu.ts` (`PRODUCT_OPTION_GROUPS`) — Size/Milk on the coffee, Extras/Cooking on
// the steak — so the till shows a picker on those two products, the receipt/basket group their
// modifier lines, and the dashboard's option-group manager has real content to show off.
//
// The deployment holds one tenant per database. `seedOptions` runs inside the CALLER's
// transaction, under the app_user role the caller selected with `withTenant`/`asAppUser` — the same posture
// `seedCatalogues` uses in this database.
// `createOptionGroup`/`createOptionGroupItem`/`setProductOptionGroups` (`@waitron/catalogue`) are
// plain catalogue operations, not session-gated the way `createPerson` (`@waitron/identity`) is,
// so — like `seedCatalogues`'s `createProduct` — this calls them directly rather than
// raw-inserting.
//
// Only EACH-priced products may carry option groups: the ring path rejects options on a `weight`
// product (`options.unsupported_product`, apps/server/src/working-order.ts). `PRODUCT_OPTION_GROUPS`
// only ever names each-priced images by construction (menu.ts), but this re-checks it against the
// menu data before attaching — a defensive, fail-loud guard rather than trusting the naming by eye.

import {
  createOptionGroup,
  createOptionGroupItem,
  setProductOptionGroups,
} from "@waitron/catalogue";
import type { TenantId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { CASA_DELGADO, MENU_DEL_DIA, PRODUCT_OPTION_GROUPS, type SeedLocale } from "./menu.js";

export interface SeedOptionsInput {
  /** image basename -> product id, from `seedCatalogues`. */
  productsByImage: Map<string, string>;
  /** Which of the two authored locales each group/item name is created under (feature B "author bare,
   *  file/display full-tag" — content authored bare here, single-locale on the row, like `SeedProduct`
   *  descriptions in `seedCatalogues`). */
  locale: SeedLocale;
}

/** The `pricingUnit` menu.ts declares for the product carrying `image`, or `undefined` if no product
 *  in either demo catalogue uses that basename. Scans both catalogues once per lookup — a handful of
 *  calls at seed time, not a hot path. */
function pricingUnitFor(image: string): "each" | "weight" | undefined {
  for (const catalogue of [CASA_DELGADO, MENU_DEL_DIA]) {
    for (const category of catalogue.categories) {
      for (const product of category.products) {
        if (product.image === image) return product.pricingUnit;
      }
    }
  }
  return undefined;
}

/**
 * Create every group in `PRODUCT_OPTION_GROUPS` and attach it to its named product, in order. Each
 * product's groups are created fresh and attached via `setProductOptionGroups` (a full replace, but
 * this always runs against a just-seeded, group-less product, so it is equivalent to an append here).
 */
export async function seedOptions(
  tx: Transaction,
  tenantId: TenantId,
  { productsByImage, locale }: SeedOptionsInput,
): Promise<void> {
  for (const { productImage, groups } of PRODUCT_OPTION_GROUPS) {
    const productId = productsByImage.get(productImage);
    if (productId === undefined) {
      throw new Error(`seedOptions: no seeded product for image '${productImage}'`);
    }
    const unit = pricingUnitFor(productImage);
    if (unit !== "each") {
      throw new Error(
        `seedOptions: '${productImage}' is not an each-priced product (pricingUnit=${String(unit)}) — ` +
          "the sale path rejects options on a weight product (options.unsupported_product)",
      );
    }

    const groupIds: string[] = [];
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
      for (const [index, item] of group.items.entries()) {
        await createOptionGroupItem(tx, tenantId, created.id, {
          name: { [locale]: item.name[locale] },
          priceDelta: item.priceDelta,
          vatClass: item.vatClass,
          sort: index,
        });
      }
      groupIds.push(created.id);
    }
    await setProductOptionGroups(tx, tenantId, productId, groupIds);
  }
}
