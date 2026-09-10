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
    // The manager set is SUPERVISOR ∪ {the management write gates} = the whole catalog EXCEPT the
    // admin-only permissions, so pin every row it should hold: a regressed MANAGER that dropped the
    // ...SUPERVISOR spread would otherwise pass on the two specific assertions above while silently
    // losing sale.refund/discount/rectify. mirror.create is admin-only (hands out a data-access sync
    // token) and is asserted false for manager in its own test below.
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
    // A domain-named device-admin permission (open the pairing window, accept or deny a join request,
    // list + revoke enrolled devices), granted to exactly the roles that hold the other manager write
    // gates — manager and admin — and NEVER to staff or supervisor. The device ROUTES themselves are
    // device-cookie-authenticated, not gated on this permission; device.manage gates only the
    // window/accept/list/revoke management surface (spec §3a/§3e). Staff must never hold it (least
    // privilege — a kitchen operator cannot admit or revoke a device).
    expect(roleHasPermission("manager", "device.manage")).toBe(true);
    expect(roleHasPermission("admin", "device.manage")).toBe(true);
    expect(roleHasPermission("staff", "device.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "device.manage")).toBe(false);
  });
  it("grants cash.drawer to supervisor, manager and admin but not staff (cash-drawer authorization)", () => {
    // A domain-named cash-accountability permission: authorizing a cash-drawer open under a location's
    // 'gated' drawer_open_policy requires it. Unlike the manager-only config gates above, it lives in the
    // SUPERVISOR set beside sale.void/refund/discount/rectify — a supervisor on the floor can authorize a
    // gated drawer open — so supervisor, manager (spreads SUPERVISOR) and admin (ALL) hold it, and staff
    // NEVER does (least privilege — a plain operator cannot self-authorize a gated open).
    expect(roleHasPermission("supervisor", "cash.drawer")).toBe(true);
    expect(roleHasPermission("manager", "cash.drawer")).toBe(true);
    expect(roleHasPermission("admin", "cash.drawer")).toBe(true);
    expect(roleHasPermission("staff", "cash.drawer")).toBe(false);
  });
  it("grants printer.manage to manager and admin only (printing subsystem central management)", () => {
    // A domain-named printer-admin permission (enrol/list/revoke print agents, CRUD printers, enqueue a
    // test print) on the management dashboard (@waitron/printing), granted to exactly the roles that
    // hold the other manager write gates — manager and admin — and NEVER to staff or supervisor. The
    // agent API itself is device-authed (requireAgent), NOT gated on this permission; printer.manage
    // gates only the central-management surface (printing design §7). Staff must never hold it (least
    // privilege — a kitchen operator cannot enrol or revoke a print agent).
    expect(roleHasPermission("manager", "printer.manage")).toBe(true);
    expect(roleHasPermission("admin", "printer.manage")).toBe(true);
    expect(roleHasPermission("staff", "printer.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "printer.manage")).toBe(false);
  });
  it("grants report.view to supervisor, manager and admin, not staff", () => {
    // A domain-named reporting permission (viewing the management reporting surface — sales/takings),
    // held by SUPERVISOR (so supervisor, manager via ...SUPERVISOR and admin via ALL hold it) and NEVER
    // by staff. Distinct from report.export (exporting the modelo 303 fiscal file, manager+admin only):
    // a supervisor on the floor can read the reports without holding the tax-export gate.
    expect(roleHasPermission("supervisor", "report.view")).toBe(true);
    expect(roleHasPermission("manager", "report.view")).toBe(true);
    expect(roleHasPermission("admin", "report.view")).toBe(true);
    expect(roleHasPermission("staff", "report.view")).toBe(false);
  });
  it("folds a module permission into grantedFrom and every role ABOVE it (booking.manage)", () => {
    // booking.manage LEFT identity's central catalog in SP1 t4: it is no longer a static Permission and
    // NO role holds it until a module registers it — the deletion proof (authorizeManager's only gate is
    // roleHasPermission, manager-login.ts). Registering it at grantedFrom:"manager" folds it into
    // manager + admin (every role at or above manager on the ladder) and NEVER into supervisor/staff —
    // the same audience purchase.manage takes, now stated by the module's floor rather than a catalog
    // edit. Assert-false-then-register-then-assert-true in one test so it is order-independent under the
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
    // A synthetic permission proving the LADDER is real, not a manager-only shortcut: grantedFrom
    // "supervisor" reaches supervisor, manager (above it) and admin (top), and never staff (below it).
    // Uses a string absent from the catalog so no static grant can mask the registry path.
    registerModulePermissions([{ permission: "synthetic.floor", grantedFrom: "supervisor" }]);
    expect(roleHasPermission("supervisor", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("manager", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("admin", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("staff", "synthetic.floor")).toBe(false);
  });
  it("grants diagnostics.view to manager and admin only (logging & diagnostics foundation)", () => {
    // A domain-named diagnostics permission (view recent logs + toggle diagnostic verbosity from the
    // management dashboard / API), granted to exactly the roles that hold the other manager write gates
    // — manager and admin — and NEVER to staff or supervisor. Mirrors the other manager-only gates
    // (person.manage/till.configure): a floor supervisor cannot raise verbosity or read the log tail.
    expect(PERMISSIONS).toContain("diagnostics.view");
    expect(roleHasPermission("manager", "diagnostics.view")).toBe(true);
    expect(roleHasPermission("admin", "diagnostics.view")).toBe(true);
    expect(roleHasPermission("staff", "diagnostics.view")).toBe(false);
    expect(roleHasPermission("supervisor", "diagnostics.view")).toBe(false);
  });
  it("grants node.promote to admin only (authenticated mirror→primary promotion)", () => {
    // Promoting a node to primary is an operator-triggered, admin-only action — reached via ALL and
    // NEVER placed in the SUPERVISOR/MANAGER sets, mirroring mirror.create's admin-only scope.
    expect(PERMISSIONS).toContain("node.promote");
    expect(roleHasPermission("admin", "node.promote")).toBe(true);
    expect(roleHasPermission("admin", "mirror.create")).toBe(true);
    expect(roleHasPermission("manager", "node.promote")).toBe(false);
    expect(roleHasPermission("supervisor", "node.promote")).toBe(false);
    expect(roleHasPermission("staff", "node.promote")).toBe(false);
  });
  it("grants mirror.create to admin only (sync cloud-mirror C2b bundle minting)", () => {
    // Minting a cloud-mirror bundle hands out a data-access sync token, so it is admin-only — reached via
    // ALL and NEVER placed in the SUPERVISOR/MANAGER sets. Not even a manager holds it (least privilege —
    // handing out a data-access token is a tenant-owner capability, distinct from the other management
    // write gates).
    expect(PERMISSIONS).toContain("mirror.create");
    expect(roleHasPermission("admin", "mirror.create")).toBe(true);
    expect(roleHasPermission("manager", "mirror.create")).toBe(false);
    expect(roleHasPermission("supervisor", "mirror.create")).toBe(false);
    expect(roleHasPermission("staff", "mirror.create")).toBe(false);
  });
});

describe("permissionsForRole", () => {
  it("spans core + module permissions on the ladder", () => {
    // The effective permission set the WHOAMI probe hands the dashboard so it can gate a module's
    // nav/screen client-side. It folds the static catalog AND the module-registered permissions through
    // the SAME roleHasPermission ladder, so a module's floor (`booking.manage` at manager) reaches its
    // role and every role above, and never below. Register booking.manage here as the real boot does
    // (idempotent under the module-level registry), then pin the ladder: staff holds nothing, supervisor
    // holds report.view but not the manager-floor booking.manage, and manager/admin hold booking.manage.
    registerModulePermissions([{ permission: "booking.manage", grantedFrom: "manager" }]);
    expect(permissionsForRole("staff")).toEqual([]);
    expect(permissionsForRole("supervisor")).toContain("report.view");
    expect(permissionsForRole("supervisor")).not.toContain("booking.manage");
    expect(permissionsForRole("manager")).toContain("booking.manage");
    expect(permissionsForRole("admin")).toContain("booking.manage");
  });
});
