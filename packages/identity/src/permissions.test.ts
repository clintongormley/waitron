import { describe, expect, it } from "vitest";
import { PERMISSIONS, roleHasPermission } from "./permissions.js";

describe("roleHasPermission", () => {
  it("gives staff no privileged permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("staff", p)).toBe(false);
  });
  it("lets a supervisor void, refund, discount and rectify but not manage staff", () => {
    expect(roleHasPermission("supervisor", "sale.void")).toBe(true);
    expect(roleHasPermission("supervisor", "sale.refund")).toBe(true);
    expect(roleHasPermission("supervisor", "sale.discount")).toBe(true);
    expect(roleHasPermission("supervisor", "sale.rectify")).toBe(true);
    expect(roleHasPermission("supervisor", "person.manage")).toBe(false);
  });
  it("adds staff management for a manager", () => {
    expect(roleHasPermission("manager", "person.manage")).toBe(true);
    expect(roleHasPermission("manager", "sale.void")).toBe(true);
    // The manager set is SUPERVISOR ∪ {person.manage} = the whole catalog, so pin every row: a
    // regressed MANAGER that dropped the ...SUPERVISOR spread would otherwise pass on the two
    // specific assertions above while silently losing sale.refund/discount/rectify.
    for (const p of PERMISSIONS) expect(roleHasPermission("manager", p)).toBe(true);
  });
  it("gives an admin every permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("admin", p)).toBe(true);
  });
  it("grants till.configure to manager and admin only (design D9)", () => {
    // A domain-named config permission (layout/receipt authoring), granted to exactly the roles that
    // hold person.manage — manager and admin — and NEVER to staff or supervisor, so the layout/receipt
    // write gate matches the staff-admin gate.
    expect(roleHasPermission("manager", "till.configure")).toBe(true);
    expect(roleHasPermission("admin", "till.configure")).toBe(true);
    expect(roleHasPermission("staff", "till.configure")).toBe(false);
    expect(roleHasPermission("supervisor", "till.configure")).toBe(false);
  });
});
