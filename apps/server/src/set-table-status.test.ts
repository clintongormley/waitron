import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locations, tableServiceStatuses, tills, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable, setTableStatus } from "./tables.js";
import { listTablesWithState, openTab } from "./working-order.js";
import "./errors.js";

const LOCALE = "es-ES";
// The whole manifest (`manifestSets()`), applied in order — the tables here belong to modules (e.g.
// bookings) that FK into core, so the shared ordered set is the fixture.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  tableId: string;
  activeStatusId: string;
  inactiveStatusId: string;
}

async function setupVenue(): Promise<Seeded> {
  await seedTenant(db);
  // Inserted through the table definitions, the change `apps/server/src/testing/fiscal-fixtures.ts`
  // took: `locations.id`, `tills.id` and `tills.created_at` are `$defaultFn` generators on this
  // engine and a raw insert reaches none of them (all three columns are NOT NULL —
  // `packages/db/drizzle/0000_baseline.sql:2` and `:40`), and `invoice_locales` is a JSON array in
  // a text column, which is what refused the `array[...]` constructor that used to fill it
  // (`near "['es-ES']": syntax error`).
  const [location] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(db, async (tx) => {
    const { id: tableId } = await createTable(tx, cfg, { label: "T1" });
    // Through the table definition for the same reason as the venue rows above:
    // `table_service_statuses.id` and `.created_at` are `$defaultFn` generators and both columns are
    // NOT NULL (`packages/db/drizzle/0000_baseline.sql:517` and `:522`).
    const [active] = await tx
      .insert(tableServiceStatuses)
      .values({ label: "Bill requested", color: "#ef4444" })
      .returning({ id: tableServiceStatuses.id });
    const [inactive] = await tx
      .insert(tableServiceStatuses)
      .values({ label: "Retired", color: "#000", active: false })
      .returning({ id: tableServiceStatuses.id });
    return { tableId, activeStatusId: active!.id, inactiveStatusId: inactive!.id };
  });
  return { cfg, ...seeded };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

async function statusOf(tableId: string): Promise<string | null> {
  const { rows } = await db.execute<{ status_id: string | null }>(
    sql`select status_id from dining_tables where id = ${tableId}`,
  );
  return rows[0]!.status_id;
}

describe("setTableStatus", () => {
  it("sets a table's manual status, then clears it with null", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    expect(await statusOf(tableId)).toBe(activeStatusId);
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, null));
    expect(await statusOf(tableId)).toBeNull();
  });

  it("sets a status on a FREE table (occupancy-independent — the status shows regardless)", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    // No tab open — the table is free. A needs-cleaning-style status still applies.
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    expect(await statusOf(tableId)).toBe(activeStatusId);
  });

  it("refuses a deactivated status (status.inactive)", async () => {
    const { cfg, tableId, inactiveStatusId } = await setupVenue();
    await expect(
      asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, inactiveStatusId)),
    ).rejects.toMatchObject({
      code: "status.inactive",
      params: { statusId: inactiveStatusId },
    });
  });

  it("refuses an unknown status (status.not_found)", async () => {
    const { cfg, tableId } = await setupVenue();
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, missing)),
    ).rejects.toMatchObject({
      code: "status.not_found",
      params: { statusId: missing },
    });
  });

  it("refuses an unknown or deactivated table (table.not_found)", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => setTableStatus(tx, cfg, missing, activeStatusId)),
    ).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: missing },
    });
    // A deactivated table is not in service — also table.not_found (design §3b lists table.not_found).
    await db.execute(sql`update dining_tables set active = false where id = ${tableId}`);
    await expect(
      asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId)),
    ).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId },
    });
  });
});

describe("listTablesWithState folds in the manual status", () => {
  it("returns status: { id, label, color } for a table with a status set, null otherwise", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();

    const before = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(before.find((t) => t.id === tableId)).toMatchObject({ state: "free", status: null });

    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    const after = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    // A FREE table still shows its manual status — occupancy and status are independent (design §4).
    expect(after.find((t) => t.id === tableId)).toMatchObject({
      state: "free",
      status: { id: activeStatusId, label: "Bill requested", color: "#ef4444" },
    });
  });

  it("still shows a status deactivated AFTER it was set (the LEFT JOIN keys on id, not `active`)", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    // Set the status while it is active — setTableStatus refuses an inactive one — then deactivate it.
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    await db.execute(
      sql`update table_service_statuses set active = false where id = ${activeStatusId}`,
    );
    // Nothing clears `status_id` on deactivation (the editor can reactivate a deactivated status), so the
    // table still carries it and the read reflects the STORED status regardless of its current `active`
    // flag — the join keys on id only (brief Step 3), it has no `active` predicate.
    const rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(rows.find((t) => t.id === tableId)).toMatchObject({
      state: "free",
      status: { id: activeStatusId, label: "Bill requested", color: "#ef4444" },
    });
  });
});

describe("openTab clears a stale status (design §3b(2))", () => {
  it("a status set while the table is free is cleared when the next party opens a tab", async () => {
    const { cfg, tableId, activeStatusId } = await setupVenue();
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId, activeStatusId));
    expect(await statusOf(tableId)).toBe(activeStatusId);
    // Opening an EMPTY tab (no initial round) needs no product — it just anchors the tab to the table
    // and (TS-2's Step 3 edit) clears any stale manual status.
    await asApp(cfg, (tx) => openTab(tx, cfg, { tableId }));
    expect(await statusOf(tableId)).toBeNull();
  });
});
