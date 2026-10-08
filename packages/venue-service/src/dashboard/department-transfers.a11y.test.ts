import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { VenueServiceApi } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
function find(root: ParentNode, selector: string): HTMLElement | undefined {
  const own = root.querySelector<HTMLElement>(selector);
  if (own) return own;
  for (const child of root.querySelectorAll("*")) {
    if (child.shadowRoot) {
      const result = find(child.shadowRoot, selector);
      if (result) return result;
    }
  }
}
describe.each(["light", "dark"] as const)("transfer settings (%s)", (theme) => {
  it.each([
    ["en", 390],
    ["en", 1280],
    ["es", 390],
    ["es", 1280],
  ] as const)("the chosen desk, destinations and field refusal at %s/%i", async (locale, width) => {
    const oldWidth = window.innerWidth,
      oldHeight = window.innerHeight;
    try {
      await page.viewport(width, 844);
      setLocale(locale);
      await mountThemed("<div></div>", theme);
      host.style.width = "100%";
      const screen = document.createElement(
        "dashboard-venue-operations-screen",
      ) as VenueOperationsScreen;
      screen.api = {
        load: async () => ({
          departments: [
            {
              id: "d1",
              name: "Restaurant",
              tradingName: "Casa",
              defaultServiceMode: "table_tab",
              active: true,
            },
            {
              id: "d2",
              name: "Deli",
              tradingName: "Casa Deli",
              defaultServiceMode: "prepay",
              active: true,
            },
          ],
          zones: [],
          floorZones: [],
          readiness: [],
          salePolicies: { departments: [], zones: [] },
          settings: { editSentLines: true },
          kitchenTicketGrouping: "combined",
          printHeldWork: false,
          releaseReminderMinutes: null,
          clearingWorkflow: false,
        }),
        loadDepartmentTransfers: async () => ({
          departmentId: "d1",
          receivingProfileId: "p1",
          destinationDepartmentIds: ["d2"],
          profiles: [{ id: "p1", name: "Restaurant counter" }],
        }),
        saveDepartmentTransfers: async () => {
          throw {
            code: "department_transfer.settings_invalid",
            params: { field: "receivingProfileId" },
          };
        },
      } as unknown as VenueServiceApi;
      host.append(screen);
      await expect
        .poll(() => find(screen.shadowRoot!, '[data-test="transfers-tree-department-d1"]'))
        .toBeDefined();
      const action = find(screen.shadowRoot!, '[data-test="transfers-tree-department-d1"]')!;
      action
        .closest("wt-row-actions")!
        .shadowRoot!.querySelector<HTMLButtonElement>("button")!
        .click();
      action.click();
      await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
      const modal = screen.shadowRoot!.querySelector("wt-modal")!;
      await modal.updateComplete;
      const box = modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      expect(window.innerWidth).toBe(width);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(
        modal.querySelector<HTMLInputElement>('[name="transfer-destination-d2"]')!.checked,
      ).toBe(true);
      expect(modal.querySelector("wt-combobox")!.value).toBe("p1");
      expect(modal.heading).toBe(
        locale === "en" ? "Transfers: Restaurant" : "Traslados: Restaurant",
      );
      await expectNoA11yViolations(host);
      modal.querySelector<HTMLInputElement>('[name="transfer-destination-d2"]')!.click();
      await screen.updateComplete;
      modal.querySelector<HTMLElement>('[data-test="save-editor"]')!.click();
      const actions = modal.querySelector("wt-form-actions")!;
      await expect
        .poll(async () => (await formMessageOf(actions))?.textContent)
        .toContain(locale === "en" ? "Correct the highlighted fields" : "Corrige");
      await expectNoA11yViolations(host);
    } finally {
      await page.viewport(oldWidth, oldHeight);
    }
  });
});
