import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillKeepOpenDialog } from "./keep-open-dialog.js";
import "./keep-open-dialog.js";
beforeEach(() => setLocale("es"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe("zone accessibility", () => {
  describe.each(["light", "dark"] as const)("keep-open dialog %s", (theme) => {
    it.each(["unchanged", "chosen", "empty", "busy", "refused", "ended", "extended"])(
      "has no violations when %s",
      async (state) => {
        const { el, host } = await mountWidget<TillKeepOpenDialog>(
          "till-keep-open-dialog",
          {
            zone: {
              id: "terrace",
              name: "Terraza",
              endsAt: "14:00",
              running: state !== "ended",
              extendedUntil: state === "extended" ? "14:30" : null,
              dayEndsAt: "05:00",
              choices: state === "empty" ? [] : ["14:15", "14:30", "19:00", "19:15", "05:00"],
            },
            busy: state === "busy",
            refusal: state === "refused" ? "zone_extension.invalid" : null,
            refusalField: state === "refused" ? "until" : null,
          },
          theme,
        );
        expect(el.shadowRoot).not.toBeNull();
        if (["chosen", "busy"].includes(state)) {
          el.selected = "14:30";
          await el.updateComplete;
        }
        await expectNoA11yViolations(host);
      },
    );
  });
});
