import { describe, expect, it } from "vitest";
import { registerModulePermissions, roleHasPermission } from "@waitron/identity";
import { STAFFING_PERMISSIONS } from "./permissions.js";

describe("STAFFING_PERMISSIONS", () => {
  it("uses the core scheduling grant for manager and admin without a duplicate declaration", () => {
    expect(STAFFING_PERMISSIONS).toEqual([]);
    registerModulePermissions(STAFFING_PERMISSIONS);
    expect(roleHasPermission("manager", "schedule.manage")).toBe(true);
    expect(roleHasPermission("admin", "schedule.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "schedule.manage")).toBe(false);
    expect(roleHasPermission("staff", "schedule.manage")).toBe(false);
  });
});
