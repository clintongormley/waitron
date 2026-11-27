import type {
  ProductOrdering,
  ProductAllergens,
  OfferedModifier,
  DietProfile,
  DietOverride,
  AccessibleMenu,
  LiveOffer,
  ServedMenu,
  DiningStart,
  MenuState,
  ServedSetMenu,
  ServedSetMenuOffer,
  ContentLanguages,
} from "@waitron/shared";
import type { TillRequest, ReadOptions } from "./till-request.js";

/**
 * One sellable product as the till's widgets consume it, built from exactly two payloads:
 * {@link menuOfferToTillProduct} adapts a zone offer, and `getHeldOrder` synthesises one per line of a
 * retrieved order.
 */
export interface TillProduct {
  id: string;
  /** The shared product identity used by stock and preparation routing. */
  productId?: string;
  /** The selling identity whose menu, price and offered modifiers were selected. */
  menuItemId?: string;
  /** The published menu version this product was offered from; absent on a retrieved held line. */
  menuVersionId?: string;
  /** False when it cannot be sold now; absent on a retrieved held line. */
  available?: boolean;
  /** Who may order it on its own, as its menu version published it; absent on a retrieved held line. */
  ordering?: ProductOrdering;
  /** The offer's effective colour; absent on a retrieved held line. */
  color?: string | null;
  /** The offer's photo; absent on a retrieved held line. */
  image?: string | null;
  variantId?: string;
  variantName?: string;
  /** The selected variant's customer-facing text, locale -> text; null when it has none. */
  variantCustomerName?: Record<string, string> | null;
  variantKitchenName?: string | null;
  kitchenName?: string | null;
  /** Each variant's selling values are its EFFECTIVE ones as the offer resolved them — a line rung
   * up as the variant is sold under these, never the parent's. */
  variants?: (TillSellingValues & {
    id: string;
    name: string;
    customerName?: Record<string, string> | null;
    kitchenName?: string | null;
    image?: string | null;
    unitPrice: string;
    available: boolean;
  })[];
  /**
   * The product's STAFF-facing name, not per-language — what the till's buttons and basket render. A
   * retrieved line carries the name frozen onto it at add time.
   */
  name: string;
  /** The product's customer-facing text, locale -> text; null or blank falls back to {@link name}. */
  customerName?: Record<string, string> | null;
  description?: Record<string, string> | null;
  unit?: {
    id: string;
    staffName: string;
    staffAbbreviation: string;
    name: Record<string, string>;
    abbreviation: Record<string, string>;
    precision: number;
    hardwareUnit: "kg" | "g" | "mg" | null;
    measure?: true;
  };
  pricingUnit?: "each" | "weight";
  unitPrice: string;
  productPrices?: Record<string, string>;
  vatClass?: "general" | "reduced" | "super_reduced" | "zero";
  takeawayVatClass?: "general" | "reduced" | "super_reduced" | "zero";
  category: string | null;
  /** EU-14 allergen declaration keyed by allergen code; null = not reviewed. */
  allergens: ProductAllergens | null;
  /** The kitchen course a line inherits when it has no override. */
  courseId?: string | null;
  /** The menu this product is sold from; the till's menu filter shows only the selected menu's
   * products, and an absent value never matches one. */
  menuId?: string;
  /** The menu's display name; the switcher renders `TillMenu.name`, not this. */
  menuName?: string;
  /**
   * The ordered extras and options lists this dish offers, in the product's own attachment order. The
   * basket resolves a pick's allergens and dietary labels off it by list and product id.
   *
   * Absent on a product synthesised from a retrieved held line, so a surface reading this treats absent
   * as "offers nothing" rather than "not loaded yet".
   */
  offeredModifiers?: OfferedModifier[];
  /** Includes sold-out extras so held picks can still refresh their allergen declarations. */
  modifierAvailability?: TillMenuOffer["offeredModifiers"];
  diet?: DietProfile | null;

  dietOverride?: DietOverride | null;
  dietaryDeclarations?: string[];
}
/** The product values a line is sold under, apart from its price and names. */
export type TillSellingValues = Pick<
  TillProduct,
  | "unit"
  | "pricingUnit"
  | "category"
  | "allergens"
  | "courseId"
  | "diet"
  | "dietOverride"
  | "dietaryDeclarations"
>;
/** Exactly the {@link TillSellingValues} of `source`, so spreading them over a product replaces every
 * one of the product's — an absent value included — and nothing else. */
export function sellingValuesOf(source: TillSellingValues): TillSellingValues {
  return {
    unit: source.unit,
    pricingUnit: source.pricingUnit,
    category: source.category,
    allergens: source.allergens,
    courseId: source.courseId,
    diet: source.diet,
    dietOverride: source.dietOverride,
    dietaryDeclarations: source.dietaryDeclarations,
  };
}

export type TillMenu = AccessibleMenu;
/** A product's selling identity on one menu — the `offers[]` of `GET /api/service-zones/:zoneId/offers`:
 * the menu's published version, each offer, variant, extras item and option label marked with whether
 * it can be sold now. */
export type TillMenuOffer = LiveOffer;
/** A menu in a zone-offers body: the published version its offers come from, and that version's
 * structure and Device Home Page. */
export type TillZoneMenu = ServedMenu;
/** Whether the till offers an order's switch between eaten here and takeaway: never, now, or no
 * longer (something is sent or paid). */
export type DiningChoice = "none" | "open" | "locked";

export type ZoneDining = DiningStart;

export interface ZoneOffers {
  service: MenuState["service"];
  context: {
    zoneId: string;
    departmentId: string;
    departmentName: string;
    serviceMode: "table_tab" | "prepay" | "ticket_then_pay";
    /** Null where the region charges no takeaway VAT: every order is eaten here. */
    dining: ZoneDining | null;
  };
  defaultMenuId: string | null;
  menus: TillZoneMenu[];
  offers: TillMenuOffer[];
  setMenus?: readonly ServedSetMenu[];
  zones?: ServiceZoneSummary[];
  liveFields?: string;
}

export interface ServiceZoneSummary {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  serviceMode: "table_tab" | "prepay" | "ticket_then_pay";
}

export type MenuStateAnswer = MenuState & {
  defaultMenuId?: string | null;
  liveFields?: string;
  setupRevision?: string;
  /** The zone's {@link ZoneOffers} `context.dining`, so a department's change reaches a running till. */
  dining?: ZoneDining | null;
};
/** The offered lists as the picker asks them: only the extras items and option labels sellable now. */
function sellableModifiers(entries: TillMenuOffer["offeredModifiers"]): OfferedModifier[] {
  return entries.map((entry) =>
    entry.kind === "extras"
      ? { ...entry, items: entry.items.filter((item) => item.available) }
      : { ...entry, labels: entry.labels.filter((label) => label.available) },
  );
}
/**
 * Adapt a menu offer to the till's display model while keeping product and selling ids distinct.
 * `menuVersionId` is the published version of the offer's menu, which each line added from it sends.
 */
export function menuOfferToTillProduct(
  offer: TillMenuOffer & Pick<ServedSetMenuOffer, "aLaCartePrices">,
  menuVersionId?: string,
  priceVersionId = menuVersionId,
): TillProduct {
  const productPrices =
    priceVersionId === undefined ? undefined : offer.aLaCartePrices?.[priceVersionId];
  return {
    id: offer.productId,
    productId: offer.productId,
    menuItemId: offer.id,
    ...(menuVersionId === undefined ? {} : { menuVersionId }),
    available: offer.available,
    ...(offer.ordering === undefined ? {} : { ordering: offer.ordering }),
    ...(offer.color === undefined ? {} : { color: offer.color }),
    image: offer.image,
    name: offer.name,
    customerName: offer.customerName,
    description: offer.description,
    kitchenName: offer.kitchenName,
    unit: offer.unit,
    // No `pricingUnit`: `productUnit()` consults it only when `unit` is absent, and an offer always
    // carries its `unit`.
    unitPrice: offer.unitPrice,
    ...(productPrices === undefined ? {} : { productPrices }),
    category: offer.category,
    allergens: offer.allergens,
    courseId: offer.courseId,
    menuId: offer.menuId,
    menuName: offer.menuName,
    // The offered lists pass through in the order they arrive — the product's own attachment order,
    // which nothing on the till re-sorts.
    variants: offer.variants.map((variant) => ({
      ...sellingValuesOf(variant),
      id: variant.id,
      name: variant.name,
      customerName: variant.customerName,
      kitchenName: variant.kitchenName,
      image: variant.image,
      unitPrice: variant.unitPrice,
      available: variant.available,
    })),
    offeredModifiers: sellableModifiers(offer.offeredModifiers),
    modifierAvailability: offer.offeredModifiers,
    dietaryDeclarations: offer.dietaryDeclarations,
    diet: offer.diet,
    dietOverride: offer.dietOverride,
  };
}

export class MenuApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    this.#request = request;
  }
  getContentLanguages(): Promise<ContentLanguages> {
    return this.#request<ContentLanguages>("/api/content-languages", "GET");
  }
  async listZoneOffers(zoneId: string, options: ReadOptions = {}): Promise<ZoneOffers> {
    return this.#request<ZoneOffers>(
      `/api/service-zones/${encodeURIComponent(zoneId)}/offers`,
      "GET",
      undefined,
      options.signal,
    );
  }
  menuState(zoneId: string, options: ReadOptions = {}): Promise<MenuStateAnswer> {
    return this.#request<MenuStateAnswer>(
      `/api/menu-state?zoneId=${encodeURIComponent(zoneId)}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  async listDefaultZoneOffers(): Promise<ZoneOffers> {
    return this.#request<ZoneOffers>("/api/default-service-zone/offers", "GET");
  }
}
