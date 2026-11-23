import { describe, expect, it } from "vitest";
import { seriesPurposeLabel, seriesPurposes } from "./strings.js";

describe("seriesPurposeLabel", () => {
  it("names every series purpose from the setup strings in each locale", () => {
    expect(seriesPurposes.map((purpose) => seriesPurposeLabel(purpose, "en"))).toEqual([
      "Simplified invoices (tickets)",
      "Full invoices",
      "Corrective of simplified invoices",
      "Corrective of full invoices",
    ]);
    expect(seriesPurposes.map((purpose) => seriesPurposeLabel(purpose, "es"))).toEqual([
      "Facturas simplificadas (tickets)",
      "Facturas completas",
      "Rectificativa de simplificadas",
      "Rectificativa de completas",
    ]);
  });

  it("shows a purpose outside the list as written, never as a known label", () => {
    expect(seriesPurposeLabel("heading", "en")).toBe("heading");
  });
});
