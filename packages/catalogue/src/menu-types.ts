import type { OptionLabel } from "./modifier-list-types.js";
import type { ProductAllergens } from "./allergens.js";
import type { DietDerivation, DietOverride, DietProfile } from "./dietary.js";
import type { DietaryLabel } from "./dietary-declarations.js";
import type { PricingUnit, VatClass } from "./pricing.js";
import type { SellableUnit } from "./product-types.js";

/**
 * The SELL-SIDE wire shapes — the JSON the catalogue's read paths hand across the HTTP boundary to a
 * till (the menu offers a service zone sells, and the products a location can sell). Like
 * `product-types.ts`, this is a LEAF: type definitions only, no running code, and every type it
 * imports is itself browser-safe (nothing here reaches `@waitron/db`, drizzle or a `node:` builtin), so
 * the till can import ONE authoritative copy instead of re-declaring them by hand. The guard is
 * `scripts/dashboard-browser-purity.test.ts`. `operations.ts` still owns the code that builds these and
 * re-exports each type from here, so existing imports are unchanged; the till imports {@link MenuOffer}
 * (the zone-offer body it sells from) directly, which is what keeps it in step with the server.
 */

/** One menu-item row: the id (not the product id) that selects a price when a diner orders. */
export interface MenuItem {
  id: string;
  menuId: string;
  productId: string;
  sectionId: string;
  /** The price this menu sets, or null when it sets none and the product's own price applies. */
  grossPrice: string | null;
  displayOrder: number;
  active: boolean;
}

/** One sellable identity. The menu-item id, rather than the product id, selects its price. */
export interface MenuOffer extends MenuItem {
  /** The price the server's order path charges for this offer, RESOLVED along spec §15.3's chain
   * (`offer-price.ts`): `grossPrice` when set, else the product's own price. Never null. */
  unitPrice: string;
  menuName: string;
  sectionName: Record<string, string>;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
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
   * {@link OfferedModifier}. Each extras entry is the version this menu offer publishes. */
  offeredModifiers: OfferedModifier[];
  /** The product's ACTIVE variants in the one variant order (spec §15.5); an Inactive one is left
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
  /** The price charged here, RESOLVED along spec §15.3's chain (`offer-price.ts`). */
  unitPrice: string;
  /** The price this menu sets for the variant, or null when it sets none. */
  menuPrice: string | null;
  /** False when this menu switches the variant off. */
  offered: boolean;
  /** Active, Available and offered on this menu: whether a till may sell it here now. */
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

/**
 * A product the till can sell at a location. An `AvailableProduct` is NOT a `PriceableProduct`:
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
   * halal/kosher from the override — or null when unreviewed. The diet twin of `allergens`; Task 6's
   * till menu filter reads it. Not part of the priceable projection. */
  diet: DietProfile | null;
  /** The recipe-derived diet overlay (`products.dietDerivation`) — the folded ingredient origins + a
   * `pending` flag — or null when there is no recipe. Carried so Task 5 can recompute the as-served
   * diet from the base derivation plus the selected options' origin overlays. */
  dietDerivation: DietDerivation | null;
  /** The staff diet override (`products.dietOverride`) ALONE, or null when none — exposed distinctly
   * from `diet` (the published union) so an editor seeds its picker without double-counting, mirroring
   * `manualAllergens`. */
  dietOverride: DietOverride | null;
  dietaryDeclarations: DietaryLabel[];
  /** The product's DEFAULT kitchen course (KDS-2 `products.course_id`), or null when it has none. The
   * ring-time resolver reads it as the fallback (`<override> ?? course_id`), and the till's tab course
   * picker reads it as the per-line PRE-SELECTED default. Not part of the priceable projection, so it
   * is dropped when a row is resolved into a `PriceableProduct`. */
  courseId: string | null;
  /** The catalogue (menu) this product is sold from — its `catalogues.id`. A location may sell across
   * several accessible catalogues (its default plus any `location_catalogues` members), so a row is
   * tagged with which one it came from. Not part of the priceable projection, like `courseId`. */
  catalogueId: string;
  /** The catalogue's display name (`catalogues.name`), for grouping products by menu in the till. Also
   * not part of the priceable projection. */
  catalogueName: string;
  /** The ordered extras and options lists this PRODUCT puts in front of a diner — see
   * {@link OfferedModifier}. No menu offer is involved, so each extras entry is the list as the
   * product itself carries it. */
  offeredModifiers: OfferedModifier[];
}

/** One catalogue (menu) a location may sell from — its id, display name, and whether it is the
 * location's default (`locations.catalogue_id`), which a till's menu switcher pre-selects. */
export interface AccessibleCatalogue {
  id: string;
  name: string;
  /** True for `locations.catalogue_id` — the till's menu switcher pre-selects this one. */
  isDefault: boolean;
}

/**
 * One product an extras list offers, with everything a surface needs to draw and describe it: the
 * RESOLVED price (§3.3's chain — the menu offer's own price, then the list item's, then the
 * product's `unit_price` — already settled, because a till has no way to walk it), the terms of the
 * OFFER, and the product's names and declarations. Every product value here is the picked product's
 * EFFECTIVE one — its own, or its parent's where a variant leaves it blank — except the names, which
 * are always its own.
 *
 * `ExtraListItem` (modifier-list-types.ts) carries none of the product's facts on purpose: the row
 * duplicates nothing the `products` row already holds (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.1). This shape is where the two
 * are put back together for a reader.
 *
 * `addAllergens` and `suitableFor` take the vocabulary of a CHILD line rather than of a product,
 * because that is what a pick becomes: the same two field names as `QueueModifier`
 * (`readQueueSubItems`, apps/server/src/working-order.ts) — the product's effective `allergens`, and
 * its effective `dietaryDeclarations` expanded the way a dish's own row is expanded. Shown BESIDE the
 * dish's own declarations, never folded into them (spec §3.4).
 */
export interface OfferedExtraItem {
  productId: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  /** GROSS, in the money shape `unitPrice` uses. Never null: the inheritance is already resolved. */
  price: string;
  /** Always the extra PRODUCT's effective rate, never the dish's (spec §3.3). */
  vatClass: VatClass;
  maxQuantity: number;
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
 * the picker draws (spec §5, §10). Walked in the PRODUCT's own `product_modifiers.sort` order on
 * both reads; what a menu offer changes is each extras entry's contents, and whether it is there at
 * all — not where it sits.
 */
export type OfferedModifier = OfferedExtrasList | OfferedOptionsList;
