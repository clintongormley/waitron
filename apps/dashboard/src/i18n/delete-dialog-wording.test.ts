import { describe, expect, it } from "vitest";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { en, es } from "./strings.js";

const ALL_FIELDS = ["ends", "removes", "loading"] as const;

describe.each([
  { module: "venue-service", prefix: "prep.delete", fields: ALL_FIELDS },
  { module: "adjustments", prefix: "adjustments.delete", fields: ALL_FIELDS },
  { module: "venue-service", prefix: "venue.delete", fields: ALL_FIELDS },
  { module: "venue-service", prefix: "period.delete", fields: ["loading"] as const },
])("$module $prefix delete-dialog wording", ({ module, prefix, fields }) => {
  describe.each([
    ["en", en],
    ["es", es],
  ] as const)("%s", (locale, device) => {
    it.each(fields)("uses the device window's %s wording", (field) => {
      const own = DASHBOARD_MODULES.find((entry) => entry.module === module)!.strings[locale];
      const expected = device[`devices.delete_${field}`];
      expect(expected).toEqual(expect.any(String));
      expect(expected).not.toBe("");
      expect(own[`${prefix}_${field}`]).toBe(expected);
    });
  });
});
