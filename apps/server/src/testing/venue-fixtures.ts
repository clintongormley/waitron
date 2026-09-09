import { sql } from "drizzle-orm";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "../modules.js";
import type { TillConfig } from "../till-config.js";

// Shared venue provisioning for the real-Postgres device/join-request suites — extracted from
// device-api.pg.test.ts (which had the original) so join-requests.test.ts can stand up the same
// fixture without duplicating it. Lives under apps/server/src/testing/ (coverage-excluded, per
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
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
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

  const seeded = await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, cfg.tenantId, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, cfg.tenantId, { name: "Bebidas" });
    const cafe = await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, cfg.tenantId, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);

    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${cfg.tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${cfg.tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: cfg.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: cfg.tenantId,
      personId: stf.rows[0]!.id,
    });
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
