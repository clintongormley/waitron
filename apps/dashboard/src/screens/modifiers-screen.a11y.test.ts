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
});
