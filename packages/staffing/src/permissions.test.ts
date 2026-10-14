import { describe, expect, it } from "vitest";
import { registerModulePermissions, roleHasPermission } from "@waitron/identity";
import { STAFFING_PERMISSIONS } from "./permissions.js";

describe("STAFFING_PERMISSIONS", () => {
  it("grants staffing.manage to manager and admin once registered, never to supervisor or staff", () => {
    expect(STAFFING_PERMISSIONS).toEqual([
      { permission: "staffing.manage", grantedFrom: "manager" },
    ]);
    registerModulePermissions(STAFFING_PERMISSIONS);
    expect(roleHasPermission("manager", "staffing.manage")).toBe(true);
    expect(roleHasPermission("admin", "staffing.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "staffing.manage")).toBe(false);
    expect(roleHasPermission("staff", "staffing.manage")).toBe(false);
  });
});
