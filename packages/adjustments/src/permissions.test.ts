import { describe, expect, it } from "vitest";
import { registerModulePermissions } from "@waitron/identity";
import { roleHasPermission } from "@waitron/identity/src/permissions.js";
import { ADJUSTMENTS_PERMISSIONS } from "./permissions.js";

describe("ADJUSTMENTS_PERMISSIONS", () => {
  it("grants adjustment.manage to manager and admin once registered, never to supervisor or staff", () => {
    expect(ADJUSTMENTS_PERMISSIONS).toEqual([
      { permission: "adjustment.manage", defaultHolders: ["manager"] },
      { permission: "adjustment.apply", defaultHolders: ["staff", "supervisor", "manager"] },
      { permission: "adjustment.approve", defaultHolders: ["supervisor", "manager"] },
    ]);
    registerModulePermissions(ADJUSTMENTS_PERMISSIONS);
    expect(roleHasPermission("manager", "adjustment.manage")).toBe(true);
    expect(roleHasPermission("admin", "adjustment.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "adjustment.manage")).toBe(false);
    expect(roleHasPermission("staff", "adjustment.manage")).toBe(false);
    expect(roleHasPermission("staff", "adjustment.apply")).toBe(true);
    expect(roleHasPermission("supervisor", "adjustment.apply")).toBe(true);
    expect(roleHasPermission("manager", "adjustment.apply")).toBe(true);
    expect(roleHasPermission("admin", "adjustment.apply")).toBe(true);
    expect(roleHasPermission("staff", "adjustment.approve")).toBe(false);
    expect(roleHasPermission("supervisor", "adjustment.approve")).toBe(true);
    expect(roleHasPermission("manager", "adjustment.approve")).toBe(true);
    expect(roleHasPermission("admin", "adjustment.approve")).toBe(true);
  });
});
