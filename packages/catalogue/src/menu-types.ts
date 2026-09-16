import type { Modifier } from "@waitron/shared";
import type { ProductAllergens } from "./allergens.js";
import type { DietDerivation, DietOverride, DietProfile } from "./dietary.js";
import type { DietaryLabel } from "./dietary-declarations.js";
import type { PricingUnit, VatClass } from "./pricing.js";
import type { ProductVariant, SellableUnit } from "./product-types.js";

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
  grossPrice: string;
  displayOrder: number;
  active: boolean;
}

/** One sellable identity. The menu-item id, rather than the product id, selects its price. */
export interface MenuOffer extends MenuItem {
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
  optionGroups: MenuOfferOptionGroup[];
  modifiers: Modifier[];
  variants: ProductVariant[];
}

export interface MenuOfferOptionGroup {
  id: string;
  name: Record<string, string>;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: MenuOfferOption[];
}

export interface MenuOfferOption {
  id: string;
  name: Record<string, string>;
  priceDelta: string;
  maxQuantity: number;
  vatClass: VatClass | null;
  addAllergens: ProductAllergens | null;
  suitableFor?: string[] | null;
}

/**
 * One selectable choice within a {@link ResolvedOptionGroup} (an active `option_group_items` row).
 * `priceDelta` is the GROSS (VAT-inclusive) numeric column carried as a string, like `unitPrice`.
 * `vatClass` is `null` when the item INHERITS the parent dish's rate (`option_group_items.vat_class`
 * NULL); a non-null value overrides it. Later tasks price a selection against these.
 */
export interface ResolvedOptionItem {
  id: string;
  name: Record<string, string>;
  priceDelta: string;
  vatClass: VatClass | null;
  /** The AUTHORED per-option cap (`option_group_items.max_quantity`, NOT NULL default 1): the most of
   * THIS option a diner may take on one dish (per-option quantity). The sale path validates a selected
   * option's quantity is an integer in `1..maxQuantity` and prices the child at `dishQty × optionQty`. */
  maxQuantity: number;
  /** The option's OWN allergens (`addAllergens`): codes this option contributes ("extra cheese" →
   * milk), null when it declares none. Shown beside the dish's own allergens — the dish and its extras
   * are not combined into one figure. */
  addAllergens: ProductAllergens | null;
  /** The option's OWN positive dietary suitability (a subset of vegan/vegetarian/halal/kosher), shown
   * beside the dish's own — never folded. */
  suitableFor?: string[] | null;
}

/**
 * An active `option_groups` row attached to a product, with its active items resolved and sorted.
 * `minSelect`/`maxSelect` bound how many items a diner may pick and `required` forces at least one;
 * later tasks validate a selection against these. `items` is in `option_group_items.sort` order and
 * excludes inactive items; an active group with no active items resolves to `items: []`.
 */
export interface ResolvedOptionGroup {
  id: string;
  name: Record<string, string>;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  items: ResolvedOptionItem[];
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
  /** The product's attached ACTIVE option groups (Task 1 tables), each with its active items in sort
   * order — `[]` when the product has none. Not part of the priceable projection; later tasks price +
   * validate a diner's selection against these. */
  optionGroups: ResolvedOptionGroup[];
  modifiers: Modifier[];
}

/** One catalogue (menu) a location may sell from — its id, display name, and whether it is the
 * location's default (`locations.catalogue_id`), which a till's menu switcher pre-selects. */
export interface AccessibleCatalogue {
  id: string;
  name: string;
  /** True for `locations.catalogue_id` — the till's menu switcher pre-selects this one. */
  isDefault: boolean;
}
