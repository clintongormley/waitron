import { describe, expect, it } from "vitest";
import { personRole, roleHasPermission } from "@waitron/identity";

/**
 * The role-map fact `join-api.ts` is built on, pinned where it is consumed. Two things there break
 * silently the day `device.manage` and `printer.manage` stop being held by the same roles:
 *
 *  1. The pairing-mode routes gate on `device.manage` ALONE, so a `printer.manage`-only holder could
 *     not open the window to enrol a print agent.
 *  2. `MISSING_ROW_PERMISSION` becomes an existence oracle: a `device.manage`-only holder would get
 *     404 for an unknown id and 403 for a live `print_agent` row.
 *
 * No route test can catch either while the map holds, so the map itself is asserted.
 */
describe("the role map join-api.ts depends on", () => {
  it("grants device.manage and printer.manage to exactly the same roles", () => {
    for (const role of personRole.enumValues) {
      expect({ role, printer: roleHasPermission(role, "printer.manage") }).toEqual({
        role,
        printer: roleHasPermission(role, "device.manage"),
      });
    }
  });
});
