/**
 * `seedFloor`: the floor-plan zones, the ~16 placed tables, and the four service statuses.
 *
 * **What went with PostgreSQL.** The seed used to run as `app_user`, so a missing SELECT/INSERT on
 * `floor_zones`/`dining_tables`/`table_service_statuses` would have failed this file. SQLite has no
 * roles, `asAppUser` is an inert function (`packages/db/src/testing/roles.ts`), and every call below
 * runs on the one connection. Nothing now checks who may write the floor plan.
 *
 * `floor_zones.active` is read RAW below, and a raw read reaches no column mapper, so a boolean
 * column arrives as 0 or 1 rather than as `false`/`true`.
 */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { seedFloor } from "./seed-floor.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

const LOCALE: SeedLocale = "en";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// One NIF per provisioned venue. `useVenueDb`'s per-test reset empties every data table, so the
// counter no longer keeps two tests apart; it keeps two `provisionVenue` calls within a test apart.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a fresh chained venue (as the owner) and return the ids the seed needs. */
async function provisionVenue(): Promise<{ locationId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Casa Delgado SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [SEED_INVOICE_LOCALE[LOCALE]],
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
    { db: suite.db, modules: ALL_MODULES },
  );
  return { locationId: venue.locationId };
}

describe("seedFloor", () => {
  it("creates restaurant and deli service zones, the placed restaurant floor, and statuses", async () => {
    const { locationId } = await provisionVenue();

    const res = await withTransaction(suite.db, async (tx) => {
      await seedFloor(tx, { locationId, locale: LOCALE });

      const { rows: zones } = await tx.execute<{ name: string; active: number }>(
        sql`select name, active from floor_zones where location_id = ${locationId} order by display_order`,
      );
      const { rows: tables } = await tx.execute<{
        label: string;
        zone_id: string | null;
        capacity: number | null;
        pos_x: number | null;
        pos_y: number | null;
        shape: string | null;
      }>(
        sql`select label, zone_id, capacity, pos_x, pos_y, shape from dining_tables where location_id = ${locationId} order by label`,
      );
      const { rows: statuses } = await tx.execute<{ label: string; color: string }>(
        sql`select label, color from table_service_statuses order by display_order`,
      );
      return { zones, tables, statuses };
    });

    expect(res.zones.map((z) => z.name)).toEqual([
      "Dining room",
      "Terrace",
      "Downstairs bar",
      "Upstairs bar",
      "Deli counter",
    ]);
    expect(res.zones.every((z) => z.active === 1)).toBe(true);

    // ~16 tables, each placed (a live zone, a capacity, and a full spatial placement).
    expect(res.tables.length).toBe(16);
    for (const table of res.tables) {
      expect(table.zone_id).not.toBeNull();
      expect(table.capacity).not.toBeNull();
      expect(table.pos_x).not.toBeNull();
      expect(table.pos_y).not.toBeNull();
      expect(table.shape).not.toBeNull();
    }

    // Four statuses, in the authored order, each with its own colour.
    expect(res.statuses.map((s) => s.label)).toEqual([
      "Free",
      "Occupied",
      "Reserved",
      "Bill requested",
    ]);
    expect(new Set(res.statuses.map((s) => s.color)).size).toBe(4);
  });
});
