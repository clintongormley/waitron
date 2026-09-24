import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  type Permission,
  permissionsForRole,
  registerModulePermissions,
  roleHasPermission,
} from "./permissions.js";

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
    // Pin every row: a MANAGER that dropped the ...SUPERVISOR spread would pass the two above.
    const ADMIN_ONLY: ReadonlySet<Permission> = new Set([
      "mirror.create",
      "node.promote",
      "person.admin",
    ]);
    for (const p of PERMISSIONS) {
      expect(roleHasPermission("manager", p)).toBe(!ADMIN_ONLY.has(p));
    }
  });
  it("gives an admin every permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("admin", p)).toBe(true);
  });
  it("grants layout.configure, venue.configure and system.manage to manager and admin only", () => {
    for (const p of ["layout.configure", "venue.configure", "system.manage"] as const) {
      expect(PERMISSIONS).toContain(p);
      expect(roleHasPermission("manager", p)).toBe(true);
      expect(roleHasPermission("admin", p)).toBe(true);
      expect(roleHasPermission("staff", p)).toBe(false);
      expect(roleHasPermission("supervisor", p)).toBe(false);
    }
  });
  it("grants fiscal.view to manager and admin only", () => {
    expect(PERMISSIONS).toContain("fiscal.view");
    expect(roleHasPermission("manager", "fiscal.view")).toBe(true);
    expect(roleHasPermission("admin", "fiscal.view")).toBe(true);
    expect(roleHasPermission("supervisor", "fiscal.view")).toBe(false);
    expect(roleHasPermission("staff", "fiscal.view")).toBe(false);
  });
  it("grants schedule.manage to manager and admin only (shift-planning slice 1)", () => {
    expect(roleHasPermission("manager", "schedule.manage")).toBe(true);
    expect(roleHasPermission("admin", "schedule.manage")).toBe(true);
    expect(roleHasPermission("staff", "schedule.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "schedule.manage")).toBe(false);
  });
  it("grants swap.approve and absence.decide to manager and admin only (roster slice 2)", () => {
    for (const p of ["swap.approve", "absence.decide"] as const) {
      expect(roleHasPermission("manager", p)).toBe(true);
      expect(roleHasPermission("admin", p)).toBe(true);
      expect(roleHasPermission("staff", p)).toBe(false);
      expect(roleHasPermission("supervisor", p)).toBe(false);
    }
  });
  it("grants purchase.manage to manager and admin only (purchase-invoice authoring)", () => {
    expect(roleHasPermission("manager", "purchase.manage")).toBe(true);
    expect(roleHasPermission("admin", "purchase.manage")).toBe(true);
    expect(roleHasPermission("staff", "purchase.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "purchase.manage")).toBe(false);
  });
  it("grants recipe.manage to manager and admin only (recipe authoring)", () => {
    expect(roleHasPermission("manager", "recipe.manage")).toBe(true);
    expect(roleHasPermission("admin", "recipe.manage")).toBe(true);
    expect(roleHasPermission("staff", "recipe.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "recipe.manage")).toBe(false);
  });
  it("grants report.export to manager and admin only (modelo 303 DR303 export)", () => {
    expect(roleHasPermission("manager", "report.export")).toBe(true);
    expect(roleHasPermission("admin", "report.export")).toBe(true);
    expect(roleHasPermission("staff", "report.export")).toBe(false);
    expect(roleHasPermission("supervisor", "report.export")).toBe(false);
  });
  it("grants device.manage to manager and admin only (device-identity-1 station enrolment)", () => {
    expect(roleHasPermission("manager", "device.manage")).toBe(true);
    expect(roleHasPermission("admin", "device.manage")).toBe(true);
    expect(roleHasPermission("staff", "device.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "device.manage")).toBe(false);
  });
  it("grants cash.drawer to supervisor, manager and admin but not staff (cash-drawer authorization)", () => {
    expect(roleHasPermission("supervisor", "cash.drawer")).toBe(true);
    expect(roleHasPermission("manager", "cash.drawer")).toBe(true);
    expect(roleHasPermission("admin", "cash.drawer")).toBe(true);
    expect(roleHasPermission("staff", "cash.drawer")).toBe(false);
  });
  it("grants printer.manage to manager and admin only (printing subsystem central management)", () => {
    expect(roleHasPermission("manager", "printer.manage")).toBe(true);
    expect(roleHasPermission("admin", "printer.manage")).toBe(true);
    expect(roleHasPermission("staff", "printer.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "printer.manage")).toBe(false);
  });
  it("grants payments.manage to manager and admin only (payments configuration screen)", () => {
    expect(roleHasPermission("manager", "payments.manage")).toBe(true);
    expect(roleHasPermission("admin", "payments.manage")).toBe(true);
    expect(roleHasPermission("staff", "payments.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "payments.manage")).toBe(false);
  });
  it("grants report.view to supervisor, manager and admin, not staff", () => {
    expect(roleHasPermission("supervisor", "report.view")).toBe(true);
    expect(roleHasPermission("manager", "report.view")).toBe(true);
    expect(roleHasPermission("admin", "report.view")).toBe(true);
    expect(roleHasPermission("staff", "report.view")).toBe(false);
  });
  it("folds a module permission into grantedFrom and every role ABOVE it (booking.manage)", () => {
    // Assert false, register, assert true in one test so it is order-independent under the
    // module-level registry.
    expect(PERMISSIONS as readonly string[]).not.toContain("booking.manage");
    expect(roleHasPermission("manager", "booking.manage")).toBe(false);
    registerModulePermissions([{ permission: "booking.manage", grantedFrom: "manager" }]);
    expect(roleHasPermission("manager", "booking.manage")).toBe(true);
    expect(roleHasPermission("admin", "booking.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "booking.manage")).toBe(false);
    expect(roleHasPermission("staff", "booking.manage")).toBe(false);
  });
  it("folds a supervisor-floor module permission into supervisor, manager and admin, not staff", () => {
    // A string absent from the catalog, so no static grant can mask the registry path.
    registerModulePermissions([{ permission: "synthetic.floor", grantedFrom: "supervisor" }]);
    expect(roleHasPermission("supervisor", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("manager", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("admin", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("staff", "synthetic.floor")).toBe(false);
  });
  it("grants diagnostics.view to manager and admin only (logging & diagnostics foundation)", () => {
    expect(PERMISSIONS).toContain("diagnostics.view");
    expect(roleHasPermission("manager", "diagnostics.view")).toBe(true);
    expect(roleHasPermission("admin", "diagnostics.view")).toBe(true);
    expect(roleHasPermission("staff", "diagnostics.view")).toBe(false);
    expect(roleHasPermission("supervisor", "diagnostics.view")).toBe(false);
  });
  it("grants node.promote to admin only (authenticated mirror→primary promotion)", () => {
    expect(PERMISSIONS).toContain("node.promote");
    expect(roleHasPermission("admin", "node.promote")).toBe(true);
    expect(roleHasPermission("admin", "mirror.create")).toBe(true);
    expect(roleHasPermission("manager", "node.promote")).toBe(false);
    expect(roleHasPermission("supervisor", "node.promote")).toBe(false);
    expect(roleHasPermission("staff", "node.promote")).toBe(false);
  });
  it("grants mirror.create to admin only (sync cloud-mirror C2b bundle minting)", () => {
    expect(PERMISSIONS).toContain("mirror.create");
    expect(roleHasPermission("admin", "mirror.create")).toBe(true);
    expect(roleHasPermission("manager", "mirror.create")).toBe(false);
    expect(roleHasPermission("supervisor", "mirror.create")).toBe(false);
    expect(roleHasPermission("staff", "mirror.create")).toBe(false);
  });
});

describe("permissionsForRole", () => {
  it("spans core + module permissions on the ladder", () => {
    // Registered here too so this test does not depend on the order it runs in.
    registerModulePermissions([{ permission: "booking.manage", grantedFrom: "manager" }]);
    expect(permissionsForRole("staff")).toEqual([]);
    expect(permissionsForRole("supervisor")).toContain("report.view");
    expect(permissionsForRole("supervisor")).not.toContain("booking.manage");
    expect(permissionsForRole("manager")).toContain("booking.manage");
    expect(permissionsForRole("admin")).toContain("booking.manage");
  });
});

it("grants print.resend separately to manager and admin", () => {
  expect(roleHasPermission("manager", "print.resend")).toBe(true);
  expect(roleHasPermission("admin", "print.resend")).toBe(true);
  expect(roleHasPermission("staff", "print.resend")).toBe(false);
  expect(roleHasPermission("supervisor", "print.resend")).toBe(false);
});
