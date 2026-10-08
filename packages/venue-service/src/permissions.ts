import type { ModulePermission } from "@waitron/module";

export const MANAGE_VENUE_SERVICE = "venue_service.manage";

export const VENUE_SERVICE_PERMISSIONS: readonly ModulePermission[] = [
  { permission: MANAGE_VENUE_SERVICE, grantedFrom: "manager" },
];
