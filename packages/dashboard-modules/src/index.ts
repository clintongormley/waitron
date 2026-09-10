import { BOOKINGS_DASHBOARD } from "@waitron/bookings/dashboard";
import { VENUE_SERVICE_DASHBOARD } from "@waitron/venue-service/dashboard";
import type { DashboardContribution } from "@waitron/dashboard-kit";

// The dashboard's module registry: every module that contributes a dashboard screen names itself here,
// and the app iterates this list to mount them generically. This is the ONE place that names each
// UI-bearing module (the browser twin of @waitron/composition's server descriptor list); the app under
// apps/dashboard imports neither a module nor @waitron/composition, only this registry.
export const DASHBOARD_MODULES: readonly DashboardContribution[] = [
  BOOKINGS_DASHBOARD,
  VENUE_SERVICE_DASHBOARD,
];
