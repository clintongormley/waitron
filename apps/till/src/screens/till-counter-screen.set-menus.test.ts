import { afterEach, describe, expect, it } from "vitest";
import type { BillSetMenuState } from "@waitron/shared";
import { es } from "../i18n/strings.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { bill } from "../../test/set-menu-widgets.js";
import "./till-counter-screen.js";
import type { TillCounterScreen } from "./till-counter-screen.js";

afterEach(cleanupWidgets);

const formed = bill;
const none: BillSetMenuState = { ...bill, setMenus: [], dishes: [] };

async function mountTakeaway(setMenuBill: BillSetMenuState) {
  const store = new WorkingOrderStore();
  store.loadFrom("counter-bill", [], undefined, 1, undefined, "takeaway");
  return mountWidget<TillCounterScreen>("till-counter-screen", { store, setMenuBill });
}

const notes = (el: TillCounterScreen) =>
  Array.from(el.shadowRoot!.querySelectorAll(".total-cell [data-not-cheapest]"), (note) =>
    note.textContent!.trim(),
  );

describe.each([
  ["en-GB", "set menus formed", formed, "These set menus may not be the cheapest for this bill."],
  ["es-ES", "set menus formed", formed, es["set_menu.not_cheapest"]],
  ["en-GB", "no set menus formed", none, "Set menus might make this bill cheaper."],
  ["es-ES", "no set menus formed", none, es["set_menu.none_maybe_cheaper"]],
] as const)("Counter total in %s, %s", (locale, _case, state, text) => {
  it("says the bill may not be at its cheapest when the server's search stopped early", async () => {
    const originalLocale = currentLocale();
    try {
      setLocale(locale);
      const { el } = await mountTakeaway({ ...state, exact: false });
      expect(notes(el)).toEqual([text]);
    } finally {
      setLocale(originalLocale);
    }
  });

  it("says nothing once the server proves the cheapest", async () => {
    const originalLocale = currentLocale();
    try {
      setLocale(locale);
      const { el } = await mountTakeaway({ ...state, exact: false });
      el.setMenuBill = { ...state, exact: true };
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-not-cheapest]")).toBeNull();
      expect(el.shadowRoot!.textContent).not.toContain(text);
    } finally {
      setLocale(originalLocale);
    }
  });
});

it("says nothing when the Counter has no set-menu answer", async () => {
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
  });
  expect(el.shadowRoot!.querySelector("[data-not-cheapest]")).toBeNull();
});
