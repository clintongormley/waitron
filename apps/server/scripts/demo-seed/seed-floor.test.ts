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
import { listAvailableProducts } from "@waitron/catalogue";
import { listSalePolicies, resolveMakers } from "@waitron/venue-service";
import { locationId as brandLocationId } from "@waitron/shared";
import { readZonePlan } from "../../src/floor-plan.js";
import type { Placement } from "../../src/floor-reset-plan.js";
import { createTable } from "../../src/tables.js";
import type { TillConfig } from "../../src/till-config.js";
import { DEMO_TABLES } from "./floor.js";
import { seedFloor } from "./seed-floor.js";
import { seedCatalogues } from "./seed-catalogue.js";
import { CASA_DELGADO_ES } from "./data-sets/casa-delgado-es.js";

import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";
import { createDemoVenueProvisioner } from "./testing/provision-venue.js";

const LOCALE: SeedLocale = "en";
const TRADING_NAMES = { restaurant: "Front Bar", deli: "Back Deli" };

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const provisionVenue = createDemoVenueProvisioner(() => suite.db, {
  nifBase: 60_000_000,
  invoiceLocale: SEED_INVOICE_LOCALE[LOCALE],
});

describe("seedFloor", () => {
  it("seeds no station hours and routes drinks downstairs without an evening period", async () => {
    const { locationId } = await provisionVenue();
    const result = await withTransaction(suite.db, async (tx) => {
      const { menuIds } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      await seedFloor(tx, {
        locationId,
        locale: LOCALE,
        departmentTradingNames: TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
        menuIds,
      });
      const { rows: hours } = await tx.execute(sql`
        select c.id from hours_week_cells c
        join kitchen_stations s on s.id = c.station_id
        where s.location_id = ${locationId}`);
      const { rows: periods } = await tx.execute<{ name: string }>(sql`
        select p.name from menu_periods p join departments d on d.id = p.department_id
        where d.location_id = ${locationId} order by d.name`);
      const { rows: zones } = await tx.execute<{ id: string }>(sql`
        select id from floor_zones where location_id = ${locationId} and name = 'Upstairs bar'`);
      const { rows: stations } = await tx.execute<{ id: string }>(sql`
        select id from kitchen_stations where location_id = ${locationId} and name = 'Downstairs bar'`);
      const { products } = await listAvailableProducts(tx, locationId);
      const drink = products.find((product) => product.name === "Negroni")!;
      const makers = [];
      for (const instant of ["2026-10-02T18:00:00Z", "2026-10-06T18:00:00Z"]) {
        makers.push(
          await resolveMakers(
            tx,
            { locationId: brandLocationId(locationId) },
            zones[0]!.id,
            [drink.id],
            new Date(instant),
          ),
        );
      }
      return { hours, periods, makers, stationId: stations[0]!.id, productId: drink.id };
    });
    expect.soft(result.hours).toEqual([]);
    expect(result.periods).toEqual([{ name: "Open" }, { name: "Open" }]);
    expect(result.makers).toEqual(
      [0, 1].map(
        () =>
          new Map([
            [
              result.productId,
              { kind: "made", route: { kind: "station", stationId: result.stationId } },
            ],
          ]),
      ),
    );
  });

  it("seeds no configured station fallback", async () => {
    const { locationId } = await provisionVenue();
    const rows = await withTransaction(suite.db, async (tx) => {
      const { menuIds } = await seedCatalogues(tx, {
        locationId,
        locale: LOCALE,
        dataSet: CASA_DELGADO_ES,
      });
      await seedFloor(tx, {
        locationId,
        locale: LOCALE,
        departmentTradingNames: TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
        menuIds,
      });
      return (
        await tx.execute(sql`select fallback.station_id, fallback.fallback_station_id
        from station_fallbacks fallback
        inner join kitchen_stations station on station.id = fallback.station_id
        where station.location_id = ${locationId}`)
      ).rows;
    });
    expect(rows).toEqual([]);
  });

  it("leaves every seeded department and service zone with a sale policy for management reads", async () => {
    const { locationId } = await provisionVenue();

    const policies = await withTransaction(suite.db, async (tx) => {
      await seedFloor(tx, {
        locationId,
        locale: LOCALE,
        departmentTradingNames: TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
      });
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
      await seedFloor(tx, {
        locationId,
        locale: LOCALE,
        departmentTradingNames: TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
      });

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

  it("gives every zone with tables a saved master plan and today's plan, every table placed and none overlapping", async () => {
    const { locationId } = await provisionVenue();
    const cfg = {
      nodeId: "unused",
      seriesId: "unused",
      locationId: brandLocationId(locationId),
    } as unknown as Parameters<typeof readZonePlan>[1];

    const res = await withTransaction(suite.db, async (tx) => {
      await seedFloor(tx, {
        locationId,
        locale: LOCALE,
        departmentTradingNames: TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
      });
      const { rows: zones } = await tx.execute<{ zone_id: string }>(
        sql`select distinct zone_id from dining_tables where location_id = ${locationId}`,
      );
      const plans = [];
      for (const { zone_id } of zones) plans.push(await readZonePlan(tx, cfg, zone_id));
      const { rows: today } = await tx.execute<{
        label: string;
        zone_id: string;
        fixed: number;
        x: number | null;
        y: number | null;
        width: number | null;
        height: number | null;
        shape: string | null;
        rotation: number | null;
      }>(
        sql`select d.label, d.zone_id, t.fixed, t.x, t.y, t.width, t.height, t.shape, t.rotation
            from dining_tables d join floor_today_tables t on t.table_id = d.id
            where d.location_id = ${locationId}`,
      );
      const { rows: todayZones } = await tx.execute<{ zone_id: string }>(
        sql`select zone_id from floor_today_zones`,
      );
      return { plans, today, todayZones };
    });

    // A table turns about its centre, so its footprint is the box around the turned rectangle.
    const footprint = ({ x, y, width, height, rotation }: Placement) => {
      const turn = (rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(turn));
      const sin = Math.abs(Math.sin(turn));
      const halfWidth = (width * cos + height * sin) / 2;
      const halfHeight = (width * sin + height * cos) / 2;
      const cx = x + width / 2;
      const cy = y + height / 2;
      return {
        left: cx - halfWidth,
        right: cx + halfWidth,
        top: cy - halfHeight,
        bottom: cy + halfHeight,
      };
    };
    const overlapping = (rects: { label: string; placement: Placement }[]): string[] => {
      const pairs: string[] = [];
      for (const [i, a] of rects.entries()) {
        for (const b of rects.slice(i + 1)) {
          const p = footprint(a.placement);
          const q = footprint(b.placement);
          if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom)
            pairs.push(`${a.label}/${b.label}`);
        }
      }
      return pairs;
    };

    expect(res.plans).toHaveLength(3);
    expect(res.todayZones.map((z) => z.zone_id).sort()).toEqual(
      res.plans.map((p) => p.zoneId).sort(),
    );
    expect(res.plans.flatMap((p) => p.tables)).toHaveLength(16);
    expect(res.today).toHaveLength(16);
    for (const plan of res.plans) {
      expect(plan.revision).toBeGreaterThanOrEqual(1);
      for (const table of plan.tables) {
        expect(table.id).not.toBeNull();
        expect(table.liveTableId).not.toBeNull();
        expect(table.placement).not.toBeNull();
        expect(table.fixed).toBe(table.label.startsWith("B"));
      }
      const placed = plan.tables.map((t) => ({ label: t.label, placement: t.placement! }));
      expect(overlapping(placed)).toEqual([]);
      const todays = res.today
        .filter((t) => t.zone_id === plan.zoneId)
        .map((t) => ({ label: t.label, placement: t as unknown as Placement }));
      expect(overlapping(todays)).toEqual([]);
    }
    for (const t of res.today) {
      expect([t.x, t.y, t.width, t.height, t.shape, t.rotation]).not.toContain(null);
      expect(t.fixed).toBe(t.label.startsWith("B") ? 1 : 0);
    }
    const bar = res.plans.flatMap((p) => p.tables).filter((t) => t.label.startsWith("B"));
    expect(bar.map((t) => t.placement)).toEqual([
      { x: 17, y: 59, width: 2, height: 2, shape: "round", rotation: 0 },
      { x: 53, y: 59, width: 2, height: 2, shape: "round", rotation: 0 },
      { x: 89, y: 59, width: 2, height: 2, shape: "round", rotation: 0 },
    ]);
  });

  it("sizes a table by how many it seats, and draws only a round table round", () => {
    const placementOf = (label: string) => DEMO_TABLES.find((t) => t.label === label)!;
    expect([placementOf("1"), placementOf("3"), placementOf("7"), placementOf("8")]).toMatchObject([
      { capacity: 2, shape: "round", placement: { width: 6, height: 6, shape: "round" } },
      { capacity: 4, shape: "square", placement: { width: 8, height: 8, shape: "rect" } },
      { capacity: 6, shape: "rect", placement: { width: 10, height: 8, shape: "rect" } },
      { capacity: 8, shape: "rect", placement: { width: 14, height: 8, shape: "rect" } },
    ]);
  });

  it("refuses, naming it, a table in a seeded zone that the seed did not create", async () => {
    const { locationId } = await provisionVenue();
    const seeding = withTransaction(suite.db, async (tx) => {
      const { rows } = await tx.execute<{ zone_id: string }>(
        sql`select zone_id from zone_service_policies
            where location_id = ${locationId} and is_counter_default limit 1`,
      );
      await createTable(tx, { locationId: brandLocationId(locationId) } as TillConfig, {
        label: "Stray",
        zoneId: rows[0]!.zone_id,
      });
      await seedFloor(tx, {
        locationId,
        locale: LOCALE,
        departmentTradingNames: TRADING_NAMES,
        dataSet: CASA_DELGADO_ES,
      });
    });
    await expect(seeding).rejects.toThrow(/"Stray"/);
  });

  it.each(["en", "es"] as const)(
    "gives the departments the trading names it is handed, whatever the seed language (%s)",
    async (locale) => {
      const { locationId } = await provisionVenue();

      const rows = await withTransaction(suite.db, async (tx) => {
        await seedFloor(tx, {
          locationId,
          locale,
          departmentTradingNames: TRADING_NAMES,
          dataSet: CASA_DELGADO_ES,
        });
        const { rows } = await tx.execute<{ name: string; trading_name: string }>(
          sql`select d.name, d.trading_name from departments d
              join department_sale_policies p on p.department_id = d.id
              where d.location_id = ${locationId} order by p.order_start desc`,
        );
        return rows;
      });

      expect(rows).toEqual(
        locale === "en"
          ? [
              { name: "Restaurant and bar", trading_name: "Front Bar" },
              { name: "Deli", trading_name: "Back Deli" },
            ]
          : [
              { name: "Restaurante y bar", trading_name: "Front Bar" },
              { name: "Charcutería", trading_name: "Back Deli" },
            ],
      );
    },
  );
});
