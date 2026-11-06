import type { HomeDevice, HomeDisplay, MenuChange, MenuPreview } from "./menu-document-types.js";
import type { IncludeFolder, MemberRef, MenuHome, SectionInput } from "./section-types.js";

export interface UndoStructureNode {
  memberId: string;
  ref: MemberRef;
  children?: readonly UndoStructureNode[];
  ownerMenuId?: string;
  includedMenuId?: string;
  folder?: IncludeFolder;
}

export interface MenuUndoInput {
  preview: MenuPreview;
  /** The content languages switched on now. */
  languages: readonly string[];
  structure?: { rootSectionId: string; nodes: readonly UndoStructureNode[] } | null;
  /** The working Home page with member ids. */
  home?: MenuHome | null;
}

/** One write that puts a change back, named for the dashboard client method it maps to, with that
 * method's arguments and the display names a refusal sentence needs. */
export type MenuUndoCommand =
  | { method: "renameCatalogue"; menuId: string; name: string }
  | {
      method: "updateMenuItem";
      menuId: string;
      menuItemId: string;
      input: { grossPrice: string | null };
      name: string;
    }
  | {
      method: "setMenuVariantPrice";
      menuId: string;
      menuItemId: string;
      variantId: string;
      price: string | null;
      name: string;
      variantName: string;
    }
  | { method: "updateSection"; sectionId: string; patch: Partial<SectionInput>; name: string }
  | {
      method: "setHomeDisplay";
      menuId: string;
      device: HomeDevice;
      patch: Partial<HomeDisplay>;
    };

export type MenuChangeAction =
  | { kind: "undo"; command: MenuUndoCommand }
  | { kind: "edit_product"; productId: string }
  | { kind: "edit_menu"; menuId: string; tab: "structure" | "prices" }
  | { kind: "edit_extras_list"; listId: string }
  | { kind: "none" };

/** Every change's action, by change id, worked out once. */
export function menuChangeActions(input: MenuUndoInput): ReadonlyMap<string, MenuChangeAction> {
  return new Map(input.preview.changes.map((change) => [change.id, actionFor(change)]));
}

const NONE: MenuChangeAction = { kind: "none" };

function actionFor(change: MenuChange): MenuChangeAction {
  switch (change.source) {
    case "shared_product":
      return sharedProductAction(change);
    case "included_menu":
      return includedMenuAction(change);
    case "this_menu":
      return NONE;
  }
}

function sharedProductAction(change: MenuChange): MenuChangeAction {
  switch (change.kind) {
    case "product_deleted":
    case "product_removed":
      return NONE;
    case "extra_portion_changed":
    case "extra_max_quantity_changed":
      return { kind: "edit_extras_list", listId: change.listId };
    default:
      return "productId" in change ? { kind: "edit_product", productId: change.productId } : NONE;
  }
}

function includedMenuAction(change: MenuChange): MenuChangeAction {
  if (change.includedMenu === undefined) return NONE;
  const prices =
    change.kind === "price_changed" ||
    (change.kind === "product_changed" && change.fields.every((field) => field === "variants"));
  return {
    kind: "edit_menu",
    menuId: change.includedMenu.id,
    tab: prices ? "prices" : "structure",
  };
}
