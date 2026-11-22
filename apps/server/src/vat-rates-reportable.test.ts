import { COUNTRY_PACKS, vatRatesFor } from "@waitron/country-packs";
import { mapModelo303 } from "@waitron/reporting";
import { decimal } from "@waitron/shared";
import { describe, expect, it } from "vitest";

const ZERO = decimal("0.00");

const supportedAreas = COUNTRY_PACKS.flatMap((pack) =>
  pack.fiscalJurisdictions
    .filter(({ supported, modules }) => supported && modules !== undefined)
    .map(({ id }) => [pack.countryCode, id] as const),
);

describe("every rate a person may pick", () => {
  it.each(supportedAreas)("in %s %s has a box on the VAT return", (country, territory) => {
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
