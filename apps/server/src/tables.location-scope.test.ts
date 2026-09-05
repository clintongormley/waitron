import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
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

// Real PostgreSQL (a shared-container clone of the CORE template). The location predicate is a plain
// WHERE filter — PGlite would exercise the query logic too — but this is a SECURITY fix, so it is
// proven against the real cluster as the non-superuser app_user, on the same path production takes:
// a same-tenant caller must never reach ANOTHER location's rows.
const suite = useTemplateDb({ template: "core" });
let db: Database;
beforeAll(() => {
  db = suite.admin;
});

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** ONE tenant, TWO venues (locations A and B) — the cross-LOCATION, same-TENANT shape the placement
 *  verbs' own `location_id` predicate is the only guard against. Returns a full TillConfig scoped to
 *  each. */
async function setupTwoVenues(): Promise<{ a: TillConfig; b: TillConfig }> {
  const tenantId = await seedTenant(db);
  const make = async (name: string): Promise<TillConfig> => {
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, ${name}, array[${LOCALE}], 'Venta en establecimiento') returning id`);
    const locationId = loc.rows[0]!.id;
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, ${`${name} Caja`}) returning id`);
    const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
    return {
      tenantId,
      tillId: brandTillId(till.rows[0]!.id),
      nodeId: brandNodeId(nodeId),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      cardProvider: "none",
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
    // Table A is in scope, but zone B is another venue's. The `dining_tables_zone_fk` is (tenant, zone)
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
