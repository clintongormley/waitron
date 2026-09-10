import type { ModulePermission } from "@waitron/module";

export const VENUE_SERVICE_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "venue_service.manage", grantedFrom: "manager" },
];
