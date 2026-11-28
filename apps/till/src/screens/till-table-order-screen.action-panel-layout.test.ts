import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import {
  cleanupWidgets,
  mountWidget,
  panelBackButton,
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
  "Ham croquettes",
  "Spicy potatoes",
  "Potato omelette",
  "Cold tomato soup",
  "Fried squid",
  "Caramel custard",
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

async function openAction(action: string) {
  const party = { ...switcherParty, tableIds: ["t1"] };
  const targets = Array.from({ length: 18 }, (_, index) => index + 2);
  const table = (number: number, held = false): TableState => ({
    id: `t${number}`,
    label: `Table ${number}`,
    shortName: `Table ${number}`,
    party: held ? party : null,
    signals: [],
    zoneId: null,
    state: held ? "open-tab" : "free",
    hasOpenTab: held,
    condition: held ? "held" : "free",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
  });
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products,
    menus,
    lines: [],
    orderId: "wo-1",
    draftStore: new DraftStore(),
    party,
    bills: [partyBill("wo-1", 1, "10.00"), ...targets.map((n) => partyBill(`wo-${n}`, n, "5.00"))],
    tables: [table(1, true), ...targets.map((n) => table(n))],
  });
  await resized(el);
  const root = el.shadowRoot!;
  const trigger = root.querySelector("[data-table-menu]")!.shadowRoot!.querySelector("button")!;
  await userEvent.click(trigger);
  await userEvent.click(root.querySelector(`[data-table-menu] [data-action="${action}"]`)!);
  await resized(el);
  return { root, trigger };
}

it("at 1024 px Move dishes goes under the order without squeezing the menu", async () => {
  await pageAt(1024, 900);
  const { root } = await openAction("move-dishes");
  const ordering = root.querySelector(".ordering")!;
  const panel = root.querySelector("[data-action-panel]")!;
  expect(box(panel).top).toBeGreaterThanOrEqual(box(ordering).bottom);
  const browser = root.querySelector("till-menu-browser")!;
  const picker = box(browser.querySelector("till-menu-switcher")!);
  const search = box(browser.shadowRoot!.querySelector('[data-region="search"]')!);
  expect(Math.abs(picker.bottom - search.bottom)).toBeLessThanOrEqual(1);
  expect(picker.right).toBeLessThanOrEqual(search.left);
});

it.each(["merge", "move-bill"])(
  "%s keeps Back above a scrollable list and fits the order at both widths",
  async (action) => {
    await pageAt(1024, 600);
    const { root, trigger } = await openAction(action);

    const panel = root.querySelector<HTMLElement>("[data-action-panel]")!;
    const bounds = () => {
      const { left, top, right, bottom } = box(panel.shadowRoot?.querySelector("dialog") ?? panel);
      return [left, top, right, bottom].map(Math.round);
    };
    const orderLeft = Math.round(box(root.querySelector("[data-draft-pane]")!).left);
    expect(orderLeft).toBeGreaterThan(0);
    await expect.poll(bounds).toEqual([orderLeft, 0, 1024, 600]);
    const browser = root.querySelector("till-menu-browser")!;
    const picker = box(browser.querySelector("till-menu-switcher")!);
    const search = box(browser.shadowRoot!.querySelector('[data-region="search"]')!);
    expect(Math.abs(picker.bottom - search.bottom)).toBeLessThanOrEqual(1);
    expect(picker.right).toBeLessThanOrEqual(search.left);

    const body = panel
      .querySelector("wt-full-screen-panel")!
      .shadowRoot!.querySelector('[part="body"]')!;
    const back = panelBackButton(panel.querySelector<HTMLElement>("[data-action-back]")!);
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(box(back).top).toBeGreaterThanOrEqual(0);
    expect(box(back).bottom).toBeLessThanOrEqual(600);

    await pageAt(390, 844);
    await expect.poll(bounds).toEqual([0, 0, 390, 844]);
    await userEvent.click(back);
    await expect.poll(() => root.querySelector("[data-action-panel]")).toBeNull();
    expect(trigger.getRootNode()).toHaveProperty("activeElement", trigger);
  },
);
