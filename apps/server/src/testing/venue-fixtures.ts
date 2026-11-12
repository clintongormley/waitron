import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { sql } from "drizzle-orm";
import { withTransaction, type Database, venueLocationId } from "@waitron/db";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { persons, startManagementSession } from "@waitron/identity";
import { planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { jobOrigin, nodeId as brandNodeId, seriesId as brandSeriesId } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "../modules.js";
import type { OriginConfig } from "../trading-context.js";
import type { WithVenueRowId } from "./venue-row-id.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { fixturePasswordHash, fixturePinHash } from "./known-secret-hashes.js";

// Shared venue provisioning, extracted so the suites that need it stand up one fixture rather than
// each keeping a copy.

const LOCALE = "es-ES";

export interface Venue {
  seriesId: ReturnType<typeof brandSeriesId>;
  /** Orders a test opens directly come from the dashboard, so no device is seeded for them. */
  cfg: WithVenueRowId<OriginConfig>;
  /** The venue's provisioned default kitchen station — where `placeOrder` fires items, and the
   *  station the KDS device below binds to. */
  defaultStationId: string;
  coffeeId: string;
  waterId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `hardware.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds none of the management
   * permissions the gates check). */
  staffCookie: string;
}

function tillConfigFromVenue(venue: VenueResult, venueId: string): WithVenueRowId<OriginConfig> {
  return {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(venue.nodeId),
    locationId: venueId,
    locale: LOCALE,
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
    // ticket_then_pay so `placeOrder` FIRES the lines to the kitchen (open → placed) without filing a
    // fiscal doc — the lightest fire path that puts real ticket items on the station queue.
  };
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(74_000_000 + nifCounter);
}

/**
 * A provisioned venue in `ticket_then_pay`, a two-product catalogue, and a manager and a staff
 * management session.
 */
export async function setupVenue(db: Database): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        name: "Main room",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administrator",
          firstNames: "Test",
          lastNames: "Operator",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );

  const venueId = await venueLocationId(db);
  const cfg = tillConfigFromVenue(venue, venueId);

  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: `Delicatessen ${venueId}` });
    const drinks = await createCategory(tx, { name: "Drinks" });
    const coffee = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const water = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Water",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToVenue(tx, cat.id);

    const [mgr] = await seedPersons(tx, {
      displayName: "The Manager",
      pinHash: fixturePinHash("1234"),
      role: "manager",
    });
    const [stf] = await seedPersons(tx, {
      displayName: "The Clerk",
      pinHash: fixturePinHash("1234"),
      role: "staff",
    });
    const managerSession = await startManagementSession(tx, { personId: mgr!.id });
    const staffSession = await startManagementSession(tx, { personId: stf!.id });
    return {
      coffeeId: coffee.id,
      waterId: water.id,
      managerSid: managerSession.token,
      staffSid: staffSession.token,
    };
  });

  const { rows } = await db.execute<{ id: string }>(sql`
    select id from kitchen_stations where is_default and active`);

  return {
    cfg,
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    defaultStationId: rows[0]!.id,
    coffeeId: seeded.coffeeId,
    waterId: seeded.waterId,
    managerCookie: `${MANAGEMENT_COOKIE}=${seeded.managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${seeded.staffSid}`,
  };
}
