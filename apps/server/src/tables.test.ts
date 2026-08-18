import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable, deactivateTable, listTables, updateTable } from "./tables.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(): Promise<TillConfig> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
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
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

describe("table CRUD", () => {
  it("creates a table and lists it (active, by label)", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) =>
      createTable(tx, cfg, { label: "12", zone: "terrace", capacity: 4 }),
    );
    const tables = await asApp(cfg, (tx) => listTables(tx, cfg));
    expect(tables).toEqual([
      expect.objectContaining({ id, label: "12", zone: "terrace", capacity: 4, active: true }),
    ]);
  });

  it("refuses a duplicate label in the same venue (table.label_taken)", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createTable(tx, cfg, { label: "7" }));
    await expect(asApp(cfg, (tx) => createTable(tx, cfg, { label: "7" }))).rejects.toMatchObject({
      code: "table.label_taken",
      params: { label: "7" },
    });
  });

  it("updates a table's fields", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "3" }));
    // All three optional fields supplied, so the patch-builder's label/zone/capacity branches all fire.
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { label: "3A", zone: "bar", capacity: 6 }));
    const [t] = await asApp(cfg, (tx) => listTables(tx, cfg));
    expect(t).toMatchObject({ id, label: "3A", zone: "bar", capacity: 6 });
  });

  it("updateTable throws table.not_found for an unknown id", async () => {
    const cfg = await setupVenue();
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => updateTable(tx, cfg, missing, { label: "X" })),
    ).rejects.toMatchObject({ code: "table.not_found", params: { tableId: missing } });
  });

  it("updateTable surfaces a label collision as table.label_taken", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createTable(tx, cfg, { label: "1" }));
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "2" }));
    await expect(
      asApp(cfg, (tx) => updateTable(tx, cfg, id, { label: "1" })),
    ).rejects.toMatchObject({ code: "table.label_taken", params: { label: "1" } });
  });

  it("deactivate hides the table from the active list, and throws table.not_found on an unknown id", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "9" }));
    await asApp(cfg, (tx) => deactivateTable(tx, cfg, id));
    expect(await asApp(cfg, (tx) => listTables(tx, cfg))).toEqual([]);
    await expect(asApp(cfg, (tx) => deactivateTable(tx, cfg, randomUUID()))).rejects.toMatchObject({
      code: "table.not_found",
    });
  });

  it("createTable rethrows a NON-unique DB error raw, not as table.label_taken", async () => {
    const cfg = await setupVenue();
    // A location id that names no row: the composite (tenant_id, location_id) FK
    // `dining_tables_location_fk` rejects the insert with a 23503 foreign-key violation — NOT the
    // 23505 label unique. So `isUniqueViolation` is false and `createTable` must rethrow the raw
    // driver error rather than mistranslating any failure into `table.label_taken` (the false branch
    // of its catch — the other side of the duplicate-label test's prove-by-deletion).
    const badCfg: TillConfig = { ...cfg, locationId: brandLocationId(randomUUID()) };
    const err = await asApp(cfg, (tx) => createTable(tx, badCfg, { label: "5" })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error); // rejected (a resolved {id} would fail this)
    expect(err).not.toBeInstanceOf(AppError); // a raw driver error, not a domain translation
  });

  it("updateTable rethrows a NON-unique DB error raw, not as table.label_taken", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "6" }));
    // 10_000_000_000 overflows the int4 `capacity` column (22003 numeric_value_out_of_range) — NOT
    // the label unique. So `isUniqueViolation` is false and `updateTable` rethrows the raw driver
    // error rather than mistranslating it (the false branch of its catch).
    const err = await asApp(cfg, (tx) =>
      updateTable(tx, cfg, id, { capacity: 10_000_000_000 }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error); // rejected (a resolved void would fail this)
    expect(err).not.toBeInstanceOf(AppError); // a raw driver error, not a domain translation
  });
});
