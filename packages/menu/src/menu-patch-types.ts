import type { MenuDocument, QueuedEdition } from "@waitron/shared";
import type { DeclarationValues } from "./declaration-values.js";

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
  offer: ["name", "customerName", "kitchenName", "description", "image", "price", "declarations"],
  variant: ["name", "customerName", "kitchenName", "image", "price", "declarations"],
  extra: ["name", "customerName", "kitchenName", "image", "price", "declarations"],
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

/** A queued version holding declarations that are not the products' current ones. */
export interface QueuedDeclarationDrift {
  versionId: string;
  activatesAt: string;
  /** The targets whose copies here differ, a dish's including its variants; `stillOld` when every
   * differing copy holds the value being corrected. */
  targets: { target: MenuPatchTarget; stillOld: boolean }[];
}

export interface PatchDraft extends LiveMenu {
  /** Every dish's, variant's and extra's current values, by product id: what a declarations change
   * copies. */
  declarations: Record<string, DeclarationValues>;
  queued: QueuedDeclarationDrift[];
}
