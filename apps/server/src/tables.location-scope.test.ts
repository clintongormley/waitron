import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, CORE_MIGRATIONS, locations, tills, withTransaction } from "@waitron/db";
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

/**
 * The placement verbs' location predicate, on the engine the box now runs.
 *
 * ## The half this file used to carry and does not any more
 *
 * It ran against a real PostgreSQL cluster as `app_user`, a non-superuser LOGIN role, because the
 * subject is a security fix and the old header argued a security claim wants the production role.
 * **That role is gone and is replaced by nothing**: SQLite has no roles, `RealPostgres.connectAs`
 * has no counterpart, and `asAppUser` is an empty function body
 * (`packages/db/src/testing/roles.ts:25`). Every call below now runs on the one connection the
 * venue file admits. The `asAppUser(tx)` calls are kept rather than picked out one file at a time,
 * because the branch sweeps them together; they separate nothing today.
 *
 * **Nothing in the four cases below depended on the role.** What each one asserts is that a verb's
 * own `location_id` predicate refuses a row belonging to another location of the SAME tenant, and
 * that predicate is a `where` clause in `./tables.ts` that runs identically whoever is connected.
 * Measured 2026-09-22: all four pass here, and the negative control in the fourth case (a
 * same-location place and clear, which must NOT be refused) still passes too.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** ONE tenant, TWO venues (locations A and B) — the cross-LOCATION, same-TENANT shape the placement
 *  verbs' own `location_id` predicate is the only guard against. Returns a full TillConfig scoped to
 *  each. */
async function setupTwoVenues(): Promise<{ a: TillConfig; b: TillConfig }> {
  await seedTenant(db);
  const make = async (name: string): Promise<TillConfig> => {
    // Inserted through the table definitions, the change `apps/server/src/testing/fiscal-fixtures.ts`
    // took: `locations.id`, `tills.id` and `tills.created_at` are `$defaultFn` generators on this
    // engine and a raw insert reaches none of them (all three columns are NOT NULL —
    // `packages/db/drizzle/0000_baseline.sql:2` and `:40`), and `invoice_locales` is a JSON array in
    // a text column, which is what refused the `array[...]` constructor that used to fill it
    // (`near "['es-ES']": syntax error`).
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
    // A live table + a live zone, both in venue B.
    const { id: tableB } = await asApp(b, (tx) => createTable(tx, b, { label: "B-1" }));
    const { id: zoneB } = await asApp(b, (tx) => createZone(tx, b, { name: "Zona B" }));
    // Called with venue A's cfg, table B is out of scope → table.not_found, never a silent write.
    await expect(
      asApp(a, (tx) => setTablePlacement(tx, a, tableB, { zoneId: zoneB, ...P })),
    ).rejects.toMatchObject({ code: "table.not_found", params: { tableId: tableB } });
  });

  it("setTablePlacement refuses a zone that belongs to ANOTHER location of the same tenant", async () => {
    const { a, b } = await setupTwoVenues();
    const { id: tableA } = await asApp(a, (tx) => createTable(tx, a, { label: "A-1" }));
    const { id: zoneB } = await asApp(b, (tx) => createZone(tx, b, { name: "Zona B" }));
    // Table A is in scope, but zone B is another venue's. The `dining_tables_zone_fk` is (zone)
    // only, so without the explicit location predicate the cross-location zone would be accepted.
    await expect(
      asApp(a, (tx) => setTablePlacement(tx, a, tableA, { zoneId: zoneB, ...P })),
    ).rejects.toMatchObject({ code: "zone.not_found", params: { zoneId: zoneB } });
  });

  it("clearPlacement refuses a table that belongs to ANOTHER location, leaving its placement intact", async () => {
    const { a, b } = await setupTwoVenues();
    const { id: zoneB } = await asApp(b, (tx) => createZone(tx, b, { name: "Zona B" }));
    const { id: tableB } = await asApp(b, (tx) => createTable(tx, b, { label: "B-1" }));
    // Place it legitimately from venue B first, so a location-BLIND clear WOULD find and null it.
    await asApp(b, (tx) => setTablePlacement(tx, b, tableB, { zoneId: zoneB, ...P }));
    // Clearing it with venue A's cfg must be refused (table out of scope) → table.not_found.
    await expect(asApp(a, (tx) => clearPlacement(tx, a, tableB))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: tableB },
    });
    // …and the placement is STILL there — the cross-location clear did not null the four columns.
    const row = await db.execute<{ pos_x: number | null }>(
      sql`select pos_x from dining_tables where id = ${tableB}`,
    );
    expect(row.rows[0]!.pos_x).toBe(P.posX);
  });

  it("a table placed from its OWN location still succeeds (the scope does not over-refuse)", async () => {
    // The positive control: with the location predicate in place, an in-scope place still works — the
    // fix refuses the cross-location write without breaking the legitimate same-location one.
    const { a } = await setupTwoVenues();
    const { id: tableA } = await asApp(a, (tx) => createTable(tx, a, { label: "A-1" }));
    const { id: zoneA } = await asApp(a, (tx) => createZone(tx, a, { name: "Zona A" }));
    await asApp(a, (tx) => setTablePlacement(tx, a, tableA, { zoneId: zoneA, ...P }));
    const row = await db.execute<{ pos_x: number | null; zone_id: string | null }>(
      sql`select pos_x, zone_id from dining_tables where id = ${tableA}`,
    );
    expect(row.rows[0]).toMatchObject({ pos_x: P.posX, zone_id: zoneA });
    // And clearing it from its own location works too.
    await asApp(a, (tx) => clearPlacement(tx, a, tableA));
    const cleared = await db.execute<{ pos_x: number | null }>(
      sql`select pos_x from dining_tables where id = ${tableA}`,
    );
    expect(cleared.rows[0]!.pos_x).toBeNull();
  });
});
