import { sql } from "drizzle-orm";
import { withTransaction, type Database } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "../modules.js";
import type { TillConfig } from "../till-config.js";

// Shared venue provisioning, extracted so the suites that need it stand up one fixture rather than
// each keeping a copy.

const LOCALE = "es-ES";

export interface Venue {
  cfg: TillConfig;
  /** The location's provisioned default kitchen station — where `placeOrder` fires items, and the
   *  station the KDS device below binds to. */
  defaultStationId: string;
  cafeId: string;
  aguaId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `device.manage`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    // ticket_then_pay so `placeOrder` FIRES the lines to the kitchen (open → placed) without filing a
    // fiscal doc — the lightest fire path that puts real ticket items on the station queue.
    orderFlow: "ticket_then_pay",
  };
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(74_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * A provisioned venue in `ticket_then_pay`, a two-product catalogue, and a manager and a staff
 * management session. The venue provisions as `prepay`, so `order_flow` is flipped to agree with
 * `cfg`.
 */
export async function setupVenue(db: Database): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
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
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          firstNames: "Test",
          lastNames: "Operator",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  await db.execute(
    sql`update locations set order_flow = 'ticket_then_pay' where id = ${cfg.locationId}`,
  );

  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);

    const [mgr] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    const managerSession = await startManagementSession(tx, { personId: mgr!.id });
    const staffSession = await startManagementSession(tx, { personId: stf!.id });
    return {
      cafeId: cafe.id,
      aguaId: agua.id,
      managerSid: managerSession.token,
      staffSid: staffSession.token,
    };
  });

  const { rows } = await db.execute<{ id: string }>(sql`
    select id from kitchen_stations where location_id = ${cfg.locationId} and is_default and active`);

  return {
    cfg,
    defaultStationId: rows[0]!.id,
    cafeId: seeded.cafeId,
    aguaId: seeded.aguaId,
    managerCookie: `${MANAGEMENT_COOKIE}=${seeded.managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${seeded.staffSid}`,
  };
}
