import type { CombinedOffer } from "./menu-combine-types.js";
import type { OptionLabel } from "./modifier-list-types.js";
import type { ProductAllergens } from "./allergens.js";
import type { DietOverride, DietProfile } from "./dietary.js";
import type { DietaryLabel } from "./dietary-declarations.js";
import type { PricingUnit } from "./pricing-unit.js";
import type { ProductOrdering } from "./product-ordering.js";
import type { VatClass } from "./vat-rates.js";
import type { SellableUnit } from "./product-types.js";
import type { ProductPresentation } from "./product-presentation.js";

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
  /** The product's own Available flag (`products.available`). A variant's is on its `variants` entry. */
  available: boolean;
  /** Every Active variant, in variant order; an Inactive one is on no menu. */
  variants: MenuPriceVariant[];
}

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
  /** The staff diet override (`products.dietOverride`) ALONE, or null when none — exposed distinctly
   * from `diet` (the published union) so an editor seeds its picker without double-counting, mirroring
   * `manualAllergens`. */
  dietOverride: DietOverride | null;
  dietaryDeclarations: DietaryLabel[];
  /** The product's DEFAULT kitchen course (`products.course_id`), or null when it has none. Not part
   * of the priceable projection, so it is dropped when a row is resolved into a `PriceableProduct`. */
  courseId: string | null;
  catalogueId: string;
  /** The catalogue's display name (`catalogues.name`), for grouping products by menu in the till. Also
   * not part of the priceable projection. */
  catalogueName: string;
  /** The ordered extras and options lists this PRODUCT puts in front of a diner — see
   * {@link OfferedModifier}. No menu offer is involved, so each extras entry is the list as the
   * product itself carries it. */
  offeredModifiers: OfferedModifier[];
}

export interface AccessibleCatalogue {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * `addAllergens` and `suitableFor` take the vocabulary of a CHILD line rather than of a product,
 * because that is what a pick becomes: the product's effective `allergens`, and its effective
 * `dietaryDeclarations` expanded the way a dish's own row is expanded. Shown BESIDE the dish's own
 * declarations, never folded into them.
 */
export interface OfferedExtraItem {
  productId: string;
  /** Raw parent and relative-variant facts, kept separate for independent language fallback. */
  presentation: ProductPresentation;
  /** Physical amount supplied by one pick, in the effective product unit. */
  portion: string;
  unit: {
    id: string;
    staffName: string;
    staffAbbreviation: string;
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
