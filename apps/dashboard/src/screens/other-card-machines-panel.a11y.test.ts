import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import type { OtherCardMachinesView } from "../api/payments-api.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { OtherCardMachinesPanel } from "./other-card-machines-panel.js";
import "./other-card-machines-panel.js";

afterEach(cleanupWidgets);

const machines: OtherCardMachinesView["otherCardMachines"] = [
  { id: "m1", name: "Bar terminal", paysInto: "other" },
  { id: "m2", name: "Terrace", paysInto: "connected_account" },
];

const states = [
  { state: "empty", list: [], sumUpConnected: true, refuse: false },
  { state: "rows", list: machines, sumUpConnected: true, refuse: false },
  { state: "not-connected note", list: machines, sumUpConnected: false, refuse: false },
  { state: "refusal", list: machines, sumUpConnected: true, refuse: true },
] as const;

for (const theme of ["light", "dark"] as const) {
  it.each(states)(`is accessible in ${theme}: $state`, async ({ list, sumUpConnected, refuse }) => {
    const { host } = await mountWidget<OtherCardMachinesPanel>(
      "dashboard-other-card-machines",
      {
        api: {
          getOtherCardMachines: async () => ({ otherCardMachines: [...list], revision: 1 }),
          saveOtherCardMachines: async () => {
            throw {
              code: "management.request_invalid",
              params: { field: "otherCardMachines.1.name" },
            };
          },
        } as unknown as DashboardApi,
        sumUpConnected,
      },
      theme,
    );
    await expect.element(page.getByRole("button", { name: "Add a machine" })).toBeVisible();
    if (!sumUpConnected)
      await expect
        .element(page.getByText("SumUp is not connected", { exact: false }))
        .toBeVisible();
    if (refuse) {
      await page.getByRole("textbox", { name: "Name" }).nth(1).fill("Terrace 2");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .element(page.getByText("Use a name of up to 60 characters that no other machine has."))
        .toBeVisible();
    }
    await expectNoA11yViolations(host);
  });
}
