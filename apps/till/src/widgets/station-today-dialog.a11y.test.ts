import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillStationTodayDialog } from "./station-today-dialog.js";
import "./station-today-dialog.js";
beforeEach(() => setLocale("es"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("station today dialog %s", (theme) => {
  it.each(["ready", "empty", "busy", "refused", "committed"] as const)(
    "has no violations when %s",
    async (state) => {
      const { el, host } = await mountWidget<TillStationTodayDialog>(
        "till-station-today-dialog",
        {
          stationName: "Parrilla",
          destinations: state === "empty" ? [] : [{ id: "pass", name: "Pase", isDefault: true }],
          busy: state === "busy",
          refusal: state === "refused" ? "station.destination_invalid" : null,
        },
        theme,
      );
      expect(el.shadowRoot).not.toBeNull();
      if (state === "committed") {
        el.commit();
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    },
  );
});
