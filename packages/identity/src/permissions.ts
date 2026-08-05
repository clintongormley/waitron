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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The four values of the `person_role` enum (packages/identity/src/schema/persons.ts). */
export type PersonRoleValue = "staff" | "supervisor" | "manager" | "admin";

const SUPERVISOR: ReadonlySet<Permission> = new Set([
  "sale.void",
  "sale.refund",
  "sale.discount",
  "sale.rectify",
]);
const MANAGER: ReadonlySet<Permission> = new Set([...SUPERVISOR, "person.manage"]);
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
