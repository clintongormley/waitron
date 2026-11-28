import { requireBodyUuid } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { SET_MENU_DRAFT_LINE, type SetMenuDraftLine } from "./set-menu-bill.js";
import "./errors.js";

/** The set-menu fields a till line may carry: a dish tapped in a set-menu folder. */
export interface SetMenuWireFields {
  setMenuId?: unknown;
}

export type SetMenuParsedLine<L> = Omit<L, keyof SetMenuWireFields> & {
  [SET_MENU_DRAFT_LINE]?: SetMenuDraftLine;
};

/**
 * A set-menu basket line holds exactly one dish. Pricing reads its menu from
 * {@link SET_MENU_DRAFT_LINE} and its version from `menuVersionId`.
 */
export function parseSetMenuWireLines<
  L extends SetMenuWireFields & { quantity?: unknown; menuVersionId?: unknown },
>(lines: readonly L[]): SetMenuParsedLine<L>[] {
  return lines.map((line, position) => {
    if (typeof line !== "object" || line === null || Array.isArray(line))
      throw new AppError("management.request_invalid", { field: "lines" });
    const { setMenuId, ...dish } = line;
    if (setMenuId === undefined) return dish;
    const field = (name: string) => `lines[${position}].${name}`;
    const menuId = requireBodyUuid(setMenuId, field("setMenuId")).toLowerCase();
    const menuVersionId = requireBodyUuid(dish.menuVersionId, field("menuVersionId")).toLowerCase();
    if (typeof dish.quantity !== "string" || !/^1(?:\.0{1,3})?$/.test(dish.quantity))
      throw new AppError("management.request_invalid", { field: field("quantity") });
    return {
      ...dish,
      menuVersionId,
      [SET_MENU_DRAFT_LINE]: { setMenuId: menuId, position },
    };
  });
}
