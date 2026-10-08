import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillStationToday } from "./station-today.js";
import "./station-today.js";
beforeEach(() => setLocale("es"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("station today %s", (theme) => {
  it.each([
    ["open", true, false, true, null, "open"],
    ["opened", true, false, true, "open", "opened_by_hand"],
    ["closed", true, false, false, "closed", "closed_by_hand"],
    ["out of hours", true, false, false, null, "out_of_hours"],
    ["default", true, true, true, null, "default"],
    ["switched off", false, false, false, null, "switched_off"],
  ] as const)(
    "has no violations while %s",
    async (_label, active, isDefault, open, byHand, why) => {
      const { el, host } = await mountWidget<TillStationToday>(
        "till-station-today",
        {
          station: {
            id: "grill",
            name: "Parrilla",
            active,
            isDefault,
            open,
            byHand,
            sendsTo: open ? null : "bar",
            why,
          },
          stations: [{ id: "bar", name: "Barra" }],
        },
        theme,
      );
      expect(el.shadowRoot).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );
});
