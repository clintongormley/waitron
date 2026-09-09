import { describe, expect, it } from "vitest";
import { findAdministrativeAreaByPostalCode, resolveFiscalJurisdiction } from "@waitron/country";
import {
  SPAIN,
  validateSpanishNif,
  validateSpanishPhone,
  validateSpanishPostalCode,
} from "./spain.js";

describe("validateSpanishNif", () => {
  it.each([
    ["12345678z", "12345678Z", "personal"],
    [" X-2482300-W ", "X2482300W", "foreigner"],
    ["b 1234567 4", "B12345674", "entity"],
    ["A12345674", "A12345674", "entity"],
    ["N1234567D", "N1234567D", "entity"],
    ["P1234567D", "P1234567D", "entity"],
    ["C1234567D", "C1234567D", "entity"],
    ["K1234567L", "K1234567L", "tax-assigned-personal"],
    ["L12A4567Z", "L12A4567Z", "tax-assigned-personal"],
  ] as const)("normalises and accepts %s", (input, normalized, kind) => {
    expect(validateSpanishNif(input)).toEqual({ valid: true, normalized, kind });
  });

  it.each([
    ["", "empty"],
    ["123", "format"],
    ["12345678A", "checksum"],
    ["X2482300A", "checksum"],
    ["B12345678", "checksum"],
    ["A1234567D", "checksum"],
    ["N12345674", "checksum"],
    ["P12345674", "checksum"],
  ] as const)("rejects %s with reason %s", (input, reason) => {
    expect(validateSpanishNif(input)).toEqual({ valid: false, reason });
  });
});

describe("Spanish postcodes and provinces", () => {
  it.each([
    ["28013", "28"],
    ["08001", "08"],
    ["35001", "35"],
    ["52006", "52"],
  ])("normalises %s and derives province %s", (postcode, province) => {
    expect(validateSpanishPostalCode(` ${postcode} `)).toEqual({
      valid: true,
      normalized: postcode,
      kind: "postal-code",
    });
    expect(findAdministrativeAreaByPostalCode(SPAIN, postcode)?.code).toBe(province);
  });

  it.each(["", "8001", "53000", "AA001"])("rejects invalid postcode %s", (postcode) => {
    expect(validateSpanishPostalCode(postcode).valid).toBe(false);
  });

  it("contains every official two-digit province code exactly once", () => {
    const codes = SPAIN.administrativeAreas.map(({ code }) => code);
    expect(codes).toEqual(
      Array.from({ length: 52 }, (_, index) => String(index + 1).padStart(2, "0")),
    );
    expect(new Set(codes).size).toBe(52);
  });

  it("uses the Canary time zone only for the two Canary provinces", () => {
    const canaryCodes = SPAIN.administrativeAreas
      .filter(({ timeZone }) => timeZone === "Atlantic/Canary")
      .map(({ code }) => code);
    expect(canaryCodes).toEqual(["35", "38"]);
    expect(SPAIN.administrativeAreas.find(({ code }) => code === "28")?.timeZone).toBe(
      "Europe/Madrid",
    );
  });

  it("records regional language preferences without changing the Spanish fallback", () => {
    expect(SPAIN.administrativeAreas.find(({ code }) => code === "08")?.defaultLocale).toBe(
      "ca-ES",
    );
    expect(SPAIN.administrativeAreas.find(({ code }) => code === "15")?.defaultLocale).toBe(
      "gl-ES",
    );
    expect(SPAIN.administrativeAreas.find(({ code }) => code === "48")?.defaultLocale).toBe(
      "eu-ES",
    );
    expect(
      SPAIN.administrativeAreas.find(({ code }) => code === "28")?.defaultLocale,
    ).toBeUndefined();
    expect(SPAIN.defaultLocale).toBe("es-ES");
  });

  it("supports common territory and makes every unimplemented Spanish regime explicit", () => {
    expect(resolveFiscalJurisdiction(SPAIN, "28")).toMatchObject({
      id: "ES-common",
      supported: true,
      modules: { filing: "verifactu", tax: "vat" },
    });
    expect(resolveFiscalJurisdiction(SPAIN, "48")).toMatchObject({
      id: "ES-foral-basque",
      supported: false,
    });
    expect(resolveFiscalJurisdiction(SPAIN, "31")).toMatchObject({
      id: "ES-foral-navarre",
      supported: false,
    });
    expect(resolveFiscalJurisdiction(SPAIN, "35")).toMatchObject({
      id: "ES-canary",
      supported: false,
    });
    expect(resolveFiscalJurisdiction(SPAIN, "51")).toMatchObject({
      id: "ES-ceuta",
      supported: false,
    });
    expect(resolveFiscalJurisdiction(SPAIN, "52")).toMatchObject({
      id: "ES-melilla",
      supported: false,
    });
  });
});

describe("validateSpanishPhone", () => {
  it.each([
    ["612 345 678", "+34612345678", "mobile"],
    ["(+34) 612-345-678", "+34612345678", "mobile"],
    ["0034 912 345 678", "+34912345678", "geographic"],
  ] as const)("normalises %s", (input, normalized, kind) => {
    expect(validateSpanishPhone(input)).toEqual({ valid: true, normalized, kind });
  });

  it.each(["", "+33 612345678", "512345678", "61234"])("rejects %s", (input) => {
    expect(validateSpanishPhone(input).valid).toBe(false);
  });
});
