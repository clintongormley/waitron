import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
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
 * selected through, or null when no offer is involved (`listAvailableProducts`).
 */
export interface ModifierHolder {
  productId: string;
  menuItemId: string | null;
}

/**
 * Every extras and options definition a set of dishes attaches, read together.
 *
 * The ORDER path and the sell-side reads resolve this from one body so they stay in step: what a
 * till is offered has to be exactly the set the selection validators will answer, or a required list
 * the till never drew refuses the order.
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
 * {@link AttachedModifiers} plus each product's ordered attachment list, keyed by the LOWER-CASED
 * product id, which {@link readOfferedModifiers} walks to interleave extras and options (spec §5).
 */
interface WalkedAttachments extends AttachedModifiers {
  attachments: ReadonlyMap<string, ProductModifierRef[]>;
}

/**
 * Resolve {@link AttachedModifiers} for a set of dishes: a bounded number of queries whatever the
 * number of dishes, and never one per dish (CLAUDE.md §3).
 *
 * INACTIVE lists come back too, because the two validators read each list's `active` flag
 * themselves. A read that DRAWS the lists filters them itself.
 */
export async function resolveAttachedModifiers(
  tx: Transaction,
  dishes: readonly ModifierHolder[],
): Promise<AttachedModifiers> {
  const { extrasByHolder, optionsByProduct } = await walkAttachedModifiers(tx, dishes);
  return { extrasByHolder, optionsByProduct };
}

async function walkAttachedModifiers(
  tx: Transaction,
  dishes: readonly ModifierHolder[],
  includeEveryModifierItem = false,
): Promise<WalkedAttachments> {
  const productIds = [...new Set(dishes.map((dish) => dish.productId))];
  const menuItemIds = [
    ...new Set(dishes.flatMap((dish) => (dish.menuItemId === null ? [] : [dish.menuItemId]))),
  ];
  const productOnlyIds = [
    ...new Set(dishes.flatMap((dish) => (dish.menuItemId === null ? [dish.productId] : []))),
  ];
  // Read ONCE and handed to `readProductExtras`, which would otherwise read the same rows again.
  const attachments = await readProductModifiers(tx, productIds);

  const extrasByHolder = new Map<string, ResolvedExtraList[]>();
  if (menuItemIds.length > 0) {
    for (const [holder, lists] of await readMenuExtras(tx, menuItemIds, {
      includeEveryModifierItem,
    })) {
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
 * not duplicate (spec §3.1). */
type OfferedExtraItemFacts = Omit<OfferedExtraItem, "price" | "maxQuantity" | "preselected">;

const activeVariant = alias(products, "active_variant");

/** One query for every product any offered list names, and none at all when no list names one.
 * With `includeEveryModifierItem`, an Unavailable product is read too, but never an Inactive one:
 * availability must not change the document a publish would write, and deleting a product must. */
async function readExtraProducts(
  tx: Transaction,
  productIds: string[],
  includeEveryModifierItem: boolean,
): Promise<Map<string, OfferedExtraItemFacts>> {
  if (productIds.length === 0) return new Map();
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
    .where(
      and(
        inArray(products.id, productIds),
        eq(products.active, true),
        includeEveryModifierItem ? undefined : eq(products.available, true),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(activeVariant)
            .where(and(eq(activeVariant.parentId, products.id), eq(activeVariant.active, true))),
        ),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        productId: row.id,
        name: row.name,
        customerName: row.customerName,
        kitchenName: row.kitchenName,
        vatClass: row.vatClass as VatClass,
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
 * dish was reached through an offer and by the PRODUCT id when it was not, LOWER-CASED.
 *
 * The order is the product's own `product_modifiers.sort` on BOTH paths (spec §5). A menu offer
 * changes what is IN an extras entry, and whether it is there at all; it does not move the entry, so
 * `menu_item_extra_lists.display_order` decides nothing here.
 *
 * Only ACTIVE lists are offered, and an options list offers only its AVAILABLE labels: exactly what
 * `validateExtraSelections` and `validateOptionSelections` will accept an answer from. An extras
 * item is left out when its product row is missing, Inactive or Unavailable (spec §15.6), or has an
 * Active variant (spec §15.1). The order path refuses a pick of the last three on its own read.
 *
 * With `includeEveryModifierItem`, what a published document holds: every label, and an extras
 * item whether or not its product is Available and whether or not the offer withdraws it; an item
 * whose product is Inactive, or has an Active variant, is still left out. A default label is then
 * kept while it names any label of its list.
 */
export async function readOfferedModifiers(
  tx: Transaction,
  dishes: readonly ModifierHolder[],
  options: { includeEveryModifierItem?: boolean } = {},
): Promise<Map<string, OfferedModifier[]>> {
  const includeEveryModifierItem = options.includeEveryModifierItem === true;
  const { attachments, extrasByHolder, optionsByProduct } = await walkAttachedModifiers(
    tx,
    dishes,
    includeEveryModifierItem,
  );

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

  const facts = await readExtraProducts(
    tx,
    [
      ...new Set(
        [...walked.values()].flatMap((entries) =>
          entries.flatMap((entry) =>
            entry.kind === "extras" ? entry.list.items.map((item) => item.productId) : [],
          ),
        ),
      ),
    ],
    includeEveryModifierItem,
  );

  const offered = new Map<string, OfferedModifier[]>();
  for (const [holder, entries] of walked) {
    offered.set(
      holder,
      entries.map((entry): OfferedModifier => {
        if (entry.kind === "options") {
          const labels = includeEveryModifierItem
            ? entry.list.labels
            : entry.list.labels.filter((label) => label.available);
          return {
            kind: "options",
            id: entry.list.id,
            name: entry.list.name,
            customerName: entry.list.customerName,
            kitchenName: entry.list.kitchenName,
            // Dropped when it names no label still on offer: `option_lists.default_label_id` carries
            // no foreign key, and a till preselecting a withdrawn label would send an answer
            // `validateOptionSelections` refuses.
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
