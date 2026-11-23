import type { SetMenuProblem, SetMenuTerms } from "./set-menu-types.js";
import type { Unit } from "./product-types.js";
import type { MenuClash } from "./menu-combine-types.js";
import type {
  MenuOffer,
  MenuOfferVariant,
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedOptionsList,
} from "./menu-types.js";
import type { OptionLabel } from "./modifier-list-types.js";
import type { IncludeFolderOverrides } from "./section-types.js";

/**
 * The published-menu wire shapes, for the dashboard and the till to import. A browser-safe LEAF:
 * type definitions only. The guard is `scripts/dashboard-browser-purity.test.ts`.
 */

/** Supplied from current products when the document is served. */
export type DeclarationField = "allergens" | "diet" | "dietOverride" | "dietaryDeclarations";
export type OverlayOfferField = "available" | "courseId" | "category" | DeclarationField;

/** `image` is the product's effective photo, which `OfferedExtraItem` does not carry. */
export type FrozenExtraItem = Omit<OfferedExtraItem, "addAllergens" | "suitableFor"> & {
  image: string | null;
};
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
  | { kind: "set_menu"; menuId: string; name: string }
  | {
      kind: "section";
      includedMenu?: { id: string; name: string };
      /** Its members are drawn in its place; a shortcut to it still opens it. */
      direct?: true;
      /** What the include fixes, present only while it is shown as a folder (absent when shown
       * directly, whatever it stores), so a change list can tell it from the included menu's change. */
      fixed?: IncludeFolderOverrides;
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

export type SetMenuOfferVariant = FrozenOfferVariant & { countsAsCourseId: string };
export type SetMenuFrozenOffer = Omit<FrozenOffer, "variants"> & {
  /** The course the dish counts as, or null when only its variants have courses. */
  countsAsCourseId: string | null;
  /** The course this set menu gives the dish and its variants, if any. */
  courseOverrideId: string | null;
  variants: SetMenuOfferVariant[];
};

export interface PublishedSetMenu {
  name: string;
  terms: SetMenuTerms;
  root: DocumentList;
  offers: Record<string, SetMenuFrozenOffer>;
  /** The draft row's stored updatedAt when the full menu took this copy. */
  changedAt: string;
}

type MenuPriceOrigin =
  { kind: "product" } | { kind: "this_menu" } | { kind: "included_menu"; id: string; name: string };

export interface MenuDocument {
  format: 4;
  /** Direct active inclusions' working hashes. */
  includedMenuHashes?: Record<string, string>;
  menuId: string;
  menuName: string;
  /** The menu's top level. */
  root: DocumentList;
  /** Keyed by menu-item id: one per distinct product the menu offers. */
  offers: Record<string, FrozenOffer>;
  setMenus?: Record<string, PublishedSetMenu>;
  /** Resolved price origins for Preview, keyed by dish or variant product id. */
  priceOrigins?: Record<string, MenuPriceOrigin>;
  /** The Device Home Page: its shortcuts in order, an empty slot for a target this document does
   * not hold, and how each device presents it. */
  home: DeviceHome;
}

export type DeclarationOffer = Omit<FrozenOffer, "variants" | "offeredModifiers"> &
  Pick<MenuOffer, DeclarationField> & {
    variants: (FrozenOfferVariant & Pick<MenuOfferVariant, DeclarationField>)[];
    offeredModifiers: (
      | Extract<FrozenOfferedModifier, { kind: "options" }>
      | (Omit<Extract<FrozenOfferedModifier, { kind: "extras" }>, "items"> & {
          items: (FrozenExtraItem & Pick<OfferedExtraItem, "addAllergens" | "suitableFor">)[];
        })
    )[];
  };
export type DeclarationDocument = Omit<MenuDocument, "offers"> & {
  offers: Record<string, DeclarationOffer>;
};

/** An extras item as a served offer carries it: the frozen item with its current availability. */
export type LiveExtraItem = FrozenExtraItem &
  Pick<OfferedExtraItem, "addAllergens" | "suitableFor"> & { available: boolean };

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
 * A published offer with live fields from current rows. Deleted lists and missing products are
 * omitted; surviving variants, extras items and option labels carry current availability.
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

export type ServedSetMenuOffer = LiveOffer & {
  /** The counting course in this published copy. The served courseId controls sending. */
  countsAsCourseId: string | null;
  variantCountsAs: Record<string, string>;
};

export interface ServedSetMenuCopy {
  /** The set menu id and the hash of the published copy. */
  key: string;
  menuId: string;
  name: string;
  terms: SetMenuTerms;
  changedAt: string;
  structure: DocumentList;
  offers: ServedSetMenuOffer[];
}

export interface ServedSetMenu extends ServedSetMenuCopy {
  /** The live versions that hold this copy, sorted by code units. */
  versionIds: string[];
  orderable: boolean;
  /** The one copy a new bill takes when this set menu is on sale. */
  newestOnSale: boolean;
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
        | "ordering"
        | "direct";
    }
  | { kind: "variants" | "extras" | "options" }
  | { kind: "portion" | "maxQuantity" | "limits" | "default" | "members" };

export type MenuTarget =
  | { kind: "title"; menuId: string }
  | { kind: "list"; sectionIds: string[] }
  | { kind: "set_menu"; menuId: string; sectionIds: string[] }
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
export type MenuChangeSource = "this_menu" | "shared_product" | "included_menu" | "set_menu";

export type SetMenuChangeField = "price" | "vat" | "names" | "lines" | "dishes";

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
  | {
      kind: "price_changed";
      productId: string;
      name: string;
      from: string;
      to: string;
      /** On a this-menu change while this menu sets a price: what it would charge with none; null
       * when the places it would inherit from disagree. */
      inheritedPrice?: string | null;
    }
  | {
      kind: "product_changed";
      productId: string;
      name: string;
      fields: ProductChangeField[];
      /** On a this-menu change, by variant id, for each variant this menu sets a price for: what it
       * would charge with none; null when the places it would inherit from disagree. */
      inheritedVariantPrices?: Record<string, string | null>;
    }
  | {
      kind: "extra_unit_changed";
      productId: string;
      name: string;
      listId: string;
      listName: string;
      from: Pick<Unit, "name" | "abbreviation" | "staffName" | "staffAbbreviation" | "precision">;
      to: Pick<Unit, "name" | "abbreviation" | "staffName" | "staffAbbreviation" | "precision">;
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
  | {
      kind: "set_menu_added" | "set_menu_removed";
      setMenu: { id: string; name: string };
      sectionIds: string[];
      under: string[];
    }
  | {
      kind: "set_menu_changed";
      setMenu: { id: string; name: string };
      /** Empty when saving again changed only the copy's stamp. */
      fields: SetMenuChangeField[];
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
  | "vat"
  | "ordering"
  | "variants"
  | "extras"
  | "options";

export type SectionChangeField = "names" | "image" | "color" | "direct";

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
  setMenuProblems: { menuId: string; name: string; problems: SetMenuProblem[] }[];
  hash: string;
  changes: MenuChange[];
  warnings: (
    | { kind: "shortcut_missing"; name: string }
    | {
        kind: "allergens_unreviewed";
        products: { id: string; name: string; parentName: string | null }[];
      }
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
  publishedAt: string;
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

/** `GET /management-api/menus/:id/publications`. */
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
  readonly orderable: boolean;
  /** The period that ended earlier this business day whose menu this is, while no running
   * period offers it; else null, and null on a read that resolves no service period
   * (`withDefault: false`). */
  readonly endedPeriodName: string | null;
  readonly audience: "customer" | "staff";
  versionId: string;
  /** The live document's `root`. */
  structure: DocumentList;
  /** The live document's `home`. */
  home: DeviceHome;
}

/** `GET /api/menu-state?zoneId=` — each live menu's published version, and what cannot be sold
 * now. */
export interface MenuState {
  service: {
    open: boolean;
    zoneOpen: boolean;
    periodName: string | null;
    periodOccurrenceKey: string | null;
    zoneKeepOpen: {
      zoneId: string;
      zoneName: string;
      closesAt: string;
      running: boolean;
      extendedUntil: string | null;
    } | null;
    keepOpen: {
      periodId: string;
      periodName: string;
      endsAt: string;
      running: boolean;
    } | null;
  };
  menus: {
    menuId: string;
    versionId: string;
    orderable: boolean;
    /** The period that ended earlier this business day whose menu this is, while no running
     * period offers it; else null. */
    readonly endedPeriodName: string | null;
  }[];
  unavailable: MenuUnavailable;
}
