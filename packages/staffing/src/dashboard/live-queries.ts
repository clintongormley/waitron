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
    "seasons",
    "special_days",
    "special_day_dates",
    "locations",
    "location_business_day_settings",
    "location_day_cutover_changes",
  ],
} as const;
