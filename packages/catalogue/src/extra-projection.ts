import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { centsToDecimal } from "@waitron/shared";
import { menuItemExtraItems, menuItemExtraLists } from "./schema/extras.js";
import { readExtraListsByIds, resolveExtraPrice } from "./extras.js";
import { readProductModifiers } from "./product-modifiers.js";
import type { ExtraList, ExtraListItem } from "./extra-contract.js";
import type { ProductModifierRef } from "./product-modifiers.js";

/**
 * A list item with its price already settled. The one difference from {@link ExtraListItem} is that
 * price: there it is nullable, meaning "inherit", and here it is always a string, because the
 * inheritance has been resolved. A till or a menu screen has no way to resolve it — the fallback
 * chain ends at the product's `unit_price`, which is not on the item — so a projection must.
 */
export type ResolvedExtraListItem = Omit<ExtraListItem, "price"> & { price: string };

/** A list with every item priced — what both projections in this file hand back. */
export type ResolvedExtraList = Omit<ExtraList, "items"> & { items: ResolvedExtraListItem[] };

const key = (menuItemId: string, listId: string, productId: string) =>
  `${menuItemId}\u0000${listId}\u0000${productId}`;

/**
 * One item still to be priced, with the menu price that outranks its own — null when there is no
 * menu offer in the question at all, which is the product read's case.
 */
type Candidate = { item: ExtraListItem; menuPrice: string | null };

/**
 * The `unit_price` of every product an item still has to borrow one from, and no others: only an
 * item with no menu price AND no price of its own ever reaches the product's row
 * (`resolveExtraPrice`, extras.ts). ONE query whatever the number of candidates, and none when
 * nothing has to borrow.
 */
async function borrowedUnitPrices(
  tx: Transaction,
  candidates: Candidate[],
): Promise<Map<string, { unitPrice: string }>> {
  const named = [
    ...new Set(
      candidates.flatMap(({ item, menuPrice }) =>
        menuPrice === null && item.price === null ? [item.productId] : [],
      ),
    ),
  ];
  if (named.length === 0) return new Map();
  const rows = await tx
    .select({ id: products.id, unitPrice: products.unitPrice })
    .from(products)
    .where(inArray(products.id, named));
  return new Map(
    rows.map((product) => [product.id, { unitPrice: centsToDecimal(product.unitPrice) }]),
  );
}

/**
 * The candidates that can be priced, in the order they came in.
 *
 * An item that has to borrow its product's price and cannot is left out: it cannot be priced, so it
 * cannot be sold. It narrows the LIST as well, so these projections can hand back an ACTIVE list
 * with no items at all — a shape `parseExtraListInput` (extra-contract.ts) refuses outright on the
 * authoring side. An order answering such a list reaches `validateExtraSelections`
 * (extra-contract.ts) through `buildLineExtras` (apps/server/src/modifier-selection.ts), and finds
 * nothing to pick: a list whose `minPicks` is above zero then refuses the line rather than selling
 * the dish without the item. What pins that refusal is
 * "does not let an omitted payload waive a required extras list the menu offer has emptied"
 * (apps/server/src/working-order.test.ts), which reaches the same empty-ACTIVE-list shape by the
 * other route — a menu offer withdrawing the item — rather than by an unpriceable one.
 * `extra_list_items_product_fk` is ON DELETE RESTRICT
 * (schema/extras.ts), which forbids that state at any ONE instant. On PostgreSQL it was still
 * reachable: the items and the products were read by two statements with a read-committed snapshot
 * each, so another transaction could drop the item from the list and then delete the product in
 * between, and the case that reproduced it did exactly that. One write transaction runs on the
 * venue file at a time now, so a read taken inside `withTransaction` cannot be torn that way;
 * "leaves out a list item whose product has gone" (extras.concurrency.test.ts) writes the same row
 * directly instead, and that case's own note says how and why.
 */
function priceItems(
  candidates: Candidate[],
  unitPrices: Map<string, { unitPrice: string }>,
): ResolvedExtraListItem[] {
  return candidates.flatMap(({ item, menuPrice }): ResolvedExtraListItem[] => {
    const price = resolveExtraPrice(item, unitPrices.get(item.productId), menuPrice);
    return price === undefined ? [] : [{ ...item, price }];
  });
}

/**
 * The step both reads below finish with: borrow the `unit_price` of every item that still needs
 * one, settle each list's prices, and group the lists under whatever HOLDS them — a menu offer in
 * one read, a product in the other. Each entry's `holder` is the id the caller wants its map keyed
 * by, and the order of `offered` is the order each holder's lists come back in.
 */
async function resolveHeldLists(
  tx: Transaction,
  offered: { holder: string; definition: ExtraList; items: Candidate[] }[],
): Promise<Map<string, ResolvedExtraList[]>> {
  const unitPrices = await borrowedUnitPrices(
    tx,
    offered.flatMap(({ items }) => items),
  );
  const result = new Map<string, ResolvedExtraList[]>();
  for (const { holder, definition, items } of offered) {
    const held = result.get(holder) ?? [];
    held.push({ ...definition, items: priceItems(items, unitPrices) });
    result.set(holder, held);
  }
  return result;
}

/**
 * What each menu offer publishes: its extras lists in `display_order`, each narrowed and repriced
 * by that offer's own rows (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md`
 * §3.2).
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
 * set it is handed. The order path is what joins the two: `resolveBasketModifiers`
 * (apps/server/src/working-order.ts) resolves one basket's lists through this function and hands
 * them to `buildLineExtras` (apps/server/src/modifier-selection.ts), which calls that validator.
 *
 * A bounded number of queries whatever the number of menu items: the publications, the lists, their
 * items, this offer's overrides, and the products whose own price an item still has to borrow.
 */
export async function readMenuExtras(
  tx: Transaction,
  menuItemIds: string[],
): Promise<Map<string, ResolvedExtraList[]>> {
  if (menuItemIds.length === 0) return new Map();
  const publications = await tx
    .select({
      menuItemId: menuItemExtraLists.menuItemId,
      listId: menuItemExtraLists.listId,
    })
    .from(menuItemExtraLists)
    .where(inArray(menuItemExtraLists.menuItemId, menuItemIds))
    .orderBy(menuItemExtraLists.displayOrder, menuItemExtraLists.listId);
  if (publications.length === 0) return new Map();

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
      // A null override price means "no menu price", which is not the same offer as a price of
      // zero: the chain below falls through on null and stops on 0.00.
      { price: row.price === null ? null : centsToDecimal(row.price), available: row.available },
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
    const items = definition.items.flatMap((item): Candidate[] => {
      const override = overrides.get(key(publication.menuItemId, definition.id, item.productId));
      if (override?.available === false) return [];
      return [{ item, menuPrice: override?.price ?? null }];
    });
    return [{ holder: publication.menuItemId, definition, items }];
  });

  return resolveHeldLists(tx, offered);
}

/**
 * What each PRODUCT itself carries: the extras lists attached to it in `product_modifiers`, in the
 * product's own attachment order, each item priced from the list item and then from the product
 * (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.3, minus the menu step —
 * no menu offer is involved in this read at all, so an offer's overrides and withdrawals are
 * invisible here).
 *
 * The value is the same {@link ResolvedExtraList} the menu read returns, rather than a type of its
 * own with identical members: the difference between the two reads is where a price came from, not
 * what the caller is handed, and two names for one shape would let the halves drift apart while
 * both claimed to be "a list with its prices resolved".
 *
 * Keyed by product id in the LOWER-CASED form the uuid column hands back, whatever case the caller
 * asked in, so a caller holding an upper-cased id has to lower-case it before looking one up — the
 * same rule `readProductModifiers` (product-modifiers.ts) states, because this map's keys are that
 * map's keys.
 *
 * A product carrying no extras list has no entry, and an OPTIONS list attached to the same product
 * is not this function's business — it is dropped here and read by the options path instead.
 *
 * An INACTIVE list is returned rather than dropped, for the reason {@link readMenuExtras} gives:
 * the `active` flag is what `validateExtraSelections` (extra-contract.ts) reads to answer only the
 * active lists of the set it is handed. An item nothing can price is left out, for the reason
 * {@link priceItems} gives.
 *
 * A bounded number of queries whatever the number of products: the attachments, the lists, their
 * items, and the products whose own price an item still has to borrow — four, one fewer than the
 * menu read, which also reads the offer's overrides.
 *
 * `attachments` is the answer to the FIRST of those four, when the caller has already read it for a
 * wider set of products than this one — as the order path does, which reads `product_modifiers`
 * once per basket for the options side too (`resolveBasketModifiers`,
 * apps/server/src/working-order.ts). It is narrowed to `productIds` here, so a caller may hand over
 * the map it read for a superset and still get exactly what it asked for. Omitted, the read asks
 * the question itself, which is what every other caller does.
 */
export async function readProductExtras(
  tx: Transaction,
  productIds: string[],
  attachments?: ReadonlyMap<string, ProductModifierRef[]>,
): Promise<Map<string, ResolvedExtraList[]>> {
  // `readProductModifiers` keys its map by the LOWER-CASED form the uuid column hands back
  // (product-modifiers.ts), so the narrowing compares in that form whatever case the caller asked
  // in — the same rule this function's own keys follow.
  const named = new Set(productIds.map((productId) => productId.toLowerCase()));
  const held = attachments ?? (await readProductModifiers(tx, productIds));
  const carried = [...held].flatMap(([productId, refs]) =>
    named.has(productId)
      ? refs.flatMap((ref) => (ref.kind === "extras" ? [{ productId, listId: ref.id }] : []))
      : [],
  );
  if (carried.length === 0) return new Map();

  const lists = await readExtraListsByIds(tx, [...new Set(carried.map((each) => each.listId))]);
  const definitions = new Map(lists.map((list) => [list.id, list]));

  // An attachment whose list has no definition is skipped, exactly as an unmatched publication is
  // in {@link readMenuExtras} and for the same reason: the attachments and the lists are two
  // statements, each with its own read-committed snapshot, so a list deleted between them leaves
  // an attachment row with nothing to project.
  const offered = carried.flatMap(({ productId, listId }) => {
    const definition = definitions.get(listId);
    if (definition === undefined) return [];
    // No menu row is consulted, so every item's menu price is absent and the chain starts at the
    // list item's own price.
    return [
      {
        holder: productId,
        definition,
        items: definition.items.map((item): Candidate => ({ item, menuPrice: null })),
      },
    ];
  });

  return resolveHeldLists(tx, offered);
}
