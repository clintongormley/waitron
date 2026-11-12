import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    "staff_role.not_found": { staffRoleId: string };
    "staff_role.name_taken": { name: string };
    "person.job_roles_changed": Record<string, never>;
    "staffing.invalid": { field: string };
    "staffing_area.not_found": { area: string };
  }
}
