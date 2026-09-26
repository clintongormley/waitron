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

/** Stripped from the document (D6): availability, and the three fields that are not menu content. */
export type OverlayOfferField = "available" | "vatClass" | "courseId" | "category";
/** `OfferedExtraItem` carries no `available`; the served offer adds it. */
export type OverlayExtraItemField = "available" | "vatClass";

export type FrozenExtraItem = Omit<OfferedExtraItem, OverlayExtraItemField>;
export type FrozenOptionLabel = Omit<OptionLabel, "available">;

/** Every item and every label, available or not: availability is applied when the document is
 * served. */
export type FrozenOfferedModifier =
  | (Omit<OfferedExtrasList, "items"> & { items: FrozenExtraItem[] })
  | (Omit<OfferedOptionsList, "labels"> & { labels: FrozenOptionLabel[] });

export type FrozenOfferVariant = Omit<MenuOfferVariant, OverlayOfferField>;

export type FrozenOffer = Omit<
  MenuOffer,
  OverlayOfferField | "placements" | "offeredModifiers" | "variants"
> & {
  /** The dish's own photo and description, which `MenuOffer` does not carry. */
  image: string | null;
  description: Record<string, string> | null;
  variants: FrozenOfferVariant[];
  placements: string[][];
  offeredModifiers: FrozenOfferedModifier[];
};

export type DocumentMember =
  | { kind: "product"; menuItemId: string; productId: string }
  | {
      kind: "section";
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
  { kind: "product"; productId: string } | { kind: "section"; sectionId: string };

export interface DocumentLayout {
  id: string;
  name: string;
  tiles: DocumentTile[];
}

export interface MenuDocument {
  format: 1;
  menuId: string;
  menuName: string;
  /** The menu's top level. */
  root: DocumentList;
  /** Keyed by menu-item id: one per distinct product the menu offers. */
  offers: Record<string, FrozenOffer>;
  /** The default first; a shortcut whose target is not in the document is left out (D13). */
  homeLayouts: DocumentLayout[];
  defaultHomeLayoutId: string;
}

/** An extras item as a served offer carries it: the frozen item with its current availability. */
export type LiveExtraItem = OfferedExtraItem & { available: boolean };

/**
 * An options list as a served offer carries it. Unlike `OfferedOptionsList`, whose labels are the
 * available ones alone, it holds every label the document holds.
 */
export type LiveOptionsList = Omit<OfferedOptionsList, "labels" | "defaultLabelId"> & {
  /** Every label, each with its current availability. */
  labels: OptionLabel[];
  /** Null unless it names a label that is available now. */
  defaultLabelId: string | null;
};

export type LiveOfferedModifier =
  (Omit<OfferedExtrasList, "items"> & { items: LiveExtraItem[] }) | LiveOptionsList;

/**
 * A published offer with the live fields put back from the current rows. Every variant, extras item
 * and option label the document holds is present, each marked with whether it can be sold now.
 */
export interface LiveOffer extends MenuOffer {
  available: boolean;
  image: string | null;
  description: Record<string, string> | null;
  offeredModifiers: LiveOfferedModifier[];
}

/** Where a change came from (spec §11.1). */
export type ChangeSource = "this_menu" | "shared_product" | "shared_section";

export type MenuChange = {
  source: ChangeSource;
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
  | { kind: "product_moved"; productId: string; name: string; from: string[][]; to: string[][] }
  | { kind: "price_changed"; productId: string; name: string; from: string; to: string }
  | { kind: "product_changed"; productId: string; name: string; fields: ProductChangeField[] }
  | {
      kind: "section_added" | "section_removed";
      sectionId: string;
      name: string;
      under: string[];
    }
  | { kind: "section_changed"; sectionId: string; name: string; fields: SectionChangeField[] }
  | { kind: "order_changed"; list: string[] }
  | { kind: "layout_changed"; layoutId: string; name: string }
  | { kind: "default_layout_changed"; from: string; to: string }
  | { kind: "menu_renamed"; from: string; to: string }
);

export type ProductChangeField =
  | "names"
  | "description"
  | "image"
  | "unit"
  | "allergens"
  | "diet"
  | "variants"
  | "extras"
  | "options";

export type SectionChangeField = "names" | "image" | "color";

export type MenuStatus =
  | { state: "unpublished" }
  | { state: "current" | "changed"; version: number; publishedAt: string; hash: string };

/** What publishing the menu's working state now would change, and the hash a publish must match. */
export interface MenuPreview {
  hash: string;
  changes: MenuChange[];
  warnings: { kind: "shortcut_omitted"; layoutName: string; name: string }[];
}

/** The version a publish made live. */
export interface PublishedMenuVersion {
  versionId: string;
  number: number;
}
