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
