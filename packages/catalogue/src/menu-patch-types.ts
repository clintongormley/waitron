import type { MenuDocument, QueuedEdition } from "./menu-document-types.js";

/** The patch wire shapes. A browser-safe LEAF: types and the field table only. */

export type MenuPatchTarget =
  | { kind: "offer"; menuItemId: string }
  | { kind: "variant"; menuItemId: string; variantId: string }
  | { kind: "extra"; listId: string; productId: string }
  | { kind: "option_label"; listId: string; labelId: string }
  | { kind: "list"; listKind: "extras" | "options"; listId: string }
  | { kind: "section"; sectionId: string };

export interface MenuPatchChange {
  target: MenuPatchTarget;
  field: string;
  value: unknown;
}

/** The only fields a patch may change, per kind of target; anything else is refused. */
export const PATCH_FIELDS: { readonly [K in MenuPatchTarget["kind"]]: readonly string[] } = {
  offer: ["name", "customerName", "kitchenName", "description", "image", "price", "vatClass"],
  variant: ["name", "customerName", "kitchenName", "image", "price", "vatClass"],
  extra: ["name", "customerName", "kitchenName", "image", "price", "vatClass"],
  option_label: ["name", "customerName", "kitchenName"],
  list: ["name", "customerName", "kitchenName"],
  section: ["internalName", "names", "image"],
};

export interface MenuPatchResult {
  versionId: string;
  number: number;
  requeued: QueuedEdition[];
}

export interface LiveMenu {
  versionId: string;
  number: number;
  since: string;
  document: MenuDocument;
}
