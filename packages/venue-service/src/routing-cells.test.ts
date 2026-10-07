import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  engineErrorMessage,
  floorZones,
  isRefusal,
  kitchenStations,
  locations,
  products,
  UNIQUE_VIOLATION,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment, deactivateServiceZone } from "./operations.js";
import type { RouteTarget } from "./routing.js";
import type { CellAddress } from "./routing-types.js";
import { clearRoutingCell, setRoutingCell } from "./routing-store.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const noPrep: RouteTarget = { kind: "no_preparation" };
const station = (stationId: string): RouteTarget => ({ kind: "station", stationId });

async function venue(tx: Transaction, suffix = "") {
  const [loc] = await tx
    .insert(locations)
    .values({
      name: `Venue${suffix}`,
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    })
    .returning();
  const cfg = { locationId: locationId(loc!.id) };
  const zones = await tx
    .insert(floorZones)
    .values([
      { ...cfg, name: "Terrace" },
      { ...cfg, name: "Inside" },
    ])
    .returning();
  const department = await createDepartment(tx, cfg, {
    name: "Dining",
    defaultServiceMode: "table_tab",
  });
  for (const zone of zones)
    await configureZone(tx, cfg, { zoneId: zone.id, departmentId: department.id });
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Bar", isDefault: true },
      { ...cfg, name: "Kitchen" },
      { ...cfg, name: "Off", active: false },
    ])
    .returning();
  return {
    cfg,
    terrace: zones[0]!.id,
    inside: zones[1]!.id,
    bar: stations[0]!.id,
    kitchen: stations[1]!.id,
    switchedOff: stations[2]!.id,
  };
}

async function fixture(tx: Transaction) {
  const v = await venue(tx);
  const drinks = (await createCategory(tx, { name: "Drinks" })).id;
  const food = (await createCategory(tx, { name: "Food" })).id;
  const menu = await createCatalogue(tx, { name: "Menu" });
  const product = async (name: string) =>
    (
      await createProduct(tx, {
        catalogueId: menu.id,
        name,
        categoryId: drinks,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      })
    ).id;
  const mojito = await product("Mojito");
  const beer = await product("Beer");
  const [variant] = await tx
    .insert(products)
    .values({ catalogueId: menu.id, parentId: mojito, name: "Large", categoryId: null })
    .returning();
  return { ...v, drinks, food, mojito, beer, variant: variant!.id };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const setup = () => withTransaction(db, (tx) => fixture(tx));

type RawCell = {
  category?: string | null;
  product?: string | null;
  zone?: string | null;
  station?: string | null;
  noPrep?: boolean;
};

function rawInsert(f: Fixture, cell: RawCell) {
  return sql`insert into routing_cells
      (id, location_id, category_id, product_id, zone_id, station_id, no_preparation)
    values (${randomUUID()}, ${f.cfg.locationId}, ${cell.category ?? null}, ${cell.product ?? null},
      ${cell.zone ?? null}, ${cell.station ?? null}, ${cell.noPrep === true ? 1 : 0})`;
}

const insert = (statement: ReturnType<typeof sql>) =>
  withTransaction(db, async (tx) => {
    await tx.execute(statement);
  });

async function refused(statement: ReturnType<typeof sql>, kind: readonly number[], words: string) {
  const error = await captureError(() => insert(statement));
  expect(isRefusal(error, kind), words).toBe(true);
  expect(engineErrorMessage(error), words).toContain(words);
}

const UNIQUE = (...columns: string[]) =>
  `UNIQUE constraint failed: ${columns.map((column) => `routing_cells.${column}`).join(", ")}`;

describe("the routing_cells table", () => {
  it("stores each of the five coordinate classes once and refuses a second identical one", async () => {
    const f = await setup();
    const classes: [RawCell, string][] = [
      [{ category: f.drinks }, UNIQUE("location_id", "category_id")],
      [{ category: f.drinks, zone: f.terrace }, UNIQUE("location_id", "category_id", "zone_id")],
      [{ product: f.mojito }, UNIQUE("location_id", "product_id")],
      [{ product: f.mojito, zone: f.terrace }, UNIQUE("location_id", "product_id", "zone_id")],
      [{ zone: f.terrace }, UNIQUE("location_id", "zone_id")],
    ];
    for (const [cell] of classes) await insert(rawInsert(f, { ...cell, station: f.bar }));
    for (const [cell, words] of classes)
      await refused(rawInsert(f, { ...cell, noPrep: true }), UNIQUE_VIOLATION, words);
    const [stored] = (await db.execute<{ n: number }>(sql`select count(*) as n from routing_cells`))
      .rows;
    expect(stored!.n).toBe(5);
  });

  it("lets different categories, products and zones coexist", async () => {
    const f = await setup();
    const cells: RawCell[] = [
      { category: f.drinks },
      { category: f.food },
      { category: f.drinks, zone: f.terrace },
      { category: f.drinks, zone: f.inside },
      { category: f.food, zone: f.terrace },
      { product: f.mojito },
      { product: f.beer },
      { product: f.mojito, zone: f.terrace },
      { product: f.mojito, zone: f.inside },
      { product: f.beer, zone: f.terrace },
      { zone: f.terrace },
      { zone: f.inside },
    ];
    for (const cell of cells) await insert(rawInsert(f, { ...cell, station: f.kitchen }));
    const [stored] = (await db.execute<{ n: number }>(sql`select count(*) as n from routing_cells`))
      .rows;
    expect(stored!.n).toBe(cells.length);
  });

  it("refuses both subjects, no target, both targets, and the implicit All × Every zone coordinate", async () => {
    const f = await setup();
    await refused(
      rawInsert(f, { category: f.drinks, product: f.mojito, station: f.bar }),
      CHECK_VIOLATION,
      "CHECK constraint failed: routing_cells_subject_ck",
    );
    await refused(
      rawInsert(f, { category: f.drinks }),
      CHECK_VIOLATION,
      "CHECK constraint failed: routing_cells_target_ck",
    );
    await refused(
      rawInsert(f, { category: f.drinks, station: f.bar, noPrep: true }),
      CHECK_VIOLATION,
      "CHECK constraint failed: routing_cells_target_ck",
    );
    await refused(
      rawInsert(f, { station: f.bar }),
      CHECK_VIOLATION,
      "CHECK constraint failed: routing_cells_coordinate_ck",
    );
    await refused(
      rawInsert(f, { noPrep: true }),
      CHECK_VIOLATION,
      "CHECK constraint failed: routing_cells_coordinate_ck",
    );
  });
});

type StoredCell = {
  category_id: string | null;
  product_id: string | null;
  zone_id: string | null;
  station_id: string | null;
  no_preparation: number;
};

async function readStoredCells(f: Fixture): Promise<StoredCell[]> {
  return (
    await db.execute<StoredCell>(
      sql`select category_id, product_id, zone_id, station_id, no_preparation
        from routing_cells where location_id = ${f.cfg.locationId}
        order by category_id, product_id, zone_id`,
    )
  ).rows;
}

async function readStoredCell(f: Fixture, address: CellAddress): Promise<StoredCell | undefined> {
  const row = address.row;
  return (await readStoredCells(f)).find(
    (cell) =>
      cell.category_id === (row.kind === "category" ? row.categoryId : null) &&
      cell.product_id === (row.kind === "product" ? row.productId : null) &&
      cell.zone_id === address.zoneId,
  );
}

const scoped = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(db, fn);

describe("setRoutingCell / clearRoutingCell", () => {
  it("sets, replaces, and clears twice", async () => {
    const f = await setup();
    const address: CellAddress = {
      row: { kind: "category", categoryId: f.drinks },
      zoneId: f.terrace,
    };
    await scoped((tx) => setRoutingCell(tx, f.cfg, address, station(f.bar)));
    expect(await readStoredCells(f)).toEqual([
      {
        category_id: f.drinks,
        product_id: null,
        zone_id: f.terrace,
        station_id: f.bar,
        no_preparation: 0,
      },
    ]);
    await scoped((tx) => setRoutingCell(tx, f.cfg, address, station(f.kitchen)));
    expect(await readStoredCells(f)).toEqual([
      {
        category_id: f.drinks,
        product_id: null,
        zone_id: f.terrace,
        station_id: f.kitchen,
        no_preparation: 0,
      },
    ]);
    await scoped((tx) => clearRoutingCell(tx, f.cfg, address));
    await scoped((tx) => clearRoutingCell(tx, f.cfg, address));
    expect(await readStoredCells(f)).toEqual([]);
  });

  it("writes each coordinate class to its own row and clears only the addressed one", async () => {
    const f = await setup();
    const addresses: CellAddress[] = [
      { row: { kind: "category", categoryId: f.drinks }, zoneId: null },
      { row: { kind: "category", categoryId: f.drinks }, zoneId: f.terrace },
      { row: { kind: "product", productId: f.mojito }, zoneId: null },
      { row: { kind: "product", productId: f.mojito }, zoneId: f.terrace },
      { row: { kind: "all" }, zoneId: f.terrace },
    ];
    await scoped(async (tx) => {
      for (const address of addresses) await setRoutingCell(tx, f.cfg, address, station(f.kitchen));
    });
    expect(await readStoredCells(f)).toHaveLength(5);
    await scoped((tx) => clearRoutingCell(tx, f.cfg, addresses[1]!));
    expect(await readStoredCell(f, addresses[1]!)).toBeUndefined();
    for (const address of [addresses[0]!, ...addresses.slice(2)])
      expect(await readStoredCell(f, address)).toMatchObject({ station_id: f.kitchen });
  });

  it("stores explicit No preparation distinctly from a cleared cell", async () => {
    const f = await setup();
    const address: CellAddress = { row: { kind: "product", productId: f.mojito }, zoneId: null };
    await scoped((tx) => setRoutingCell(tx, f.cfg, address, noPrep));
    expect(await readStoredCell(f, address)).toEqual({
      category_id: null,
      product_id: f.mojito,
      zone_id: null,
      station_id: null,
      no_preparation: 1,
    });
    await scoped((tx) => clearRoutingCell(tx, f.cfg, address));
    expect(await readStoredCell(f, address)).toBeUndefined();
  });

  it("accepts caller UUID spellings and stores the canonical one", async () => {
    const f = await setup();
    const upper: CellAddress = {
      row: { kind: "product", productId: f.mojito.toUpperCase() },
      zoneId: f.terrace.toUpperCase(),
    };
    await scoped((tx) => setRoutingCell(tx, f.cfg, upper, station(f.bar.toUpperCase())));
    await scoped((tx) => setRoutingCell(tx, f.cfg, upper, station(f.kitchen.toUpperCase())));
    expect(await readStoredCells(f)).toEqual([
      {
        category_id: null,
        product_id: f.mojito,
        zone_id: f.terrace,
        station_id: f.kitchen,
        no_preparation: 0,
      },
    ]);
    await scoped((tx) => clearRoutingCell(tx, f.cfg, upper));
    expect(await readStoredCells(f)).toEqual([]);
  });

  it("refuses a variant or unknown subject", async () => {
    const f = await setup();
    const cases: [CellAddress, Record<string, string>][] = [
      [
        { row: { kind: "product", productId: f.variant }, zoneId: null },
        { subject: "product", id: f.variant },
      ],
    ];
    const unknownProduct = randomUUID(),
      unknownCategory = randomUUID();
    cases.push(
      [
        { row: { kind: "product", productId: unknownProduct }, zoneId: f.terrace },
        { subject: "product", id: unknownProduct },
      ],
      [
        { row: { kind: "category", categoryId: unknownCategory }, zoneId: null },
        { subject: "category", id: unknownCategory },
      ],
    );
    for (const [address, params] of cases) {
      await expect(
        scoped((tx) => setRoutingCell(tx, f.cfg, address, noPrep)),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
        params,
      });
      await expect(scoped((tx) => clearRoutingCell(tx, f.cfg, address))).rejects.toMatchObject({
        code: "route.subject_not_found",
        params,
      });
    }
    expect(await readStoredCells(f)).toEqual([]);
  });

  it("refuses an inactive or foreign-location station", async () => {
    const f = await setup();
    const other = await scoped((tx) => venue(tx, " (other)"));
    const address: CellAddress = { row: { kind: "category", categoryId: f.drinks }, zoneId: null };
    for (const stationId of [f.switchedOff, other.bar, randomUUID()])
      await expect(
        scoped((tx) => setRoutingCell(tx, f.cfg, address, station(stationId))),
      ).rejects.toMatchObject({ code: "route.station_inactive", params: { stationId } });
    expect(await readStoredCells(f)).toEqual([]);
  });

  it("refuses an inactive or foreign zone", async () => {
    const f = await setup();
    const other = await scoped((tx) => venue(tx, " (other)"));
    await scoped((tx) => deactivateServiceZone(tx, f.cfg, f.inside));
    for (const zoneId of [f.inside, other.terrace, randomUUID()]) {
      const address: CellAddress = { row: { kind: "category", categoryId: f.drinks }, zoneId };
      await expect(
        scoped((tx) => setRoutingCell(tx, f.cfg, address, station(f.bar))),
      ).rejects.toMatchObject({ code: "service_zone.not_found", params: { zoneId } });
    }
    expect(await readStoredCells(f)).toEqual([]);
  });

  it("refuses the All × Every zone address for both set and clear", async () => {
    const f = await setup();
    const address: CellAddress = { row: { kind: "all" }, zoneId: null };
    for (const write of [
      (tx: Transaction) => setRoutingCell(tx, f.cfg, address, station(f.kitchen)),
      (tx: Transaction) => setRoutingCell(tx, f.cfg, address, noPrep),
      (tx: Transaction) => clearRoutingCell(tx, f.cfg, address),
    ])
      await expect(scoped(write)).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "address" },
      });
    expect(await readStoredCells(f)).toEqual([]);
  });

  it("never changes the default station when clearing", async () => {
    const f = await setup();
    const address: CellAddress = { row: { kind: "all" }, zoneId: f.terrace };
    await scoped((tx) => setRoutingCell(tx, f.cfg, address, station(f.kitchen)));
    await scoped((tx) => clearRoutingCell(tx, f.cfg, address));
    const defaults = await db
      .select({ id: kitchenStations.id, isDefault: kitchenStations.isDefault })
      .from(kitchenStations)
      .where(eq(kitchenStations.locationId, f.cfg.locationId));
    expect(defaults.filter((row) => row.isDefault).map((row) => row.id)).toEqual([f.bar]);
    expect(await readStoredCells(f)).toEqual([]);
  });

  it("scopes a clear to its own location", async () => {
    const f = await setup();
    const other = await scoped((tx) => venue(tx, " (other)"));
    const address: CellAddress = { row: { kind: "category", categoryId: f.drinks }, zoneId: null };
    await scoped((tx) => setRoutingCell(tx, f.cfg, address, station(f.bar)));
    await scoped((tx) => clearRoutingCell(tx, other.cfg, address));
    expect(await readStoredCell(f, address)).toMatchObject({ station_id: f.bar });
  });

  it("two queued transactions writing one coordinate leave one row holding the second value", async () => {
    const f = await setup();
    const address: CellAddress = {
      row: { kind: "category", categoryId: f.drinks },
      zoneId: f.terrace,
    };
    await Promise.all([
      scoped((tx) => setRoutingCell(tx, f.cfg, address, station(f.bar))),
      scoped((tx) => setRoutingCell(tx, f.cfg, address, station(f.kitchen))),
    ]);
    expect(await readStoredCells(f)).toEqual([
      {
        category_id: f.drinks,
        product_id: null,
        zone_id: f.terrace,
        station_id: f.kitchen,
        no_preparation: 0,
      },
    ]);
  });
});
