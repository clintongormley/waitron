import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { VenueServiceApi } from "./client.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import "./venue-operations-screen.js";

afterEach(cleanup);
describe.each(["light", "dark"] as const)("venue status accessibility (%s)", (theme) => {
  test("announces readiness problems as a correctly structured list", async () => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue({
        readiness: [{ code: "venue.department_missing" }],
        departments: [],
        zones: [],
        routes: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        categories: [],
        stations: [],
        floorZones: [],
        products: [],
        settings: { editSentLines: true },
      }),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("kitchen changes setting accessibility (%s)", (theme) => {
  test.each([
    ["stored", undefined],
    ["refused", new Error("offline")],
  ] as const)("the switch and its hint, %s", async (_state, refusal) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const el = document.createElement("dashboard-venue-operations-screen") as VenueOperationsScreen;
    el.api = {
      load: vi.fn().mockResolvedValue({
        readiness: [],
        departments: [],
        zones: [],
        routes: [],
        hours: [],
        zoneMenus: [],
        menus: [],
        categories: [],
        stations: [],
        floorZones: [],
        products: [],
        settings: { editSentLines: true },
      }),
      saveSettings: refusal ? vi.fn().mockRejectedValue(refusal) : vi.fn(),
    } as unknown as VenueServiceApi;
    host.append(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="routing"]')!.click();
    await el.updateComplete;
    if (refusal) {
      el.shadowRoot!.querySelector("wt-switch")!.shadowRoot!.querySelector("input")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector('[data-field-error="editSentLines"]')).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});
