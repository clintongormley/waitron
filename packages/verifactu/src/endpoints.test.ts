import { describe, expect, it } from "vitest";
import { QR_ENDPOINTS, SOAP_ENDPOINTS, SOAP_ENDPOINTS_SELLO } from "./endpoints.js";

// A wrong endpoint here is catastrophic and silent: requests go nowhere, or
// worse, somewhere unintended, with no local signal that anything is wrong.
// `toContain` fragments would let a mutated host or path slip through, so
// every constant is pinned to its exact, complete URL.
describe("SOAP_ENDPOINTS", () => {
  it("pins the exact production and preproduction submission/consulta URLs", () => {
    expect(SOAP_ENDPOINTS).toEqual({
      production:
        "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
      preproduction: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    });
  });
});

describe("SOAP_ENDPOINTS_SELLO", () => {
  it("pins the exact production and preproduction sello-de-entidad URLs", () => {
    // Deliberately a different host (www10/prewww10) than SOAP_ENDPOINTS
    // (www1/prewww1) — sello de entidad certificates dispatch elsewhere.
    expect(SOAP_ENDPOINTS_SELLO).toEqual({
      production:
        "https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
      preproduction: "https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    });
  });

  it("uses a different host from SOAP_ENDPOINTS in both environments", () => {
    expect(SOAP_ENDPOINTS_SELLO.production).not.toBe(SOAP_ENDPOINTS.production);
    expect(SOAP_ENDPOINTS_SELLO.preproduction).not.toBe(SOAP_ENDPOINTS.preproduction);
  });
});

describe("QR_ENDPOINTS", () => {
  it("pins the exact production and preproduction QR validation URLs", () => {
    // Both host AND path change between environments here, unlike the SOAP
    // endpoints above (host only) — exact equality is what catches a
    // mutation to either half.
    expect(QR_ENDPOINTS).toEqual({
      production: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
      preproduction: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
    });
  });
});
