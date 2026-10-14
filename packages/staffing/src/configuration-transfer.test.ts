import { describe, expect, it } from "vitest";
import { STAFFING_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

describe("STAFFING_CONFIGURATION_TRANSFER", () => {
  it("transfers the staff roles, who holds them and the painted staffing, never the shift assignments", () => {
    expect(STAFFING_CONFIGURATION_TRANSFER).toEqual({
      kind: "tables",
      tables: [
        { name: "staff_roles", locationColumns: ["location_id"] },
        { name: "person_staff_roles" },
        { name: "staffing_days" },
        { name: "staffing_blocks" },
      ],
    });
  });
});
