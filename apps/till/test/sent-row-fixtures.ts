import type {
  CurrentOrderGroup,
  CurrentOrderRow,
  CurrentOrders,
  TabLine,
} from "../src/api/kitchen-api.js";
import { withRowRequestedAt } from "./kitchen-stamps.js";

/** A sent list's fixtures: rows of bill `b1`, fired at 11:40 on the day `now` is noon of. */
export const now = Date.parse("2026-10-18T12:00:00Z");
export const at = (minute: number) => `2026-10-18T11:${String(minute).padStart(2, "0")}:00Z`;

export const sentDish = (id: string, over: Partial<CurrentOrderRow> = {}): CurrentOrderRow =>
  withRowRequestedAt({
    lineId: id,
    workingOrderId: "b1",
    billStatus: "open",
    lineNo: 1,
    courseId: null,
    name: id,
    quantity: "1.000",
    netAmount: "3.00",
    unitPrecision: 0,
    servedQuantity: "0.000",
    servedAt: null,
    released: true,
    readyAt: null,
    firedAt: at(40),
    kitchen: null,
    note: null,
    extras: [],
    ...over,
  });

export const sentGroup = (
  id: string,
  rows: CurrentOrderRow[],
  over: Partial<CurrentOrderGroup> = {},
): CurrentOrderGroup => ({
  id,
  position: 1,
  displayNumber: 7,
  numberPartyId: "p1",
  state: "held",
  firedAt: null,
  remindAt: null,
  sentAt: at(30),
  sentBy: "Ana",
  rows,
  ...over,
});

export const sentCurrent = (
  rows: CurrentOrderRow[] = [],
  groups: CurrentOrderGroup[] = [],
): CurrentOrders => ({
  revision: 4,
  hasGroups: groups.length > 0,
  nextDisplayNumber: 8,
  retainedCourses: [],
  reminder: null,
  groups,
  ungrouped: rows,
});

/** The bill line behind one portion of a burger, which makes identical portions one row. */
export const burgerLine = (id: string, lineNo: number): TabLine => ({
  id,
  lineNo,
  stationId: null,
  changesAfterSending: null,
  movable: true,
  name: "Burger",
  productId: "burger",
  parentProductId: null,
  parentLineNo: null,
  quantity: "1.000",
  priceQuantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "9.50",
  servedAt: null,
  courseId: null,
  sentAt: at(40),
  firedAt: at(40),
  state: null,
  groupId: null,
  note: null,
  listId: null,
  menuItemId: "offer-burger",
  portion: true,
});

export const burgerDish = (id: string, lineNo: number, over: Partial<CurrentOrderRow> = {}) =>
  sentDish(id, { name: "Burger", lineNo, netAmount: "9.50", ...over });
