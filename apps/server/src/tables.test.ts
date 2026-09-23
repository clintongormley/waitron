import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  locations,
  nowIso,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import {
  clearPlacement,
  createTable,
  createZone,
  deactivateTable,
  deactivateZone,
  listTables,
  listZones,
  setTablePlacement,
  updateTable,
  updateZone,
} from "./tables.js";
import {
  advanceTicketItem,
  fireLines,
  listTablesWithState,
  markLineServed,
  openTab,
} from "./working-order.js";
import "./errors.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";

const LOCALE = "es-ES";

/**
 * An ISO stamp `minutes` before the reading this call takes, for a `tsString` column — what
 * `now() - interval '<n> minutes'` wrote before the engine changed (SQLite has neither function nor
 * interval type).
 *
 * The clock read here is the FIXTURE's, taken a few milliseconds before the read under test takes
 * its own (`listTablesWithState` calls `Date.now()` once per call, `working-order.ts:4720`), so the
 * age the read measures is `minutes` PLUS whatever the suite spent in between. That direction is
 * the safe one for every case below, which sit inside a band rather than on its edge: 12 minutes is
 * between the seeded station's `overdue` 10 and `forgotten` 15, and 16 is past 15 with no upper
 * bound above it. PostgreSQL's `now()` was transaction time and had the same property, one
 * transaction earlier.
 */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// The whole manifest, not [core]: the tables here belong to several modules that FK into core, and
// `manifestSets()` is that whole ordered set.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(opts: { timeZone?: string } = {}): Promise<TillConfig> {
  await seedTenant(db);
  // Default the location's time_zone from the schema default (Europe/Madrid) unless a test pins one —
  // the reserved-on-floor read derives venue-local "today"/"now" from this column (design §2b/§4).
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
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
      timeZone,
    })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
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
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

describe("table CRUD", () => {
  it("creates a table WITH a zone and lists it (active, by label)", async () => {
    const cfg = await setupVenue();
    // A table with a zone now points at a real `floor_zones` row (the FK), not a free-text string.
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terraza" }));
    const { id } = await asApp(cfg, (tx) =>
      createTable(tx, cfg, { label: "12", zoneId, capacity: 4 }),
    );
    const tables = await asApp(cfg, (tx) => listTables(tx, cfg));
    // A freshly-created (unplaced) table carries the four FP-2 placement columns as null — listTables
    // now PROJECTS them (Task 7b), so the dashboard editor no longer loses a placement on reload.
    expect(tables).toEqual([
      expect.objectContaining({
        id,
        label: "12",
        zoneId,
        capacity: 4,
        active: true,
        posX: null,
        posY: null,
        shape: null,
        rotation: null,
      }),
    ]);
  });

  it("listTables projects the FP-2 placement columns — place a table, then read them back", async () => {
    // The place-then-read receipt (CLAUDE.md §1): a null-only assertion proves nothing about the
    // projection, so PLACE the table and read the exact values back through listTables. Sibling at the
    // "table placement" describe below proves the same for `listTablesWithState` (the till surface).
    const cfg = await setupVenue();
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Comedor" }));
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "4", capacity: 4 }));
    await asApp(cfg, (tx) =>
      setTablePlacement(tx, cfg, id, {
        zoneId,
        posX: 500,
        posY: 250,
        shape: "square",
        rotation: 15,
      }),
    );
    const placed = (await asApp(cfg, (tx) => listTables(tx, cfg))).find((t) => t.id === id)!;
    expect(placed).toMatchObject({ posX: 500, posY: 250, shape: "square", rotation: 15, zoneId });
  });

  it("creates a table WITHOUT a zone (zoneId null)", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "no-zone" }));
    const [t] = await asApp(cfg, (tx) => listTables(tx, cfg));
    expect(t).toMatchObject({ id, label: "no-zone", zoneId: null });
  });

  it("createTable with an unknown zoneId throws zone.not_found (the zone FK, not table.label_taken)", async () => {
    const cfg = await setupVenue();
    const zoneId = randomUUID();
    await expect(
      asApp(cfg, (tx) => createTable(tx, cfg, { label: "orphan", zoneId })),
    ).rejects.toMatchObject({ code: "zone.not_found", params: { zoneId } });
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
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Barra" }));
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "3" }));
    // All three optional fields supplied, so the patch-builder's label/zoneId/capacity branches all fire.
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { label: "3A", zoneId, capacity: 6 }));
    const [t] = await asApp(cfg, (tx) => listTables(tx, cfg));
    expect(t).toMatchObject({ id, label: "3A", zoneId, capacity: 6 });
  });

  it("updateTable with an unknown zoneId throws zone.not_found (the zone FK, not table.label_taken)", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "u" }));
    const zoneId = randomUUID();
    await expect(asApp(cfg, (tx) => updateTable(tx, cfg, id, { zoneId }))).rejects.toMatchObject({
      code: "zone.not_found",
      params: { zoneId },
    });
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
    // A location id that names no row: the (location_id) FK `dining_tables_location_fk` refuses the
    // insert — NOT the label unique. So `isUniqueViolation` is false and `createTable` must rethrow
    // the raw driver error rather than mistranslating any failure into `table.label_taken` (the
    // false branch of its catch). The engine's message is `FOREIGN KEY constraint failed` and names
    // neither table nor column, which is why nothing here asks WHICH key refused.
    const badCfg: TillConfig = { ...cfg, locationId: brandLocationId(randomUUID()) };
    const err = await asApp(cfg, (tx) => createTable(tx, badCfg, { label: "5" })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error); // rejected (a resolved {id} would fail this)
    expect(err).not.toBeInstanceOf(AppError); // a raw driver error, not a domain translation
  });

  it("updateTable rethrows a NON-unique DB error raw, not as table.label_taken", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "5" }));
    // None of updateTable's inputs can make the UPDATE refuse except on the label unique, so a
    // temporary trigger supplies the other kind of refusal.
    await db.execute(sql`
      create trigger dining_tables_refuse_update before update on dining_tables
      begin select raise(abort, 'table update refused'); end`);
    try {
      const err = await asApp(cfg, (tx) => updateTable(tx, cfg, id, { label: "6" })).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AppError);
      expect(String(err)).toMatch(/table update refused/);
    } finally {
      await db.execute(sql`drop trigger dining_tables_refuse_update`);
    }
  });
});

describe("zone CRUD", () => {
  it("creates, lists (ordered by display_order, active-only), renames, deactivates a zone", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) =>
      createZone(tx, cfg, { name: "Comedor", displayOrder: 1 }),
    );
    await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terraza", displayOrder: 0 }));
    // Ordered by display_order: Terraza (0) before Comedor (1).
    expect((await asApp(cfg, (tx) => listZones(tx, cfg))).map((z) => z.name)).toEqual([
      "Terraza",
      "Comedor",
    ]);
    await asApp(cfg, (tx) => updateZone(tx, cfg, id, { name: "Salón", displayOrder: 2 }));
    // Renamed and reordered (Terraza 0, Salón 2), both still active.
    expect((await asApp(cfg, (tx) => listZones(tx, cfg))).map((z) => z.name)).toEqual([
      "Terraza",
      "Salón",
    ]);
    await asApp(cfg, (tx) => deactivateZone(tx, cfg, id));
    // Inactive hidden.
    expect((await asApp(cfg, (tx) => listZones(tx, cfg))).map((z) => z.name)).toEqual(["Terraza"]);
  });

  it("listZones returns exactly the FloorZone shape (id/name/displayOrder/active — no createdAt)", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) =>
      createZone(tx, cfg, { name: "Comedor", displayOrder: 3 }),
    );
    const [z] = await asApp(cfg, (tx) => listZones(tx, cfg));
    expect(z).toEqual({ id, name: "Comedor", displayOrder: 3, active: true });
  });

  it("createZone defaults displayOrder to 0 when omitted", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Solo" }));
    const [z] = await asApp(cfg, (tx) => listZones(tx, cfg));
    expect(z).toMatchObject({ name: "Solo", displayOrder: 0 });
  });

  it("rejects a duplicate name (zone.name_taken) and an unknown id (zone.not_found)", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Comedor" }));
    await expect(
      asApp(cfg, (tx) => createZone(tx, cfg, { name: "Comedor" })),
    ).rejects.toMatchObject({ code: "zone.name_taken", params: { name: "Comedor" } });
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => updateZone(tx, cfg, missing, { name: "X" })),
    ).rejects.toMatchObject({ code: "zone.not_found", params: { zoneId: missing } });
  });

  it("updateZone surfaces a name collision as zone.name_taken", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createZone(tx, cfg, { name: "A" }));
    const { id } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "B" }));
    await expect(asApp(cfg, (tx) => updateZone(tx, cfg, id, { name: "A" }))).rejects.toMatchObject({
      code: "zone.name_taken",
      params: { name: "A" },
    });
  });

  it("updateZone reactivates and reorders (the active + displayOrder patch branches)", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) =>
      createZone(tx, cfg, { name: "Patio", displayOrder: 5 }),
    );
    await asApp(cfg, (tx) => deactivateZone(tx, cfg, id));
    expect(await asApp(cfg, (tx) => listZones(tx, cfg))).toEqual([]);
    await asApp(cfg, (tx) => updateZone(tx, cfg, id, { active: true, displayOrder: 9 }));
    expect(await asApp(cfg, (tx) => listZones(tx, cfg))).toEqual([
      { id, name: "Patio", displayOrder: 9, active: true },
    ]);
  });

  it("deactivateZone throws zone.not_found for an unknown id", async () => {
    const cfg = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => deactivateZone(tx, cfg, missing))).rejects.toMatchObject({
      code: "zone.not_found",
      params: { zoneId: missing },
    });
  });

  it("createZone rethrows a NON-unique DB error raw, not as zone.name_taken", async () => {
    const cfg = await setupVenue();
    // A location id that names no row: the (location_id) FK `floor_zones_location_fk` refuses the
    // insert — NOT the name unique. So `isUniqueViolation` is false and `createZone` rethrows the
    // raw driver error rather than mistranslating it (the false branch of its catch). The same
    // idiom as the `createTable` control above; it replaced an int4 `display_order` overflow, which
    // this engine's 64-bit INTEGER no longer refuses.
    const badCfg: TillConfig = { ...cfg, locationId: brandLocationId(randomUUID()) };
    const err = await asApp(cfg, (tx) => createZone(tx, badCfg, { name: "Big" })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error); // rejected (a resolved {id} would fail this)
    expect(err).not.toBeInstanceOf(AppError); // a raw driver error, not a domain translation
  });

  it("updateZone rethrows a NON-unique DB error raw, not as zone.name_taken", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terraza" }));
    // `floor_zones` declares no CHECK, so a temporary trigger supplies the non-unique refusal.
    await db.execute(sql`
      create trigger floor_zones_refuse_update before update on floor_zones
      begin select raise(abort, 'zone update refused'); end`);
    try {
      const err = await asApp(cfg, (tx) => updateZone(tx, cfg, id, { name: "Patio" })).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AppError);
      expect(String(err)).toMatch(/zone update refused/);
    } finally {
      await db.execute(sql`drop trigger floor_zones_refuse_update`);
    }
  });
});

// ONE LOSS, from the storage swap: the `isZoneFkViolation` crafted-error unit tests are deleted
// with the function they covered. They pinned that a refusal on `dining_tables_zone_fk` was told
// apart from the sibling location and status FKs by the TABLE and COLUMN the refusal named. This
// engine's foreign-key refusal names neither — the whole message is `FOREIGN KEY constraint
// failed` (`packages/db/src/constraint-target.ts`) — so there is nothing left to tell apart.
// `zone.not_found` now comes from `tables.ts`'s `requireZone`, an existence check before the
// write, and the two real-DB cases above are what prove it. What is no longer checked: that a
// refusal on the location FK or the status FK cannot be mistaken for a zone fault. Those two FKs
// still refuse, and their refusals are now rethrown raw because nothing inspects them at all.

// FP-2 spatial placement (Task 2). The verb logic is validation plus a by-id UPDATE; the
// `venue.configure` gate lives on the ROUTE and is proven there.
// A distinct case proves EACH validation branch: table.not_found, zone.not_found, and one per field.
describe("table placement", () => {
  it("places a table, reads the placement back via listTablesWithState, then clears the four columns (zoneId kept)", async () => {
    const cfg = await setupVenue();
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Comedor" }));
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "4", capacity: 4 }));

    await asApp(cfg, (tx) =>
      setTablePlacement(tx, cfg, id, {
        zoneId,
        posX: 500,
        posY: 250,
        shape: "square",
        rotation: 15,
      }),
    );
    const placed = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === id,
    )!;
    expect(placed).toMatchObject({ posX: 500, posY: 250, shape: "square", rotation: 15, zoneId });

    await asApp(cfg, (tx) => clearPlacement(tx, cfg, id));
    const cleared = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === id,
    )!;
    // The four placement columns are NULL; zoneId (an FP-1 column, not one of the four) is left as-is.
    expect(cleared).toMatchObject({ posX: null, posY: null, shape: null, rotation: null, zoneId });
  });

  it("returns null placement fields for a table that has never been placed", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "unplaced" }));
    const [t] = await asApp(cfg, (tx) => listTablesWithState(tx, cfg));
    expect(t).toMatchObject({ id, posX: null, posY: null, shape: null, rotation: null });
  });

  it("rejects each invalid placement field with placement.invalid naming THAT field (never the value)", async () => {
    const cfg = await setupVenue();
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Barra" }));
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "5" }));
    const ok = { zoneId, posX: 0, posY: 0, shape: "round" as const, rotation: 0 };

    // posX above the range, AND a non-integer — both name posX (the two upper/non-integer branches).
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, posX: 2000 })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "posX" } });
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, posX: 1.5 })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "posX" } });
    // posY below the range → names posY (the lower branch).
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, posY: -1 })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "posY" } });
    // shape not a floor_table_shape enum member → names shape.
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, shape: "hexagon" as never })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "shape" } });
    // rotation above 359 → names rotation.
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, rotation: 360 })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "rotation" } });
  });

  it("rejects placement of a missing OR deactivated table with table.not_found", async () => {
    const cfg = await setupVenue();
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Z" }));
    const p = { zoneId, posX: 0, posY: 0, shape: "round" as const, rotation: 0 };
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => setTablePlacement(tx, cfg, missing, p))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: missing },
    });
    // A deactivated table is not placeable — an ACTIVE table is required (setTableStatus/design §3b shape).
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "gone" }));
    await asApp(cfg, (tx) => deactivateTable(tx, cfg, id));
    await expect(asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, p))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: id },
    });
  });

  it("rejects placement into a missing OR deactivated zone with zone.not_found (a live zone is required)", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "6" }));
    const missingZone = randomUUID();
    await expect(
      asApp(cfg, (tx) =>
        setTablePlacement(tx, cfg, id, {
          zoneId: missingZone,
          posX: 0,
          posY: 0,
          shape: "round",
          rotation: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: "zone.not_found", params: { zoneId: missingZone } });
    // A deactivated zone is not "live" → zone.not_found. The zone FK (createTable/updateTable's check)
    // cannot see `active`, so setTablePlacement checks it explicitly.
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Old" }));
    await asApp(cfg, (tx) => deactivateZone(tx, cfg, zoneId));
    await expect(
      asApp(cfg, (tx) =>
        setTablePlacement(tx, cfg, id, { zoneId, posX: 0, posY: 0, shape: "round", rotation: 0 }),
      ),
    ).rejects.toMatchObject({ code: "zone.not_found", params: { zoneId } });
  });

  it("clearPlacement throws table.not_found for an unknown id", async () => {
    const cfg = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => clearPlacement(tx, cfg, missing))).rejects.toMatchObject({
      code: "table.not_found",
      params: { tableId: missing },
    });
  });
});

// KDS-1 §3d ready→floor. Unlike the CRUD describes above, this exercises the full
// tab→fire→bump→serve path, so the venue also needs sellable products and a default kitchen
// station (fireLines' fallback). The same fixture shape tabs.test.ts's setupVenue uses.
async function setupTabVenue(): Promise<{
  cfg: TillConfig;
  cafeId: string;
  aguaId: string;
  tableId: string;
}> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
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
  await seedKitchenStation(db, { locationId: brandLocationId(locationId) });
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
  const { cafeId, aguaId, tableId } = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const table = await createTable(tx, cfg, { label: "T1" });
    return { cafeId: cafe.id, aguaId: agua.id, tableId: table.id };
  });
  return { cfg, cafeId, aguaId, tableId };
}

// A read-model shape test: the shape is what this pins.
describe("listTablesWithState — readyToServe (N listos, KDS-1 §3d)", () => {
  it("counts the tab's ready-not-served lines, distinct from pendingToServe", async () => {
    const { cfg, cafeId, aguaId, tableId } = await setupTabVenue();

    // Open a tab with two lines and FIRE the round → two ticket items, both queued.
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ],
      }),
    );
    const lines = await asApp(cfg, (tx) =>
      tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          courseId: workingOrderLines.courseId,
          parentLineId: workingOrderLines.parentLineId,
          note: workingOrderLines.note,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    // Queued, nothing served → readyToServe 0; pendingToServe still counts both unserved lines.
    let row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === tableId,
    )!;
    expect(row).toMatchObject({ readyToServe: 0, pendingToServe: 2 });

    // Bump the first line's ticket item queued → preparing → ready.
    const [item] = await asApp(cfg, (tx) =>
      tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, lines[0]!.id)),
    );
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, item!.id, "preparing"));
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, item!.id, "ready"));

    // One line ready and still unserved → readyToServe 1; pendingToServe unchanged (ready ≠ served).
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ readyToServe: 1, pendingToServe: 2 });

    // Mark that same line served → the ready item drops out of readyToServe; pendingToServe falls to 1.
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ readyToServe: 0, pendingToServe: 1 });
  });
});

// KDS-3 §3c "en camino": the floor's most-advanced hint. `enRoute` counts the tab's lines whose
// ticket item has been DISPATCHED by the pass (`away_at IS NOT NULL`) but the waiter has not yet
// acknowledged (`served_at IS NULL`) — the window between the expediter sending a course away and
// the floor carrying it out. The same read-model shape test as readyToServe above.
describe("listTablesWithState — enRoute (en camino, KDS-3 §3c)", () => {
  it("counts away-not-served lines, reports enRoute + readyToServe together, and clears enRoute on serve", async () => {
    const { cfg, cafeId, aguaId, tableId } = await setupTabVenue();

    // Open a tab with two lines and FIRE the round → two ticket items, both queued.
    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ],
      }),
    );
    const lines = await asApp(cfg, (tx) =>
      tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          courseId: workingOrderLines.courseId,
          parentLineId: workingOrderLines.parentLineId,
          note: workingOrderLines.note,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    // Nothing dispatched yet → enRoute 0; the two unserved lines still count in pendingToServe.
    let row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === tableId,
    )!;
    expect(row).toMatchObject({ enRoute: 0, readyToServe: 0, pendingToServe: 2 });

    // Bump BOTH lines' ticket items queued → preparing → ready → readyToServe 2, still none away.
    const items = await asApp(cfg, (tx) =>
      tx
        .select({ id: ticketItems.id, lineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, tabId)),
    );
    for (const item of items) {
      await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, item.id, "preparing"));
      await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, item.id, "ready"));
    }
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ enRoute: 0, readyToServe: 2, pendingToServe: 2 });

    // DISPATCH line 1's item — stamp `away_at` (the read-model column `markCourseAway` writes; its
    // dispatch VERB is exercised in Task 3, this pins the read count). It stays `ready` + unserved, so it
    // now counts in BOTH enRoute (away, unserved) AND readyToServe (ready, unserved) — a table can report
    // both, which is exactly what lets the client apply the en-camino > listos precedence.
    const away = items.find((i) => i.lineId === lines[0]!.id)!;
    await asApp(cfg, (tx) =>
      tx.update(ticketItems).set({ awayAt: nowIso() }).where(eq(ticketItems.id, away.id)),
    );
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ enRoute: 1, readyToServe: 2, pendingToServe: 2 });

    // The waiter carries out line 1 (`served_at` set) → the away item drops out of enRoute (served) AND
    // readyToServe; pendingToServe falls to the one still-unserved line. `served_at` is the final ack.
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ enRoute: 0, readyToServe: 1, pendingToServe: 1 });
  });
});

// KDS order-timing alerts (design §3/§6) — the floor's flash-red signal: the worst age band
// across the open tab's UNSERVED lines, classified against each line's OWN station thresholds on
// the DB clock. The same read-model shape test as readyToServe/enRoute above; the schema suite
// covers the threshold columns and their CHECK.
describe("listTablesWithState — timingBand (KDS order-timing alerts)", () => {
  it("bands a line by its station thresholds and clears once served (design §3 — ages until it reaches the guest)", async () => {
    const { cfg, cafeId, aguaId, tableId } = await setupTabVenue();

    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ],
      }),
    );
    const lines = await asApp(cfg, (tx) =>
      tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          courseId: workingOrderLines.courseId,
          parentLineId: workingOrderLines.parentLineId,
          note: workingOrderLines.note,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    // Backdate line 1's ticket item past the seeded station's default overdue threshold (10) but under
    // forgotten (15); line 2 stays fresh.
    await asApp(cfg, (tx) =>
      tx.execute(sql`update ticket_items set queued_at = ${minutesAgo(12)}
                     where working_order_line_id = ${lines[0]!.id}`),
    );

    let row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === tableId,
    )!;
    expect(row.timingBand).toBe("overdue");

    // Serve the overdue line → it drops off the clock (§3); the remaining unserved line (line 2) is
    // fresh, so the TABLE clears too.
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row.timingBand).toBe("fresh");
  });

  it("worst-line-wins: a forgotten line outranks a fresh one on the same table", async () => {
    const { cfg, cafeId, aguaId, tableId } = await setupTabVenue();

    const { tabId } = await asApp(cfg, (tx) =>
      openTab(tx, cfg, {
        tableId,
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ],
      }),
    );
    const lines = await asApp(cfg, (tx) =>
      tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          courseId: workingOrderLines.courseId,
          parentLineId: workingOrderLines.parentLineId,
          note: workingOrderLines.note,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    // Line 1 past forgotten (15); line 2 left fresh — the table reports the worse of the two.
    await asApp(cfg, (tx) =>
      tx.execute(sql`update ticket_items set queued_at = ${minutesAgo(16)}
                     where working_order_line_id = ${lines[0]!.id}`),
    );

    const row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === tableId,
    )!;
    expect(row.timingBand).toBe("forgotten");
  });

  it("a free table (no open tab) reports fresh", async () => {
    const { cfg, tableId } = await setupTabVenue();
    const row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === tableId,
    )!;
    expect(row.timingBand).toBe("fresh");
  });
});
