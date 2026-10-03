import type { Database } from "@waitron/db";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../../src/modules.js";

export function createDemoVenueProvisioner(
  db: () => Database,
  options: {
    nifBase: number;
    nifFormat?: "fixed_k" | "calculated";
    invoiceLocale: string;
    adminPin?: string;
    adminEmail?: string;
  },
) {
  let nifCounter = 0;
  return async () => {
    nifCounter += 1;
    const number = options.nifBase + nifCounter;
    const taxId =
      options.nifFormat === "calculated"
        ? nifWithControlLetter(number)
        : `${String(number).padStart(8, "0")}K`;
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId,
          legalName: "Casa Delgado SL",
          location: {
            name: "Sala principal",
            fiscalTerritory: "ES-common",
            invoiceLocales: [options.invoiceLocale],
            operationDescription: "Venta en establecimiento",
            addressLine1: "Calle Mayor 1",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
          },
          tillName: "Caja 1",
          seriesCode: "A",
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Administradora",
            pinHash: hashPin(options.adminPin ?? "1234"),
            passwordHash: hashPassword("dashPass123"),
            email: options.adminEmail ?? "owner@example.test",
          },
        },
        ALL_MODULES,
      ),
      { db: db(), modules: ALL_MODULES },
    );
    // planVenue puts the standard series before the rectificative one.
    return { ...venue, seriesId: venue.seriesIds[0]! };
  };
}
