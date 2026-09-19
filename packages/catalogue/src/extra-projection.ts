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
 * An INACTIVE list is returned rather than dropped, carrying its `active` flag, because the flag is
 * what `validateExtraSelections` (extra-contract.ts) reads to answer only the ACTIVE lists of the
 * set it is handed. Nothing joins the two yet: on 2026-09-19 every caller of either is a test, and
 * no production code passes this function's output to that one.
 *
 * A bounded number of queries whatever the number of menu items: the publications, the lists, their
 * items, this offer's overrides, and the products whose own price an item still has to borrow.
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

  const lists = await readExtraListsByIds(tx, [
    ...new Set(publications.map((publication) => publication.listId)),
  ]);
  const definitions = new Map(lists.map((list) => [list.id, list]));
  const overrideRows = await tx
    .select()
    .from(menuItemExtraItems)
    .where(inArray(menuItemExtraItems.menuItemId, menuItemIds));
  const overrides = new Map(
    overrideRows.map((row) => [
      key(row.menuItemId, row.listId, row.productId),
      { price: row.price, available: row.available },
    ]),
  );

  // The publications and the lists are read by two separate statements, and under read-committed
  // each takes its own snapshot, so a list deleted between them leaves a publication row here with
  // no definition to project. Skipping it shows the offer without that list, which is what the
  // delete did to it anyway. Paired with its overrides in the same pass, so the next two steps —
  // which products still need a price read, and what each item finally costs — ask that question
  // once between them rather than once each.
  const offered = publications.flatMap((publication) => {
    const definition = definitions.get(publication.listId);
    if (definition === undefined) return [];
    const items = definition.items.flatMap((item) => {
      const override = overrides.get(key(publication.menuItemId, definition.id, item.productId));
      if (override?.available === false) return [];
      return [{ item, menuPrice: override?.price ?? null }];
    });
    return [{ menuItemId: publication.menuItemId, definition, items }];
  });

  // Only an item with no menu price AND no price of its own ever reaches the product's
  // `unit_price` (`resolveExtraPrice`, extras.ts), so those are the only products read — not every
  // product every published list names.
  const named = [
    ...new Set(
      offered.flatMap(({ items }) =>
        items.flatMap(({ item, menuPrice }) =>
          menuPrice === null && item.price === null ? [item.productId] : [],
        ),
      ),
    ),
  ];
  const productRows =
    named.length === 0
      ? []
      : await tx
          .select({ id: products.id, unitPrice: products.unitPrice })
          .from(products)
          .where(inArray(products.id, named));
  const unitPrices = new Map(
    productRows.map((product) => [product.id, { unitPrice: product.unitPrice }]),
  );

  for (const { menuItemId, definition, items } of offered) {
    const priced = items.flatMap(({ item, menuPrice }): MenuExtraListItem[] => {
      // An item that has to borrow its product's price and cannot is left out of the menu view: it
      // cannot be priced, so it cannot be sold. It narrows the LIST as well, which reaches further
      // than one item: if every item goes this way and the list is active with `minPicks` of 1 or
      // more, `validateExtraSelections` (extra-contract.ts) answers it with `extras.limit_exceeded`
      // whatever the diner picks, so the DISH becomes unorderable once the order path calls that
      // function (the plan's Task 7; nothing calls it today). And an active list with no items is a
      // shape `parseExtraListInput` refuses outright, so this projection can hand back one the
      // authoring contract treats as impossible. `extra_list_items_product_fk` is ON DELETE RESTRICT
      // (schema/extras.ts), which forbids that state at any ONE instant — but the items above and
      // the products here are two statements with a read-committed snapshot each, so another
      // transaction can drop the item from the list and then delete the product in between. Seen
      // that way, on a real backend, by "leaves out a list item whose product disappears between
      // the menu view's two reads" (extras.pg.test.ts).
      const price = resolveExtraPrice(item, unitPrices.get(item.productId), menuPrice);
      return price === undefined ? [] : [{ ...item, price }];
    });
    const held = result.get(menuItemId) ?? [];
    held.push({ ...definition, items: priced });
    result.set(menuItemId, held);
  }
  return result;
}
