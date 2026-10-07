import type { MenuClash } from "./menu-combine-types.js";
import type {
  MenuOffer,
  MenuOfferVariant,
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedOptionsList,
} from "./menu-types.js";
import type { OptionLabel } from "./modifier-list-types.js";

/**
 * The published-menu wire shapes, for the dashboard and the till to import. A browser-safe LEAF:
 * type definitions only. The guard is `scripts/dashboard-browser-purity.test.ts`.
 */

/** Stripped from the document (D6): availability, and the two fields that are not menu content. */
export type OverlayOfferField = "available" | "courseId" | "category";

/** `image` is the product's effective photo, which `OfferedExtraItem` does not carry. */
export type FrozenExtraItem = OfferedExtraItem & { image: string | null };
export type FrozenOptionLabel = Omit<OptionLabel, "available">;

/** Every option label, and every extras item whose product is Active and has no Active variant,
 * available or not: availability is applied when the document is served. */
export type FrozenOfferedModifier =
  | (Omit<OfferedExtrasList, "items"> & { items: FrozenExtraItem[] })
  | (Omit<OfferedOptionsList, "labels"> & { labels: FrozenOptionLabel[] });

export type FrozenOfferVariant = Omit<MenuOfferVariant, OverlayOfferField>;

type PublishedOrdering = { ordering?: MenuOffer["ordering"] };

export type FrozenOffer = Omit<
  MenuOffer,
  OverlayOfferField | "placements" | "offeredModifiers" | "variants" | "ordering" | "combined"
> &
  PublishedOrdering & {
    /** The dish's own photo and description, which `MenuOffer` does not carry. */
    image: string | null;
    description: Record<string, string> | null;
    /** The product's effective colour (color-inheritance.ts), frozen when the version is built;
     * null draws the neutral tile. */
    color?: string | null;
    variants: FrozenOfferVariant[];
    placements: string[][];
    offeredModifiers: FrozenOfferedModifier[];
  };

export type DocumentMember =
  | { kind: "product"; menuItemId: string; productId: string }
  | {
      kind: "section";
      includedMenu?: { id: string; name: string };
      sectionId: string;
      internalName: string;
      names: Record<string, string>;
      image: string | null;
      color: string | null;
      members: DocumentMember[];
    };

export interface DocumentList {
  members: DocumentMember[];
}

export type DocumentTile =
  | { kind: "product"; productId: string }
  | { kind: "section"; sectionId: string }
  | { kind: "empty" };

export type HomeDevice = "handheld" | "till";
export type HomeTileMode = "colours" | "thumbnails";
export type HomeOrder = "home_first" | "menu_first";

export interface HomeDisplay {
  columns: number;
  tiles: HomeTileMode;
  order: HomeOrder;
}

export interface DeviceHome {
  shortcuts: DocumentTile[];
  handheld: HomeDisplay;
  till: HomeDisplay;
}

export interface MenuDocument {
  format: 3;
  /** Direct active inclusions' working hashes. */
  includedMenuHashes?: Record<string, string>;
  menuId: string;
  menuName: string;
  /** The menu's top level. */
  root: DocumentList;
  /** Keyed by menu-item id: one per distinct product the menu offers. */
  offers: Record<string, FrozenOffer>;
  /** The Device Home Page: its shortcuts in order, an empty slot for a target this document does
   * not hold, and how each device presents it. */
  home: DeviceHome;
}

/** An extras item as a served offer carries it: the frozen item with its current availability. */
export type LiveExtraItem = FrozenExtraItem & { available: boolean };

/**
 * An options list as a served offer carries it. Unlike `OfferedOptionsList`, whose labels are the
 * available ones alone, it holds every label the document holds.
 */
export type LiveOptionsList = Omit<OfferedOptionsList, "labels" | "defaultLabelId"> & {
  /** Every label, each with its current availability. */
  labels: OptionLabel[];
  /**
   * An available label, or null only when no label is available now: `effectiveDefaultLabelId`
   * applied to `publishedDefaultLabelId`, by `applyLiveFields` and again by the till's
   * `withUnavailable` whenever it applies a newer unavailable set.
   */
  defaultLabelId: string | null;
  /** The default the version published, whether or not it is available now. */
  publishedDefaultLabelId: string | null;
};

export type LiveOfferedModifier =
  (Omit<OfferedExtrasList, "items"> & { items: LiveExtraItem[] }) | LiveOptionsList;

/**
 * A published offer with the live fields put back from the current rows. Every variant, extras item
 * and option label the document holds is present, each marked with whether it can be sold now.
 */
export interface LiveOffer extends Omit<MenuOffer, "ordering" | "combined">, PublishedOrdering {
  available: boolean;
  image: string | null;
  /** The product's effective colour (color-inheritance.ts), frozen when the version is built;
   * null draws the neutral tile. */
  color?: string | null;
  description: Record<string, string> | null;
  offeredModifiers: LiveOfferedModifier[];
}

export type MenuField =
  | { kind: "summary" }
  | { kind: "name"; audience: "staff" | "customer" | "kitchen"; language?: string }
  | { kind: "description"; language: string }
  | {
      kind:
        | "price"
        | "override"
        | "image"
        | "color"
        | "unit"
        | "allergens"
        | "diet"
        | "vat"
        | "ordering";
    }
  | { kind: "variants" | "extras" | "options" }
  | { kind: "portion" | "maxQuantity" | "limits" | "default" | "members" };

export type MenuTarget =
  | { kind: "title"; menuId: string }
  | { kind: "list"; sectionIds: string[] }
  | { kind: "section"; sectionIds: string[]; field: MenuField }
  | {
      kind: "product";
      sectionIds: string[];
      menuItemId: string;
      productId: string;
      variantId?: string;
      listId?: string;
      extraProductId?: string;
      optionLabelId?: string;
      field: MenuField;
    }
  | {
      kind: "home";
      device: "handheld" | "till";
      field: "shortcuts" | "columns" | "tiles" | "order";
    };

export interface MenuOccurrence {
  target: MenuTarget;
  ancestorSectionIds: string[];
}

/** Where a change came from (spec §11.1). */
export type MenuChangeSource = "this_menu" | "shared_product" | "included_menu";

export type MenuChangeBody = {
  source: MenuChangeSource;
  includedMenu?: { id: string; name: string };
  /** The other published menus the same shared change flags, by name. */
  alsoOn?: string[];
} & (
  | {
      kind: "product_added" | "product_removed";
      productId: string;
      name: string;
      /** The internal names of the sections from the top level to the list holding it. */
      under: string[];
    }
  | { kind: "product_deleted"; productId: string; name: string }
  | { kind: "product_moved"; productId: string; name: string; from: string[][]; to: string[][] }
  | { kind: "price_changed"; productId: string; name: string; from: string; to: string }
  | { kind: "product_changed"; productId: string; name: string; fields: ProductChangeField[] }
  | {
      kind: "extra_unit_changed";
      productId: string;
      name: string;
      listId: string;
      listName: string;
      from: { abbreviation: Record<string, string>; precision: number };
      to: { abbreviation: Record<string, string>; precision: number };
    }
  | {
      kind: "extra_portion_changed";
      productId: string;
      name: string;
      listId: string;
      listName: string;
      from: { portion: string; abbreviation: Record<string, string> };
      to: { portion: string; abbreviation: Record<string, string> };
    }
  | {
      kind: "extra_max_quantity_changed";
      productId: string;
      name: string;
      listId: string;
      listName: string;
      from: number | null;
      to: number | null;
    }
  | {
      kind: "section_added" | "section_removed";
      sectionId: string;
      parentSectionIds: string[];
      name: string;
      under: string[];
    }
  | { kind: "section_changed"; sectionId: string; name: string; fields: SectionChangeField[] }
  | { kind: "order_changed"; listSectionId: string | null; list: string[] }
  | { kind: "home_shortcuts_changed" }
  | { kind: "home_display_changed"; device: HomeDevice }
  | { kind: "menu_renamed"; from: string; to: string }
);

export type MenuChange = MenuChangeBody & {
  id: string;
  targets: { before: MenuTarget[]; after: MenuTarget[] };
};

export type ProductChangeField =
  | "names"
  | "description"
  | "image"
  | "color"
  | "unit"
  | "allergens"
  | "diet"
  | "vat"
  | "ordering"
  | "variants"
  | "extras"
  | "options";

export type SectionChangeField = "names" | "image" | "color";

export type MenuStatus =
  | { state: "unpublished"; clashes: number }
  | {
      state: "current" | "changed";
      clashes: number;
      version: number;
      publishedAt: string;
      hash: string;
    };

/** What publishing the menu's working state now would change, and the hash a publish must match. */
export interface MenuPreview {
  clashes: MenuClash[];
  hash: string;
  changes: MenuChange[];
  warnings: (
    | { kind: "shortcut_missing"; name: string }
    | {
        kind: "extra_portion_precision";
        listName: string;
        name: string;
        portion: string;
        abbreviation: Record<string, string>;
        precision: number;
      }
  )[];
  /** The menu's publication state, as `menuStatus` answers it. */
  status: MenuStatus;
  /** What the publish would make live. */
  document: MenuDocument;
  live: { versionId: string; document: MenuDocument } | null;
}

/** The version a publish made live. */
export interface PublishedMenuVersion {
  versionId: string;
  number: number;
}

export interface OvertakenEdition {
  versionId: string;
  number: number;
  activatesAt: string;
}

export interface QueuedEdition {
  versionId: string;
  number: number;
  activatesAt: string;
}

export interface MenuEdition {
  versionId: string;
  number: number;
  state: "queued" | "activated" | "cancelled";
  activatesAt: string;
  queuedAt: string;
  cancelledAt: string | null;
  contentHash: string;
}

export interface MenuPublications {
  live: { versionId: string; number: number; since: string } | null;
  /** Every queued edition, soonest first, then the ten most recently numbered settled ones. */
  editions: MenuEdition[];
}

/** An instant as the venue clock shows it; `repeated` when the clock shows that minute twice. */
export interface LocalTime {
  date: string;
  time: string;
  offset: string;
  repeated: boolean;
}

/** `GET /management-api/catalogues/:id/publications`. */
export interface MenuPublicationsAnswer {
  timeZone: string;
  live: (NonNullable<MenuPublications["live"]> & { local: LocalTime }) | null;
  editions: (MenuEdition & { local: LocalTime })[];
}

/** What a zone's live menus hold that cannot be sold now — `GET /api/menu-state`'s `unavailable`. */
export interface MenuUnavailable {
  /** Every product or variant that is Inactive or Unavailable, extras items' products included. */
  products: string[];
  /** Every option label that is unavailable, or deleted since the version was published. */
  optionLabels: string[];
}

/** One menu of a zone-offers body: its live version, and that version's structure and Device Home
 * Page. */
export interface ServedMenu {
  id: string;
  name: string;
  /** Whether this is the zone's default menu, which the till selects first. */
  isDefault: boolean;
  versionId: string;
  /** The live document's `root`. */
  structure: DocumentList;
  /** The live document's `home`. */
  home: DeviceHome;
}

/** `GET /api/menu-state?zoneId=` — each live menu's published version, and what cannot be sold
 * now. */
export interface MenuState {
  menus: { menuId: string; versionId: string }[];
  unavailable: MenuUnavailable;
}
