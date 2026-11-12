import type { ModulePermission } from "@waitron/module";

export const ADJUSTMENTS_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "adjustment.manage", defaultHolders: ["manager"] },
  { permission: "adjustment.apply", defaultHolders: ["staff", "supervisor", "manager"] },
  { permission: "adjustment.approve", defaultHolders: ["supervisor", "manager"] },
];
