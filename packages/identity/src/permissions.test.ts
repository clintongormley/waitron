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
  it("grants schedule.manage to manager and admin only (shift-planning slice 1)", () => {
    // A domain-named scheduling permission (roster authoring), granted to exactly the roles that hold
    // person.manage — manager and admin — and NEVER to staff or supervisor, so the roster write gate
    // matches the staff-admin gate. Later slices add swap.approve / absence.decide beside it.
    expect(roleHasPermission("manager", "schedule.manage")).toBe(true);
    expect(roleHasPermission("admin", "schedule.manage")).toBe(true);
    expect(roleHasPermission("staff", "schedule.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "schedule.manage")).toBe(false);
  });
  it("grants swap.approve and absence.decide to manager and admin only (roster slice 2)", () => {
    // Two domain-named approval permissions (manager approve/reject of shift swaps and absences),
    // granted to exactly the roles that hold schedule.manage — manager and admin — and NEVER to staff
    // or supervisor, so the approval gate matches the roster-authoring gate.
    for (const p of ["swap.approve", "absence.decide"] as const) {
      expect(roleHasPermission("manager", p)).toBe(true);
      expect(roleHasPermission("admin", p)).toBe(true);
      expect(roleHasPermission("staff", p)).toBe(false);
      expect(roleHasPermission("supervisor", p)).toBe(false);
    }
  });
  it("grants purchase.manage to manager and admin only (purchase-invoice authoring)", () => {
    // A domain-named accounting permission (received purchase-invoice authoring, the commercial lane),
    // granted to exactly the roles that hold person.manage — manager and admin — and NEVER to staff or
    // supervisor, so the purchase write gate matches the staff-admin gate.
    expect(roleHasPermission("manager", "purchase.manage")).toBe(true);
    expect(roleHasPermission("admin", "purchase.manage")).toBe(true);
    expect(roleHasPermission("staff", "purchase.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "purchase.manage")).toBe(false);
  });
  it("grants recipe.manage to manager and admin only (recipe authoring)", () => {
    // A domain-named authoring permission (ingredient + product-recipe authoring on the commercial lane),
    // granted to exactly the roles that hold person.manage — manager and admin — and NEVER to staff or
    // supervisor, so the recipe write gate matches the other management-dashboard write gates.
    expect(roleHasPermission("manager", "recipe.manage")).toBe(true);
    expect(roleHasPermission("admin", "recipe.manage")).toBe(true);
    expect(roleHasPermission("staff", "recipe.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "recipe.manage")).toBe(false);
  });
  it("grants report.export to manager and admin only (modelo 303 DR303 export)", () => {
    // A domain-named reporting permission (exporting the modelo 303 fiscal file), granted to exactly
    // the roles that hold the other manager write gates — manager and admin — and NEVER to staff or
    // supervisor. A distinct seam from purchase.manage: exporting the tax return is not authoring
    // supplier invoices (spec D7).
    expect(roleHasPermission("manager", "report.export")).toBe(true);
    expect(roleHasPermission("admin", "report.export")).toBe(true);
    expect(roleHasPermission("staff", "report.export")).toBe(false);
    expect(roleHasPermission("supervisor", "report.export")).toBe(false);
  });
  it("grants device.manage to manager and admin only (device-identity-1 station enrolment)", () => {
    // A domain-named device-admin permission (generate pairing codes, list + revoke enrolled devices),
    // granted to exactly the roles that hold the other manager write gates — manager and admin — and
    // NEVER to staff or supervisor. The device ROUTES themselves are device-cookie-authenticated, not
    // gated on this permission; device.manage gates only the enrol/list/revoke management surface
    // (spec §3a/§3e). Staff must never hold it (least privilege — a kitchen operator cannot enrol or
    // revoke a device).
    expect(roleHasPermission("manager", "device.manage")).toBe(true);
    expect(roleHasPermission("admin", "device.manage")).toBe(true);
    expect(roleHasPermission("staff", "device.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "device.manage")).toBe(false);
  });
});
