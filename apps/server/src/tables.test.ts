import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  DEFAULT_TIME_ZONE,
  asAppUser,
  ticketItems,
  withTenant,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
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
  isZoneFkViolation,
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

const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(opts: { timeZone?: string } = {}): Promise<TillConfig> {
  const tenantId = await seedTenant(db);
  // Default the location's time_zone from the schema default (Europe/Madrid) unless a test pins one —
  // the reserved-on-floor read derives venue-local "today"/"now" from this column (design §2b/§4).
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description, time_zone)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento', ${timeZone}) returning id`);
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
    // A location id that names no row: the composite (tenant_id, location_id) FK
    // `dining_tables_location_fk` rejects the insert with a 23503 foreign-key violation — NOT the
    // 23505 label unique NOR the `dining_tables_zone_fk` the zone check matches on. So both
    // `isUniqueViolation` and `isZoneFkViolation` are false and `createTable` must rethrow the raw
    // driver error rather than mistranslating any failure into `table.label_taken`/`zone.not_found`
    // (the false branch of both catch checks — the other side of the two prove-by-deletion tests).
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
    // 10_000_000_000 overflows the int4 `display_order` column (22003 numeric_value_out_of_range) —
    // NOT the name unique. So `isUniqueViolation` is false and `createZone` rethrows the raw driver
    // error rather than mistranslating it (the false branch of its catch — the negative control the
    // sibling create/update verbs each carry).
    const err = await asApp(cfg, (tx) =>
      createZone(tx, cfg, { name: "Big", displayOrder: 10_000_000_000 }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error); // rejected (a resolved {id} would fail this)
    expect(err).not.toBeInstanceOf(AppError); // a raw driver error, not a domain translation
  });

  it("updateZone rethrows a NON-unique DB error raw, not as zone.name_taken", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Ord" }));
    // 10_000_000_000 overflows the int4 `display_order` column (22003 numeric_value_out_of_range) —
    // NOT the name unique. So `isUniqueViolation` is false and `updateZone` rethrows the raw driver
    // error rather than mistranslating it (the false branch of its catch).
    const err = await asApp(cfg, (tx) =>
      updateZone(tx, cfg, id, { displayOrder: 10_000_000_000 }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error); // rejected (a resolved void would fail this)
    expect(err).not.toBeInstanceOf(AppError); // a raw driver error, not a domain translation
  });
});

// The FK-name check createTable/updateTable use to tell the zone FK apart from the sibling
// location/status FKs. Crafted-error unit tests (no DB) pin every branch — the real-DB tests above
// already prove the true path (a bad zoneId → zone.not_found) and the location-FK false path.
describe("isZoneFkViolation", () => {
  it("matches a 23503 on dining_tables_zone_fk, at the top level and nested under .cause", () => {
    expect(isZoneFkViolation({ code: "23503", constraint: "dining_tables_zone_fk" })).toBe(true);
    // Drizzle wraps the driver error; the real code/constraint live one level down under `.cause`.
    expect(
      isZoneFkViolation({ cause: { code: "23503", constraint: "dining_tables_zone_fk" } }),
    ).toBe(true);
  });

  it("does NOT match a sibling constraint, a different code, a non-object, or a self-referential cause", () => {
    // The location FK is a 23503 too, but a different constraint — must stay raw.
    expect(isZoneFkViolation({ code: "23503", constraint: "dining_tables_location_fk" })).toBe(
      false,
    );
    expect(isZoneFkViolation({ code: "23505", constraint: "dining_tables_zone_fk" })).toBe(false);
    expect(isZoneFkViolation(null)).toBe(false);
    expect(isZoneFkViolation("nope")).toBe(false);
    // A self-referential cause must terminate the walk rather than spin forever.
    const selfRef: { cause?: unknown } = {};
    selfRef.cause = selfRef;
    expect(isZoneFkViolation(selfRef)).toBe(false);
  });
});

// FP-2 spatial placement (Task 2). PGlite is enough here — the verb logic is validation + a by-id
// UPDATE with no privilege/concurrency dimension (the real-PG gate lives on the ROUTE in a later task).
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

// KDS-1 §3d ready→floor. Unlike the CRUD describes above, this exercises the full tab→fire→bump→serve
// path, so the venue also needs sellable products and a default kitchen station (fireLines' fallback).
// Seeded as the superuser (RLS bypassed in setup), the shape tabs.test.ts's setupVenue uses.
async function setupTabVenue(): Promise<{
  cfg: TillConfig;
  cafeId: string;
  aguaId: string;
  tableId: string;
}> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  await seedKitchenStation(db, { tenantId, locationId: brandLocationId(locationId) });
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
  const { cafeId, aguaId, tableId } = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua" },
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

// PGlite is the right target: a read-model shape test with no RLS/concurrency dimension (Task 1's
// real-PG suite covers ticket_items RLS). The read-model shape is what this pins.
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
          doneness: workingOrderLines.doneness,
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

// KDS-3 §3c "en camino": the floor's most-advanced hint. `enRoute` counts the tab's lines whose ticket
// item has been DISPATCHED by the pass (`away_at IS NOT NULL`) but the waiter has not yet acknowledged
// (`served_at IS NULL`) — the window between the expediter sending a course away and the floor carrying
// it out. PGlite is the right target (the same read-model shape test as readyToServe above; no
// RLS/concurrency dimension — Task 1's real-PG suite covers ticket_items RLS).
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
          doneness: workingOrderLines.doneness,
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
      tx
        .update(ticketItems)
        .set({ awayAt: sql`now()` })
        .where(eq(ticketItems.id, away.id)),
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

// Bookings-1 Task 6 (reserved-on-floor, design §4): each table carries its NEXT imminent `booked`
// reservation for TODAY (venue-local) at/after NOW (venue-local), or null. "Today"/"now" derive from
// `locations.time_zone` at read time (§2b) — computed in JS, never in SQL — so the read takes an
// injectable clock (the station-queue precedent) that a test pins for determinism. PGlite is enough:
// the logic is a correlated read with no privilege/concurrency dimension.
describe("listTablesWithState — nextReservation (reserved-on-floor)", () => {
  // Insert a booking directly (as the app role) — the booking-api write verbs are a separate task; this
  // read test only needs rows in the table. `booking_time` is a plain venue-local `time` (§2b).
  async function insertBooking(
    cfg: TillConfig,
    fields: {
      tableId: string | null;
      date: string;
      time: string;
      partySize?: number;
      name?: string;
      status?: string;
    },
  ): Promise<void> {
    await asApp(cfg, (tx) =>
      tx.execute(sql`
        insert into bookings
          (tenant_id, location_id, table_id, booking_date, booking_time, party_size, contact_name, created_by, status)
        values
          (${cfg.tenantId}, ${cfg.locationId}, ${fields.tableId}, ${fields.date}, ${fields.time},
           ${fields.partySize ?? 2}, ${fields.name ?? "Ana"}, ${randomUUID()}, ${fields.status ?? "booked"})
      `),
    );
  }

  // 2026-09-15T10:00:00Z → Madrid (CEST, UTC+2 in September) 12:00 on 2026-09-15.
  const MADRID_NOON = new Date("2026-09-15T10:00:00Z");

  it("surfaces the table's next booked reservation later today as HH:MM", async () => {
    const cfg = await setupVenue();
    const { id: tableId } = await asApp(cfg, (tx) =>
      createTable(tx, cfg, { label: "7", capacity: 4 }),
    );
    await insertBooking(cfg, {
      tableId,
      date: "2026-09-15",
      time: "14:00",
      partySize: 5,
      name: "Marta",
    });

    const row = (
      await asApp(cfg, (tx) => listTablesWithState(tx, cfg, undefined, MADRID_NOON))
    ).find((t) => t.id === tableId)!;
    expect(row.nextReservation).toEqual({ time: "14:00" });
  });

  it("returns null when the table has no upcoming booked reservation", async () => {
    const cfg = await setupVenue();
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "8" }));
    const row = (
      await asApp(cfg, (tx) => listTablesWithState(tx, cfg, undefined, MADRID_NOON))
    ).find((t) => t.id === tableId)!;
    expect(row.nextReservation).toBeNull();
  });

  it("excludes past-time, non-booked-status, and other-day reservations", async () => {
    const cfg = await setupVenue();
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "9" }));
    // Past-time today (now = 12:00): excluded.
    await insertBooking(cfg, { tableId, date: "2026-09-15", time: "09:00" });
    // Future today but not `booked`: each excluded.
    await insertBooking(cfg, { tableId, date: "2026-09-15", time: "15:00", status: "seated" });
    await insertBooking(cfg, { tableId, date: "2026-09-15", time: "16:00", status: "cancelled" });
    await insertBooking(cfg, { tableId, date: "2026-09-15", time: "17:00", status: "no_show" });
    await insertBooking(cfg, { tableId, date: "2026-09-15", time: "18:00", status: "completed" });
    // Booked but a different day: excluded.
    await insertBooking(cfg, { tableId, date: "2026-09-16", time: "13:00" });

    const row = (
      await asApp(cfg, (tx) => listTablesWithState(tx, cfg, undefined, MADRID_NOON))
    ).find((t) => t.id === tableId)!;
    expect(row.nextReservation).toBeNull();
  });

  it("returns the earliest of two future booked reservations", async () => {
    const cfg = await setupVenue();
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "10" }));
    await insertBooking(cfg, { tableId, date: "2026-09-15", time: "20:00", name: "Later" });
    await insertBooking(cfg, { tableId, date: "2026-09-15", time: "13:30", name: "Earlier" });

    const row = (
      await asApp(cfg, (tx) => listTablesWithState(tx, cfg, undefined, MADRID_NOON))
    ).find((t) => t.id === tableId)!;
    expect(row.nextReservation).toEqual({ time: "13:30" });
  });

  it("does not crash when locations.time_zone is an invalid IANA zone (falls back to the default)", async () => {
    // `locations.time_zone` is free-text with NO CHECK constraint (schema: `.notNull()
    // .default("Europe/Madrid")`), so a typo or a legacy value can be stored. `Intl.DateTimeFormat`
    // throws `RangeError` on an unknown zone, which would turn the floor read (GET /api/tables/state)
    // into a 500 — bad config must not take out the operational floor. The read falls back to the
    // column's own default (Europe/Madrid), so with `MADRID_NOON` the 14:00 booking still surfaces.
    const cfg = await setupVenue({ timeZone: "Not/AZone" });
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "13" }));
    await insertBooking(cfg, {
      tableId,
      date: "2026-09-15",
      time: "14:00",
      partySize: 3,
      name: "Fallback",
    });

    const rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg, undefined, MADRID_NOON));
    const row = rows.find((t) => t.id === tableId)!;
    expect(row.nextReservation).toEqual({ time: "14:00" });
  });

  it("derives venue-local 'today' from locations.time_zone, not UTC (date boundary)", async () => {
    // now = 2026-09-01T23:00:00Z. In Pacific/Kiritimati (UTC+14) that is 2026-09-02 13:00 — a DIFFERENT
    // calendar day than the UTC 2026-09-01. A booking dated 2026-09-02 at 15:00 must surface (it is the
    // venue's "today", after the venue's "now"); were the read using UTC it would look at 2026-09-01 and
    // find nothing.
    const cfg = await setupVenue({ timeZone: "Pacific/Kiritimati" });
    const clock = new Date("2026-09-01T23:00:00Z");
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "11" }));
    await insertBooking(cfg, { tableId, date: "2026-09-02", time: "15:00", name: "Venue" });
    // A booking on the UTC day (2026-09-01) must NOT surface — it is yesterday at the venue.
    await insertBooking(cfg, { tableId, date: "2026-09-01", time: "23:30", name: "UtcDay" });

    const row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg, undefined, clock))).find(
      (t) => t.id === tableId,
    )!;
    expect(row.nextReservation).toEqual({ time: "15:00" });
  });

  it("derives venue-local 'now' from locations.time_zone (hour boundary)", async () => {
    // Same instant/tz as above → venue now is 2026-09-02 13:00. A booking at 12:00 (before) is excluded;
    // one at 14:00 (after) surfaces — proving the >= now filter uses the VENUE hour, not UTC's 23:00.
    const cfg = await setupVenue({ timeZone: "Pacific/Kiritimati" });
    const clock = new Date("2026-09-01T23:00:00Z");
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "12" }));
    await insertBooking(cfg, { tableId, date: "2026-09-02", time: "12:00", name: "Past" });
    await insertBooking(cfg, { tableId, date: "2026-09-02", time: "14:00", name: "Future" });

    const row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg, undefined, clock))).find(
      (t) => t.id === tableId,
    )!;
    expect(row.nextReservation).toEqual({ time: "14:00" });
  });

  it("keeps a just-passed reservation on the floor within the grace window, drops it beyond", async () => {
    // now = Madrid 12:00. RESERVATION_GRACE_MINUTES is 30, so the grace floor is 11:30. A booking at
    // 11:45 (15 min past, within grace) STILL surfaces — the reserved cue is most useful when a guest is
    // due or running late — while one at 11:15 (45 min past, beyond grace) is gone. Both are today +
    // booked; only their time relative to the grace floor differs.
    const cfg = await setupVenue();
    const { id: withinId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "14" }));
    const { id: beyondId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "15" }));
    // The grace floor itself (11:30 = now − 30) must STILL surface: the filter is `>= graceFloor`
    // (inclusive), so a `>=`→`>` regression would drop this exact-boundary booking and this pins it.
    const { id: boundaryId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "16" }));
    await insertBooking(cfg, { tableId: withinId, date: "2026-09-15", time: "11:45", name: "Due" });
    await insertBooking(cfg, {
      tableId: beyondId,
      date: "2026-09-15",
      time: "11:15",
      name: "Gone",
    });
    await insertBooking(cfg, {
      tableId: boundaryId,
      date: "2026-09-15",
      time: "11:30",
      name: "Edge",
    });

    const rows = await asApp(cfg, (tx) => listTablesWithState(tx, cfg, undefined, MADRID_NOON));
    expect(rows.find((t) => t.id === withinId)!.nextReservation).toEqual({ time: "11:45" });
    expect(rows.find((t) => t.id === beyondId)!.nextReservation).toBeNull();
    expect(rows.find((t) => t.id === boundaryId)!.nextReservation).toEqual({ time: "11:30" });
  });
});

// KDS order-timing alerts (design §3/§6) — the floor's flash-red signal: the worst age band across the
// open tab's UNSERVED lines, classified against each line's OWN station thresholds on the DB clock. PGlite
// is the right target (the same read-model shape test as readyToServe/enRoute above; no RLS/concurrency
// dimension — Task 1's real-PG suite covers ticket_items RLS, and the migration's own real-PG suite covers
// the threshold columns/CHECK).
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
          doneness: workingOrderLines.doneness,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    // Backdate line 1's ticket item past the seeded station's default overdue threshold (10) but under
    // forgotten (15); line 2 stays fresh.
    await asApp(cfg, (tx) =>
      tx.execute(sql`update ticket_items set queued_at = now() - interval '12 minutes'
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
          doneness: workingOrderLines.doneness,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    // Line 1 past forgotten (15); line 2 left fresh — the table reports the worse of the two.
    await asApp(cfg, (tx) =>
      tx.execute(sql`update ticket_items set queued_at = now() - interval '16 minutes'
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
