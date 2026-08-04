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
  });
  it("gives an admin every permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("admin", p)).toBe(true);
  });
});
