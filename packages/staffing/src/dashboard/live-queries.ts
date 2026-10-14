export const QUERY_DEPENDENCIES = {
  "staff-roles": ["staff_roles", "person_staff_roles", "persons"],
  "staff-role-delete-impact": [
    "staff_roles",
    "person_staff_roles",
    "staffing_blocks",
    "shift_assignments",
    "persons",
  ],
} as const;
