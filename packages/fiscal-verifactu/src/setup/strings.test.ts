import { describe, expect, it } from "vitest";
import { seriesPurposeLabel, seriesPurposes } from "./strings.js";

describe("seriesPurposeLabel", () => {
  it("names every series purpose from the setup strings in each locale", () => {
    expect(seriesPurposes.map((purpose) => seriesPurposeLabel(purpose, "en"))).toEqual([
      "Standard",
      "Full invoice",
      "Corrective",
      "Full invoice corrective",
    ]);
    expect(seriesPurposes.map((purpose) => seriesPurposeLabel(purpose, "es"))).toEqual([
      "Simplificada",
      "Factura completa",
      "Rectificativa de simplificadas",
      "Rectificativa de completas",
    ]);
  });

  it("shows a purpose outside the list as written, never as a known label", () => {
    expect(seriesPurposeLabel("heading", "en")).toBe("heading");
  });
});
