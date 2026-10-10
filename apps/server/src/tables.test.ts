import { createZone } from "./testing/service-zone.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  diningTables,
  floorZones,
  kitchenTimingDefaults,
  locations,
  parties,
  partyTables,
  nowIso,
  ticketItems,
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
  jobOrigin,
} from "@waitron/shared";
import type { OriginConfig } from "./till-config.js";
import {
  clearPlacement,
  createTable,
  deactivateTable,
  deactivateZone,
  listTables,
  listZones,
  setTablePlacement,
  updateTable,
  updateZone,
} from "./tables.js";
import { advanceTicketItem, fireLines, listTablesWithState } from "./working-order.js";
import { openPartyTab, serveLine } from "./testing/serve-line.js";
import "./errors.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";

const LOCALE = "es-ES";

/**
 * The read under test takes its own clock later, so the age it measures is `minutes` plus the
 * suite's elapsed time. The cases below sit inside a band, not on its edge, so that drift is safe.
 */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// The whole manifest: the tables here belong to several modules.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(opts: { timeZone?: string } = {}): Promise<OriginConfig> {
  await seedTenant(db);
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  // Through the table definitions: `locations.id` is a `$defaultFn` generator,
  // which a raw insert does not reach.
  const [location] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
      timeZone,
    })
    .returning({ id: locations.id });
  await db.insert(kitchenTimingDefaults).values({ locationId: location!.id });
  const locationId = location!.id;
  const nodeId = await seedNode(db, brandLocationId(locationId));
  return {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

function asApp<T>(cfg: OriginConfig, fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

describe("table CRUD", () => {
  it("creates a table WITH a zone and lists it (active, by label)", async () => {
    const cfg = await setupVenue();
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terraza" }));
    const { id } = await asApp(cfg, (tx) =>
      createTable(tx, cfg, { label: "12", zoneId, capacity: 4 }),
    );
    const tables = await asApp(cfg, (tx) => listTables(tx, cfg));
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
    // A null-only assertion cannot show the columns are projected, so place the table first.
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
    // A location id that names no row: the location foreign key refuses, not the label unique.
    const badCfg: OriginConfig = { ...cfg, locationId: brandLocationId(randomUUID()) };
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

describe("updateTable on a table in a floor plan", () => {
  async function seedTable(cfg: OriginConfig, planned: boolean) {
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Sala" }));
    const { id: otherZoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Patio" }));
    const { id } = await asApp(cfg, (tx) =>
      createTable(tx, cfg, { label: "P1", zoneId, capacity: 4 }),
    );
    if (planned)
      await db.update(diningTables).set({ planned: true }).where(eq(diningTables.id, id));
    return { id, otherZoneId };
  }

  async function readTable(id: string) {
    const [row] = await db
      .select({
        label: diningTables.label,
        zoneId: diningTables.zoneId,
        capacity: diningTables.capacity,
        active: diningTables.active,
      })
      .from(diningTables)
      .where(eq(diningTables.id, id));
    return row!;
  }

  it("refuses a rename, a zone move, and switching off or on, each table.in_floor_plan, and changes nothing", async () => {
    const cfg = await setupVenue();
    const { id, otherZoneId } = await seedTable(cfg, true);
    const before = await readTable(id);
    for (const patch of [{ label: "P2" }, { zoneId: otherZoneId }, { active: false }]) {
      await expect(asApp(cfg, (tx) => updateTable(tx, cfg, id, patch))).rejects.toMatchObject({
        code: "table.in_floor_plan",
        params: { tableId: id },
      });
    }
    expect(await readTable(id)).toEqual(before);

    await db.update(diningTables).set({ active: false }).where(eq(diningTables.id, id));
    await expect(
      asApp(cfg, (tx) => updateTable(tx, cfg, id, { active: true })),
    ).rejects.toMatchObject({ code: "table.in_floor_plan", params: { tableId: id } });
    expect((await readTable(id)).active).toBe(false);
  });

  it("answers zone.not_found, not table.in_floor_plan, for a planned table moved to a missing zone", async () => {
    const cfg = await setupVenue();
    const { id } = await seedTable(cfg, true);
    const zoneId = randomUUID();
    await expect(asApp(cfg, (tx) => updateTable(tx, cfg, id, { zoneId }))).rejects.toMatchObject({
      code: "zone.not_found",
      params: { zoneId },
    });
  });

  it("changes the capacity, even when the old screen resends the unchanged name", async () => {
    const cfg = await setupVenue();
    const { id } = await seedTable(cfg, true);
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { label: "P1", capacity: 8 }));
    expect(await readTable(id)).toMatchObject({ label: "P1", capacity: 8, active: true });
  });

  it("on a table never planned, renames, moves, switches off and on, and changes capacity", async () => {
    const cfg = await setupVenue();
    const { id, otherZoneId } = await seedTable(cfg, false);
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { label: "P2" }));
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { zoneId: otherZoneId }));
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { capacity: 6 }));
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { active: false }));
    expect(await readTable(id)).toEqual({
      label: "P2",
      zoneId: otherZoneId,
      capacity: 6,
      active: false,
    });
    await asApp(cfg, (tx) => updateTable(tx, cfg, id, { active: true }));
    expect((await readTable(id)).active).toBe(true);
  });
});

describe("other old-screen writes on a table in a floor plan", () => {
  async function seedTable(cfg: OriginConfig, planned: boolean) {
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Sala" }));
    const { id: otherZoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Patio" }));
    const { id } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "Q1", zoneId }));
    if (planned)
      await db.update(diningTables).set({ planned: true }).where(eq(diningTables.id, id));
    return { id, zoneId, otherZoneId };
  }

  async function readTable(id: string) {
    const [row] = await db
      .select({ zoneId: diningTables.zoneId, active: diningTables.active, posX: diningTables.posX })
      .from(diningTables)
      .where(eq(diningTables.id, id));
    return row!;
  }

  const spot = { posX: 10, posY: 20, shape: "square" as const, rotation: 0 };

  it("deactivateTable refuses a planned table with table.in_floor_plan and leaves it on", async () => {
    const cfg = await setupVenue();
    const { id } = await seedTable(cfg, true);
    await expect(asApp(cfg, (tx) => deactivateTable(tx, cfg, id))).rejects.toMatchObject({
      code: "table.in_floor_plan",
      params: { tableId: id },
    });
    expect((await readTable(id)).active).toBe(true);
  });

  it("deactivateTable still switches off a table never planned", async () => {
    const cfg = await setupVenue();
    const { id } = await seedTable(cfg, false);
    await asApp(cfg, (tx) => deactivateTable(tx, cfg, id));
    expect((await readTable(id)).active).toBe(false);
  });

  it("setTablePlacement refuses moving a planned table to another zone, and places it within its own", async () => {
    const cfg = await setupVenue();
    const { id, zoneId, otherZoneId } = await seedTable(cfg, true);
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...spot, zoneId: otherZoneId })),
    ).rejects.toMatchObject({ code: "table.in_floor_plan", params: { tableId: id } });
    expect(await readTable(id)).toMatchObject({ zoneId, posX: null });
    await asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...spot, zoneId }));
    expect(await readTable(id)).toMatchObject({ zoneId, posX: 10 });
  });

  it("setTablePlacement moves a table never planned to another zone", async () => {
    const cfg = await setupVenue();
    const { id, otherZoneId } = await seedTable(cfg, false);
    await asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...spot, zoneId: otherZoneId }));
    expect(await readTable(id)).toMatchObject({ zoneId: otherZoneId, posX: 10 });
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

  it("can include inactive zones for management without changing the active-only list", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Closed room" }));
    await asApp(cfg, (tx) => deactivateZone(tx, cfg, id));
    expect(await asApp(cfg, (tx) => listZones(tx, cfg))).toEqual([]);
    expect(await asApp(cfg, (tx) => listZones(tx, cfg, { includeInactive: true }))).toEqual([
      { id, name: "Closed room", displayOrder: 0, active: false },
    ]);
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

  it("createZone keeps a primary-key clash as an internal database error", async () => {
    const cfg = await setupVenue();
    const existing = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terrace" }));
    const generateId = vi
      .spyOn(floorZones.id as unknown as { defaultFn: () => string }, "defaultFn")
      .mockReturnValue(existing.id);
    try {
      await expect(
        asApp(cfg, (tx) => createZone(tx, cfg, { name: "Garden" })),
      ).rejects.toMatchObject({
        errcode: 1555,
        message: "UNIQUE constraint failed: floor_zones.id",
      });
    } finally {
      generateId.mockRestore();
    }
    expect(await asApp(cfg, (tx) => listZones(tx, cfg))).toEqual([
      { id: existing.id, name: "Terrace", displayOrder: 0, active: true },
    ]);
  });

  it("updateZone does not translate a primary-key clash from another write in its trigger", async () => {
    const cfg = await setupVenue();
    const existing = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terrace" }));
    await db.execute(sql`create trigger test_zone_key_clash before update on floor_zones
      when new.name = 'Trigger collision'
      begin
        insert into floor_zones (id, location_id, name, created_at)
        values (old.id, old.location_id, 'Another zone', old.created_at);
      end`);
    try {
      await expect(
        asApp(cfg, (tx) => updateZone(tx, cfg, existing.id, { name: "Trigger collision" })),
      ).rejects.toMatchObject({
        errcode: 1555,
        message: "UNIQUE constraint failed: floor_zones.id",
      });
    } finally {
      await db.execute(sql`drop trigger test_zone_key_clash`);
    }
    expect(await asApp(cfg, (tx) => listZones(tx, cfg))).toEqual([
      { id: existing.id, name: "Terrace", displayOrder: 0, active: true },
    ]);
  });

  it("updateZone keeps a name-key refusal internal when the patch supplies no name", async () => {
    const cfg = await setupVenue();
    const existing = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terrace" }));
    await db.execute(sql`create trigger test_zone_name_clash before update on floor_zones
      when new.name = old.name
      begin
        insert into floor_zones (id, location_id, name, created_at)
        values ('name-clash-control', old.location_id, old.name, old.created_at);
      end`);
    try {
      await expect(
        asApp(cfg, (tx) => updateZone(tx, cfg, existing.id, { displayOrder: 4 })),
      ).rejects.toMatchObject({
        errcode: 2067,
        message: "UNIQUE constraint failed: floor_zones.location_id, floor_zones.name",
      });
    } finally {
      await db.execute(sql`drop trigger test_zone_name_clash`);
    }
    expect(await asApp(cfg, (tx) => listZones(tx, cfg))).toEqual([
      { id: existing.id, name: "Terrace", displayOrder: 0, active: true },
    ]);
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

  it("deactivating a zone switches off its tables", async () => {
    const cfg = await setupVenue();
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terrace" }));
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "T8", zoneId }));

    await asApp(cfg, (tx) => deactivateZone(tx, cfg, zoneId));

    expect(
      (
        await db
          .select({ active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, zoneId))
      )[0],
    ).toEqual({ active: false });
    expect(
      (
        await db
          .select({ active: diningTables.active })
          .from(diningTables)
          .where(eq(diningTables.id, tableId))
      )[0],
    ).toEqual({ active: false });
  });

  it("refuses zone removal while an open party occupies a table there", async () => {
    const cfg = await setupVenue();
    const { id: zoneId } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terrace" }));
    const { id: tableId } = await asApp(cfg, (tx) => createTable(tx, cfg, { label: "T9", zoneId }));
    await asApp(cfg, async (tx) => {
      const [party] = await tx
        .insert(parties)
        .values({ openedBy: randomUUID() })
        .returning({ id: parties.id });
      await tx.insert(partyTables).values({ partyId: party!.id, tableId });
    });

    await expect(asApp(cfg, (tx) => deactivateZone(tx, cfg, zoneId))).rejects.toMatchObject({
      code: "zone.table_in_use",
      params: { zoneId, tableId, tableName: "T9" },
    });
    await expect(
      asApp(cfg, (tx) => updateZone(tx, cfg, zoneId, { active: false })),
    ).rejects.toMatchObject({
      code: "zone.table_in_use",
      params: { zoneId, tableId, tableName: "T9" },
    });
    expect(
      (
        await db
          .select({ active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, zoneId))
      )[0],
    ).toEqual({ active: true });
  });

  it("allows removing a zone with a closed party while another zone has an open party", async () => {
    const cfg = await setupVenue();
    const { id: removedZone } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Dining" }));
    const { id: otherZone } = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Bar" }));
    const { id: removedTable } = await asApp(cfg, (tx) =>
      createTable(tx, cfg, { label: "D1", zoneId: removedZone }),
    );
    const { id: otherTable } = await asApp(cfg, (tx) =>
      createTable(tx, cfg, { label: "B1", zoneId: otherZone }),
    );
    await asApp(cfg, async (tx) => {
      const [closed] = await tx
        .insert(parties)
        .values({
          openedBy: randomUUID(),
          state: "closed",
          closedAt: new Date().toISOString(),
        })
        .returning({ id: parties.id });
      const [open] = await tx
        .insert(parties)
        .values({ openedBy: randomUUID() })
        .returning({ id: parties.id });
      await tx.insert(partyTables).values([
        { partyId: closed!.id, tableId: removedTable },
        { partyId: open!.id, tableId: otherTable },
      ]);
    });

    await expect(asApp(cfg, (tx) => deactivateZone(tx, cfg, removedZone))).resolves.toBeUndefined();
    expect(
      (
        await db
          .select({ active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, otherZone))
      )[0],
    ).toEqual({ active: true });
    expect(
      (
        await db
          .select({ active: diningTables.active })
          .from(diningTables)
          .where(eq(diningTables.id, otherTable))
      )[0],
    ).toEqual({ active: true });
  });

  it("service zone creation rethrows a non-unique insert refusal raw", async () => {
    const cfg = await setupVenue();
    await db.execute(sql`create trigger refuse_zone_insert before insert on floor_zones
      begin select raise(abort, 'zone insert refused'); end`);
    try {
      const err = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Big" })).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AppError);
      expect(String(err)).toMatch(/zone insert refused/);
    } finally {
      await db.execute(sql`drop trigger refuse_zone_insert`);
    }
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

// The `venue.configure` gate lives on the route and is tested there.
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

    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, posX: 2000 })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "posX" } });
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, posX: 1.5 })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "posX" } });
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, posY: -1 })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "posY" } });
    await expect(
      asApp(cfg, (tx) => setTablePlacement(tx, cfg, id, { ...ok, shape: "hexagon" as never })),
    ).rejects.toMatchObject({ code: "placement.invalid", params: { field: "shape" } });
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

// Products offered in the table's zone, and a kitchen station they route to, for the
// tab → fire → bump → serve path.
async function setupTabVenue(): Promise<{
  cfg: OriginConfig;
  cafeId: string;
  aguaId: string;
  tableId: string;
  offers: ZoneOffers;
}> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  // Through the table definitions: `locations.id` is a `$defaultFn` generator,
  // which a raw insert does not reach.
  const [location] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  await db.insert(kitchenTimingDefaults).values({ locationId: location!.id });
  const locationId = location!.id;
  await seedKitchenStation(db, { locationId: brandLocationId(locationId) });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const cfg: OriginConfig = {
    origin: jobOrigin("dashboard"),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const { cafeId, aguaId, tableId, offers } = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
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
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const table = await createTable(tx, cfg, { label: "T1", zoneId: offers.zoneId });
    return { cafeId: cafe.id, aguaId: agua.id, tableId: table.id, offers };
  });
  return { cfg, cafeId, aguaId, tableId, offers };
}

describe("listTablesWithState — readyToServe (N listos, KDS-1 §3d)", () => {
  it("counts the tab's ready-not-served lines, distinct from pendingToServe", async () => {
    const { cfg, cafeId, aguaId, tableId, offers } = await setupTabVenue();

    const { tabId } = await asApp(cfg, (tx) =>
      openPartyTab(tx, cfg, {
        tableId,
        lines: offers.toOfferLines([
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ]),
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
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    let row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === tableId,
    )!;
    expect(row).toMatchObject({ readyToServe: 0, pendingToServe: 2 });

    const [item] = await asApp(cfg, (tx) =>
      tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, lines[0]!.id)),
    );
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, item!.id, "preparing"));
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, item!.id, "ready"));

    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ readyToServe: 1, pendingToServe: 2 });

    await asApp(cfg, (tx) => serveLine(tx, cfg, tabId, 1));
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ readyToServe: 0, pendingToServe: 1 });
  });
});

// `enRoute` counts lines the pass has sent away (`away_at` set) that the waiter has not yet served.
describe("listTablesWithState — enRoute (en camino, KDS-3 §3c)", () => {
  it("counts away-not-served lines, reports enRoute + readyToServe together, and clears enRoute on serve", async () => {
    const { cfg, cafeId, aguaId, tableId, offers } = await setupTabVenue();

    const { tabId } = await asApp(cfg, (tx) =>
      openPartyTab(tx, cfg, {
        tableId,
        lines: offers.toOfferLines([
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ]),
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
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    let row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === tableId,
    )!;
    expect(row).toMatchObject({ enRoute: 0, readyToServe: 0, pendingToServe: 2 });

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

    // Away and still ready: a table reports both, so the client can rank en camino above listos.
    const away = items.find((i) => i.lineId === lines[0]!.id)!;
    await asApp(cfg, (tx) =>
      tx.update(ticketItems).set({ awayAt: nowIso() }).where(eq(ticketItems.id, away.id)),
    );
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ enRoute: 1, readyToServe: 2, pendingToServe: 2 });

    await asApp(cfg, (tx) => serveLine(tx, cfg, tabId, 1));
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row).toMatchObject({ enRoute: 0, readyToServe: 1, pendingToServe: 1 });
  });
});

// The worst age band across the open tab's unserved lines, each against its own station's thresholds.
describe("listTablesWithState — timingBand (KDS order-timing alerts)", () => {
  it("bands a line by its station thresholds and clears once served (design §3 — ages until it reaches the guest)", async () => {
    const { cfg, cafeId, aguaId, tableId, offers } = await setupTabVenue();

    const { tabId } = await asApp(cfg, (tx) =>
      openPartyTab(tx, cfg, {
        tableId,
        lines: offers.toOfferLines([
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ]),
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
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    // Between the seeded station's overdue (10) and forgotten (15) thresholds.
    await asApp(cfg, (tx) =>
      tx.execute(sql`update ticket_items set queued_at = ${minutesAgo(12)}
                     where working_order_line_id = ${lines[0]!.id}`),
    );

    let row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find(
      (t) => t.id === tableId,
    )!;
    expect(row.timingBand).toBe("overdue");

    await asApp(cfg, (tx) => serveLine(tx, cfg, tabId, 1));
    row = (await asApp(cfg, (tx) => listTablesWithState(tx, cfg))).find((t) => t.id === tableId)!;
    expect(row.timingBand).toBe("fresh");
  });

  it("worst-line-wins: a forgotten line outranks a fresh one on the same table", async () => {
    const { cfg, cafeId, aguaId, tableId, offers } = await setupTabVenue();

    const { tabId } = await asApp(cfg, (tx) =>
      openPartyTab(tx, cfg, {
        tableId,
        lines: offers.toOfferLines([
          { productId: cafeId, quantity: "1" },
          { productId: aguaId, quantity: "1" },
        ]),
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
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo),
    );
    await asApp(cfg, (tx) => fireLines(tx, cfg, tabId, lines));

    // Past the seeded station's forgotten threshold (15).
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

it("identifies the disabled zone that keeps a renamed zone's name", async () => {
  const cfg = await setupVenue();
  const target = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Terrace" }));
  const source = await asApp(cfg, (tx) => createZone(tx, cfg, { name: "Dining" }));
  await asApp(cfg, (tx) => deactivateZone(tx, cfg, target.id));
  await expect(
    asApp(cfg, (tx) => updateZone(tx, cfg, source.id, { name: "Terrace" })),
  ).rejects.toMatchObject({
    code: "zone.name_disabled",
    params: { name: "Terrace", zoneId: target.id },
  });
  expect(await asApp(cfg, (tx) => listZones(tx, cfg, { includeInactive: true }))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: source.id, name: "Dining", active: true }),
      expect.objectContaining({ id: target.id, name: "Terrace", active: false }),
    ]),
  );
  await asApp(cfg, (tx) => updateZone(tx, cfg, source.id, { name: "Dining" }));
});
