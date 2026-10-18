import { afterEach, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { mount } from "./till-table-order-screen.test-helpers.js";
import { current } from "./till-table-order-screen.current-orders.test-helpers.js";
import { dish, extra, recorded } from "./till-table-order-screen.sent-prices.test-helpers.js";
import { openSentDish } from "./till-table-order-screen.sent.test-helpers.js";

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
          note: "Dish note",
          servedAt: "2026-09-28T20:05:00Z",
          servedQuantity: "2.000",
        },
      ],
    }),
  });
  const dialog = await openSentDish(el, "dish", "served");
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
