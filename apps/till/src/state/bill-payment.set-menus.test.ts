import { expect, it } from "vitest";
import type { BillSetMenuState } from "@waitron/shared";
import type { TabLine } from "../api/client.js";
import { payLines } from "./bill-payment.js";

const row = (over: Partial<TabLine> & Pick<TabLine, "lineNo">): TabLine => ({
  changesAfterSending: null,
  stationId: null,
  movable: false,
  id: `line-${over.lineNo}`,
  productId: "p",
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "0.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  groupId: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
  ...over,
});

const placed = (lineId: string, setMenuLineId: string, priceCents: number) => ({
  lineId,
  setMenuLineId,
  place: 1,
  productId: `product-${lineId}`,
  variantId: null,
  priceCents,
  countsAsCourseId: "starter",
  movable: true,
});

const state = (...dishes: ReturnType<typeof placed>[]): BillSetMenuState => ({
  copies: [],
  recorded: {},
  setMenus: [
    { lineId: "daily-1", copyId: "daily-copy", lineNo: 1 },
    { lineId: "special-1", copyId: "special-copy", lineNo: 2 },
  ],
  dishes,
});

const menus = [
  row({ lineNo: 1, id: "daily-1", productId: null, name: "Daily menu", unitPriceGross: "14.00" }),
  row({
    lineNo: 2,
    id: "special-1",
    productId: null,
    name: "Special menu",
    unitPriceGross: "20.00",
  }),
];

it("the items list shows set menus and leaves out covered dishes at 0.00", () => {
  const lines = [
    ...menus,
    row({ lineNo: 3, id: "soup", name: "Soup" }),
    row({ lineNo: 4, id: "sea-bass", name: "Sea bass" }),
    row({ lineNo: 5, id: "sirloin", name: "Sirloin", unitPriceGross: "5.00" }),
  ];

  expect(
    payLines(
      lines,
      (line) => line.name!,
      state(
        placed("soup", "daily-1", 0),
        placed("sea-bass", "special-1", 0),
        placed("sirloin", "daily-1", 500),
      ),
    ),
  ).toEqual([
    { lineNo: 1, name: "Daily menu", quantity: "1", total: "14.00", unitTotal: null },
    { lineNo: 2, name: "Special menu", quantity: "1", total: "20.00", unitTotal: null },
    { lineNo: 5, name: "Sirloin", quantity: "1", total: "5.00", unitTotal: null },
  ]);
});

it("a covered soup with bread is listed at the bread's amount", () => {
  const lines = [
    ...menus,
    row({ lineNo: 3, id: "soup", name: "Soup" }),
    row({
      lineNo: 4,
      id: "bread",
      name: "Bread",
      parentLineNo: 3,
      productId: "bread",
      unitPriceGross: "1.50",
    }),
  ];

  expect(payLines(lines, (line) => line.name!, state(placed("soup", "daily-1", 0)))).toEqual([
    { lineNo: 1, name: "Daily menu", quantity: "1", total: "14.00", unitTotal: null },
    { lineNo: 2, name: "Special menu", quantity: "1", total: "20.00", unitTotal: null },
    { lineNo: 3, name: "Soup", quantity: "1", total: "1.50", unitTotal: null },
  ]);
});

it("a comped dish that is not in a set menu is still listed", () => {
  const lines = [
    ...menus,
    row({ lineNo: 3, id: "soup", name: "Soup" }),
    row({
      lineNo: 4,
      id: "wine",
      name: "Wine",
      unitPriceGross: "0.00",
      listUnitPriceGross: "6.00",
    }),
  ];

  expect(payLines(lines, (line) => line.name!, state(placed("soup", "daily-1", 0)))).toEqual([
    { lineNo: 1, name: "Daily menu", quantity: "1", total: "14.00", unitTotal: null },
    { lineNo: 2, name: "Special menu", quantity: "1", total: "20.00", unitTotal: null },
    { lineNo: 4, name: "Wine", quantity: "1", total: "0.00", unitTotal: null },
  ]);
});
