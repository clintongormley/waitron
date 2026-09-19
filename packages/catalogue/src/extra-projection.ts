import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { menuItemExtraItems, menuItemExtraLists } from "./schema/extras.js";
import { readExtraListsByIds, resolveExtraPrice } from "./extras.js";
import type { ExtraList, ExtraListItem } from "./extra-contract.js";

/**
 * A list item as one menu offer sells it. The one difference from {@link ExtraListItem} is the
 * price: there it is nullable, meaning "inherit", and here it is always a string, because the
 * inheritance has been resolved. A till or a menu screen has no way to resolve it — the fallback
 * chain ends at the product's `unit_price`, which is not on the item — so the projection must.
 */
export type MenuExtraListItem = Omit<ExtraListItem, "price"> & { price: string };

/** A published list with its items resolved and narrowed for this menu offer. */
export type MenuExtraList = Omit<ExtraList, "items"> & { items: MenuExtraListItem[] };

const key = (menuItemId: string, listId: string, productId: string) =>
  `${menuItemId}\u0000${listId}\u0000${productId}`;

/**
 * What each menu offer publishes: its extras lists in `display_order`, each narrowed and repriced
 * by that offer's own rows (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md`
 * §3.2), the heir of `readMenuModifiers` (modifier-projection.ts).
 *
 * A list item with NO row in `menu_item_extra_items` is offered here at its own resolved price; a
 * row replaces that price when it carries one and withdraws the item when `available` is false —
 * the semantics `setMenuItemExtraLists` (extras.ts) documents, and the opposite of the option path,
 * where a row's presence is the publication. A row naming a product the list no longer offers is
 * read by nothing here, which is the other half of that table's missing foreign key
 * (schema/extras.ts).
 *
 * An INACTIVE list is returned rather than dropped, with its `active` flag. The option path does
 * not settle the question: `listModifiers` (modifiers.ts:41-45) reports every group as
 * `available: true` whatever `option_groups.active` holds, so it neither drops an inactive
 * definition nor hands the caller a flag to act on. This does hand one over, because there is
 * already a consumer for it — `validateExtraSelections` (extra-contract.ts:199) answers only the
 * ACTIVE lists of the set it is given.
 *
 * A bounded number of queries whatever the number of menu items: the publications, the lists, their
 * items, this offer's overrides, and the products the items name.
 */
export async function readMenuExtras(
  tx: Transaction,
  menuItemIds: string[],
): Promise<Map<string, MenuExtraList[]>> {
  const result = new Map<string, MenuExtraList[]>();
  if (menuItemIds.length === 0) return result;
  const publications = await tx
    .select({
      menuItemId: menuItemExtraLists.menuItemId,
      listId: menuItemExtraLists.listId,
    })
    .from(menuItemExtraLists)
    .where(inArray(menuItemExtraLists.menuItemId, menuItemIds))
    .orderBy(menuItemExtraLists.displayOrder, menuItemExtraLists.listId);
  if (publications.length === 0) return result;

  const definitions = new Map(
    (
      await readExtraListsByIds(tx, [
        ...new Set(publications.map((publication) => publication.listId)),
      ])
    ).map((list) => [list.id, list]),
  );
  const overrides = new Map(
    (
      await tx
        .select()
        .from(menuItemExtraItems)
        .where(inArray(menuItemExtraItems.menuItemId, menuItemIds))
    ).map((row) => [
      key(row.menuItemId, row.listId, row.productId),
      { price: row.price, available: row.available },
    ]),
  );
  const named = [
    ...new Set(
      [...definitions.values()].flatMap((list) => list.items.map((item) => item.productId)),
    ),
  ];
  const unitPrices = new Map(
    named.length === 0
      ? []
      : (
          await tx
            .select({ id: products.id, unitPrice: products.unitPrice })
            .from(products)
            .where(inArray(products.id, named))
        ).map((product) => [product.id, product.unitPrice]),
  );

  for (const publication of publications) {
    // The publications and the lists are read by two separate statements, and under read-committed
    // each takes its own snapshot, so a list deleted between them leaves a publication row here
    // with no definition to project. Skipping it shows the offer without that list, which is what
    // the delete did to it anyway.
    const definition = definitions.get(publication.listId);
    if (definition === undefined) continue;
    const items = definition.items.flatMap((item): MenuExtraListItem[] => {
      const override = overrides.get(key(publication.menuItemId, definition.id, item.productId));
      if (override?.available === false) return [];
      // The product row exists: `extra_list_items_product_fk` is ON DELETE RESTRICT
      // (schema/extras.ts), so a list item cannot outlive the product it names.
      const unitPrice = unitPrices.get(item.productId)!;
      return [{ ...item, price: resolveExtraPrice(item, { unitPrice }, override?.price) }];
    });
    const held = result.get(publication.menuItemId) ?? [];
    held.push({ ...definition, items });
    result.set(publication.menuItemId, held);
  }
  return result;
}
