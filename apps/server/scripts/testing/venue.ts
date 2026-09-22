// One provisioned venue in a real venue DIRECTORY, for the suites that run the one-shot operator
// scripts (`register-till`, `record-one-sale`, `settle-invoice-first`).
//
// It provisions through the SHIPPING path — `planVenue` + `applyVenue`, the same pair
// `waitron-provision venue` and `dev-setup.ts` use — so the fiscal ids the scripts are handed were
// minted the way a real box mints them, SIF and chain head included. A hand-inserted row would be
// the unverified fixture CLAUDE.md §4 warns about.
//
// It lives under `scripts/testing/` rather than in `src/testing/`: `src/testing/venue-fixtures.ts`
// builds catalogues, devices and management sessions for the HTTP suites, none of which these
// scripts touch.
import { openVenueDatabase } from "@waitron/db";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";

/** The fiscal ids a provisioned venue hands back — the arguments the scripts take. */
export interface TestVenue {
  tillId: string;
  nodeId: string;
  /** The ORDINARY sale series. `planVenue` emits the standard series first. */
  seriesId: string;
  /** The rectificative series, for the correction `settle-invoice-first` issues. */
  rectificativeSeriesId: string;
  locationId: string;
}

/**
 * Provision one preproduction venue into an ALREADY MIGRATED `venueDir`.
 *
 * `taxId` is a parameter because `tenants (country, tax_id)` is unique and `applyVenue` refuses a
 * second taxpayer in one database: a suite provisioning two venues needs two NIFs.
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
