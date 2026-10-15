import { CALENDAR_MONTH_PLAN_READS } from "@waitron/venue-service/live-queries";

export const QUERY_DEPENDENCIES = {
  "staff-roles": ["staff_roles", "person_staff_roles", "persons"],
  "staff-role-delete-impact": [
    "staff_roles",
    "person_staff_roles",
    "staffing_blocks",
    "shift_assignments",
    "persons",
  ],
  "staffing-month": [
    "staffing_days",
    "staffing_blocks",
    "staff_roles",
    "departments",
    "kitchen_stations",
    ...CALENDAR_MONTH_PLAN_READS,
  ],
} as const;
