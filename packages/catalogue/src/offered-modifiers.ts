import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { readMenuExtras, readProductExtras } from "./extra-projection.js";
import type { ResolvedExtraList } from "./extra-projection.js";
import { readOptionListsByIds } from "./options.js";
import { readProductModifiers } from "./product-modifiers.js";
import { expandDietaryDeclarations, validateDietaryDeclarations } from "./dietary-declarations.js";
import type { OptionList } from "./modifier-list-types.js";
import type { ProductModifierRef } from "./product-types.js";
import type { VatClass } from "./pricing.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";
import type { OfferedExtraItem, OfferedModifier } from "./menu-types.js";

/**
 * One dish whose attachments are being resolved: the product it sells, and the menu offer it was
 * selected through, or null when the line names a plain product and no offer is involved.
 */
export interface ModifierHolder {
  productId: string;
  menuItemId: string | null;
}

/**
 * Every extras and options definition a set of dishes attaches, read together.
 *
 * Both the ORDER path and the two sell-side reads resolve this from one body, which is what keeps
 * them in step: what a till is offered has to be exactly the set
 * `validateExtraSelections`/`validateOptionSelections` (extra-contract.ts, option-contract.ts) will
 * answer, or a required list the till never drew refuses the order.
 */
export interface AttachedModifiers {
  /** Keyed by MENU-ITEM id on the offer path and by PRODUCT id otherwise — extras are published by
   * the offer when there is one and held by the product when there is not (spec §3.2). */
  extrasByHolder: ReadonlyMap<string, ResolvedExtraList[]>;
  /** Keyed by the underlying PRODUCT id on both paths: an options list is attached to the product
   * and a menu offer neither republishes nor narrows one (spec §3.1). */
  optionsByProduct: ReadonlyMap<string, OptionList[]>;
}

/**
 * {@link AttachedModifiers} plus the attachment walk that produced it — each product's ordered
 * attachment list, keyed as `readProductModifiers` keys it, by the LOWER-CASED product id.
 *
 * Not published: the walk is how {@link readOfferedModifiers} interleaves a dish's extras and
 * options into the one order a till draws (spec §5), and that is the only thing that reads it.
 */
interface WalkedAttachments extends AttachedModifiers {
  attachments: ReadonlyMap<string, ProductModifierRef[]>;
}

/**
 * Resolve {@link AttachedModifiers} for a set of dishes: a bounded number of queries whatever the
 * number of dishes, and never one per dish (CLAUDE.md §3).
 *
 * INACTIVE lists come back too, carrying their own `active` flag, because the two validators read
 * that flag to answer only the active lists of the set they are handed — so the order path has to
 * hand them the whole set. A read that DRAWS the lists filters them itself; {@link
 * readOfferedModifiers} does.
 */
export async function resolveAttachedModifiers(
  tx: Transaction,
  dishes: readonly ModifierHolder[],
): Promise<AttachedModifiers> {
  const { extrasByHolder, optionsByProduct } = await walkAttachedModifiers(tx, dishes);
  return { extrasByHolder, optionsByProduct };
}

/** {@link resolveAttachedModifiers}'s body, keeping the walk it read on the way. */
async function walkAttachedModifiers(
  tx: Transaction,
  dishes: readonly ModifierHolder[],
): Promise<WalkedAttachments> {
  const productIds = [...new Set(dishes.map((dish) => dish.productId))];
  const menuItemIds = [
    ...new Set(dishes.flatMap((dish) => (dish.menuItemId === null ? [] : [dish.menuItemId]))),
  ];
  const productOnlyIds = [
    ...new Set(dishes.flatMap((dish) => (dish.menuItemId === null ? [dish.productId] : []))),
  ];
  // Every dish's attachments, read ONCE: the options side below needs them for the whole set, and
  // `readProductExtras` would otherwise ask the same table for the same ids on the same transaction
  // as its own first statement. Awaited in turn with the reads below, never in parallel
  // (CLAUDE.md §3).
  const attachments = await readProductModifiers(tx, productIds);

  // Each dish is read on the side its own identity puts it on, so a set mixing offer lines with
  // plain product lines resolves both. The two key spaces are distinct ids, so nothing collides.
  const extrasByHolder = new Map<string, ResolvedExtraList[]>();
  if (menuItemIds.length > 0) {
    for (const [holder, lists] of await readMenuExtras(tx, menuItemIds)) {
      extrasByHolder.set(holder, lists);
    }
  }
  if (productOnlyIds.length > 0) {
    for (const [holder, lists] of await readProductExtras(tx, productOnlyIds, attachments)) {
      extrasByHolder.set(holder, lists);
    }
  }
  const optionLists = new Map(
    (
      await readOptionListsByIds(tx, [
        ...new Set(
          [...attachments.values()].flatMap((refs) =>
            refs.flatMap((ref) => (ref.kind === "options" ? [ref.id] : [])),
          ),
        ),
      ])
    ).map((list) => [list.id, list]),
  );
  const optionsByProduct = new Map(
    [...attachments].map(([productId, refs]): [string, OptionList[]] => [
      productId,
      refs.flatMap((ref) => {
        const list = ref.kind === "options" ? optionLists.get(ref.id) : undefined;
        return list === undefined ? [] : [list];
      }),
    ]),
  );
  return { attachments, extrasByHolder, optionsByProduct };
}

/** The `products` columns an offered extras item borrows — everything its own row deliberately does
 * not duplicate (spec §3.1). Named apart from `ExtraProductFacts`
 * (apps/server/src/modifier-selection.ts), which is the ORDER path's different shape of the same
 * row: that one carries customer text already resolved to one language, this one carries the raw
 * map plus the allergens and dietary labels a picker draws. */
type OfferedExtraItemFacts = Omit<OfferedExtraItem, "price" | "maxQuantity" | "preselected">;

/**
 * The `products` row behind each extras item: its own three names, as stored, and the EFFECTIVE VAT
 * class, allergens and dietary labels — a variant's own, or its parent's where it leaves one blank.
 * One query for every id, and none at all when there are none. Both the sell-side read below and
 * the order path (`resolveBasketModifiers`, `apps/server/src/working-order.ts`) read an extras
 * item's product through this, so what a till draws and what an order is taxed at come from the
 * same query.
 */
export async function readExtraItemProducts(tx: Transaction, productIds: readonly string[]) {
  if (productIds.length === 0) return [];
  const rows = await tx
    .select({
      id: products.id,
      name: products.name,
      customerName: products.customerName,
      kitchenName: products.kitchenName,
      vatClass: effectiveProductColumns.vatClass,
      allergens: effectiveProductColumns.allergens,
      dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(products.id, [...productIds]));
  return rows.map((row) => ({ ...row, vatClass: row.vatClass as VatClass }));
}

/** {@link readExtraItemProducts}, in the shape a picker draws. */
async function readExtraProducts(
  tx: Transaction,
  productIds: string[],
): Promise<Map<string, OfferedExtraItemFacts>> {
  const rows = await readExtraItemProducts(tx, productIds);
  return new Map(
    rows.map((row) => [
      row.id,
      {
        productId: row.id,
        name: row.name,
        customerName: row.customerName,
        kitchenName: row.kitchenName,
        vatClass: row.vatClass,
        addAllergens: row.allergens,
        suitableFor: expandDietaryDeclarations(
          validateDietaryDeclarations(row.dietaryDeclarations),
        ),
      },
    ]),
  );
}

/** One walked entry before its extras items have borrowed their products' facts. */
type WalkedList =
  { kind: "extras"; list: ResolvedExtraList } | { kind: "options"; list: OptionList };

/**
 * The ordered extras and options lists each dish offers a till, keyed by the MENU-ITEM id when the
 * dish was reached through an offer and by the PRODUCT id when it was not — the same holder keying
 * {@link AttachedModifiers.extrasByHolder} uses, and the same LOWER-CASED form the uuid columns
 * hand back, so a caller holding an upper-cased id lower-cases it before looking one up.
 *
 * The walk is the product's own `product_modifiers.sort` order on BOTH paths (spec §5: the one
 * ordered list a product exposes). A menu offer changes what is IN an extras entry — its items
 * narrowed and repriced by `menu_item_extra_items` (spec §3.2) — and whether the entry is there at
 * all, because a list the offer does not publish has no resolved version to draw; it does not move
 * the entry, so `menu_item_extra_lists.display_order` decides nothing here.
 *
 * Only ACTIVE lists are offered, and an options list offers only its AVAILABLE labels: that is
 * exactly what `validateExtraSelections` (extra-contract.ts:246,277) and
 * `validateOptionSelections` (option-contract.ts:148,171) will accept an answer from. An item whose
 * `products` row has gone is left out, for the reason `priceItems` (extra-projection.ts) leaves out
 * an item it cannot price: there is nothing to draw it with. That is the safe direction — the
 * validator would still accept a pick of it — and it is the same read-committed race that file
 * documents, not a state the `ON DELETE RESTRICT` key allows at any one instant.
 *
 * A bounded number of queries whatever the number of dishes: {@link walkAttachedModifiers}'s — the
 * same set {@link resolveAttachedModifiers} issues — plus one for the products the offered items
 * name.
 */
export async function readOfferedModifiers(
  tx: Transaction,
  dishes: readonly ModifierHolder[],
): Promise<Map<string, OfferedModifier[]>> {
  const { attachments, extrasByHolder, optionsByProduct } = await walkAttachedModifiers(tx, dishes);

  const walked = new Map<string, WalkedList[]>();
  for (const dish of dishes) {
    const productId = dish.productId.toLowerCase();
    const holder = (dish.menuItemId ?? dish.productId).toLowerCase();
    if (walked.has(holder)) continue;
    const extras = new Map((extrasByHolder.get(holder) ?? []).map((list) => [list.id, list]));
    const options = new Map((optionsByProduct.get(productId) ?? []).map((list) => [list.id, list]));
    walked.set(
      holder,
      (attachments.get(productId) ?? []).flatMap((ref): WalkedList[] => {
        if (ref.kind === "extras") {
          const list = extras.get(ref.id);
          return list === undefined || !list.active ? [] : [{ kind: "extras", list }];
        }
        const list = options.get(ref.id);
        return list === undefined || !list.active ? [] : [{ kind: "options", list }];
      }),
    );
  }

  const facts = await readExtraProducts(tx, [
    ...new Set(
      [...walked.values()].flatMap((entries) =>
        entries.flatMap((entry) =>
          entry.kind === "extras" ? entry.list.items.map((item) => item.productId) : [],
        ),
      ),
    ),
  ]);

  const offered = new Map<string, OfferedModifier[]>();
  for (const [holder, entries] of walked) {
    offered.set(
      holder,
      entries.map((entry): OfferedModifier => {
        if (entry.kind === "options") {
          const labels = entry.list.labels.filter((label) => label.available);
          return {
            kind: "options",
            id: entry.list.id,
            name: entry.list.name,
            customerName: entry.list.customerName,
            kitchenName: entry.list.kitchenName,
            // Dropped when it names no label still on offer. `option_lists.default_label_id` carries
            // no foreign key (schema/options.ts) and nothing re-checks it after a label is
            // withdrawn, so a till preselecting it would send an answer
            // `validateOptionSelections` refuses with `options.label_required`.
            defaultLabelId: labels.some((label) => label.id === entry.list.defaultLabelId)
              ? entry.list.defaultLabelId
              : null,
            labels,
          };
        }
        return {
          kind: "extras",
          id: entry.list.id,
          name: entry.list.name,
          customerName: entry.list.customerName,
          kitchenName: entry.list.kitchenName,
          minPicks: entry.list.minPicks,
          maxPicks: entry.list.maxPicks,
          items: entry.list.items.flatMap((item): OfferedExtraItem[] => {
            const product = facts.get(item.productId);
            return product === undefined
              ? []
              : [
                  {
                    ...product,
                    price: item.price,
                    maxQuantity: item.maxQuantity,
                    preselected: item.preselected,
                  },
                ];
          }),
        };
      }),
    );
  }
  return offered;
}
