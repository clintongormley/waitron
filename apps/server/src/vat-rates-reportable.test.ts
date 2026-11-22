import { COUNTRY_PACKS, vatRatesFor } from "@waitron/country-packs";
import { mapModelo303 } from "@waitron/reporting";
import { decimal } from "@waitron/shared";
import { describe, expect, it } from "vitest";

const ZERO = decimal("0.00");

// Modelo 303 is Spain's VAT return, so only Spanish areas whose tax module is VAT file it.
const modelo303Areas = COUNTRY_PACKS.filter(({ countryCode }) => countryCode === "ES").flatMap(
  (pack) =>
    pack.fiscalJurisdictions
      .filter(({ supported, modules }) => supported && modules?.tax === "vat")
      .map(({ id }) => [pack.countryCode, id] as const),
);

describe("every rate a person may pick", () => {
  it("is checked in at least one area that files modelo 303", () => {
    expect(modelo303Areas).toContainEqual(["ES", "ES-common"]);
  });

  it.each(modelo303Areas)("in %s %s has a box on modelo 303", (country, territory) => {
    const pickable = vatRatesFor(country, territory)?.pickable;
    expect(pickable).toBeDefined();
    const vatReturn = {
      year: 2026,
      period: { kind: "month", month: 1 } as const,
      byRate: pickable!.map((rate) => ({ rate: decimal(rate), base: ZERO, tax: ZERO })),
      baseTotal: ZERO,
      taxTotal: ZERO,
      deductible: { byRate: [], baseTotal: ZERO, taxTotal: ZERO },
      result: ZERO,
    };
    expect(() => mapModelo303(vatReturn)).not.toThrow();
  });
});
