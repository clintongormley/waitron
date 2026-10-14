import { describe, expect, it } from "vitest";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

describe("QUERY_DEPENDENCIES", () => {
  it("reads the staff roles again when a role, a holder or a person changes", () => {
    expect(QUERY_DEPENDENCIES["staff-roles"]).toEqual([
      "staff_roles",
      "person_staff_roles",
      "persons",
    ]);
  });

  it("reads a delete's impact again when a role, a holder, a painted block, a shift or a person changes", () => {
    expect(QUERY_DEPENDENCIES["staff-role-delete-impact"]).toEqual([
      "staff_roles",
      "person_staff_roles",
      "staffing_blocks",
      "shift_assignments",
      "persons",
    ]);
    expect(Object.keys(QUERY_DEPENDENCIES)).toEqual(["staff-roles", "staff-role-delete-impact"]);
  });
});
