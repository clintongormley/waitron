import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("accessible open products modal", async () => {
    const client = {
      getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
      listModifiers: vi
        .fn()
        .mockResolvedValue([{ id: "x", type: "text", name: { es: "Nota" }, available: true }]),
      getModifierDependants: vi.fn().mockResolvedValue({
        products: [{ id: "p1", name: "Café" }],
        menus: [{ id: "mn1", name: "Desayuno" }],
        orders: 0,
      }),
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
    const modal = el.shadowRoot!.querySelector('wt-modal[data-test="products-modal"]')!;
    await vi.waitFor(() =>
      expect(modal.querySelector('[data-test="modifier-usage"]')).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });
  it("accessible open delete dialog with a dependants preview", async () => {
    const client = {
      getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
      listModifiers: vi
        .fn()
        .mockResolvedValue([{ id: "m", type: "text", name: { es: "Nota" }, available: true }]),
      getModifierDependants: vi.fn().mockResolvedValue({
        products: [{ id: "p1", name: "Café" }],
        menus: [{ id: "mn1", name: "Desayuno" }],
        orders: 0,
      }),
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
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-m"]')!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector('wt-modal[data-test="delete-dialog"]')!;
    await vi.waitFor(() =>
      expect(dialog.querySelector('[data-test="delete-warning"]')).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });
});
