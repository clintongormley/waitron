import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { ModifiersScreen } from "./modifiers-screen.js";
import type { DashboardApi } from "../api/client.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("modifiers screen (%s)", (theme) => {
  it.each(["empty", "populated", "failed"])("accessible %s state", async (state) => {
    const client = {
      getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
      listModifiers:
        state === "failed"
          ? vi.fn().mockRejectedValue(new Error("offline"))
          : vi
              .fn()
              .mockResolvedValue(
                state === "empty"
                  ? []
                  : [{ id: "m", type: "text", name: { es: "Nota" }, available: true }],
              ),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<ModifiersScreen>(
      "dashboard-modifiers-screen",
      { api: client },
      theme,
    );
    await vi.waitFor(() => {
      if (el.shadowRoot!.querySelector('[role="status"]')) throw new Error("loading");
    });
    await expectNoA11yViolations(host);
  });
  it("accessible open details modal", async () => {
    const client = {
      getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
      listModifiers: vi.fn().mockResolvedValue([
        {
          id: "x",
          type: "extras",
          name: { es: "Toppings" },
          available: true,
          required: true,
          maxTotalQuantity: 2,
          choices: [
            {
              id: "c1",
              name: { es: "Queso" },
              available: true,
              priceDelta: "1.50",
              maxQuantity: 1,
              preselected: true,
              vatClass: null,
              addAllergens: { gluten: { presence: "contains" } },
              dietaryEffect: { invalidates: ["vegan"] },
            },
          ],
        },
      ]),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<ModifiersScreen>(
      "dashboard-modifiers-screen",
      { api: client },
      theme,
    );
    const table = await vi.waitFor(() => {
      const found = el.shadowRoot!.querySelector("wt-data-table");
      if (!found) throw new Error("no table");
      return found;
    });
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="open-x"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
