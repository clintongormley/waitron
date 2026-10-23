import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { openVenueDatabase } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";

export interface TestVenue {
  nodeId: string;
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
            name: "Main room",
            fiscalTerritory: "ES-common",
            invoiceLocales: ["es-ES"],
            operationDescription: "Retail sale",
            addressLine1: "1 Market Street",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
          },
          seriesCode: "A",
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Administrator",
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
      nodeId: venue.nodeId,
      seriesId: venue.seriesIds[0]!,
      rectificativeSeriesId: venue.seriesIds[2]!,
      locationId: venue.locationId,
    };
  } finally {
    await store.close();
  }
}
