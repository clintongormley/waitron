import type { CurrentOrderRow, TabLine } from "../api/client.js";
import { row } from "./till-table-order-screen.current-orders.test-helpers.js";
import { storedDish } from "./till-table-order-screen.sent-fallback.test-helpers.js";

export const dish: TabLine = {
  ...storedDish,
  id: "dish",
  lineNo: 1,
  name: "Recorded pizza",
  quantity: "2.000",
  unitPriceGross: "0.00",
  listUnitPriceGross: "9.00",
};
export const extra: TabLine = {
  ...dish,
  id: "extra",
  lineNo: 2,
  name: "Recorded olives",
  parentLineNo: 1,
  listUnitPriceGross: "1.50",
  state: null,
};
export const recorded: CurrentOrderRow = row("dish", "Recorded pizza", "2.000", {
  netAmount: "0.00",
  extras: [
    {
      lineId: "extra",
      name: "Recorded olives",
      quantity: "2.000",
      netAmount: "0.00",
      unitPriceGross: "0.00",
      priceQuantity: "1.000",
    },
  ],
});
