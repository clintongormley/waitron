import {
  customerPresentationText,
  joinCustomerPresentationText,
  kitchenPresentationName,
  staffPresentationName,
} from "./product-presentation.js";
import { readContentLanguages } from "./content-languages.js";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { products, type Transaction } from "@waitron/db";
import { readProductExtras } from "./extra-projection.js";
import type { ResolvedExtraList } from "./extra-projection.js";
import { readOptionListsByIds } from "./options.js";
import { readProductModifiers } from "./product-modifiers.js";
import { expandDietaryDeclarations, validateDietaryDeclarations } from "./dietary-declarations.js";
import type { OptionList } from "./modifier-list-types.js";
import type { ProductModifierRef } from "./product-types.js";
import type { VatClass } from "./vat-rates.js";
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
 * Every extras and options definition a set of dishes attaches, read together, with each product's
 * ordered attachment list keyed by the LOWER-CASED product id, which {@link readOfferedModifiers}
 * walks to interleave extras and options. A bounded number of queries whatever the number of
 * dishes, and never one per dish (CLAUDE.md §3). INACTIVE lists come back too; the walk filters
 * them.
 */
interface WalkedAttachments {
  extrasByProduct: ReadonlyMap<string, ResolvedExtraList[]>;
  /** Keyed by the underlying PRODUCT id on both paths: an options list is attached to the product
   * and a menu offer neither republishes nor narrows one. */
  optionsByProduct: ReadonlyMap<string, OptionList[]>;
  attachments: ReadonlyMap<string, ProductModifierRef[]>;
}

async function walkAttachedModifiers(
  tx: Transaction,
  dishes: readonly ModifierHolder[],
): Promise<WalkedAttachments> {
  const productIds = [...new Set(dishes.map((dish) => dish.productId))];
  // Read ONCE and handed to `readProductExtras`, which would otherwise read the same rows again.
  const attachments = await readProductModifiers(tx, productIds);

  const extrasByProduct = await readProductExtras(tx, productIds, attachments);
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
  return { attachments, extrasByProduct, optionsByProduct };
}

/** The `products` columns an offered extras item borrows — everything its own row deliberately does
 * not duplicate. */
type OfferedExtraItemFacts = Omit<
  OfferedExtraItem,
  "price" | "maxQuantity" | "preselected" | "portion" | "unit"
>;

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
      parentName: parentProducts.name,
      parentCustomerName: parentProducts.customerName,
      parentKitchenName: parentProducts.kitchenName,
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
  const { defaultLanguage } = await readContentLanguages(tx, "en");
  return new Map(
    rows.map((row) => {
      const presentation = {
        name: row.parentName ?? row.name,
        customerName: row.parentName === null ? row.customerName : row.parentCustomerName,
        kitchenName: row.parentName === null ? row.kitchenName : row.parentKitchenName,
        variantName: row.parentName === null ? null : row.name,
        variantCustomerName: row.parentName === null ? null : row.customerName,
        variantKitchenName: row.parentName === null ? null : row.kitchenName,
      };
      const text = customerPresentationText(presentation, defaultLanguage);
      return [
        row.id,
        {
          productId: row.id,
          name: staffPresentationName(presentation),
          customerName:
            row.parentName === null
              ? row.customerName
              : joinCustomerPresentationText(text.product, text.variant, row.name),
          kitchenName:
            row.parentName === null ? row.kitchenName : kitchenPresentationName(presentation),
          vatClass: row.vatClass as VatClass,
          addAllergens: row.allergens,
          suitableFor: expandDietaryDeclarations(
            validateDietaryDeclarations(row.dietaryDeclarations),
          ),
        },
      ];
    }),
  );
}

/** One walked entry before its extras items have borrowed their products' facts. */
type WalkedList =
  { kind: "extras"; list: ResolvedExtraList } | { kind: "options"; list: OptionList };

/**
 * The ordered extras and options lists each dish offers a till, keyed by the MENU-ITEM id when the
 * dish was reached through an offer and by the PRODUCT id when it was not, LOWER-CASED.
 *
 * The order is the product's own `product_modifiers.sort`.
 *
 * Only ACTIVE lists are offered, and an options list offers only its AVAILABLE labels: exactly what
 * `validateExtraSelections` and `validateOptionSelections` will accept an answer from. An extras
 * item is left out when its product row is missing, Inactive or Unavailable, or has an
 * Active variant.
 *
 * With `includeEveryModifierItem`, what a published document holds: every label, and an extras
 * item whether or not its product is Available; an item
 * whose product is Inactive, or has an Active variant, is still left out. A default label is then
 * kept while it names any label of its list.
 */
export async function readOfferedModifiers(
  tx: Transaction,
  dishes: readonly ModifierHolder[],
  options: { includeEveryModifierItem?: boolean } = {},
): Promise<Map<string, OfferedModifier[]>> {
  const includeEveryModifierItem = options.includeEveryModifierItem === true;
  const { attachments, extrasByProduct, optionsByProduct } = await walkAttachedModifiers(
    tx,
    dishes,
  );

  const walked = new Map<string, WalkedList[]>();
  for (const dish of dishes) {
    const productId = dish.productId.toLowerCase();
    const holder = (dish.menuItemId ?? dish.productId).toLowerCase();
    if (walked.has(holder)) continue;
    const extras = new Map((extrasByProduct.get(productId) ?? []).map((list) => [list.id, list]));
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
                    portion: item.portion,
                    unit: item.unit,
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
