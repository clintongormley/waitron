import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
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
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
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
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  const cfg: TillConfig = {
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
  const seeded = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const { id: tableId } = await createTable(tx, cfg, { label: "T1" });
    const active = await tx.execute<{ id: string }>(
      sql`insert into table_service_statuses (tenant_id, label, color) values (${tenantId}, 'Bill requested', '#ef4444') returning id`,
    );
    const inactive = await tx.execute<{ id: string }>(
      sql`insert into table_service_statuses (tenant_id, label, color, active) values (${tenantId}, 'Retired', '#000', false) returning id`,
    );
    return { tableId, activeStatusId: active.rows[0]!.id, inactiveStatusId: inactive.rows[0]!.id };
  });
  return { cfg, ...seeded };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
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
