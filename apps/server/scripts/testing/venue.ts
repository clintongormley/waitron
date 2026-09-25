// One provisioned venue for the suites that run the one-shot operator scripts. Provisioned through
// `planVenue` + `applyVenue`, so the fiscal ids were minted the way a real box mints them.
import { openVenueDatabase } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";

export interface TestVenue {
  tillId: string;
  nodeId: string;
  /** The ORDINARY sale series. `planVenue` emits the standard series first. */
  seriesId: string;
  rectificativeSeriesId: string;
  locationId: string;
}

/**
 * `venueDir` must already be migrated.
 */
export async function provisionTestVenue(venueDir: string, taxId: string): Promise<TestVenue> {
  const store = await openVenueDatabase(venueDir);
  try {
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId,
          legalName: "Waitron Scripts SL",
          location: {
            name: "Sala principal",
            fiscalTerritory: "ES-common",
            invoiceLocales: ["es-ES"],
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
            pinHash: hashPin("5555"),
            passwordHash: hashPassword("scripts-fixture-password"),
            email: "admin@scripts.test",
          },
        },
        ALL_MODULES,
      ),
      { db: store.venue, modules: ALL_MODULES },
    );
    return {
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.seriesIds[0]!,
      rectificativeSeriesId: venue.seriesIds[1]!,
      locationId: venue.locationId,
    };
  } finally {
    await store.close();
  }
}
