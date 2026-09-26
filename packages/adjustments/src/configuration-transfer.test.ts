import { describe, expect, it } from "vitest";
import { ADJUSTMENTS_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

describe("ADJUSTMENTS_CONFIGURATION_TRANSFER", () => {
  it("transfers the reasons, which are venue policy rather than trading history", () => {
    expect(ADJUSTMENTS_CONFIGURATION_TRANSFER).toEqual({
      kind: "tables",
      tables: [{ name: "adjustment_reasons" }],
    });
  });
});
