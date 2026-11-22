import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtDataTable } from "@waitron/ui/src/components/wt-data-table.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "./working-order.js";
import { watchKeyboardInsets, type VisibleArea } from "./keyboard-inset.js";
import {
  cleanupWidgets,
  mountWidget,
  pageAt,
  resetPage,
  servedMenus,
} from "../widgets/test-helpers.js";
import {
  billOptions,
  billRow,
  findBillApi,
  json,
  listPage,
} from "../../test/find-bill-fixtures.js";
import type { TillApi, TillProduct } from "../api/client.js";
import "../screens/till-find-bill-screen.js";
import "../screens/till-counter-screen.js";
import type { TillCounterScreen } from "../screens/till-counter-screen.js";

// The owner's Pixel tablet in landscape, estimated from screenshots on 2026-11-21: a 640px-high
// page with a keyboard drawn over all but its top 256px.
const PAGE = { width: 1280, height: 640 };
const VISIBLE = 256;

const locale = currentLocale();
let stop: (() => void) | undefined;
afterEach(async () => {
  stop?.();
  stop = undefined;
  cleanupWidgets();
  setLocale(locale);
  sessionStorage.removeItem("waitron.find-bill.bills");
  sessionStorage.removeItem("waitron.find-bill.transactions");
  document.documentElement.style.removeProperty("--wt-keyboard-inset");
  document.documentElement.style.removeProperty("--wt-keyboard-top");
  window.scrollTo(0, 0);
  await resetPage();
});

class FakeViewport extends EventTarget implements VisibleArea {
  height = PAGE.height;
  offsetTop = 0;
  scale = 1;
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Reports a keyboard over all but the top of the page, as the tablet's browser does, and lets the
 * scroll that follows run. */
async function openKeyboard(): Promise<void> {
  const viewport = new FakeViewport();
  stop = watchKeyboardInsets(
    { visualViewport: viewport, innerHeight: innerHeight },
    document.documentElement,
  );
  viewport.height = VISIBLE;
  viewport.dispatchEvent(new Event("resize"));
  await frame();
  await frame();
}

function inner(host: Element): HTMLInputElement {
  return host.shadowRoot!.querySelector("input")!;
}

function expectFieldAtTopWithRowBelow(field: HTMLElement, row: HTMLElement): void {
  const fieldTop = field.getBoundingClientRect().top;
  const rowBox = row.getBoundingClientRect();
  const seen = `field top ${fieldTop}, row ${rowBox.top}–${rowBox.bottom}, scrollY ${scrollY}`;
  expect(Math.abs(fieldTop), seen).toBeLessThanOrEqual(2);
  expect(rowBox.top, seen).toBeGreaterThanOrEqual(0);
  expect(rowBox.bottom, seen).toBeLessThanOrEqual(VISIBLE);
}

it("Find a bill's search moves to the top of what the keyboard leaves, with a bill below it", async () => {
  await pageAt(PAGE.width, PAGE.height);
  setLocale("en-GB");
  const source = findBillApi(async (url) =>
    json(url.pathname.endsWith("options") ? billOptions : listPage([billRow()])),
  );
  const { el } = await mountWidget<HTMLElement & { api: TillApi; active: boolean }>(
    "till-find-bill-screen",
    { api: source.api, active: true },
  );
  const table = await vi.waitFor(() => {
    const found = el.shadowRoot!.querySelector<WtDataTable<unknown>>(
      'wt-data-table[data-tab="bills"]',
    );
    expect(found?.loading).toBe(false);
    expect(found?.rows.length).toBeGreaterThan(0);
    return found!;
  });
  await table.updateComplete;
  const field = table.shadowRoot!.querySelector<HTMLInputElement>("input.table-search")!;
  const row = table.shadowRoot!.querySelector<HTMLElement>("tbody tr")!;
  field.focus();
  await openKeyboard();
  expectFieldAtTopWithRowBelow(field, row);
});

function product(key: string, name: string): TillProduct {
  return {
    id: `p-${key}`,
    productId: `p-${key}`,
    menuItemId: `mi-${key}`,
    menuId: "drinks",
    available: true,
    name,
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
  };
}

it("the Counter's product search moves to the top of what the keyboard leaves, with a result below it", async () => {
  await pageAt(PAGE.width, PAGE.height);
  const products = [product("cafe", "Café solo"), product("croquetas", "Croquetas")];
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    products,
    menus: servedMenus(
      [{ id: "drinks", name: "Drinks", isDefault: true, versionId: "drinks-v1" }],
      products.map((each) => ({ id: each.menuItemId!, menuId: "drinks", productId: each.id })),
    ),
    selectedMenuId: "drinks",
  });
  const browser = el.shadowRoot!.querySelector("till-menu-browser")!;
  const field = inner(browser.shadowRoot!.querySelector('[data-region="search"] wt-input')!);
  await userEvent.type(field, "Cro");
  const result = await vi.waitFor(() => {
    const found = [...browser.shadowRoot!.querySelectorAll<HTMLElement>("wt-button, button")].find(
      (each) => each.textContent!.includes("Croquetas"),
    );
    expect(found).toBeDefined();
    return found!;
  });
  field.focus();
  await openKeyboard();
  expectFieldAtTopWithRowBelow(field, result);
});
