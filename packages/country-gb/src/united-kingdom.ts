import type { CountryPack } from "@waitron/country";

/**
 * The UK pack exists to preserve the existing no-fiscal-regime provisioning path. Its address,
 * postcode, telephone and tax-identifier rules remain manual until they have product consumers.
 */
export const UNITED_KINGDOM: CountryPack = {
  countryCode: "GB",
  name: "United Kingdom",
  defaultLocale: "en-GB",
  defaultTimeZone: "Europe/London",
  invoiceLocales: ["en-GB"],
  moduleIds: [],
  availableForVenueSetup: false,
  administrativeAreas: [],
  defaultFiscalJurisdictionId: "GB-vat",
  fiscalJurisdictions: [
    {
      id: "GB-vat",
      areaCodes: [],
      supported: true,
      modules: { filing: "none", tax: "none" },
    },
  ],
};
