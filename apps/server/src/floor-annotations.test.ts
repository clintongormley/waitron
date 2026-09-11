import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { listTablesWithState } from "./working-order.js";
import { ALL_MODULES, enabledFloorAnnotators } from "./modules.js";
import "./errors.js";

// The MERGE (does `listTablesWithState` surface a booked row's time through the floor-annotator seat?)
// and the deletion proof (a descriptor with `floorAnnotations` omitted yields no badge) live in
// apps/server — a module cannot import apps/server, so the SEAM they exercise (core's read-model calling
// the module's annotator) can only be pinned here. The pure per-table annotator scenarios live in
// `@waitron/bookings`'s `floor.test.ts`. PGlite is enough: a correlated read, no privilege/concurrency.
const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const LOCALE = "es-ES";

async function setupVenue(): Promise<TillConfig> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description, time_zone)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento', ${DEFAULT_TIME_ZONE}) returning id`);
  const locationId = loc.rows[0]!.id;
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  return {
    tenantId,
    tillId: brandTillId(randomUUID()),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
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

async function insertBooking(cfg: TillConfig, tableId: string, time: string): Promise<void> {
  await asApp(cfg, (tx) =>
    tx.execute(sql`
      insert into bookings
        (tenant_id, location_id, table_id, booking_date, booking_time, party_size, contact_name, created_by, status)
      values
        (${cfg.tenantId}, ${cfg.locationId}, ${tableId}, '2026-09-15', ${time}, 2, 'Ana', ${randomUUID()}, 'booked')`),
  );
}

// 2026-09-15T10:00:00Z → Madrid (CEST) 12:00 on 2026-09-15, so a 14:00 booking is imminent today.
const MADRID_NOON = new Date("2026-09-15T10:00:00Z");

describe("listTablesWithState — floor-annotator merge", () => {
  it("surfaces a table's imminent booked reservation through the bookings floor annotator", async () => {
    const cfg = await setupVenue();
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "7" }));
    await insertBooking(cfg, tableId, "14:00");

    // The REAL enabled-set annotators (bookings among them) — the exact assembly boot passes.
    const annotators = enabledFloorAnnotators(ALL_MODULES);
    const row = (
      await asApp(cfg, (tx) => listTablesWithState(tx, cfg, annotators, undefined, MADRID_NOON))
    ).find((t) => t.id === tableId)!;
    expect(row.nextReservation).toEqual({ time: "14:00" });
  });

  it("returns nextReservation null with NO annotators, even for a table with a booked row (deletion proof)", async () => {
    // Modelling a descriptor whose `floorAnnotations` seat is OMITTED: `enabledFloorAnnotators` yields
    // nothing, so the merge runs over an empty set and the booked row never reaches the floor. Proves the
    // badge flows ONLY through the seat — no residual reserved read left in core's query.
    const cfg = await setupVenue();
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "8" }));
    await insertBooking(cfg, tableId, "14:00");

    const withoutSeat = ALL_MODULES.map((m) => ({ ...m, floorAnnotations: undefined }));
    const annotators = enabledFloorAnnotators(withoutSeat);
    expect(annotators).toHaveLength(0);

    const row = (
      await asApp(cfg, (tx) => listTablesWithState(tx, cfg, annotators, undefined, MADRID_NOON))
    ).find((t) => t.id === tableId)!;
    expect(row.nextReservation).toBeNull();
  });
});
