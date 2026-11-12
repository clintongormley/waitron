import { describe, expect, it } from "vitest";
import { STAFFING_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

describe("STAFFING_CONFIGURATION_TRANSFER", () => {
  it("transfers painted staffing, never job roles or shift assignments", () => {
    expect(STAFFING_CONFIGURATION_TRANSFER).toEqual({
      kind: "tables",
      tables: [{ name: "staffing_days" }, { name: "staffing_blocks" }],
    });
  });
});
