/**
 * Call sites gate on a PERMISSION, never a role string, so the role→permission map below can change
 * in one place. Permission ids are never renamed once shipped.
 */
export const PERMISSIONS = [
  "sale.void",
  "sale.refund",
  "sale.discount", // no call site yet
  "sale.rectify",
  "person.manage",
  // Assigning or removing the admin role changes who can control every permission. Admin only.
  "person.admin",
  "layout.configure",
  "venue.configure",
  "system.manage",
  "schedule.manage",
  "swap.approve",
  "absence.decide",
  "purchase.manage",
  "recipe.manage",
  "report.export",
  "report.view",
  "device.manage",
  "printer.manage",
  "payments.manage",
  "print.resend",
  "cash.drawer",
  // Hands out a data-access sync token, so admin-only.
  "mirror.create",
  "node.promote",
  "diagnostics.view",
  "fiscal.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PersonRoleValue = "staff" | "supervisor" | "manager" | "admin";

const SUPERVISOR: ReadonlySet<Permission> = new Set([
  "sale.void",
  "sale.refund",
  "sale.discount",
  "sale.rectify",
  "cash.drawer",
  "report.view",
]);
const MANAGER: ReadonlySet<Permission> = new Set([
  ...SUPERVISOR,
  "person.manage",
  "layout.configure",
  "venue.configure",
  "system.manage",
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
  "fiscal.view",
]);
const ALL: ReadonlySet<Permission> = new Set(PERMISSIONS);

const ROLE_PERMISSIONS: Record<PersonRoleValue, ReadonlySet<Permission>> = {
  staff: new Set<Permission>(),
  supervisor: SUPERVISOR,
  manager: MANAGER,
  admin: ALL,
};

// Returns its argument unchanged, but only type-checks when the tuple lists EVERY `PersonRoleValue`:
// an unlisted role would make `indexOf` below return -1 and fold into `["admin"]` alone.
const arrayOfAll =
  <T>() =>
  <U extends readonly T[]>(array: U & ([T] extends [U[number]] ? unknown : never)): U =>
    array;

// Identity OWNS the ladder; a module states only the floor a permission is granted from.
const ROLE_LADDER = arrayOfAll<PersonRoleValue>()([
  "staff",
  "supervisor",
  "manager",
  "admin",
] as const);

// Populated once at boot, before any route auth runs (apps/server/src/boot.ts). A module's permission
// lives here, never in the static PERMISSIONS catalog.
const MODULE_PERMISSIONS = new Map<string, ReadonlySet<PersonRoleValue>>();

/** Grants each `permission` to `grantedFrom` and every role ABOVE it. Re-registering a permission
 * overwrites its role set. */
export function registerModulePermissions(
  perms: readonly { permission: string; grantedFrom: PersonRoleValue }[],
): void {
  for (const { permission, grantedFrom } of perms) {
    const floor = ROLE_LADDER.indexOf(grantedFrom);
    MODULE_PERMISSIONS.set(permission, new Set(ROLE_LADDER.slice(floor)));
  }
}

/** The static catalog plus every module permission registered so far, filtered by
 * `roleHasPermission`. */
export function permissionsForRole(role: PersonRoleValue): string[] {
  const ids = [...PERMISSIONS, ...MODULE_PERMISSIONS.keys()];
  return ids.filter((p) => roleHasPermission(role, p));
}

/** `permission` widens past the closed core union so a module's own permission string is accepted. */
export function roleHasPermission(
  role: PersonRoleValue,
  permission: Permission | (string & {}),
): boolean {
  return (
    (ROLE_PERMISSIONS[role] as ReadonlySet<string>).has(permission) ||
    (MODULE_PERMISSIONS.get(permission)?.has(role) ?? false)
  );
}
