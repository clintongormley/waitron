import type { ModulePermission } from "@waitron/module";

/** This seat is the permission's one declaring home; identity owns the ladder above the floor. */
export const BOOKINGS_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "booking.manage", grantedFrom: "manager" },
];
