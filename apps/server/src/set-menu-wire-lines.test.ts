import { describe, expect, it } from "vitest";
import { SET_MENU_DRAFT_LINE } from "./set-menu-bill.js";
import { parseSetMenuWireLines } from "./set-menu-wire-lines.js";

const MENU = "0190A000-0000-7000-8000-000000000001";
const VERSION = "0190A000-0000-7000-8000-000000000002";
const RESERVED = "0190A000-0000-7000-8000-000000000003";
const ITEM = "0190a000-0000-7000-8000-000000000004";

const inMenu = (extra: Record<string, unknown> = {}) => ({
  menuItemId: ITEM,
  quantity: "1",
  menuVersionId: VERSION,
  setMenuId: MENU,
  ...extra,
});

function refusal(lines: unknown[]) {
  try {
    parseSetMenuWireLines(lines as Parameters<typeof parseSetMenuWireLines>[0]);
  } catch (error) {
    return (error as { code: string; params: unknown }).code === "management.request_invalid"
      ? (error as { params: unknown }).params
      : error;
  }
  return "accepted";
}

describe("parseSetMenuWireLines", () => {
  it("leaves a line that names no set menu as it was", () => {
    const line = { menuItemId: ITEM, quantity: "2", menuVersionId: VERSION, note: "no salt" };
    const [parsed] = parseSetMenuWireLines([line]);
    expect(parsed).toEqual(line);
    expect(parsed![SET_MENU_DRAFT_LINE]).toBeUndefined();
  });

  it("carries a set-menu dish into pricing by its marker, ids in lower case", () => {
    const [plain, parsed] = parseSetMenuWireLines([
      { menuItemId: ITEM, quantity: "1" },
      inMenu({ quantity: "1.000", setMenuReservedLineId: RESERVED, setMenuReservedPlace: 2 }),
    ]);
    expect(plain![SET_MENU_DRAFT_LINE]).toBeUndefined();
    expect(parsed).toEqual({
      menuItemId: ITEM,
      quantity: "1.000",
      menuVersionId: VERSION.toLowerCase(),
      [SET_MENU_DRAFT_LINE]: {
        setMenuId: MENU.toLowerCase(),
        position: 1,
        reserved: { setMenuLineId: RESERVED.toLowerCase(), place: 2 },
      },
    });
  });

  it("reserves no place when the line names none", () => {
    expect(parseSetMenuWireLines([inMenu()])[0]![SET_MENU_DRAFT_LINE]?.reserved).toBeNull();
  });

  it.each([
    ["a line that is not an object", [null], "lines"],
    ["a list as a line", [[]], "lines"],
    ["a malformed set menu", [inMenu({ setMenuId: "daily" })], "lines[0].setMenuId"],
    [
      "a reservation with no set menu",
      [{ menuItemId: ITEM, quantity: "1", menuVersionId: VERSION, setMenuReservedPlace: 0 }],
      "lines[0].setMenuId",
    ],
    ["no menu version", [inMenu({ menuVersionId: undefined })], "lines[0].menuVersionId"],
    ["more than one dish", [inMenu({ quantity: "2" })], "lines[0].quantity"],
    ["a quantity that is not text", [inMenu({ quantity: 1 })], "lines[0].quantity"],
    [
      "a place with no reserved set menu",
      [inMenu({ setMenuReservedPlace: 0 })],
      "lines[0].setMenuReservedLineId",
    ],
    [
      "a negative place",
      [inMenu({ setMenuReservedLineId: RESERVED, setMenuReservedPlace: -1 })],
      "lines[0].setMenuReservedPlace",
    ],
    [
      "a fractional place",
      [inMenu({ setMenuReservedLineId: RESERVED, setMenuReservedPlace: 0.5 })],
      "lines[0].setMenuReservedPlace",
    ],
    [
      "a place as text",
      [inMenu({ setMenuReservedLineId: RESERVED, setMenuReservedPlace: "0" })],
      "lines[0].setMenuReservedPlace",
    ],
    [
      "a reserved set menu with no place",
      [inMenu({ setMenuReservedLineId: RESERVED })],
      "lines[0].setMenuReservedPlace",
    ],
  ])("refuses %s", (_, lines, field) => {
    expect(refusal(lines)).toEqual({ field });
  });
});
