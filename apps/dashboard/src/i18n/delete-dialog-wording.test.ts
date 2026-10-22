import { describe, expect, it } from "vitest";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { en, es } from "./strings.js";

describe.each([
  { module: "staffing", prefix: "staffing.role.delete" },
  { module: "venue-service", prefix: "prep.delete" },
])("$module delete-dialog wording", ({ module, prefix }) => {
  describe.each([
    ["en", en],
    ["es", es],
  ] as const)("%s", (locale, device) => {
    it.each(["ends", "removes", "loading"] as const)(
      "uses the device window's %s wording",
      (field) => {
        const own = DASHBOARD_MODULES.find((entry) => entry.module === module)!.strings[locale];
        const expected = device[`devices.delete_${field}`];
        expect(expected).not.toBe("");
        expect(own[`${prefix}_${field}`]).toBe(expected);
      },
    );
  });
});
