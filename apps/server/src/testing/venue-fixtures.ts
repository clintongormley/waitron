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

// Shared venue provisioning for the device/join-request suites — extracted from device-api.test.ts
// (which had the original) so join-requests.test.ts can stand up the same fixture without
// duplicating it. Neither suite opens a container any more:
// `grep -c 'useRealPostgres\|Testcontainers' apps/server/src/device-api.test.ts
// apps/server/src/join-requests.test.ts` prints 0 for both (run 2026-09-23). Lives under apps/server/src/testing/ (coverage-excluded, per
// vitest.config.ts) alongside fiscal-fixtures.ts, which follows the same pattern.

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

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — a per-module counter. Module state resets per test
// file (vitest's default isolation), so this stays collision-free within one file exactly as it did
// when it lived there directly.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(74_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Stand up a fresh provisioned venue (mode `ticket_then_pay`), seed a two-product catalogue, and mint a
 * manager + staff management session. The venue provisions with the DEFAULT `prepay`; the `order_flow`
 * column is flipped to `ticket_then_pay` (as the owner, fixture setup) so the DB agrees with `cfg`, the
 * way `boot.ts`/`modeVenue` wire them.
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

    // Through the table definition, never a raw insert: `persons.id` and `persons.created_at` are
    // NOT NULL columns whose values come from `$defaultFn` generators
    // (`packages/identity/src/schema/persons.ts`), and a statement reaches no generator — measured
    // here as `NOT NULL constraint failed: persons.id`.
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
      managerSid: managerSession.id,
      staffSid: staffSession.id,
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
