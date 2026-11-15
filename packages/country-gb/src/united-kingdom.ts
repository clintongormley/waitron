import type { CountryPack } from "@waitron/country";

/**
 * The UK pack exists to preserve the existing no-fiscal-regime provisioning path. Its address,
 * postcode, telephone and tax-identifier rules remain manual until they have product consumers.
 */
export const UNITED_KINGDOM: CountryPack = {
  countryCode: "GB",
  defaultLocale: "en-GB",
  defaultTimeZone: "Europe/London",
  timeZones: ["Europe/London"],
  invoiceLocales: ["en-GB"],
  moduleIds: [],
  starterCourses: [
    { name: "Starters", heldUntilFired: false },
    { name: "Mains", heldUntilFired: true, starterKey: "mains" },
    { name: "Desserts", heldUntilFired: true, starterKey: "desserts" },
  ],
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
