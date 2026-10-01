import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PrepStationsApi } from "./routing-client.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import "./prep-stations-screen.js";
afterEach(cleanup);
const empty = {
  routing: {
    claims: [],
    exceptions: [],
    unassigned: { folders: [], products: [] },
    defaultStationId: null,
    stations: [],
  },
  stations: [],
  categories: [],
  zones: [],
  products: [],
  printers: [],
  stationPrinters: [],
  devices: [],
};
describe.each(["light", "dark"] as const)("prep stations accessibility (%s)", (theme) => {
  it.each(["empty", "station", "editor", "claim", "invalid"] as const)(
    "checks %s state",
    async (state) => {
      setLocale("en");
      await mountThemed("<div></div>", theme);
      const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
      el.api = {
        load: vi.fn().mockResolvedValue(
          state === "empty"
            ? empty
            : {
                ...empty,
                stations: [
                  {
                    id: "bar",
                    name: "Bar",
                    active: true,
                    isDefault: true,
                    displayOrder: 0,
                    warmAfterMinutes: 5,
                    overdueAfterMinutes: 10,
                    forgottenAfterMinutes: 15,
                  },
                ],
              },
        ),
      } as unknown as PrepStationsApi;
      host.append(el);
      await new Promise((r) => setTimeout(r, 0));
      await el.updateComplete;
      if (state === "editor" || state === "invalid") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-bar"]')!.click();
        await el.updateComplete;
      }
      if (state === "claim") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="claim-bar"]')!.click();
        await el.updateComplete;
      }
      if (state === "invalid") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="overdue"]')!.dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "5" } }),
        );
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-station"]')!.click();
        await el.updateComplete;
      }
      expect(el.shadowRoot!.querySelector("h1")).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );
});
