import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  WAITRON_ID_SISTEMA,
  assertUsableIdSistema,
  resolveFiscalModules,
} from "./fiscal-modules.js";

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

describe("WAITRON_ID_SISTEMA", () => {
  it("is a Waitron product code of at most 2 characters", () => {
    expect(WAITRON_ID_SISTEMA.length).toBeGreaterThan(0);
    expect(WAITRON_ID_SISTEMA.length).toBeLessThanOrEqual(2);
    expect(() => assertUsableIdSistema(WAITRON_ID_SISTEMA)).not.toThrow();
  });

  it("assertUsableIdSistema rejects an over-long id", () => {
    expect(() => assertUsableIdSistema("ABC")).toThrow();
  });
});
