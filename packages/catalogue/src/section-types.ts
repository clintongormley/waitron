/** A `library` section is reusable; a `menu_root` or `home_layout` list belongs to one menu. */
export type SectionRole = "library" | "menu_root" | "home_layout";

export type MemberRef =
  { kind: "product"; productId: string } | { kind: "section"; sectionId: string };

export interface SectionMember {
  id: string;
  position: number;
  ref: MemberRef;
}

export interface LibrarySection {
  id: string;
  internalName: string;
  /** Customer-facing names by language; `{}` when the section has none. */
  names: Record<string, string>;
  image: string | null;
  color: string | null;
  members: SectionMember[];
}

export interface SectionUsages {
  menus: { id: string; name: string }[];
  sections: { id: string; internalName: string }[];
}

/** A section's details, as creating or changing a library section takes them. */
export interface SectionInput {
  internalName: string;
  names?: Record<string, string>;
  image?: string | null;
  color?: string | null;
}

/** One tile of a home layout, as the Home page tab lists it. `ref.kind` says product or section. */
export interface HomeTile {
  memberId: string;
  position: number;
  ref: MemberRef;
  /** A product's staff name, or a section's internal name. */
  name: string;
  /** False when the menu's working state no longer offers the product or reaches the section:
   * publishing leaves such a tile out (D13). */
  reachable: boolean;
}

/** A menu's working home layout with its tiles in order. */
export interface HomeLayout {
  id: string;
  name: string;
  isDefault: boolean;
  tiles: HomeTile[];
}

/** One menu's layouts, and the one a device profile chose for it. */
export interface DeviceMenuHomeLayouts {
  menuId: string;
  menuName: string;
  /** The default first, then the others by name. */
  layouts: { id: string; name: string; isDefault: boolean }[];
  /** Null means the menu's default layout. */
  selectedLayoutId: string | null;
  /** The chosen layout is no longer one of the menu's working layouts (D14). */
  selectedRemoved: boolean;
}
