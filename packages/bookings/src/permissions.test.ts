import { describe, expect, it } from "vitest";
import { registerModulePermissions, roleHasPermission } from "@waitron/identity";
import { BOOKINGS_PERMISSIONS } from "./permissions.js";

describe("BOOKINGS_PERMISSIONS", () => {
  it("declares exactly booking.manage granted from manager", () => {
    // toEqual, not toMatchObject: pin the WHOLE seat (both fields of the one entry), so a stray extra
    // grant or a renamed field is caught, not silently ignored (CLAUDE.md §4). The string is frozen —
    // codes/permissions are never renamed once shipped.
    expect(BOOKINGS_PERMISSIONS).toEqual([
      { permission: "booking.manage", grantedFrom: "manager" },
    ]);
  });

  it("folds into manager + admin and NOT supervisor/staff when registered (deletion proof)", () => {
    // Before registration NO role holds booking.manage — it left identity's central catalog (SP1 t4),
    // so this is the deletion proof: with the descriptor's permissions seat omitted (i.e. this seat
    // never registered), a manager is refused. After folding the module's OWN seat, manager and admin
    // hold it — every role at or above the "manager" floor — and supervisor/staff never do.
    expect(roleHasPermission("manager", "booking.manage")).toBe(false);
    registerModulePermissions(BOOKINGS_PERMISSIONS);
    expect(roleHasPermission("manager", "booking.manage")).toBe(true);
    expect(roleHasPermission("admin", "booking.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "booking.manage")).toBe(false);
    expect(roleHasPermission("staff", "booking.manage")).toBe(false);
  });
});
