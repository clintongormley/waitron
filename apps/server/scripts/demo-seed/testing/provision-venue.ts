import type { Database } from "@waitron/db";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../../src/modules.js";
import { venueModuleConfig } from "../../../src/provision.js";

/** A United Kingdom venue's enabled modules, as `fiscal-none.e2e.test.ts` provisions one. */
const GB_MODULES = enabledModules(
  ALL_MODULES,
  venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
);

export function createDemoVenueProvisioner(
  db: () => Database,
  options: {
    /** Spain unless given. */
    country?: "GB";
    nifBase: number;
    nifFormat?: "fixed_k" | "calculated";
    invoiceLocale: string;
    adminPin?: string;
    adminEmail?: string;
    province?: string;
    postalCode?: string;
    city?: string;
  },
) {
  let nifCounter = 0;
  return async () => {
    nifCounter += 1;
    const number = options.nifBase + nifCounter;
    const gb = options.country === "GB";
    const modules = gb ? GB_MODULES : ALL_MODULES;
    const taxId = gb
      ? `GB${String(number).padStart(9, "0")}`
      : options.nifFormat === "calculated"
        ? nifWithControlLetter(number)
        : `${String(number).padStart(8, "0")}K`;
    const venue = await applyVenue(
      planVenue(
        {
          country: gb ? "GB" : "ES",
          taxId,
          legalName: gb ? "Deli London Ltd" : "Casa Delgado SL",
          location: {
            name: gb ? "Main counter" : "Sala principal",
            fiscalTerritory: gb ? "GB-vat" : "ES-common",
            invoiceLocales: [options.invoiceLocale],
            operationDescription: gb ? "Sale on premises" : "Venta en establecimiento",
            addressLine1: gb ? "1 High Street" : "Calle Mayor 1",
            addressLine2: null,
            postalCode: options.postalCode ?? (gb ? "EC1A 1AA" : "28013"),
            city: options.city ?? (gb ? "London" : "Madrid"),
            province: options.province ?? (gb ? "London" : "Madrid"),
            timeZone: gb ? "Europe/London" : "Europe/Madrid",
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
        modules,
      ),
      { db: db(), modules },
    );
    // planVenue puts the standard series before the rectificative one.
    return { ...venue, seriesId: venue.seriesIds[0]! };
  };
}
