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
  // Assigning or removing the admin role changes who can control every permission. Admin only.
  "person.admin",
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
  // Authoring received purchase invoices (supplier + dates + VAT breakdown) from
  // the management dashboard (@waitron/purchasing), the data source for the modelo 303 deductible-VAT
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
  // Viewing the management reporting surface (sales/takings) from the management dashboard / API
  // (@waitron/reporting). A domain-named REPORTING permission distinct from report.export (exporting
  // the modelo 303 fiscal file, manager+admin only): reading the reports is a floor-supervisor
  // capability, so it lives in the SUPERVISOR set — supervisor, manager (spreads SUPERVISOR) and admin
  // (ALL) hold it, staff never does. Codes/permissions are never renamed once shipped.
  "report.view",
  // Admitting devices and managing enrolled ones (a screen asks to join, an admin opens the venue's
  // pairing window and matches the number it shows; the accepted device authenticates by a device
  // cookie thereafter) from the management dashboard (device-identity-1). A domain-named DEVICE-ADMIN
  // permission, distinct from staff admin (person.manage); granted to manager + admin, the same roles
  // as the other management write gates. The device ROUTES themselves are device-cookie-authenticated
  // (requireDevice), NOT gated on this — this gates only the window/accept/list/revoke management
  // surface (spec §3a/§3e).
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
  // Gates the Payments configuration screen and its server routes (@waitron/payments) — choosing and
  // setting up the card-payment provider and reader; granted to manager + admin, the same roles as
  // the other management write gates. Codes/permissions are never renamed once shipped.
  "payments.manage",
  // Re-emitting stored documents is separately authorized from printer configuration.
  "print.resend",
  // Authorizing a cash-drawer OPEN when a location's drawer_open_policy is 'gated' (@waitron/db
  // drawer_opens audit log). A domain-named CASH-ACCOUNTABILITY permission on the floor lane, NOT a
  // management-dashboard config gate — so it sits in the SUPERVISOR set beside sale.void/refund/
  // discount/rectify, granting it to supervisor + manager + admin and NEVER to staff. Under an 'open'
  // policy no permission is consulted; under 'gated' the drawer route requires this. Codes/permissions
  // are never renamed once shipped.
  "cash.drawer",
  // Minting a cloud-mirror bundle (sync cloud-mirror C2b) — hands out a data-access sync token, so
  // admin-only. Not in SUPERVISOR/MANAGER; reaches `admin` via ALL.
  "mirror.create",
  // Promoting a node to primary (authenticated mirror→primary promotion) — an operator-triggered
  // control action, so admin-only. Not in SUPERVISOR/MANAGER; reaches `admin` via ALL.
  "node.promote",
  // view recent logs + toggle diagnostic verbosity; manager + admin
  "diagnostics.view",
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
  // A supervisor can read the management reporting surface (sales/takings); manager (spreads
  // SUPERVISOR) and admin (ALL) inherit it, staff never holds it. Distinct from report.export.
  "report.view",
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
  "payments.manage",
  "print.resend",
  "diagnostics.view",
]);
const ALL: ReadonlySet<Permission> = new Set(PERMISSIONS);

const ROLE_PERMISSIONS: Record<PersonRoleValue, ReadonlySet<Permission>> = {
  staff: new Set<Permission>(),
  supervisor: SUPERVISOR,
  manager: MANAGER,
  admin: ALL,
};

// Returns its argument unchanged, but only type-checks when the tuple lists EVERY `PersonRoleValue`.
// It is the exhaustiveness tie for ROLE_LADDER below: a role added to `PersonRoleValue` but forgotten
// in the tuple makes the argument's required type `never`, so the call fails to compile — a LOUD
// error, not a silent mis-fold (an unlisted role would make `indexOf` return -1 and fold into
// `["admin"]` alone). Both directions are caught: a tuple entry outside `PersonRoleValue` breaks the
// `U extends readonly PersonRoleValue[]` bound.
const arrayOfAll =
  <T>() =>
  <U extends readonly T[]>(array: U & ([T] extends [U[number]] ? unknown : never)): U =>
    array;

// staff < supervisor < manager < admin — identity OWNS the ladder. A module states only the floor a
// permission is granted from (grantedFrom); the fold below spreads it to that role and every role
// above. The one source of the ordering, reused by registerModulePermissions; tied exhaustively to
// `PersonRoleValue` by `arrayOfAll` so it cannot silently diverge from the role enum.
const ROLE_LADDER = arrayOfAll<PersonRoleValue>()([
  "staff",
  "supervisor",
  "manager",
  "admin",
] as const);

// Module-contributed permissions, folded into their roles at boot (registerModulePermissions). A
// module's permission lives HERE, never in the static PERMISSIONS catalog; roleHasPermission consults
// both. Mutable, populated once at startup before any route auth runs (apps/server/src/boot.ts);
// re-registering the same permission simply overwrites its role set.
const MODULE_PERMISSIONS = new Map<string, ReadonlySet<PersonRoleValue>>();

/**
 * Fold a module's contributed permissions into identity's role ladder. Each `{ permission,
 * grantedFrom }` grants `permission` to `grantedFrom` and every role ABOVE it (the ladder stays
 * identity's — the module names only the floor). Called ONCE at startup, before any route auth, over
 * the composition root's assembled set; the static catalog names no module permission (spec §4.2).
 */
export function registerModulePermissions(
  perms: readonly { permission: string; grantedFrom: PersonRoleValue }[],
): void {
  for (const { permission, grantedFrom } of perms) {
    // indexOf never returns -1: `grantedFrom` is a PersonRoleValue and `arrayOfAll` above forces
    // ROLE_LADDER to list every one, so the floor is always found and `slice` spreads to it and above.
    const floor = ROLE_LADDER.indexOf(grantedFrom);
    MODULE_PERMISSIONS.set(permission, new Set(ROLE_LADDER.slice(floor)));
  }
}

/**
 * The effective permission ids `role` holds — the static catalog plus every module-registered
 * permission, filtered through the SAME `roleHasPermission` ladder. The WHOAMI probe hands this set to
 * the dashboard so it can gate a module's nav/screen client-side; it is a hint for the UI, never a
 * substitute for the server-side `authorizeManager` gate each route still enforces. Depends on the
 * module registry, so it reflects only permissions already folded in by `registerModulePermissions`
 * (done once at boot before any request).
 */
export function permissionsForRole(role: PersonRoleValue): string[] {
  const ids = [...PERMISSIONS, ...MODULE_PERMISSIONS.keys()];
  return ids.filter((p) => roleHasPermission(role, p));
}

/** True if `role` may perform an action requiring `permission`. `permission` widens past the closed
 * core union so a module's own permission string is accepted (the boundary authorizeManager also
 * widens to); a core permission resolves against the static map, a module permission against the
 * registry above. */
export function roleHasPermission(
  role: PersonRoleValue,
  permission: Permission | (string & {}),
): boolean {
  return (
    (ROLE_PERMISSIONS[role] as ReadonlySet<string>).has(permission) ||
    (MODULE_PERMISSIONS.get(permission)?.has(role) ?? false)
  );
}
