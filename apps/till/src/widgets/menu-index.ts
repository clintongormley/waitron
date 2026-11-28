import {
  indexDocument,
  type DocumentMember,
  type HomeIndex,
  type SectionStep,
} from "@waitron/shared";
import type { TillProduct, TillZoneMenu } from "../api/menu-api.js";
import type { OrderingCopy } from "../state/set-menus.js";

export type SectionNode = Extract<DocumentMember, { kind: "section" }>;

export type MenuIndex = HomeIndex<TillProduct>;
export function listsSetMenu(members: readonly DocumentMember[], id: string): boolean {
  return members.some((member) =>
    member.kind === "set_menu"
      ? member.menuId === id
      : member.kind === "section" && listsSetMenu(member.members, id),
  );
}

export type SearchResult =
  | { kind: "product"; product: TillProduct }
  | { kind: "set_menu"; row: OrderingCopy }
  | { kind: "section"; section: SectionNode; path: SectionStep[]; disabled: boolean };

/**
 * A product member whose offer is not among `products` is left out, and so is one not sold
 * separately, which is ordered only as an extra on another dish, and a section left with nothing
 * to order. Staff only is shown: every till screen is staff's.
 */
export function indexMenu(
  menu: TillZoneMenu,
  products: TillProduct[],
  copies: readonly OrderingCopy[] = [],
): MenuIndex {
  const offers = new Map(
    products
      .filter((product) => product.ordering !== "not_sold_separately")
      .map((product) => [product.menuItemId, product]),
  );
  return indexDocument(
    menu.structure.members,
    (id) => offers.get(id),
    (id) => copies.some(({ copy }) => copy.menuId === id),
  );
}
