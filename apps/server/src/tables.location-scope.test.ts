import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, tills, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { clearPlacement, createTable, createZone, setTablePlacement } from "./tables.js";
import "./errors.js";

const LOCALE = "es-ES";

// The placement verbs' own `location_id` predicate is the only thing refusing another location's row.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

async function setupTwoVenues(): Promise<{ a: TillConfig; b: TillConfig }> {
  await seedTenant(db);
  const make = async (name: string): Promise<TillConfig> => {
    // Through the table definitions: `locations.id`, `tills.id` and `tills.created_at` are
    // `$defaultFn` generators, which a raw insert does not reach.
    const [location] = await db
      .insert(locations)
      .values({
        name,
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const locationId = location!.id;
    const [till] = await db
      .insert(tills)
      .values({ locationId, name: `${name} Caja` })
      .returning({ id: tills.id });
    const nodeId = await seedNode(db, brandLocationId(locationId));
    return {
      tillId: brandTillId(till!.id),
      nodeId: brandNodeId(nodeId),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      tipsEnabled: false,
      orderFlow: "prepay",
    };
  };
  return { a: await make("Loc A"), b: await make("Loc B") };
}

const P = { posX: 100, posY: 100, shape: "round" as const, rotation: 0 };

describe("placement verbs are LOCATION-scoped (a same-tenant cross-location write is refused)", () => {
  it("setTablePlacement refuses a table that belongs to ANOTHER location of the same tenant", async () => {
    const { a, b } = await setupTwoVenues();
    const { id: tableB } = await asApp(b, (tx) => createTable(tx, b, { label: "B-1" }));
    const { id: zoneB } = await asApp(b, (tx) => createZone(tx, b, { name: "Zona B" }));
    await expect(
      asApp(a, (tx) => setTablePlacement(tx, a, tableB, { zoneId: zoneB, ...P })),
    ).rejects.toMatchObject({ code: "table.not_found", params: { tableId: tableB } });
  });

  it("setTablePlacement refuses a zone that belongs to ANOTHER location of the same tenant", async () => {
    const { a, b } = await setupTwoVenues();
    const { id: tableA } = await asApp(a, (tx) => createTable(tx, a, { label: "A-1" }));
    const { id: zoneB } = await asApp(b, (tx) => createZone(tx, b, { name: "Zona B" }));
    // `dining_tables_zone_fk` cannot see the location, so only the verb's predicate refuses this.
    await expect(
      asApp(a, (tx) => setTablePlacement(tx, a, tableA, { zoneId: zoneB, ...P })),
    ).rejects.toMatchObject({ code: "zone.not_found", params: { zoneId: zoneB } });
  });

  it("clearPlacement refuses a table that belongs to ANOTHER location, leaving its placement intact", async () => {
    const { a, b } = await setupTwoVenues();
    const { id: zoneB } = await asApp(b, (tx) => createZone(tx, b, { name: "Zona B" }));
    const { id: tableB } = await asApp(b, (tx) => createTable(tx, b, { label: "B-1" }));
    // Placed first, so a location-blind clear would find and null it.
    await asApp(b, (tx) => setTablePlacement(tx, b, tableB, { zoneId: zoneB, ...P }));
    await expect(asApp(a, (tx) => clearPlacement(tx, a, tableB))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: tableB },
    });
    const row = await db.execute<{ pos_x: number | null }>(
      sql`select pos_x from dining_tables where id = ${tableB}`,
    );
    expect(row.rows[0]!.pos_x).toBe(P.posX);
  });

  it("a table placed from its OWN location still succeeds (the scope does not over-refuse)", async () => {
    const { a } = await setupTwoVenues();
    const { id: tableA } = await asApp(a, (tx) => createTable(tx, a, { label: "A-1" }));
    const { id: zoneA } = await asApp(a, (tx) => createZone(tx, a, { name: "Zona A" }));
    await asApp(a, (tx) => setTablePlacement(tx, a, tableA, { zoneId: zoneA, ...P }));
    const row = await db.execute<{ pos_x: number | null; zone_id: string | null }>(
      sql`select pos_x, zone_id from dining_tables where id = ${tableA}`,
    );
    expect(row.rows[0]).toMatchObject({ pos_x: P.posX, zone_id: zoneA });
    await asApp(a, (tx) => clearPlacement(tx, a, tableA));
    const cleared = await db.execute<{ pos_x: number | null }>(
      sql`select pos_x from dining_tables where id = ${tableA}`,
    );
    expect(cleared.rows[0]!.pos_x).toBeNull();
  });
});
