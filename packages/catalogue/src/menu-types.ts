import type { CombinedOffer } from "./menu-combine-types.js";
import type { OptionLabel } from "./modifier-list-types.js";
import type { ProductAllergens } from "./allergens.js";
import type { DietDerivation, DietOverride, DietProfile } from "./dietary.js";
import type { DietaryLabel } from "./dietary-declarations.js";
import type { PricingUnit } from "./pricing.js";
import type { ProductOrdering } from "./product-ordering.js";
import type { VatClass } from "./vat-rates.js";
import type { SellableUnit } from "./product-types.js";

/**
 * The menu wire shapes — the JSON the catalogue's read paths hand across the HTTP boundary to a till
 * (the menu offers a service zone sells, and the products in a location's menu list) and to the
 * dashboard's menu screens. Like `product-types.ts`, this is a LEAF: type definitions only, no
 * running code, and every type it imports is itself browser-safe (nothing here reaches
 * `@waitron/db`, drizzle or a `node:` builtin), so the till and the dashboard can import ONE
 * authoritative copy instead of re-declaring them by hand. The guard is
 * `scripts/dashboard-browser-purity.test.ts`.
 */

/** One menu-item row: the id (not the product id) that selects a price when a diner orders. */
export interface MenuItem {
  id: string;
  menuId: string;
  productId: string;
  /** The price this menu sets, or null when it sets none. */
  grossPrice: string | null;
}

/** One sellable identity. The menu-item id, rather than the product id, selects its price. */
export interface MenuOffer extends MenuItem {
  combined: CombinedOffer;
  unitPrice: string;
  menuName: string;
  /** Each path of section ids from the menu's root to a list holding the product; `[]` is the top
   * level. */
  placements: string[][];
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  /** The dish's own setting; a variant has none, and is ordered under its dish. */
  ordering: ProductOrdering;
  unit: SellableUnit;
  vatClass: VatClass;
  category: string | null;
  allergens: ProductAllergens | null;
  diet: DietProfile | null;
  dietDerivation: DietDerivation | null;
  dietOverride: DietOverride | null;
  dietaryDeclarations: DietaryLabel[];
  courseId: string | null;
  /** The ordered extras and options lists this OFFER puts in front of a diner — see
   * {@link OfferedModifier}. */
  offeredModifiers: OfferedModifier[];
  /** The product's ACTIVE variants in the one variant order; an Inactive one is left
   * out. A variant is only ever listed here, under its parent's offer, never as an offer itself. */
  variants: MenuOfferVariant[];
}

/**
 * One variant as a menu offers it. The names are the variant's own; every other product value is
 * its EFFECTIVE one — its own, or its parent's where it leaves the field blank.
 */
export interface MenuOfferVariant {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  image: string | null;
  unitPrice: string;
  /** The price this menu sets for the variant, or null when it sets none. */
  menuPrice: string | null;
  /** The variant's own Available: whether a till may sell it now. Only an Active variant is listed. */
  available: boolean;
  unit: SellableUnit;
  pricingUnit: PricingUnit;
  vatClass: VatClass;
  category: string | null;
  allergens: ProductAllergens | null;
  diet: DietProfile | null;
  dietDerivation: DietDerivation | null;
  dietOverride: DietOverride | null;
  dietaryDeclarations: DietaryLabel[];
  courseId: string | null;
}

/** One Active variant's own settings on one menu. */
export interface MenuVariant {
  variantId: string;
  price: string | null;
}

/** One Active variant's price setting on one menu. */
export interface MenuPriceVariant extends MenuVariant {
  active: boolean;
  /** The variant's own Available flag (`products.available` on its row). */
  available: boolean;
}

/** One product a menu reaches, with what it costs there (`menuPrices`). */
export interface MenuPriceRow {
  combined: CombinedOffer;
  menuItemId: string;
  productId: string;
  /** The staff name. */
  name: string;
  /** The product's reporting category, `products.category_id`. */
  categoryId: string | null;
  /** Each path of section ids from the menu's root to a list holding the product; `[]` is the top
   * level. */
  placements: string[][];
  /** The price this menu sets, or null when it sets none. */
  override: string | null;
  effectivePrice: string;
  /** The product's own Active state. A variant's is on its `variants` entry. */
  active: boolean;
  /** The product's own Available flag (`products.available`). A variant's is on its `variants` entry. */
  available: boolean;
  /** Every Active variant, in variant order; an Inactive one is on no menu. */
  variants: MenuPriceVariant[];
}

/**
 * A product in a location's menu list. An `AvailableProduct` is NOT a `PriceableProduct`:
 * it carries `name` + `customerName`, not the snapshot `descriptions` a sale line freezes. Before
 * pricing, resolve the customer-facing text (customerName, falling back to the staff `name`, via the
 * resolvers in `product-presentation.ts`) into a `PriceableProduct`, then hand THAT to `priceBasket`.
 * `category` is the resolved category NAME (left-joined), or null.
 */
export interface AvailableProduct {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  unit: SellableUnit;
  pricingUnit: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  category: string | null;
  allergens: ProductAllergens | null;
  /** The PUBLISHED diet profile (`products.diet`) — vegan/vegetarian labels, contains-tags, and any
   * halal/kosher from the override — or null when unreviewed. The diet twin of `allergens`. Not part
   * of the priceable projection. */
  diet: DietProfile | null;
  /** The recipe-derived diet overlay (`products.dietDerivation`) — the folded ingredient origins + a
   * `pending` flag — or null when there is no recipe. */
  dietDerivation: DietDerivation | null;
  /** The staff diet override (`products.dietOverride`) ALONE, or null when none — exposed distinctly
   * from `diet` (the published union) so an editor seeds its picker without double-counting, mirroring
   * `manualAllergens`. */
  dietOverride: DietOverride | null;
  dietaryDeclarations: DietaryLabel[];
  /** The product's DEFAULT kitchen course (`products.course_id`), or null when it has none. Not part
   * of the priceable projection, so it is dropped when a row is resolved into a `PriceableProduct`. */
  courseId: string | null;
  /** The catalogue (menu) this row came from — its `catalogues.id`. A location's menu list may hold
   * several catalogues (its default plus any `location_catalogues` members), so a row is tagged with
   * which one it came from. Not part of the priceable projection, like `courseId`. */
  catalogueId: string;
  /** The catalogue's display name (`catalogues.name`), for grouping products by menu in the till. Also
   * not part of the priceable projection. */
  catalogueName: string;
  /** The ordered extras and options lists this PRODUCT puts in front of a diner — see
   * {@link OfferedModifier}. No menu offer is involved, so each extras entry is the list as the
   * product itself carries it. */
  offeredModifiers: OfferedModifier[];
}

/** One catalogue (menu) — its id, display name, and whether it is the default. From
 * `GET /api/products` the default is the location's (`locations.catalogue_id`). */
export interface AccessibleCatalogue {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * One product an extras list offers, with everything a surface needs to draw and describe it: the
 * RESOLVED price (the menu offer's own price, then the list item's, then the
 * product's `unit_price` — already settled, because a till has no way to walk it), the terms of the
 * OFFER, and the product's names and declarations. Every product value here is the picked product's
 * EFFECTIVE one — its own, or its parent's where a variant leaves it blank — except the names, which
 * are always its own.
 *
 * `ExtraListItem` (modifier-list-types.ts) carries none of the product's facts on purpose: the row
 * duplicates nothing the `products` row already holds. This shape is where the two are put back
 * together for a reader.
 *
 * `addAllergens` and `suitableFor` take the vocabulary of a CHILD line rather than of a product,
 * because that is what a pick becomes: the product's effective `allergens`, and its effective
 * `dietaryDeclarations` expanded the way a dish's own row is expanded. Shown BESIDE the dish's own
 * declarations, never folded into them.
 */
export interface OfferedExtraItem {
  productId: string;
  /** Physical amount supplied by one pick, in the effective product unit. */
  portion: string;
  unit: {
    id: string;
    name: Record<string, string>;
    abbreviation: Record<string, string>;
    precision: number;
    hardwareUnit: "kg" | "g" | "mg" | null;
  };
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  /** GROSS, in the money shape `unitPrice` uses. Never null: the inheritance is already resolved. */
  price: string;
  /** Always the extra PRODUCT's effective rate, never the dish's. */
  vatClass: VatClass;
  maxQuantity: number | null;
  preselected: boolean;
  addAllergens: ProductAllergens | null;
  suitableFor: DietaryLabel[];
}

/** One extras list on offer, with its items narrowed and priced. Only ACTIVE lists are offered. */
export interface OfferedExtrasList {
  kind: "extras";
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  minPicks: number;
  maxPicks: number | null;
  items: OfferedExtraItem[];
}

/**
 * One options list on offer. `labels` holds the AVAILABLE labels alone — the set
 * `validateOptionSelections` (option-contract.ts) will accept an answer from — and `defaultLabelId`
 * is null unless it names one of them.
 */
export interface OfferedOptionsList {
  kind: "options";
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  defaultLabelId: string | null;
  labels: OptionLabel[];
}

/**
 * One entry of the ordered list a dish offers a till: the extras widget or the options radio group
 * the picker draws. Walked in the PRODUCT's own `product_modifiers.sort` order on
 * both reads; what a menu offer changes is each extras entry's contents, and whether it is there at
 * all — not where it sits.
 */
export type OfferedModifier = OfferedExtrasList | OfferedOptionsList;
