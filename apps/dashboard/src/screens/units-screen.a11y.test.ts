import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { UnitsScreen } from "./units-screen.js";
import "./units-screen.js";

afterEach(cleanupWidgets);

function api(): DashboardApi {
  const listUnits = vi
    .fn()
    .mockResolvedValue([{ id: "u1", name: { es: "unidad", en: "each" }, precision: 0 }]);
  const getContentLanguages = vi
    .fn()
    .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] });
  return {
    liveData: new LiveData(),
    background: { listUnits, getContentLanguages },
    listUnits,
    getContentLanguages,
    createUnit: vi.fn(),
    updateUnit: vi.fn(),
    deleteUnit: vi.fn().mockRejectedValue({
      code: "unit.in_use",
      params: {
        products: [
          { id: "p1", name: { es: "Café", en: "Coffee" }, available: true },
          { id: "p2", name: { es: "Té", en: "Tea" }, available: false },
        ],
      },
    }),
  } as unknown as DashboardApi;
}

describe.each(["light", "dark"] as const)("units-screen a11y (%s theme)", (theme) => {
  it("renders the list and editor accessibly", async () => {
    const { el, host } = await mountWidget<UnitsScreen>(
      "dashboard-units-screen",
      { api: api() },
      theme,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    await el.shadowRoot!.querySelector("dashboard-unit-form")!.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders the in-use modal accessibly", async () => {
    const { el, host } = await mountWidget<UnitsScreen>(
      "dashboard-units-screen",
      { api: api() },
      theme,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    // Deleting an in-use unit is refused and opens the modal.
    el.shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=delete-u1]")!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
