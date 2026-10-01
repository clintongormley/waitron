import { afterEach, beforeEach, describe, it, vi } from "vitest";
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
  it.each(["top", "folder", "search", "all", "form", "selection", "move", "delete"])(
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
              .mockResolvedValue([{ id: "d", folders: 1, products: 2, routes: 1 }]),
          } as unknown as DashboardApi,
          categories: [
            { id: "d", name: "Drinks", parentId: null },
            { id: "b", name: "Beer", parentId: "d" },
          ],
          routing: {
            stationTimes: [],
            todayEnds: null,
            clockReadable: true,
            claims: [],
            exceptions: [],
            unassigned: { folders: [], products: [] },
            defaultStationId: null,
            stations: [],
          },
          folderId: state === "folder" ? "b" : null,
          view: state === "all" ? "all" : "folders",
        },
        theme,
      );
      if (state === "search") {
        el.shadowRoot!.querySelector('[name="catalogue-search"]')!.dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "beer" } }),
        );
        await el.updateComplete;
      }
      if (state === "form") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="new-folder"]')!.click();
        await el.updateComplete;
        await el.shadowRoot!.querySelector("dashboard-category-form")!.updateComplete;
      }
      const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
      await list.updateComplete;
      await list.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
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
});
