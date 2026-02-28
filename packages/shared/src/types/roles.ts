export const PLATFORM_ROLES = ["super_admin"] as const;
export const TENANT_ROLES = [
  "owner",
  "manager",
  "staff",
  "kitchen",
  "customer",
] as const;
export const ALL_ROLES = [...PLATFORM_ROLES, ...TENANT_ROLES] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type TenantRole = (typeof TENANT_ROLES)[number];
export type Role = (typeof ALL_ROLES)[number];

export function isPlatformRole(role: Role): role is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}
