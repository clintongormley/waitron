import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const STATE =
  "venue service configuration or live order state; copied to a standby, never drained back";

export const VENUE_SERVICE_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("departments", "state", STATE),
  classify("zone_service_policies", "state", STATE),
  classify("zone_menus", "state", STATE),
  classify("device_zone_defaults", "state", STATE),
  classify("preparation_routes", "state", STATE),
  classify("department_hours", "state", STATE),
  classify("order_service_contexts", "state", STATE),
  classify("working_line_contexts", "state", STATE),
];

export const VENUE_SERVICE_CHANGE_SOURCES: readonly ChangeSource[] =
  VENUE_SERVICE_CLASSIFICATION.map(({ table }) => ({ table, type: table }));
