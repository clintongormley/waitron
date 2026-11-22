import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { PaymentsSettingsPanel } from "./payments-settings-panel.js";
import "./payments-screen.js";

afterEach(cleanupWidgets);

for (const theme of ["light", "dark"] as const) {
  it.each([true, false])(
    `is accessible in ${theme} with practice controls available: %s`,
    async (testProvidersAvailable) => {
      const { host } = await mountWidget<PaymentsSettingsPanel>(
        "dashboard-payments-settings",
        {
          api: {
            getPaymentSettings: async () => ({
              tipsEnabled: true,
              testProviders: false,
              testProvidersAvailable,
              revision: 1,
            }),
          } as DashboardApi,
        },
        theme,
      );
      await expect
        .element(page.getByRole("switch", { name: "Offer tips at the till" }))
        .toBeChecked();
      await expectNoA11yViolations(host);
    },
  );
}
