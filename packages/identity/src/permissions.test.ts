import { describe, expect, expectTypeOf, it } from "vitest";
import {
  PERMISSIONS,
  CORE_PERMISSIONS,
  declaredPermissions,
  defaultPermissionsFor,
  isDeclaredPermission,
  type Permission,
  permissionsForRole,
  registerModulePermissions,
  roleHasPermission,
} from "./permissions.js";

describe("approved permission names preserve default holders", () => {
  const roles = ["staff", "supervisor", "manager", "admin"] as const;
  for (const [permission, holders] of [
    ["payment.take", [true, true, true, true]],
    ["hardware.manage", [false, false, true, true]],
    ["venue.configure", [false, false, true, true]],
    ["schedule.manage", [false, false, true, true]],
    ["system.manage", [false, false, true, true]],
    ["catalogue.manage", [false, false, true, true]],
  ] as const) {
    it(`keeps the default holders of ${permission}`, () => {
      expect(PERMISSIONS).toContain(permission);
      expect(roles.map((role) => roleHasPermission(role, permission))).toEqual(holders);
    });
  }

  it("retires the replaced identifiers from every role", () => {
    for (const permission of [
      "sale.take_payment",
      "device.manage",
      "printer.manage",
      "payments.manage",
      "print.resend",
      "layout.configure",
      "venue_service.manage",
      "swap.approve",
      "absence.decide",
      "staffing.manage",
      "diagnostics.view",
      "image.manage",
    ]) {
      expect(roles.map((role) => roleHasPermission(role, permission))).toEqual([
        false,
        false,
        false,
        false,
      ]);
    }
  });

  it("projects each permission only once", () => {
    for (const role of roles) {
      const permissions = permissionsForRole(role);
      expect(permissions.length).toBe(new Set(permissions).size);
    }
  });
});

describe("roleHasPermission", () => {
  it("gives staff no permission but taking a payment", () => {
    for (const p of PERMISSIONS) {
      if (p === "payment.take") continue;
      expect(roleHasPermission("staff", p)).toBe(false);
    }
  });
  it("lets every role take a payment", () => {
    expect(PERMISSIONS).toContain("payment.take");
    for (const role of ["staff", "supervisor", "manager", "admin"] as const) {
      expect(roleHasPermission(role, "payment.take")).toBe(true);
    }
  });
  it("lets a supervisor void, refund and rectify but not manage staff", () => {
    expect(roleHasPermission("supervisor", "sale.void")).toBe(true);
    expect(roleHasPermission("supervisor", "sale.refund")).toBe(true);
    expect(roleHasPermission("supervisor", "sale.discount")).toBe(false);
    expect(roleHasPermission("supervisor", "sale.rectify")).toBe(true);
    expect(roleHasPermission("supervisor", "person.manage")).toBe(false);
  });
  it("adds staff management for a manager", () => {
    expect(roleHasPermission("manager", "person.manage")).toBe(true);
    expect(roleHasPermission("manager", "sale.void")).toBe(true);
    // Pin every row: a MANAGER that dropped the ...SUPERVISOR spread would pass the two above.
    const ADMIN_ONLY: ReadonlySet<Permission> = new Set([
      "node.manage",
      "system.box_admin",
      "person.admin",
      "personal_data.export",
    ]);
    for (const p of PERMISSIONS) {
      expect(roleHasPermission("manager", p)).toBe(!ADMIN_ONLY.has(p));
    }
  });
  it("gives an admin every permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("admin", p)).toBe(true);
  });
  it("grants venue.configure and system.manage to manager and admin only", () => {
    for (const p of ["venue.configure", "system.manage"] as const) {
      expect(PERMISSIONS).toContain(p);
      expect(roleHasPermission("manager", p)).toBe(true);
      expect(roleHasPermission("admin", p)).toBe(true);
      expect(roleHasPermission("staff", p)).toBe(false);
      expect(roleHasPermission("supervisor", p)).toBe(false);
    }
  });
  it("grants catalogue.manage to manager and admin only", () => {
    expect(PERMISSIONS).toContain("catalogue.manage");
    expect(roleHasPermission("manager", "catalogue.manage")).toBe(true);
    expect(roleHasPermission("admin", "catalogue.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "catalogue.manage")).toBe(false);
    expect(roleHasPermission("staff", "catalogue.manage")).toBe(false);
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
  it("grants schedule.manage to manager and admin only (roster slice 2)", () => {
    for (const p of ["schedule.manage"] as const) {
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
  it("grants report.export to manager and admin only (modelo 303 DR303 export)", () => {
    expect(roleHasPermission("manager", "report.export")).toBe(true);
    expect(roleHasPermission("admin", "report.export")).toBe(true);
    expect(roleHasPermission("staff", "report.export")).toBe(false);
    expect(roleHasPermission("supervisor", "report.export")).toBe(false);
  });
  it("grants hardware.manage to manager and admin only (device-identity-1 station enrolment)", () => {
    expect(roleHasPermission("manager", "hardware.manage")).toBe(true);
    expect(roleHasPermission("admin", "hardware.manage")).toBe(true);
    expect(roleHasPermission("staff", "hardware.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "hardware.manage")).toBe(false);
  });
  it("grants cash.drawer to supervisor, manager and admin but not staff (cash-drawer authorization)", () => {
    expect(roleHasPermission("supervisor", "cash.drawer")).toBe(true);
    expect(roleHasPermission("manager", "cash.drawer")).toBe(true);
    expect(roleHasPermission("admin", "cash.drawer")).toBe(true);
    expect(roleHasPermission("staff", "cash.drawer")).toBe(false);
  });
  it("grants hardware.manage to manager and admin only (printing subsystem central management)", () => {
    expect(roleHasPermission("manager", "hardware.manage")).toBe(true);
    expect(roleHasPermission("admin", "hardware.manage")).toBe(true);
    expect(roleHasPermission("staff", "hardware.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "hardware.manage")).toBe(false);
  });
  it("grants hardware.manage to manager and admin only (payments configuration screen)", () => {
    expect(roleHasPermission("manager", "hardware.manage")).toBe(true);
    expect(roleHasPermission("admin", "hardware.manage")).toBe(true);
    expect(roleHasPermission("staff", "hardware.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "hardware.manage")).toBe(false);
  });
  it("grants report.view to supervisor, manager and admin, not staff", () => {
    expect(roleHasPermission("supervisor", "report.view")).toBe(true);
    expect(roleHasPermission("manager", "report.view")).toBe(true);
    expect(roleHasPermission("admin", "report.view")).toBe(true);
    expect(roleHasPermission("staff", "report.view")).toBe(false);
  });
  it("folds a module permission into the named default holders (booking.manage)", () => {
    // Assert false, register, assert true in one test so it is order-independent under the
    // module-level registry.
    expect(PERMISSIONS as readonly string[]).not.toContain("booking.manage");
    expect(roleHasPermission("manager", "booking.manage")).toBe(false);
    registerModulePermissions([{ permission: "booking.manage", defaultHolders: ["manager"] }]);
    expect(roleHasPermission("manager", "booking.manage")).toBe(true);
    expect(roleHasPermission("admin", "booking.manage")).toBe(true);
    expect(roleHasPermission("supervisor", "booking.manage")).toBe(false);
    expect(roleHasPermission("staff", "booking.manage")).toBe(false);
  });
  it("folds a module permission with supervisor and manager defaults into supervisor, manager and admin, not staff", () => {
    // A string absent from the catalog, so no static grant can mask the registry path.
    registerModulePermissions([
      { permission: "synthetic.floor", defaultHolders: ["supervisor", "manager"] },
    ]);
    expect(roleHasPermission("supervisor", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("manager", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("admin", "synthetic.floor")).toBe(true);
    expect(roleHasPermission("staff", "synthetic.floor")).toBe(false);
  });
  it("grants system.manage to manager and admin only (logging & diagnostics foundation)", () => {
    expect(PERMISSIONS).toContain("system.manage");
    expect(roleHasPermission("manager", "system.manage")).toBe(true);
    expect(roleHasPermission("admin", "system.manage")).toBe(true);
    expect(roleHasPermission("staff", "system.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "system.manage")).toBe(false);
  });
  it("grants system.box_admin to admin only (authenticated mirror→primary promotion)", () => {
    expect(PERMISSIONS).toContain("system.box_admin");
    expect(roleHasPermission("admin", "system.box_admin")).toBe(true);
    expect(roleHasPermission("admin", "node.manage")).toBe(true);
    expect(roleHasPermission("manager", "system.box_admin")).toBe(false);
    expect(roleHasPermission("supervisor", "system.box_admin")).toBe(false);
    expect(roleHasPermission("staff", "system.box_admin")).toBe(false);
  });
  it("grants personal_data.export to admin only (another person's data download)", () => {
    expect(PERMISSIONS).toContain("personal_data.export");
    expect(roleHasPermission("admin", "personal_data.export")).toBe(true);
    expect(roleHasPermission("manager", "personal_data.export")).toBe(false);
    expect(roleHasPermission("supervisor", "personal_data.export")).toBe(false);
    expect(roleHasPermission("staff", "personal_data.export")).toBe(false);
    expect(permissionsForRole("admin")).toContain("personal_data.export");
    expect(permissionsForRole("manager")).not.toContain("personal_data.export");
  });
  it("grants node.manage to admin only (sync cloud-mirror C2b bundle minting)", () => {
    expect(PERMISSIONS).toContain("node.manage");
    expect(roleHasPermission("admin", "node.manage")).toBe(true);
    expect(roleHasPermission("manager", "node.manage")).toBe(false);
    expect(roleHasPermission("supervisor", "node.manage")).toBe(false);
    expect(roleHasPermission("staff", "node.manage")).toBe(false);
  });
});

describe("permissionsForRole", () => {
  it("spans core + module permissions from explicit declarations", () => {
    // Registered here too so this test does not depend on the order it runs in.
    registerModulePermissions([{ permission: "booking.manage", defaultHolders: ["manager"] }]);
    expect(permissionsForRole("staff")).toEqual(["payment.take"]);
    expect(permissionsForRole("supervisor")).toContain("report.view");
    expect(permissionsForRole("supervisor")).not.toContain("booking.manage");
    expect(permissionsForRole("manager")).toContain("booking.manage");
    expect(permissionsForRole("admin")).toContain("booking.manage");
  });
});

it("grants hardware.manage for resending to manager and admin", () => {
  expect(roleHasPermission("manager", "hardware.manage")).toBe(true);
  expect(roleHasPermission("admin", "hardware.manage")).toBe(true);
  expect(roleHasPermission("staff", "hardware.manage")).toBe(false);
  expect(roleHasPermission("supervisor", "hardware.manage")).toBe(false);
});

describe("explicit permission declarations", () => {
  it("exposes a read-only core catalogue", () => {
    expectTypeOf(PERMISSIONS).toEqualTypeOf<readonly Permission[]>();
  });
  it("declares each core permission's default holders", () => {
    const all = ["staff", "supervisor", "manager"];
    const supervisors = ["supervisor", "manager"];
    expect(
      Object.fromEntries(
        CORE_PERMISSIONS.map(({ permission, defaultHolders }) => [permission, defaultHolders]),
      ),
    ).toEqual({
      "payment.take": all,
      "sale.void": supervisors,
      "sale.refund": supervisors,
      "sale.rectify": supervisors,
      "cash.drawer": supervisors,
      "report.view": supervisors,
      "venue.view": supervisors,
      "person.manage": ["manager"],
      "catalogue.manage": ["manager"],
      "venue.configure": ["manager"],
      "system.manage": ["manager"],
      "schedule.manage": ["manager"],
      "purchase.manage": ["manager"],
      "report.export": ["manager"],
      "hardware.manage": ["manager"],
      "fiscal.view": ["manager"],
      "person.admin": [],
      "personal_data.export": [],
      "node.manage": [],
      "system.box_admin": [],
    });
    expect(defaultPermissionsFor("staff")).toEqual(["payment.take"]);
    expect(isDeclaredPermission("payment.take")).toBe(true);
  });
  it("Admin holds a permission registered after start", () => {
    registerModulePermissions([{ permission: "synthetic.later", defaultHolders: [] }]);
    expect(roleHasPermission("admin", "synthetic.later")).toBe(true);
    expect(roleHasPermission("manager", "synthetic.later")).toBe(false);
    expect(permissionsForRole("admin")).toContain("synthetic.later");
  });
  it("an undeclared permission authorizes nobody, Admin included", () => {
    expect(isDeclaredPermission("synthetic.unknown")).toBe(false);
    for (const role of ["staff", "supervisor", "manager", "admin"] as const) {
      expect(roleHasPermission(role, "synthetic.unknown")).toBe(false);
    }
  });
  it("refuses a module redeclaring a core permission", () => {
    expect(() =>
      registerModulePermissions([{ permission: "payment.take", defaultHolders: [] }]),
    ).toThrow("permission declared twice: payment.take");
    expect(roleHasPermission("staff", "payment.take")).toBe(true);
  });
  it("no longer declares retired permissions", () => {
    for (const permission of ["sale.discount", "mirror.create", "node.promote"]) {
      expect(declaredPermissions()).not.toContain(permission);
    }
  });
  it("grants exactly the named holders and overwrites a module declaration", () => {
    registerModulePermissions([
      { permission: "synthetic.explicit", defaultHolders: ["staff", "manager"] },
    ]);
    expect(
      (["staff", "supervisor", "manager", "admin"] as const).map((role) =>
        roleHasPermission(role, "synthetic.explicit"),
      ),
    ).toEqual([true, false, true, true]);
    expect(defaultPermissionsFor("manager")).toContain("synthetic.explicit");
    registerModulePermissions([
      { permission: "synthetic.explicit", defaultHolders: ["supervisor"] },
    ]);
    expect(
      (["staff", "supervisor", "manager", "admin"] as const).map((role) =>
        roleHasPermission(role, "synthetic.explicit"),
      ),
    ).toEqual([false, true, false, true]);
    expect(defaultPermissionsFor("manager")).not.toContain("synthetic.explicit");
    expect(defaultPermissionsFor("supervisor")).toContain("synthetic.explicit");
  });
});
