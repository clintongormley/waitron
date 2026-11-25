import { describe, expect, it } from "vitest";
import { seriesPurposeLabel, seriesPurposes } from "./strings.js";

describe("seriesPurposeLabel", () => {
  it("names every series purpose from the setup strings in each locale", () => {
    expect(seriesPurposes.map((purpose) => seriesPurposeLabel(purpose, "en"))).toEqual([
      "Simplified invoices (tickets)",
      "Full invoices",
      "Corrective receipts",
      "Corrective invoices",
    ]);
    expect(seriesPurposes.map((purpose) => seriesPurposeLabel(purpose, "es"))).toEqual([
      "Facturas simplificadas (tickets)",
      "Facturas completas",
      "Tickets rectificativos",
      "Facturas rectificativas",
    ]);
  });

  it("shows a purpose outside the list as written, never as a known label", () => {
    expect(seriesPurposeLabel("heading", "en")).toBe("heading");
  });
});
