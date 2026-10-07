import type { HomeDisplay } from "./menu-document-types.js";

/** Every section belongs to one menu. */
export type SectionRole = "section" | "menu_root" | "home_layout";

export type MemberRef =
  { kind: "product"; productId: string } | { kind: "section"; sectionId: string };

export type TileRef = MemberRef | { kind: "missing"; name: string };

export interface SectionMember<Ref extends TileRef = MemberRef> {
  id: string;
  position: number;
  ref: Ref;
}

export interface SectionDetails {
  id: string;
  internalName: string;
  /** Customer-facing names by language; `{}` when the section has none. */
  names: Record<string, string>;
  image: string | null;
  color: string | null;
  members: SectionMember[];
}

/** What one include fixes for its folder. A key that is absent follows the included menu. */
export interface IncludeFolderOverrides {
  /** Only the languages fixed here; a blank value fixes "no name in this language". */
  names?: Record<string, string>;
  image?: string | null;
  color?: string | null;
}

/** How one include shows the menu it includes. */
export interface IncludeFolder {
  showAsFolder: boolean;
  overrides: IncludeFolderOverrides;
}

/** A section's customer-facing presentation. */
export interface Presentation {
  names: Record<string, string>;
  image: string | null;
  color: string | null;
}

/** Details for creating or changing an owned section. */
export interface SectionInput {
  internalName: string;
  names?: Record<string, string>;
  image?: string | null;
  color?: string | null;
}

/** One shortcut of a Device Home Page. */
export interface HomeTile {
  memberId: string;
  position: number;
  ref: TileRef;
  missingName: string | null;
  /** A product's staff name, or a section's internal name. */
  name: string;
  /** Whether the menu's working structure reaches the target, by membership alone. */
  reachable: boolean;
}

/** A menu's working Device Home Page: its shortcuts in order, and how each device presents it. */
export interface MenuHome {
  homeSectionId: string;
  shortcuts: HomeTile[];
  handheld: HomeDisplay;
  till: HomeDisplay;
}
