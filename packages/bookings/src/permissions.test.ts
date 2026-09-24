import { describe, expect, it } from "vitest";
import { registerModulePermissions, roleHasPermission } from "@waitron/identity";
import { BOOKINGS_PERMISSIONS } from "./permissions.js";

describe("BOOKINGS_PERMISSIONS", () => {
  it("declares exactly booking.manage granted from manager", () => {
    expect(BOOKINGS_PERMISSIONS).toEqual([
      { permission: "booking.manage", grantedFrom: "manager" },
    ]);
  });

  it("folds into manager + admin and NOT supervisor/staff when registered (deletion proof)", () => {
    // Identity's own catalog does not hold booking.manage: only the module's seat grants it.
    expect(roleHasPermission("manager", "booking.manage")).toBe(false);
    registerModulePermissions(BOOKINGS_PERMISSIONS);
    expect(roleHasPermission("manager", "booking.manage")).toBe(true);
    expect(roleHasPermission("admin", "booking.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "booking.manage")).toBe(false);
    expect(roleHasPermission("staff", "booking.manage")).toBe(false);
  });
});
