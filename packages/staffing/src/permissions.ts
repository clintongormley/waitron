import type { ModulePermission } from "@waitron/module";

export const STAFFING_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "staffing.manage", grantedFrom: "manager" },
];
