import { MEDIA_DASHBOARD } from "@waitron/media/dashboard";
import { BOOKINGS_DASHBOARD } from "@waitron/bookings/dashboard";
import { VENUE_SERVICE_DASHBOARD } from "@waitron/venue-service/dashboard";
import { ADJUSTMENTS_DASHBOARD } from "@waitron/adjustments/dashboard";
import { STAFFING_DASHBOARD } from "@waitron/staffing/dashboard";
import { WORKFORCE_DASHBOARD } from "@waitron/workforce/dashboard";
import { VERIFACTU_DASHBOARD } from "@waitron/fiscal-verifactu/src/dashboard/index.js";
import type { DashboardContribution } from "@waitron/dashboard-kit";

// The dashboard's module registry: every module that contributes to the dashboard (a screen, a
// settings panel or a Calendar view) names itself here, and the app iterates this list to mount
// them generically. This is the ONE place that names each UI-bearing module (the browser twin of
// @waitron/composition's server descriptor list); the app under apps/dashboard imports neither a
// module nor @waitron/composition, only this registry.
export const DASHBOARD_MODULES: readonly DashboardContribution[] = [
  MEDIA_DASHBOARD,
  BOOKINGS_DASHBOARD,
  VENUE_SERVICE_DASHBOARD,
  ADJUSTMENTS_DASHBOARD,
  STAFFING_DASHBOARD,
  WORKFORCE_DASHBOARD,
  VERIFACTU_DASHBOARD,
];

export { CARD_PROVIDER_PANELS } from "./card-providers.js";

export { ATTENDANCE_QUERY_DEPENDENCIES } from "@waitron/workforce/dashboard";
export type {
  AttendanceCommand,
  AttendanceCommandPayload,
  AttendanceCommandResult,
  AttendanceChange,
  AttendanceInbox,
  AttendanceDayView,
  AttendanceManagerQueue,
  AttendanceLookups,
  CorrectionItem,
  OwnAttendanceCommand,
  HoursSelection,
  HoursDay,
  HoursOpenShift,
  HoursClosure,
  PersonHours,
  ManagerHours,
  AttendanceExportSelection,
  ManagerAttendanceExportSelection,
  AttendanceExportOptions,
} from "@waitron/workforce/attendance-contract";
