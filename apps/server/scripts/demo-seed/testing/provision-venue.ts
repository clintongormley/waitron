import type { Database } from "@waitron/db";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../../src/modules.js";
import { venueModuleConfig } from "../../../src/provision.js";

type NifFormat = "fixed_k" | "calculated";

const COUNTRIES = {
  ES: {
    legalName: "Casa Delgado SL",
    locationName: "Sala principal",
    fiscalTerritory: "ES-common",
    operationDescription: "Venta en establecimiento",
    addressLine1: "Calle Mayor 1",
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    modules: ALL_MODULES,
    taxId: (number: number, nifFormat: NifFormat | undefined) =>
      nifFormat === "calculated"
        ? nifWithControlLetter(number)
        : `${String(number).padStart(8, "0")}K`,
  },
  GB: {
    legalName: "Deli London Ltd",
    locationName: "Main counter",
    fiscalTerritory: "GB-vat",
    operationDescription: "Sale on premises",
    addressLine1: "1 High Street",
    postalCode: "EC1A 1AA",
    city: "London",
    province: "London",
    timeZone: "Europe/London",
    modules: enabledModules(
      ALL_MODULES,
      venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
    ),
    taxId: (number: number) => `GB${String(number).padStart(9, "0")}`,
  },
};

export function createDemoVenueProvisioner(
  db: () => Database,
  options: {
    country?: keyof typeof COUNTRIES;
    nifBase: number;
    /** Spain only. */
    nifFormat?: NifFormat;
    invoiceLocale: string;
    adminPin?: string;
    adminEmail?: string;
    province?: string;
    postalCode?: string;
    city?: string;
  },
) {
  const country = options.country ?? "ES";
  const fixture = COUNTRIES[country];
  let nifCounter = 0;
  return async () => {
    nifCounter += 1;
    const number = options.nifBase + nifCounter;
    const venue = await applyVenue(
      planVenue(
        {
          country,
          taxId: fixture.taxId(number, options.nifFormat),
          legalName: fixture.legalName,
          location: {
            name: fixture.locationName,
            fiscalTerritory: fixture.fiscalTerritory,
            invoiceLocales: [options.invoiceLocale],
            operationDescription: fixture.operationDescription,
            addressLine1: fixture.addressLine1,
            addressLine2: null,
            postalCode: options.postalCode ?? fixture.postalCode,
            city: options.city ?? fixture.city,
            province: options.province ?? fixture.province,
            timeZone: fixture.timeZone,
            dayCutover: "05:00",
          },
          seriesCode: "A",
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Administradora",
            pinHash: hashPin(options.adminPin ?? "1234"),
            passwordHash: hashPassword("dashPass123"),
            email: options.adminEmail ?? "owner@example.test",
          },
        },
        fixture.modules,
      ),
      { db: db(), modules: fixture.modules },
    );
    // planVenue puts the standard series before the rectificative one.
    return { ...venue, seriesId: venue.seriesIds[0]! };
  };
}
