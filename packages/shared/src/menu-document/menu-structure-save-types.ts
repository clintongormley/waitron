import type { IncludeFolder, MemberRef, SectionDetails } from "./section-types.js";

export interface MenuStructureMemberInput {
  id: string;
  ref: MemberRef;
  folder?: IncludeFolder;
}

export interface MenuStructurePriceInput {
  productId: string;
  variantId?: string;
  price: string;
}

export interface MenuStructureSaveInput {
  rootMembers: MenuStructureMemberInput[];
  sections: (Omit<SectionDetails, "members"> & { members: MenuStructureMemberInput[] })[];
  prices: MenuStructurePriceInput[];
}

export interface MenuStructureSaveResult {
  dropped: (
    | { memberId: string; reason: "deleted" }
    | { productId: string; variantId?: string; reason: "deleted" | "has_variants" | "unreachable" }
  )[];
}
