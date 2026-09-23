import type { PricingUnit, VatClass } from "./pricing.js";
import type { ProductAllergens } from "./allergens.js";
import type { DietOverride } from "./dietary.js";
import type { DietaryLabel } from "./dietary-declarations.js";

/**
 * The product wire shapes — the JSON the catalogue read/write paths hand across the HTTP boundary, so
 * the dashboard (and any browser client) can import ONE authoritative copy instead of re-declaring
 * them by hand. This is a LEAF: type definitions only, no running code, and every type it imports is
 * itself browser-safe (nothing here reaches `@waitron/db`, drizzle or a `node:` builtin). The guard is
 * `scripts/dashboard-browser-purity.test.ts`. Each shape's operational home still owns the code that
 * builds it (`operations.ts`, `product-editor.ts`, `variants.ts`, `units.ts`) and re-exports the type
 * from here so existing imports are unchanged.
 */

/**
 * One entry in a product's ordered attachment list: an extras list or an options list, never both
 * (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §5). The `id` is the LIST's
 * id, not the attachment row's — the row's own key is a surrogate nothing outside
 * `product-modifiers.ts` names.
 *
 * It lives HERE rather than beside the read/write code because the dashboard's product editor sends
 * and receives it, and this file is the one the browser may import: `product-modifiers.ts` imports
 * drizzle and `@waitron/db`. Same split `Unit`, `ProductVariant` and `Product` already take, and
 * `product-modifiers.ts` re-exports it so existing imports are unchanged.
 */
export interface ProductModifierRef {
  kind: "extras" | "options";
  id: string;
}

/** A unit a product is priced and sold in (`Each`, or a stored `units` row). */
export interface Unit {
  id: string;
  name: Record<string, string>;
  precision: number;
  abbreviation: Record<string, string>;
}

/** A {@link Unit} plus the scale integration the till reads: `hardwareUnit` names the mass unit a
 * connected scale weighs in (`kg`/`g`/`mg`), or null for a counted (each) unit. The sell-side reads
 * ({@link ./menu-types.js#AvailableProduct}, {@link ./menu-types.js#MenuOffer}) carry it so the till
 * decides whether to weigh from the unit itself, not from the legacy `pricingUnit` flag. `units.ts`
 * owns the code that builds it and re-exports this type. */
export interface SellableUnit extends Unit {
  hardwareUnit: "kg" | "g" | "mg" | null;
}

/**
 * One product variant as the editor sends and receives it — a `products` row with a `parent_id`.
 * The three names fall back INDEPENDENTLY: `name` is the plain staff-facing text, `customerName` the
 * translated text a guest reads, and `kitchenName` what a kitchen ticket prints; a blank customer or
 * kitchen name falls back to `name`, never to the parent's names. `product-presentation.ts` owns that
 * fallback. `unitPrice` and `image` are the variant's OWN values, null where it takes its parent's.
 */
export interface ProductVariant {
  id: string;
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  image: string | null;
  unitPrice: string | null;
  available: boolean;
  /** False once the variant has been removed; it is kept, never deleted (spec §15.6). */
  active: boolean;
}

/** A variant on the way IN: a new one omits `id`, an edited one carries it. Saving one makes it
 * Active; a variant left out of a save is made Inactive. */
export type ProductVariantInput = Omit<ProductVariant, "id" | "active"> & { id?: string };

/**
 * The slice of one product row the dashboard reads out of `GET /management-api/catalogues/:id/products`
 * — the whole `Product` catalogue's `operations.ts` returns. `unitPrice` is a GROSS (VAT-inclusive)
 * two-place decimal STRING, never a number; `image` is a bare `<sha256>.<ext>` filename served at
 * `/media/<image>`, or null when there is no picture.
 */
export interface Product {
  id: string;
  /** The ordered extras and options lists attached to this product. */
  modifiers: ProductModifierRef[];
  catalogueId: string;
  categoryId: string | null;
  categoryIds: string[];
  primaryCategoryId: string | null;
  /** The plain staff-facing name — what the dashboard, the till buttons and the sales reports show.
   * NOT NULL, so nothing downstream needs a fallback for it. */
  name: string;
  /** The translated name a guest reads (locale → text), or null when the product has none. A blank
   * customer name falls back to `name`; `product-presentation.ts` owns that fallback. */
  customerName: Record<string, string> | null;
  /** Whether this product may be sold on its own. `false` marks a full product intended only to be
   * referenced from elsewhere (an extra now, a recipe ingredient later) rather than offered
   * standalone; the menu and till selection is what enforces that (a later slice). */
  soldAlone: boolean;
  unitId: string;
  unit: Unit;
  description: Record<string, string> | null;
  kitchenName: string | null;
  dietaryDeclarations: DietaryLabel[];
  pricingUnit: PricingUnit;
  /** GROSS (VAT-inclusive): per selected unit. */
  unitPrice: string;
  vatClass: VatClass;
  /** Whether the product exists for the venue; deleting it makes it Inactive (spec §15.6). */
  active: boolean;
  /** Whether it can be sold right now: false is "sold out for now", and hides nothing in the
   * dashboard. The till sells a product only when it is both Active and Available — except that a
   * held order's line kept at or below its quantity is still billed although its dish or an extra
   * has since become Inactive or Unavailable; a raise is checked in `updateHeldOrder`. */
  available: boolean;
  /** The PUBLISHED allergen union (manual overlay merged with any recipe-derived floor), or null when
   * not yet reviewed. */
  allergens: ProductAllergens | null;
  /** The staff-authored overlay ALONE, before the recipe floor is unioned in — null when unreviewed.
   * The editor seeds its picker from THIS so recipe-derived allergens are never re-saved as manual. */
  manualAllergens: ProductAllergens | null;
  /** The staff diet override ALONE, or null when none — the diet twin of `manualAllergens`; the editor
   * seeds its diet-override controls from THIS without double-counting the recipe-derived profile. */
  dietOverride: DietOverride | null;
  image: string | null;
  variants: ProductVariant[];
}

/**
 * The product-editor write body's product half, as `parseProductEditorInput` validates it. The kitchen
 * routing (`stationId`/`courseId`) is NOT here — it rides in {@link ProductRouting} and the two combine
 * as {@link ProductEditorBody}, the complete body the editor sends.
 */
export interface ProductEditorInput {
  name: string;
  customerName: Record<string, string> | null;
  /** Whether the product may be sold on its own. Required in the editor body, like `available` — the
   * parser refuses a body that omits it rather than defaulting. */
  soldAlone: boolean;
  description: Record<string, string> | null;
  kitchenName: string | null;
  image: string | null;
  unitId: string | null;
  unitPrice: string;
  /** Writes `products.active`; Delete sends false and Restore true. Required, like `available`. */
  active: boolean;
  /** Writes `products.available`: "sold out for now". */
  available: boolean;
  vatClass: VatClass;
  variants: ProductVariantInput[];
  categoryIds: string[];
  primaryCategoryId: string | null;
  /** The ordered extras and options lists to attach, replacing whatever the product carries today. */
  modifiers: ProductModifierRef[];
  allergens: ProductAllergens | null;
  dietaryDeclarations: DietaryLabel[];
}

/** A product editor body's optional kitchen routing: absent leaves it alone, `null` clears it. */
export interface ProductRouting {
  stationId?: string | null;
  courseId?: string | null;
}

/** The complete product-editor write body: the product fields plus the kitchen routing, saved on one
 * transaction so a station this venue lacks rolls the product back rather than leaving it unrouted. */
export type ProductEditorBody = ProductEditorInput & ProductRouting;

/** The product-editor READ shape (`GET /management-api/products/:id/editor`): the input fields, the
 * product id, the persisted variants (each with an id), and the resolved kitchen routing. */
export type ProductEditorValue = Omit<ProductEditorInput, "variants"> & {
  id: string;
  variants: ProductVariant[];
  stationId: string | null;
  courseId: string | null;
};
