import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECEIPT_LABEL_KEYS,
  findAdministrativeAreaByPostalCode,
  receiptLanguageRules,
  resolveFiscalJurisdiction,
} from "@waitron/country";
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
    ["K1234567A", "checksum"],
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
    expect(SPAIN.administrativeAreas.find(({ code }) => code === "03")?.defaultLocale).toBe(
      "ca-ES",
    );
    expect(
      SPAIN.administrativeAreas.find(({ code }) => code === "31")?.defaultLocale,
    ).toBeUndefined();
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
    expect(resolveFiscalJurisdiction(SPAIN, "01")?.id).toBe("ES-foral-basque");
    expect(resolveFiscalJurisdiction(SPAIN, "20")?.id).toBe("ES-foral-basque");
    expect(resolveFiscalJurisdiction(SPAIN, "31")).toMatchObject({
      id: "ES-foral-navarre",
      supported: false,
    });
    expect(resolveFiscalJurisdiction(SPAIN, "35")).toMatchObject({
      id: "ES-canary",
      supported: false,
    });
    expect(resolveFiscalJurisdiction(SPAIN, "38")?.id).toBe("ES-canary");
    expect(resolveFiscalJurisdiction(SPAIN, "51")).toMatchObject({
      id: "ES-ceuta",
      supported: false,
    });
    expect(resolveFiscalJurisdiction(SPAIN, "52")).toMatchObject({
      id: "ES-melilla",
      supported: false,
    });

    for (const { code } of SPAIN.administrativeAreas) {
      const matching = SPAIN.fiscalJurisdictions.filter(({ areaCodes }) =>
        areaCodes.includes(code),
      );
      expect(matching, code).toHaveLength(1);
      expect(resolveFiscalJurisdiction(SPAIN, code), code).toBe(matching[0]);
    }
  });
});

describe("regional content languages", () => {
  const CATALONIA = ["08", "17", "25", "43"];
  const VALENCIAN_COMMUNITY = ["03", "12", "46"];
  const GALICIA = ["15", "27", "32", "36"];
  const area = (code: string) => SPAIN.administrativeAreas.find((entry) => entry.code === code)!;

  it("names Spain's official languages", () => {
    expect(SPAIN.officialLocales).toEqual(["es-ES", "ca-ES", "gl-ES", "eu-ES"]);
  });

  it.each(CATALONIA)("requires Catalan and Spanish in %s, with Catalan the default", (code) => {
    expect(area(code).requiredContentLocales).toEqual(["ca-ES", "es-ES"]);
    expect(area(code).defaultContentLocale).toBe("ca-ES");
    expect(area(code).foreignLanguageNotice).toBeUndefined();
  });

  it.each(VALENCIAN_COMMUNITY)(
    "requires Valencian and Spanish in %s and gives the one-foreign-language notice",
    (code) => {
      expect(area(code).requiredContentLocales).toEqual(["ca-ES", "es-ES"]);
      expect(area(code).defaultContentLocale).toBeUndefined();
      const notice = area(code).foreignLanguageNotice!;
      expect(notice.minimumForeign).toBe(1);
      expect(Object.keys(notice.text).sort()).toEqual(["en", "es"]);
      for (const text of Object.values(notice.text)) expect(text).toContain("36/2023");
    },
  );

  it.each(GALICIA)(
    "requires Galician and Spanish in %s and gives the two-foreign-languages notice",
    (code) => {
      expect(area(code).requiredContentLocales).toEqual(["gl-ES", "es-ES"]);
      expect(area(code).defaultContentLocale).toBeUndefined();
      const notice = area(code).foreignLanguageNotice!;
      expect(notice.minimumForeign).toBe(2);
      expect(Object.keys(notice.text).sort()).toEqual(["en", "es"]);
      for (const text of Object.values(notice.text)) expect(text).toContain("108/2006");
    },
  );

  it("requires nothing anywhere else, the Balearics, the Basque Country and Navarre included", () => {
    const ruled = new Set([...CATALONIA, ...VALENCIAN_COMMUNITY, ...GALICIA]);
    const others = SPAIN.administrativeAreas.filter(({ code }) => !ruled.has(code));
    expect(others.map(({ code }) => code)).toEqual(expect.arrayContaining(["07", "48", "31"]));
    for (const other of others) {
      expect(other.requiredContentLocales, other.code).toBeUndefined();
      expect(other.defaultContentLocale, other.code).toBeUndefined();
      expect(other.foreignLanguageNotice, other.code).toBeUndefined();
    }
  });
});

describe("receipt language", () => {
  const OFFICIAL = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];

  it("offers exactly Spain's four official languages, Spanish first, and never English", () => {
    expect(SPAIN.invoiceLocales).toEqual(OFFICIAL);
    expect(SPAIN.invoiceLocales).not.toContain("en-GB");
  });

  it.each(["08", "17", "25", "43"])(
    "fixes %s to Catalan and says why in English and Spanish",
    (code) => {
      const rules = receiptLanguageRules(SPAIN, code);
      expect(rules.choices).toEqual(OFFICIAL);
      expect(rules.defaultLocale).toBe("ca-ES");
      expect(rules.fixed?.locale).toBe("ca-ES");
      expect(Object.keys(rules.fixed!.reason).sort()).toEqual(["en", "es"]);
      for (const text of Object.values(rules.fixed!.reason)) expect(text).toContain("128-1.2.a");
    },
  );

  it("says, in English and Spanish, that a copy can be printed in another language", () => {
    const { reason } = receiptLanguageRules(SPAIN, "08").fixed!;
    expect(reason.en).toMatch(
      /Receipts here are printed in Catalan; a copy can be printed in another language\.$/,
    );
    expect(reason.es).toMatch(
      /Aquí los tiques se imprimen en catalán; una copia se puede imprimir en otro idioma\.$/,
    );
  });

  it.each(["03", "12", "46", "15", "27", "32", "36", "01", "20", "48", "07", "31", "28"])(
    "leaves %s free to choose, with Spanish the default",
    (code) => {
      expect(receiptLanguageRules(SPAIN, code)).toStrictEqual({
        choices: OFFICIAL,
        defaultLocale: "es-ES",
      });
    },
  );
});

describe("receipt labels", () => {
  it("labels exactly the pack's receipt languages", () => {
    expect(Object.keys(SPAIN.receiptLabels ?? {}).sort()).toEqual([...SPAIN.invoiceLocales].sort());
  });

  it.each(SPAIN.invoiceLocales)("gives %s every label as non-empty text", (locale) => {
    const labels = SPAIN.receiptLabels?.[locale];
    expect(Object.keys(labels ?? {}).sort()).toEqual([...RECEIPT_LABEL_KEYS].sort());
    for (const key of RECEIPT_LABEL_KEYS) {
      expect(typeof labels?.[key], key).toBe("string");
      expect(labels?.[key].trim(), key).not.toBe("");
    }
  });

  it.each(SPAIN.invoiceLocales)(
    "keeps the never-translated Veri*Factu legend and QR caption out of %s",
    (locale) => {
      const values = Object.values(SPAIN.receiptLabels?.[locale] ?? {});
      expect(values).not.toContain("VERI*FACTU");
      expect(values).not.toContain("QR tributario:");
    },
  );
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

describe("demo company identity", () => {
  it("generates company identifiers accepted by the country's real validator", () => {
    const values = new Set<string>();
    for (let index = 0; index < 100; index++) {
      const taxId = SPAIN.demo!.createCompanyTaxId();
      expect(taxId).toMatch(/^B[0-9]{8}$/);
      expect(validateSpanishNif(taxId)).toEqual({ valid: true, normalized: taxId, kind: "entity" });
      values.add(taxId);
    }
    expect(values.size).toBeGreaterThan(1);
  });

  describe("throws away a draw at or above 4,290,000,000 and draws again", () => {
    const draws = (...values: number[]) => {
      const queue = [...values];
      vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
        (array as Uint32Array)[0] = queue.shift()!;
        return array;
      });
    };
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("draws again when a draw lands on the first value past the last whole block", () => {
      draws(4_290_000_000, 1_234_567);
      expect(SPAIN.demo!.createCompanyTaxId()).toMatch(/^B1234567[0-9]$/);
    });

    it("draws again for the largest 32-bit value", () => {
      draws(4_294_967_295, 7_654_321);
      expect(SPAIN.demo!.createCompanyTaxId()).toMatch(/^B7654321[0-9]$/);
    });

    it("keeps drawing through several rejected draws in a row", () => {
      draws(4_290_000_000, 4_294_967_295, 1_234_567);
      expect(SPAIN.demo!.createCompanyTaxId()).toMatch(/^B1234567[0-9]$/);
    });

    it("keeps the last value inside the last whole block", () => {
      draws(4_289_999_999, 1_234_567);
      expect(SPAIN.demo!.createCompanyTaxId()).toMatch(/^B9999999[0-9]$/);
    });
  });
});
