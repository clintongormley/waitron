import type { ModulePermission } from "@waitron/module";

export const BOOKINGS_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "booking.manage", defaultHolders: ["manager"] },
];
