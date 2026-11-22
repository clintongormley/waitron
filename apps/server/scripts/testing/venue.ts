import { fixturePasswordHash, fixturePinHash } from "../../src/testing/known-secret-hashes.js";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { openVenueDatabase } from "@waitron/db";

import { planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";

export interface TestVenue {
  nodeId: string;
  seriesId: string;
  correctiveSeriesId: string;
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
          name: "Main room",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          addressLine1: "1 Market Street",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          seriesCode: "A",
          correctiveSeriesCode: "R",
          admin: {
            displayName: "Administrator",
            pinHash: fixturePinHash("5555"),
            passwordHash: fixturePasswordHash("scripts-fixture-password"),
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
      correctiveSeriesId: venue.seriesIds[2]!,
    };
  } finally {
    await store.close();
  }
}
