import { describe, expect, it } from "vitest";
import { registerModulePermissions, roleHasPermission } from "@waitron/identity";
import { ADJUSTMENTS_PERMISSIONS } from "./permissions.js";

describe("ADJUSTMENTS_PERMISSIONS", () => {
  it("grants adjustment.manage to manager and admin once registered, never to supervisor or staff", () => {
    expect(ADJUSTMENTS_PERMISSIONS).toEqual([
      { permission: "adjustment.manage", grantedFrom: "manager" },
    ]);
    registerModulePermissions(ADJUSTMENTS_PERMISSIONS);
    expect(roleHasPermission("manager", "adjustment.manage")).toBe(true);
    expect(roleHasPermission("admin", "adjustment.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "adjustment.manage")).toBe(false);
    expect(roleHasPermission("staff", "adjustment.manage")).toBe(false);
  });
});
