import type { ModulePermission } from "@waitron/module";
import type { PersonRoleValue } from "@waitron/shared";

export type BuiltInRoleKey = "staff" | "supervisor" | "manager" | "admin";
export type DefaultHolder = Exclude<BuiltInRoleKey, "admin">;
export interface PermissionDeclaration {
  readonly permission: string;
  readonly defaultHolders: readonly DefaultHolder[];
}

export const CORE_PERMISSIONS = [
  { permission: "payment.take", defaultHolders: ["staff", "supervisor", "manager"] },
  { permission: "sale.void", defaultHolders: ["supervisor", "manager"] },
  { permission: "sale.refund", defaultHolders: ["supervisor", "manager"] },
  { permission: "sale.rectify", defaultHolders: ["supervisor", "manager"] },
  { permission: "person.manage", defaultHolders: ["manager"] },
  { permission: "catalogue.manage", defaultHolders: ["manager"] },
  { permission: "person.admin", defaultHolders: [] },
  { permission: "personal_data.export", defaultHolders: [] },
  { permission: "venue.configure", defaultHolders: ["manager"] },
  { permission: "venue.view", defaultHolders: ["supervisor", "manager"] },
  { permission: "system.manage", defaultHolders: ["manager"] },
  { permission: "schedule.manage", defaultHolders: ["manager"] },
  { permission: "purchase.manage", defaultHolders: ["manager"] },
  { permission: "report.export", defaultHolders: ["manager"] },
  { permission: "report.view", defaultHolders: ["supervisor", "manager"] },
  { permission: "hardware.manage", defaultHolders: ["manager"] },
  { permission: "cash.drawer", defaultHolders: ["supervisor", "manager"] },
  { permission: "node.manage", defaultHolders: [] },
  { permission: "system.box_admin", defaultHolders: [] },
  { permission: "fiscal.view", defaultHolders: ["manager"] },
] as const satisfies readonly PermissionDeclaration[];

export type Permission = (typeof CORE_PERMISSIONS)[number]["permission"];
export const PERMISSIONS: readonly Permission[] = CORE_PERMISSIONS.map(
  ({ permission }) => permission,
);
const CORE_HOLDERS = new Map<string, readonly DefaultHolder[]>(
  CORE_PERMISSIONS.map(({ permission, defaultHolders }) => [permission, defaultHolders]),
);
const MODULE_PERMISSIONS = new Map<string, readonly DefaultHolder[]>();

export function registerModulePermissions(perms: readonly ModulePermission[]): void {
  for (const { permission, defaultHolders } of perms) {
    if (CORE_HOLDERS.has(permission)) throw new Error(`permission declared twice: ${permission}`);
    MODULE_PERMISSIONS.set(permission, defaultHolders);
  }
}

export function declaredPermissions(): string[] {
  return [...PERMISSIONS, ...MODULE_PERMISSIONS.keys()];
}

export function isDeclaredPermission(id: string): boolean {
  return CORE_HOLDERS.has(id) || MODULE_PERMISSIONS.has(id);
}

export function defaultPermissionsFor(holder: DefaultHolder): string[] {
  return declaredPermissions().filter((permission) => roleHasPermission(holder, permission));
}

export function permissionsForRole(role: PersonRoleValue): string[] {
  return role === "admin" ? declaredPermissions() : defaultPermissionsFor(role);
}

export function roleHasPermission(
  role: PersonRoleValue,
  permission: Permission | (string & {}),
): boolean {
  if (role === "admin") return isDeclaredPermission(permission);
  return (
    (CORE_HOLDERS.get(permission) ?? MODULE_PERMISSIONS.get(permission))?.includes(role) ?? false
  );
}
