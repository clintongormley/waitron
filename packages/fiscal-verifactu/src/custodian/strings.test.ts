import { describe, expect, it } from "vitest";
import { custodyValueLabel } from "./strings.js";

describe("custodyValueLabel", () => {
  it("names the simplified and full invoice series in each locale", () => {
    expect(["standard", "full"].map((purpose) => custodyValueLabel(purpose, "en"))).toEqual([
      "Simplified invoices (tickets)",
      "Full invoices",
    ]);
    expect(["standard", "full"].map((purpose) => custodyValueLabel(purpose, "es"))).toEqual([
      "Facturas simplificadas (tickets)",
      "Facturas completas",
    ]);
  });
});
