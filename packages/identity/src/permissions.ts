/**
 * The fixed permission catalog. Call sites gate on a PERMISSION, never a role string, so the
 * role→permission map below can change in one place without touching a single call site. Roles and
 * this map are code (design decision 3); a future data-driven RBAC would replace exactly these two
 * declarations.
 */
export const PERMISSIONS = [
  "sale.void",
  "sale.refund",
  "sale.discount", // in the catalog for completeness; no call site until the till (#7) applies a discount
  "sale.rectify",
  "person.manage",
  // Authoring the till layout + receipt trim (dashboard config, @waitron/layouts). A domain-named
  // CONFIG permission, distinct from staff admin (person.manage); granted to manager + admin, the
  // same roles as person.manage (design D9).
  "till.configure",
  // Authoring the weekly roster (draft → warn → publish) from the management dashboard
  // (@waitron/workforce). A domain-named SCHEDULING permission, distinct from staff admin
  // (person.manage) and till config (till.configure); granted to manager + admin. Later slices add
  // swap.approve / absence.decide beside it (shift-planning slice 1, 2026-08-15).
  "schedule.manage",
  // Manager approve/reject of an ACCEPTED shift swap (@waitron/workforce decideSwap), from the
  // management dashboard's approvals screen. A domain-named APPROVAL permission beside schedule.manage;
  // granted to manager + admin (roster slice 2, 2026-08-15).
  "swap.approve",
  // Manager approve/reject of a REQUESTED absence (@waitron/workforce setAbsenceStatus), same screen.
  // Domain-named beside swap.approve; granted to manager + admin (roster slice 2, 2026-08-15).
  "absence.decide",
  // Authoring received purchase invoices (facturas recibidas: supplier + dates + VAT desglose) from
  // the management dashboard (@waitron/purchasing), the data source for the modelo 303 IVA-deducible
  // reporting (#91). A domain-named ACCOUNTING permission on the commercial lane, distinct from staff
  // admin (person.manage); granted to manager + admin, the same roles as the other write gates
  // (purchase-invoice authoring UI, 2026-08-16).
  "purchase.manage",
  // Authoring ingredients + a product's recipe (allergen inheritance) from the management dashboard
  // (@waitron/recipes). A domain-named AUTHORING permission on the commercial lane, distinct from staff
  // admin (person.manage); granted to manager + admin, the same roles as the other write gates
  // (recipe-authoring UI, 2026-08-16).
  "recipe.manage",
  // Exporting the modelo 303 fiscal autoliquidación as the AEAT DR303 fixed-layout file from the
  // management dashboard / API (@waitron/reporting toDr303Record). A domain-named REPORTING permission
  // — exporting the tax return is a distinct capability from authoring supplier invoices
  // (purchase.manage) or staff admin (person.manage); granted to manager + admin, the dashboard's
  // audience (spec D7). Codes/permissions are never renamed once shipped.
  "report.export",
  // Generating pairing codes and managing enrolled devices (a kitchen/station display binds to one
  // kitchen_stations row via a single-use pairing code, then authenticates by a device cookie) from
  // the management dashboard (device-identity-1). A domain-named DEVICE-ADMIN permission, distinct from
  // staff admin (person.manage); granted to manager + admin, the same roles as the other management
  // write gates. The device ROUTES themselves are device-cookie-authenticated (requireDevice), NOT
  // gated on this — this gates only the enrol-code/list/revoke management surface (spec §3a/§3e).
  // Codes/permissions are never renamed once shipped.
  "device.manage",
  // Central management of the printing subsystem (enrol/list/revoke print agents, CRUD printers,
  // enqueue a test print) from the management dashboard (@waitron/printing). A domain-named
  // PRINTER-ADMIN permission, distinct from staff admin (person.manage) and from device enrolment
  // (device.manage); granted to manager + admin, the same roles as the other management write gates.
  // The agent API itself is device-authed (requireAgent), NOT gated on this — printer.manage gates
  // only the central-management surface (printing design §7). Codes/permissions are never renamed
  // once shipped.
  "printer.manage",
  // Authorizing a cash-drawer OPEN when a location's drawer_open_policy is 'gated' (@waitron/db
  // drawer_opens audit log). A domain-named CASH-ACCOUNTABILITY permission on the floor lane, NOT a
  // management-dashboard config gate — so it sits in the SUPERVISOR set beside sale.void/refund/
  // discount/rectify, granting it to supervisor + manager + admin and NEVER to staff. Under an 'open'
  // policy no permission is consulted; under 'gated' the drawer route requires this. Codes/permissions
  // are never renamed once shipped.
  "cash.drawer",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The four values of the `person_role` enum (packages/identity/src/schema/persons.ts). */
export type PersonRoleValue = "staff" | "supervisor" | "manager" | "admin";

const SUPERVISOR: ReadonlySet<Permission> = new Set([
  "sale.void",
  "sale.refund",
  "sale.discount",
  "sale.rectify",
  // A supervisor on the floor can authorize a gated cash-drawer open; manager (spreads SUPERVISOR)
  // and admin (ALL) inherit it, staff never holds it.
  "cash.drawer",
]);
const MANAGER: ReadonlySet<Permission> = new Set([
  ...SUPERVISOR,
  "person.manage",
  "till.configure",
  "schedule.manage",
  "swap.approve",
  "absence.decide",
  "purchase.manage",
  "recipe.manage",
  "report.export",
  "device.manage",
  "printer.manage",
]);
const ALL: ReadonlySet<Permission> = new Set(PERMISSIONS);

const ROLE_PERMISSIONS: Record<PersonRoleValue, ReadonlySet<Permission>> = {
  staff: new Set<Permission>(),
  supervisor: SUPERVISOR,
  manager: MANAGER,
  admin: ALL,
};

/** True if `role` may perform an action requiring `permission`. */
export function roleHasPermission(role: PersonRoleValue, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
