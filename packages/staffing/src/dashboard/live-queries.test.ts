import { describe, expect, it } from "vitest";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

describe("QUERY_DEPENDENCIES", () => {
  it("reads the staff roles again when a role, a holder, a painted block, a shift or a person changes", () => {
    expect(QUERY_DEPENDENCIES).toEqual({
      "staff-roles": [
        "staff_roles",
        "person_staff_roles",
        "staffing_blocks",
        "shift_assignments",
        "persons",
      ],
    });
  });
});
