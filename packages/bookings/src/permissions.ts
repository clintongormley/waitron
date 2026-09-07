import type { ModulePermission } from "@waitron/module";

/**
 * The reservation-management permission `@waitron/bookings` contributes to identity's role ladder.
 * `booking.manage` folds into `manager` + `admin` at boot (grantedFrom: "manager") — the same
 * audience the other management-dashboard write gates take, mirroring purchase.manage. The string
 * left identity's central catalog in SP1 t4; this seat is now its ONE declaring home. The module
 * states only the floor — identity owns the ladder above it. Codes/permissions are never renamed
 * once shipped.
 */
export const BOOKINGS_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "booking.manage", grantedFrom: "manager" },
];
