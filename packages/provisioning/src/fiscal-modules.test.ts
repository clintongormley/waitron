import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { FISCAL_TERRITORIES, resolveFiscalModules } from "./fiscal-modules.js";

describe("resolveFiscalModules", () => {
  it("resolves ES-common to Veri*Factu + VAT", () => {
    expect(resolveFiscalModules("ES-common")).toEqual({ filing: "verifactu", tax: "vat" });
  });

  it("resolves GB-vat to the no-regime filing module (records nothing)", () => {
    expect(resolveFiscalModules("GB-vat")).toEqual({ filing: "none", tax: "none" });
  });

  it("throws fiscal.regime_not_implemented for any other territory, echoing it", () => {
    try {
      resolveFiscalModules("ES-PV-bizkaia");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("fiscal.regime_not_implemented");
        expect(error.params).toEqual({ territory: "ES-PV-bizkaia" });
      }
    }
  });

  it("throws for the empty territory too — no silent default", () => {
    expect(() => resolveFiscalModules("")).toThrow();
  });
});

describe("FISCAL_TERRITORIES", () => {
  it("lists the territories the registry resolves, and resolves each of them", () => {
    expect(FISCAL_TERRITORIES).toEqual(["ES-common", "GB-vat"]);
    // Every listed territory resolves to a non-empty filing module (the id the composition root maps
    // to a slot member); the specific values are pinned by the per-territory tests above.
    for (const t of FISCAL_TERRITORIES)
      expect(resolveFiscalModules(t).filing.length).toBeGreaterThan(0);
  });
});
