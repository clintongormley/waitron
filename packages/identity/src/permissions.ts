import type { PersonRoleValue } from "@waitron/shared";

export const PERMISSIONS = [
  "payment.take",
  "sale.void",
  "sale.refund",
  "sale.discount", // no call site yet
  "sale.rectify",
  "person.manage",
  "catalogue.manage",
  // Assigning or removing the admin role changes who can control every permission. Admin only.
  "person.admin",
  // Another person's personal data: admin only, by the owner's A980 O5 decision (2026-10-22).
  "personal_data.export",
  "venue.configure",
  "venue.view",
  "system.manage",
  "schedule.manage",
  "purchase.manage",
  "report.export",
  "report.view",
  "hardware.manage",
  "cash.drawer",
  // Decides which machines are in the venue's membership chart and hands one its identity, so
  // admin-only.
  "mirror.create",
  "node.promote",
  "fiscal.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF: ReadonlySet<Permission> = new Set(["payment.take"]);
const SUPERVISOR: ReadonlySet<Permission> = new Set([
  ...STAFF,
  "sale.void",
  "sale.refund",
  "sale.discount",
  "sale.rectify",
  "cash.drawer",
  "report.view",
  "venue.view",
]);
const MANAGER: ReadonlySet<Permission> = new Set([
  ...SUPERVISOR,
  "person.manage",
  "catalogue.manage",
  "venue.configure",
  "system.manage",
  "schedule.manage",
  "purchase.manage",
  "report.export",
  "hardware.manage",
  "fiscal.view",
]);
const ALL: ReadonlySet<Permission> = new Set(PERMISSIONS);

const ROLE_PERMISSIONS: Record<PersonRoleValue, ReadonlySet<Permission>> = {
  staff: STAFF,
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
