import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { VenueServiceView } from "./client.js";

import "./departments-list.js";

afterEach(() => {
  cleanup();
  setLocale("en");
  sessionStorage.clear();
});
describe.each(["light", "dark"] as const)("departments list (%s)", (theme) => {
  it.each(["empty", "ready", "issues", "setup", "menu", "disabled-menu"])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed(
      "<departments-list></departments-list>",
      theme,
    )) as HTMLElement & { model: VenueServiceView; updateComplete: Promise<unknown> };
    el.model = {
      departments:
        state === "empty"
          ? []
          : [
              {
                id: "d1",
                name: "Restaurant",
                tradingName: "Casa Delgado",
                active: state !== "issues" && state !== "disabled-menu",
              },
            ],
      zones: [],
      floorZones: [{ id: "z1", name: "Patio" }],
      readiness:
        state === "issues" || state === "setup"
          ? [
              { code: "venue.default_station_missing" },
              { code: "department.no_periods", departmentId: "d1", departmentName: "Restaurant" },
              ...(state === "issues" ? [{ code: "venue.department_missing" as const }] : []),
              { code: "zone.department_missing", zoneId: "z1", zoneName: "Patio" },
            ]
          : [],
      salePolicies: { departments: [], zones: [] },
      settings: { editSentLines: true },
      kitchenTicketGrouping: "combined",
      printHeldWork: false,
      releaseReminderMinutes: 10,
      clearingWorkflow: false,
    };
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const table = el.shadowRoot?.querySelector("wt-data-table");
    expect(table, "the list is rendered for accessibility scanning").toBeTruthy();
    if (state === "menu" || state === "disabled-menu") {
      const menu = table!.shadowRoot!.querySelector("wt-row-actions")!;
      menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
      await menu.updateComplete;
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      if (state === "disabled-menu") expect(menu.textContent).toContain("Enable");
    }
    await expectNoA11yViolations(host);
  });
});
