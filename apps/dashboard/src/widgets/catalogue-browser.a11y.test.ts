import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { CatalogueBrowser } from "./catalogue-browser.js";
import type { DashboardApi, Product } from "../api/client.js";
const product = (
  id: string,
  name: string,
  primaryCategoryId: string | null,
  active = true,
): Product => ({
  id,
  name,
  primaryCategoryId,
  categoryId: primaryCategoryId,
  active,
  catalogueId: "c",
  modifiers: [],
  customerName: null,
  unitId: "u",
  unit: { id: "u", name: { en: "Each" }, abbreviation: { en: "ea" }, precision: 0 },
  description: null,
  kitchenName: null,
  dietaryDeclarations: [],
  pricingUnit: "each",
  unitPrice: "2.00",
  vatClass: "reduced",
  available: true,
  ordering: "public",
  allergens: null,
  dietOverride: null,
  manualAllergens: null,
  image: null,
  color: null,
  variants: [],
});
const PRODUCTS = [
  product("cola", "Cola", "d"),
  product("lager", "Lager", "b", false),
  product("burger", "Burger", "f"),
  product("bread", "Bread", null),
];

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
describe.each(["light", "dark"] as const)("catalogue browser (%s)", (theme) => {
  async function mountPlain() {
    const mounted = await mountWidget<CatalogueBrowser>(
      "dashboard-catalogue-browser",
      { products: PRODUCTS, api: {} as DashboardApi, categories: [] },
      theme,
    );
    const list = mounted.el.shadowRoot!.querySelector("dashboard-product-list")!;
    await list.updateComplete;
    const table = list.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    return { ...mounted, table };
  }

  it("renders the Select button's tooltip on keyboard focus accessibly", async () => {
    const { el, host } = await mountPlain();
    const select = el.shadowRoot!.querySelector<HTMLElement>('[data-test="select"]')!;
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.tab();
    await userEvent.tab();
    expect(el.shadowRoot!.activeElement).toBe(select);
    expect(getComputedStyle(select.querySelector(".icon-tooltip")!).display).toBe("block");
    await expectNoA11yViolations(host);
  });

  it("renders the Filters panel open beside the rows accessibly", async () => {
    const width = innerWidth,
      height = innerHeight;
    await page.viewport(1280, 800);
    try {
      const { host, table } = await mountPlain();
      table.shadowRoot!.querySelector<HTMLElement>(".filters-trigger")!.click();
      await table.updateComplete;
      const panel = table.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
      expect(panel.hasAttribute("data-side")).toBe(true);
      expect(getComputedStyle(panel).display).not.toBe("none");
      await expectNoA11yViolations(host);
    } finally {
      await page.viewport(width, height);
    }
  });

  it.each(["top", "open", "search", "naming", "selection", "move", "delete"])(
    "renders %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<CatalogueBrowser>(
        "dashboard-catalogue-browser",
        {
          products: PRODUCTS,
          api: {
            createCategory: vi.fn(),
            summariseFolders: vi
              .fn()
              .mockResolvedValue([
                { id: "d", folders: 1, products: 2, activeProducts: 2, routes: 1, ownRoutes: 1 },
              ]),
          } as unknown as DashboardApi,
          categories: [
            { id: "d", name: "Drinks", parentId: null, color: "#b12525" },
            { id: "b", name: "Beer", parentId: "d", color: null },
          ],
          routing: {
            stationTimes: [],
            todayEnds: null,
            clockReadable: true,
            zones: [],
            categories: [],
            products: [],
            cells: [],
            defaultStationId: null,
            stations: [],
          },
        },
        theme,
      );
      if (state === "search") {
        el.shadowRoot!.querySelector('[name="catalogue-search"]')!.dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "beer" } }),
        );
        await el.updateComplete;
      }
      const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
      await list.updateComplete;
      await list.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
      if (state === "naming") {
        const table = list.shadowRoot!.querySelector("wt-data-table")!;
        vi.mocked(el.api.createCategory).mockRejectedValueOnce({ code: "category.invalid" });
        table.shadowRoot!.querySelector<HTMLElement>('[data-test="add-category-d"]')!.click();
        await vi.waitFor(() =>
          expect(table.shadowRoot!.activeElement?.getAttribute("name")).toBe("category-name"),
        );
        await userEvent.keyboard("Juice{Enter}");
        await vi.waitFor(() =>
          expect(
            table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error,
          ).not.toBe(""),
        );
      }
      if (state === "open") {
        const table = list.shadowRoot!.querySelector("wt-data-table")!;
        table
          .shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:d"] .row-activate')!
          .click();
        await table.updateComplete;
      }
      if (["selection", "move", "delete"].includes(state)) {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="select"]')!.click();
        await el.updateComplete;
        await list.updateComplete;
        const table = list.shadowRoot!.querySelector("wt-data-table")!;
        await table.updateComplete;
        for (const key of ["folder:d", "bread"]) {
          table.shadowRoot!.querySelector<HTMLInputElement>(`[data-test="select-${key}"]`)!.click();
          await el.updateComplete;
          await list.updateComplete;
          await table.updateComplete;
        }
        if (state !== "selection") {
          el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${state}"]`)!.click();
          await el.updateComplete;
          await vi.waitFor(() => {
            if (el.shadowRoot!.querySelector("wt-spinner")) throw new Error("summary pending");
          });
          await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
        }
      }
      await expectNoA11yViolations(host);
    },
  );

  it.each(["row", "box", "refused"] as const)(
    "renders the colour chooser opened from a %s square accessibly",
    async (from) => {
      const { el, host } = await mountWidget<CatalogueBrowser>(
        "dashboard-catalogue-browser",
        {
          products: PRODUCTS,
          api: {
            updateCategory: vi
              .fn()
              .mockRejectedValue({ code: "category.invalid", params: { field: "color" } }),
          } as unknown as DashboardApi,
          categories: [
            { id: "d", name: "Drinks", parentId: null, color: "#b12525" },
            { id: "b", name: "Beer", parentId: "d", color: null },
          ],
        },
        theme,
      );
      const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
      await list.updateComplete;
      const table = list.shadowRoot!.querySelector("wt-data-table")!;
      await table.updateComplete;
      if (from === "box") {
        table.shadowRoot!.querySelector<HTMLElement>('[data-test="add-category-d"]')!.click();
        await vi.waitFor(() =>
          expect(table.shadowRoot!.activeElement?.getAttribute("name")).toBe("category-name"),
        );
        table.shadowRoot!.querySelector<HTMLElement>('[data-test="name-box-color"]')!.click();
      } else table.shadowRoot!.querySelector<HTMLElement>('[data-test="color-d"]')!.click();
      await el.updateComplete;
      const form = el.shadowRoot!.querySelector("dashboard-category-color-form")!;
      await form.updateComplete;
      expect(form.open).toBe(true);
      if (from === "refused") {
        form.shadowRoot!.querySelector<HTMLElement>('[data-color="#256bb1"]')!.click();
        await vi.waitFor(() =>
          expect(form.shadowRoot!.querySelector("#category-color-error")!.textContent).not.toBe(""),
        );
      }
      await form.shadowRoot!.querySelector("wt-modal")!.updateComplete;
      await expectNoA11yViolations(host);
    },
  );

  it.each([
    ["routed", false],
    ["unreadable", true],
  ] as const)("renders categories' Made at %s accessibly", async (_state, failed) => {
    const { el, host } = await mountWidget<CatalogueBrowser>(
      "dashboard-catalogue-browser",
      {
        products: PRODUCTS,
        api: {} as DashboardApi,
        categories: [
          { id: "d", name: "Drinks", parentId: null, color: null },
          { id: "b", name: "Beer", parentId: "d", color: null },
          { id: "f", name: "Food", parentId: null, color: null },
        ],
        routingFailed: failed,
        routing: failed
          ? null
          : {
              stationTimes: [],
              todayEnds: null,
              clockReadable: true,
              zones: [],
              categories: [],
              products: [],
              cells: [
                {
                  row: { kind: "category", categoryId: "d" },
                  zoneId: null,
                  target: { kind: "station", stationId: "bar" },
                },
                {
                  row: { kind: "product", productId: "cola" },
                  zoneId: null,
                  target: { kind: "station", stationId: "kitchen" },
                },
              ],
              defaultStationId: "kitchen",
              stations: [
                { id: "bar", name: "Bar", active: true },
                { id: "kitchen", name: "Kitchen", active: true },
              ],
            },
      },
      theme,
    );
    const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
    await list.updateComplete;
    const table = list.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:d"] .row-activate')!
      .click();
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('[part~="maker-detail"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
