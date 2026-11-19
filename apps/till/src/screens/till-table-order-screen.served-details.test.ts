import { afterEach, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { mount } from "./till-table-order-screen.test-helpers.js";
import { current, row } from "./till-table-order-screen.current-orders.test-helpers.js";
import { dish, extra, recorded } from "./till-table-order-screen.sent-prices.test-helpers.js";
import { openSentDish } from "./till-table-order-screen.sent.test-helpers.js";

import { partyBill } from "./till-table-order-screen.bill-switcher.test-helpers.js";
import { bill as setMenuBill } from "../../test/set-menu-widgets.js";

const options = [
  {
    listName: { en: "Staff cut" },
    listCustomerName: { en: "Customer cut" },
    listKitchenName: "Kitchen cut",
    labelName: { en: "Staff sliced" },
    labelCustomerName: { en: "Customer sliced" },
    labelKitchenName: "Kitchen sliced",
  },
];

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

it("keeps served dish and extra option answers, notes and extra nutrition in the native dish window", async () => {
  setLocale("en");
  const { el } = await mount({
    lines: [
      { ...dish, optionSnapshots: options, servedAt: "2026-09-28T20:05:00Z" },
      {
        ...extra,
        optionSnapshots: options,
        note: "Extra note",
        nutrition: { allergens: { milk: {} }, dietaryDeclarations: [] },
      },
    ],
    currentOrders: current({
      groups: [],
      reminder: null,
      ungrouped: [
        {
          ...recorded,
          sentAt: "2026-09-28T20:00:00Z",
          nutrition: { allergens: { eggs: {} }, dietaryDeclarations: ["vegetarian"] },
          note: "Dish note",
          servedAt: "2026-09-28T20:05:00Z",
          servedQuantity: "2.000",
        },
      ],
    }),
  });
  const dialog = await openSentDish(el, "dish", "served");
  expect(dialog.textContent).toContain("Recorded when sent");
  const picked = [...dialog.querySelectorAll(".modifier-answer")].map((el) =>
    el.textContent!.trim(),
  );
  expect(picked).toEqual(["Staff cut: Staff sliced", "Staff cut: Staff sliced"]);
  expect(dialog.textContent).toContain("Dish note");
  const extraRow = dialog.querySelector('[data-sent-extra="extra"]')!;
  expect(extraRow.textContent).toContain("Extra note");
  expect(extraRow.querySelector('[name="allergen-milk"]')).not.toBeNull();
  expect(dialog.textContent).not.toContain("Customer sliced");
  expect(dialog.textContent).not.toContain("Kitchen sliced");
  el.lines = el.lines.map((line) => ({ ...line, id: `other-${line.id}` }));
  await el.updateComplete;
  expect(dialog.querySelector(".modifier-answer")).toBeNull();
  expect(dialog.querySelector('[data-sent-extra="extra"]')!.textContent).not.toContain(
    "Extra note",
  );
  expect(dialog.querySelector('[data-sent-extra="extra"] [name="allergen-milk"]')).toBeNull();
  expect(dialog.textContent).toContain("Dish note");
});

it("closes a grouped Sent detail when its dishes move to different types of set menu", async () => {
  const lines = [1, 2].map((lineNo) => ({
    ...dish,
    id: `soup-${lineNo}`,
    lineNo,
    name: "Soup",
    quantity: "1.000",
    portion: true,
  }));
  const placed = lines.map(({ id }) => ({
    ...setMenuBill.dishes[0]!,
    lineId: id,
    setMenuLineId: "daily-2",
    priceCents: 0,
  }));
  const bill = partyBill("wo-4", 1, "47.00", {
    setMenus: { ...setMenuBill, dishes: placed },
  });
  const { el } = await mount({
    lines,
    bills: [bill],
    currentOrders: current({
      groups: [],
      ungrouped: lines.map(({ id, lineNo }) =>
        row(id, "Soup", "1.000", { lineNo, netAmount: "0.00" }),
      ),
    }),
  });
  const dialog = await openSentDish(el, "soup-1");
  const native = dialog.shadowRoot!.querySelector("dialog")!;
  expect(native.open).toBe(true);
  el.bills = [
    {
      ...bill,
      setMenus: {
        ...setMenuBill,
        dishes: [placed[0]!, { ...placed[1]!, setMenuLineId: "special-1" }],
      },
    },
  ];
  await el.updateComplete;
  await dialog.updateComplete;
  expect(native.open).toBe(false);
});
