import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./location-menus-screen.js";
import type { LocationMenusScreen } from "./location-menus-screen.js";
import type { DashboardApi, LocationCatalogueSummary, LocationSummary } from "../api/client.js";

/**
 * The location-menus screen scanned by axe in both themes, in two shapes: catalogues loaded (the
 * sells-here checkboxes + default radios, one row each) and NONE (the no-catalogues prompt). Mounted by
 * ASSIGNING the `api` stub as a property — the screen loads on connect, so the stub must resolve those
 * or a stray rejection pollutes the run. Every checkbox/radio carries an accessible name (aria-label),
 * so axe's label rule is satisfied.
 */
const catalogues: LocationCatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1, sellable: true, isDefault: true },
  { id: "cat-b", name: "Bebidas", active: true, version: 1, sellable: false, isDefault: false },
];
const locations: LocationSummary[] = [
  { id: "loc-1", name: "Main" },
  { id: "loc-2", name: "Annex" },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getLocations: vi.fn().mockResolvedValue(locations),
    listLocationCatalogues: vi.fn().mockResolvedValue(catalogues),
    addLocationCatalogue: vi.fn().mockResolvedValue(undefined),
    removeLocationCatalogue: vi.fn().mockResolvedValue(undefined),
    setLocationDefaultCatalogue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: LocationMenusScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("location-menus-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with catalogues loaded (location select + rows)", async () => {
    const { el, host } = await mountWidget<LocationMenusScreen>(
      "dashboard-location-menus-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly when the location sells no catalogues yet", async () => {
    const api = stubApi({ listLocationCatalogues: vi.fn().mockResolvedValue([]) });
    const { el, host } = await mountWidget<LocationMenusScreen>(
      "dashboard-location-menus-screen",
      { api },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with no locations at all", async () => {
    const api = stubApi({ getLocations: vi.fn().mockResolvedValue([]) });
    const { el, host } = await mountWidget<LocationMenusScreen>(
      "dashboard-location-menus-screen",
      { api },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
