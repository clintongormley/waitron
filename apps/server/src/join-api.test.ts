import { describe, expect, it } from "vitest";
import { personRole, roleHasPermission } from "@waitron/identity";

/**
 * The role-map fact `join-api.ts` is built on, pinned where it is CONSUMED rather than in
 * `@waitron/identity`, which does not itself need the two permissions to move together.
 *
 * Two things in `join-api.ts` break silently — functionally, with no test elsewhere failing — the day
 * `device.manage` and `printer.manage` stop being held by the same roles:
 *
 *  1. The three pairing-mode routes gate on `device.manage` ALONE. A `printer.manage`-only holder
 *     could then not open the venue's window at all, so could not enrol a print agent: a lockout with
 *     no error that names the cause.
 *  2. `MISSING_ROW_PERMISSION` becomes the existence oracle its own comment says it prevents. A
 *     `device.manage`-only holder would get 404 for an unknown id and 403 for a live `print_agent`
 *     row, and could enumerate the print queue from the difference.
 *
 * No ROUTE test can catch either: the gate's outcome is identical for every session that exists while
 * the map holds, which is exactly why the map itself is what gets asserted. Iterating the pgEnum
 * rather than a hand-written list means a role added later cannot slip past.
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
