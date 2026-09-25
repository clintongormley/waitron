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
