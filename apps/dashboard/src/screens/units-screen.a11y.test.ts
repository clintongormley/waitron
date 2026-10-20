import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setHelpMode } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { UnitsScreen } from "./units-screen.js";
import "./units-screen.js";

afterEach(cleanupWidgets);
afterEach(() => setHelpMode(false));

async function visibleHelp(root: ShadowRoot): Promise<number> {
  const badges = [
    ...root.querySelectorAll<HTMLElementTagNameMap["wt-help-tooltip"]>("wt-help-tooltip"),
  ];
  await Promise.all(badges.map((badge) => badge.updateComplete));
  return badges.filter((badge) => badge.checkVisibility()).length;
}

function api(): DashboardApi {
  const listUnits = vi.fn().mockResolvedValue([
    {
      id: "u1",
      staffName: "Staff unit",
      staffAbbreviation: "su",
      name: { es: "unidad", en: "each" },
      abbreviation: { es: "ud", en: "ea" },
      precision: 0,
    },
  ]);
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
          { id: "p1", name: "Café", active: true },
          { id: "p2", name: "Té", active: false },
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

  it("renders the editor accessibly with help on", async () => {
    setHelpMode(true);
    const { el, host } = await mountWidget<UnitsScreen>(
      "dashboard-units-screen",
      { api: api() },
      theme,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    await form.updateComplete;
    expect(await visibleHelp(form.shadowRoot!)).toBe(1);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
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
