import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, locations, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { bookings } from "@waitron/bookings";
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

// The seam between core's read-model and a module's floor annotator: a module cannot import
// apps/server, so it can only be pinned here. The per-table annotator cases live in
// `@waitron/bookings`'s `floor.test.ts`.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const LOCALE = "es-ES";

async function setupVenue(): Promise<TillConfig> {
  await seedTenant(db);
  // Through the table definition: `locations.id` is a NOT NULL `$defaultFn` generator a raw insert
  // never reaches.
  const [location] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
      timeZone: DEFAULT_TIME_ZONE,
    })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const nodeId = await seedNode(db, brandLocationId(locationId));
  return {
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
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

async function insertBooking(cfg: TillConfig, tableId: string, time: string): Promise<void> {
  // Through the table definition for the same reason as the venue row above.
  await asApp(cfg, (tx) =>
    tx.insert(bookings).values({
      locationId: cfg.locationId,
      tableId,
      bookingDate: "2026-09-15",
      bookingTime: time,
      partySize: 2,
      contactName: "Ana",
      createdBy: randomUUID(),
      status: "booked",
    }),
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
    // A descriptor whose `floorAnnotations` seat is OMITTED: the badge flows ONLY through the seat, so
    // the booked row never reaches the floor.
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
