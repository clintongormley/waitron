import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { FISCAL_TERRITORIES, resolveFiscalModules } from "./fiscal-modules.js";

describe("resolveFiscalModules", () => {
  it("resolves ES-common to Veri*Factu + IVA", () => {
    expect(resolveFiscalModules("ES-common")).toEqual({ filing: "verifactu", tax: "iva" });
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
    expect(FISCAL_TERRITORIES).toEqual(["ES-common"]);
    for (const t of FISCAL_TERRITORIES) expect(resolveFiscalModules(t).filing).toBe("verifactu");
  });
});
