import { requireBodyUuid } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { SET_MENU_DRAFT_LINE, type SetMenuDraftLine } from "./set-menu-bill.js";
import "./errors.js";

/** The set-menu fields a till line may carry: a dish tapped in a set-menu folder. */
export interface SetMenuWireFields {
  setMenuId?: unknown;
  setMenuReservedLineId?: unknown;
  setMenuReservedPlace?: unknown;
}

export type SetMenuParsedLine<L> = Omit<L, keyof SetMenuWireFields> & {
  [SET_MENU_DRAFT_LINE]?: SetMenuDraftLine;
};

/**
 * A basket's lines as pricing takes them: a line naming a set menu carries it, its version and
 * any reserved place as a {@link SET_MENU_DRAFT_LINE}, and holds exactly one dish. A malformed field
 * is `management.request_invalid` naming `lines[i].<field>`, and a line that is not an object names
 * `lines`.
 */
export function parseSetMenuWireLines<
  L extends SetMenuWireFields & { quantity?: unknown; menuVersionId?: unknown },
>(lines: readonly L[]): SetMenuParsedLine<L>[] {
  return lines.map((line, position) => {
    if (typeof line !== "object" || line === null || Array.isArray(line))
      throw new AppError("management.request_invalid", { field: "lines" });
    const { setMenuId, setMenuReservedLineId, setMenuReservedPlace, ...dish } = line;
    if (
      setMenuId === undefined &&
      setMenuReservedLineId === undefined &&
      setMenuReservedPlace === undefined
    )
      return dish;
    const field = (name: string) => `lines[${position}].${name}`;
    const menuId = requireBodyUuid(setMenuId, field("setMenuId")).toLowerCase();
    const menuVersionId = requireBodyUuid(dish.menuVersionId, field("menuVersionId")).toLowerCase();
    if (typeof dish.quantity !== "string" || !/^1(?:\.0{1,3})?$/.test(dish.quantity))
      throw new AppError("management.request_invalid", { field: field("quantity") });
    let reserved = null;
    if (setMenuReservedLineId !== undefined || setMenuReservedPlace !== undefined) {
      const setMenuLineId = requireBodyUuid(
        setMenuReservedLineId,
        field("setMenuReservedLineId"),
      ).toLowerCase();
      if (
        typeof setMenuReservedPlace !== "number" ||
        !Number.isSafeInteger(setMenuReservedPlace) ||
        setMenuReservedPlace < 0
      )
        throw new AppError("management.request_invalid", {
          field: field("setMenuReservedPlace"),
        });
      reserved = { setMenuLineId, place: setMenuReservedPlace };
    }
    return {
      ...dish,
      menuVersionId,
      [SET_MENU_DRAFT_LINE]: { setMenuId: menuId, position, held: false, reserved },
    };
  });
}
