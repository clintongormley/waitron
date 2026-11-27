import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import {
  cleanupWidgets,
  mountWidget,
  pageAt,
  resetPage,
  servedMenus,
} from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { TableState } from "../api/floor-api.js";
import type { TillProduct } from "../api/menu-api.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, resized } from "./till-table-order-screen.test-helpers.js";
import { partyBill, switcherParty } from "./till-table-order-screen.bill-switcher.test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await resetPage();
});

const products: TillProduct[] = [
  "Croquetas de jamón",
  "Patatas bravas",
  "Tortilla",
  "Gazpacho",
  "Calamares",
  "Flan",
].map((name, index) => ({
  ...beer,
  id: `p${index}`,
  menuItemId: `offer-${index}`,
  menuId: index % 2 === 0 ? "evening" : "drinks",
  name,
}));
const menus = servedMenus(
  [
    { id: "evening", name: "Evening Special", isDefault: true, versionId: "evening-v1" },
    { id: "drinks", name: "Drinks", isDefault: false, versionId: "drinks-v1" },
  ],
  products.map((product) => ({
    id: product.menuItemId!,
    menuId: product.menuId!,
    productId: product.id,
  })),
);

const box = (element: Element) => element.getBoundingClientRect();

// The panel goes under the order where the menu would otherwise be squeezed below its own width,
// down to where the picker would leave the search's line.
it("at 1024 px an open action panel goes under the order rather than squeezing the menu", async () => {
  setLocale("en");
  await pageAt(1024, 900);
  const party = { ...switcherParty, tableIds: ["t4", "t5"] };
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products,
    menus,
    lines: [],
    orderId: "wo-2",
    draftStore: new DraftStore(),
    party,
    bills: [partyBill("wo-1", 1, "10.00"), partyBill("wo-2", 2, "54.00")],
    tables: party.tableIds.map(
      (id) =>
        ({
          id,
          label: id,
          shortName: id,
          party,
          signals: [],
          zoneId: null,
          state: "open-tab",
          hasOpenTab: true,
          condition: "held",
          pendingDeliveries: 0,
          pendingToServe: 0,
          readyToServe: 0,
          timingBand: "fresh",
          nextReservation: null,
          today: null,
        }) as TableState,
    ),
  });
  await resized(el);
  await userEvent.click(el.shadowRoot!.querySelector("[data-table-menu]")!);
  await userEvent.click(el.shadowRoot!.querySelector('[data-table-menu] [data-action="merge"]')!);
  await resized(el);

  const ordering = el.shadowRoot!.querySelector(".ordering")!;
  const panel = el.shadowRoot!.querySelector("[data-action-panel]")!;
  expect(panel).not.toBeNull();
  expect(box(panel).top).toBeGreaterThanOrEqual(box(ordering).bottom);
  const browser = el.shadowRoot!.querySelector("till-menu-browser")!;
  const picker = box(browser.querySelector("till-menu-switcher")!);
  const search = box(browser.shadowRoot!.querySelector('[data-region="search"]')!);
  expect(Math.abs(picker.bottom - search.bottom)).toBeLessThanOrEqual(1);
  expect(picker.right).toBeLessThanOrEqual(search.left);
});
