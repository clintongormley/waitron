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
const MANAGER: ReadonlySet<Permission> = new Set([
  ...SUPERVISOR,
  "person.manage",
  "till.configure",
  "schedule.manage",
  "swap.approve",
  "absence.decide",
  "purchase.manage",
  "recipe.manage",
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
