/**
 * `seedFloor`: the floor-plan zones, the placed tables, and the service statuses.
 *
 * `floor_zones.active` is read RAW below, and a raw read reaches no column mapper, so a boolean
 * column arrives as 0 or 1.
 */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listSalePolicies } from "@waitron/venue-service";
import { locationId as brandLocationId } from "@waitron/shared";
import { seedFloor } from "./seed-floor.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "en";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 60_000_000,
  invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
});

describe("seedFloor", () => {
  it("leaves every seeded department and service zone with a sale policy for management reads", async () => {
    const { locationId } = await provisionVenue();

    const policies = await withTransaction(suite.db, async (tx) => {
      await seedFloor(tx, { locationId, locale: LOCALE });
      return listSalePolicies(tx, { locationId: brandLocationId(locationId) });
    });

    expect(policies.departments).toHaveLength(2);
    expect(policies.zones).toHaveLength(5);
    expect(policies.zones.map((zone) => zone.effective.paidWhen)).toEqual([
      "prepay",
      "prepay",
      "prepay",
      "prepay",
      "prepay",
    ]);
  });

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

    expect(res.tables.length).toBe(16);
    for (const table of res.tables) {
      expect(table.zone_id).not.toBeNull();
      expect(table.capacity).not.toBeNull();
      expect(table.pos_x).not.toBeNull();
      expect(table.pos_y).not.toBeNull();
      expect(table.shape).not.toBeNull();
    }

    expect(res.statuses.map((s) => s.label)).toEqual(["VIP", "Allergy at this table", "Birthday"]);
    expect(new Set(res.statuses.map((s) => s.color)).size).toBe(3);
  });
});
