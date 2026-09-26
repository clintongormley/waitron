import type { ModulePermission } from "@waitron/module";

export const ADJUSTMENTS_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "adjustment.manage", grantedFrom: "manager" },
];
