const STAFF_ROLE_READS = [
  "staff_roles",
  "person_staff_roles",
  "staffing_blocks",
  "shift_assignments",
  "persons",
] as const;

export const QUERY_DEPENDENCIES = {
  "staff-roles": STAFF_ROLE_READS,
  "staff-role-delete-impact": STAFF_ROLE_READS,
} as const;
