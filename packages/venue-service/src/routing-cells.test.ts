import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createCatalogue, createCategory, createProduct } from "@waitron/menu";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  departments,
  engineErrorMessage,
  floorZones,
  isRefusal,
  kitchenStations,
  products,
  UNIQUE_VIOLATION,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { configureZone, createDepartment } from "./operations.js";
import type { RouteTarget } from "./routing.js";
import type { CellAddress } from "./routing-types.js";
import { clearRoutingCell, setRoutingCell } from "./routing-store.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const noPrep: RouteTarget = { kind: "no_preparation" };
const station = (stationId: string): RouteTarget => ({ kind: "station", stationId });

async function venue(tx: Transaction, suffix = "") {
  await seedVenue(tx, {
    name: `Venue${suffix}`,
    invoiceLocales: ["en-GB"],
    operationDescription: "Hospitality",
  });
  const cfg = {};
  const department = await createDepartment(tx, {
    name: "Dining",
    orderStart: "table",
  });
  const zones = await tx
    .insert(floorZones)
    .values([
      { ...cfg, name: "Terrace", departmentId: department.id },
      { ...cfg, name: "Inside", departmentId: department.id },
    ])
    .returning();
  for (const zone of zones)
    await configureZone(tx, { zoneId: zone.id, departmentId: department.id });
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
  noCategory?: boolean | number;
};

function rawInsert(_f: Fixture, cell: RawCell) {
  return sql`insert into routing_cells
      (id, category_id, product_id, zone_id, station_id, no_preparation, no_category)
    values (${randomUUID()}, ${cell.category ?? null}, ${cell.product ?? null}, ${cell.zone ?? null}, ${cell.station ?? null}, ${cell.noPrep === true ? 1 : 0}, ${typeof cell.noCategory === "number" ? cell.noCategory : cell.noCategory === true ? 1 : 0})`;
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
  it("stores each of the seven coordinate classes once and refuses a second identical one", async () => {
    const f = await setup();
    const classes: [RawCell, string][] = [
      [{ category: f.drinks }, UNIQUE("category_id")],
      [{ category: f.drinks, zone: f.terrace }, UNIQUE("category_id", "zone_id")],
      [{ product: f.mojito }, UNIQUE("product_id")],
      [{ product: f.mojito, zone: f.terrace }, UNIQUE("product_id", "zone_id")],
      [{ zone: f.terrace }, UNIQUE("zone_id")],
      [{ noCategory: true }, UNIQUE("no_category")],
      [{ noCategory: true, zone: f.terrace }, UNIQUE("no_category", "zone_id")],
    ];
    for (const [cell] of classes) await insert(rawInsert(f, { ...cell, station: f.bar }));
    for (const [cell, words] of classes)
      await refused(rawInsert(f, { ...cell, noPrep: true }), UNIQUE_VIOLATION, words);
    const [stored] = (await db.execute<{ n: number }>(sql`select count(*) as n from routing_cells`))
      .rows;
    expect(stored!.n).toBe(7);
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
      { noCategory: true },
      { noCategory: true, zone: f.terrace },
      { noCategory: true, zone: f.inside },
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
    await refused(
      rawInsert(f, { noCategory: 0, station: f.bar }),
      CHECK_VIOLATION,
      "CHECK constraint failed: routing_cells_coordinate_ck",
    );
    for (const cell of [
      { noCategory: true, category: f.drinks },
      { noCategory: true, product: f.mojito, zone: f.terrace },
      { noCategory: 2 },
    ])
      await refused(
        rawInsert(f, { ...cell, station: f.bar }),
        CHECK_VIOLATION,
        "CHECK constraint failed: routing_cells_no_category_ck",
      );
  });
});

type StoredCell = {
  category_id: string | null;
  product_id: string | null;
  zone_id: string | null;
  station_id: string | null;
  no_preparation: number;
  no_category: number;
};

async function readStoredCells(): Promise<StoredCell[]> {
  return (
    await db.execute<StoredCell>(
      sql`select category_id, product_id, zone_id, station_id, no_preparation, no_category
        from routing_cells
        order by category_id, product_id, no_category, zone_id`,
    )
  ).rows;
}

async function readStoredCell(address: CellAddress): Promise<StoredCell | undefined> {
  const row = address.row;
  return (await readStoredCells()).find(
    (cell) =>
      cell.category_id === (row.kind === "category" ? row.categoryId : null) &&
      cell.product_id === (row.kind === "product" ? row.productId : null) &&
      cell.no_category === (row.kind === "no_category" ? 1 : 0) &&
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
    await scoped((tx) => setRoutingCell(tx, address, station(f.bar)));
    expect(await readStoredCells()).toEqual([
      {
        category_id: f.drinks,
        product_id: null,
        zone_id: f.terrace,
        station_id: f.bar,
        no_preparation: 0,
        no_category: 0,
      },
    ]);
    await scoped((tx) => setRoutingCell(tx, address, station(f.kitchen)));
    expect(await readStoredCells()).toEqual([
      {
        category_id: f.drinks,
        product_id: null,
        zone_id: f.terrace,
        station_id: f.kitchen,
        no_preparation: 0,
        no_category: 0,
      },
    ]);
    await scoped((tx) => clearRoutingCell(tx, address));
    await scoped((tx) => clearRoutingCell(tx, address));
    expect(await readStoredCells()).toEqual([]);
  });

  it("writes each coordinate class to its own row and clears only the addressed one", async () => {
    const f = await setup();
    const addresses: CellAddress[] = [
      { row: { kind: "category", categoryId: f.drinks }, zoneId: null },
      { row: { kind: "category", categoryId: f.drinks }, zoneId: f.terrace },
      { row: { kind: "product", productId: f.mojito }, zoneId: null },
      { row: { kind: "product", productId: f.mojito }, zoneId: f.terrace },
      { row: { kind: "all" }, zoneId: f.terrace },
      { row: { kind: "no_category" }, zoneId: null },
      { row: { kind: "no_category" }, zoneId: f.terrace },
    ];
    await scoped(async (tx) => {
      for (const address of addresses) await setRoutingCell(tx, address, station(f.kitchen));
    });
    expect(await readStoredCells()).toHaveLength(7);
    await scoped((tx) => clearRoutingCell(tx, addresses[1]!));
    expect(await readStoredCell(addresses[1]!)).toBeUndefined();
    for (const address of [addresses[0]!, ...addresses.slice(2)])
      expect(await readStoredCell(address)).toMatchObject({ station_id: f.kitchen });
  });

  it("keeps a category × zone cell when the same category's Every zone cell is set and cleared", async () => {
    const f = await setup();
    const terrace: CellAddress = {
      row: { kind: "category", categoryId: f.drinks },
      zoneId: f.terrace,
    };
    const everyZone: CellAddress = {
      row: { kind: "category", categoryId: f.drinks },
      zoneId: null,
    };
    const terraceRow = {
      category_id: f.drinks,
      product_id: null,
      zone_id: f.terrace,
      station_id: f.bar,
      no_preparation: 0,
      no_category: 0,
    };
    await scoped((tx) => setRoutingCell(tx, terrace, station(f.bar)));
    await scoped((tx) => setRoutingCell(tx, everyZone, station(f.kitchen)));
    expect(await readStoredCells()).toEqual([
      {
        category_id: f.drinks,
        product_id: null,
        zone_id: null,
        station_id: f.kitchen,
        no_preparation: 0,
        no_category: 0,
      },
      terraceRow,
    ]);
    await scoped((tx) => clearRoutingCell(tx, everyZone));
    expect(await readStoredCells()).toEqual([terraceRow]);
  });

  it("stores explicit No preparation distinctly from a cleared cell", async () => {
    const f = await setup();
    const address: CellAddress = { row: { kind: "product", productId: f.mojito }, zoneId: null };
    await scoped((tx) => setRoutingCell(tx, address, noPrep));
    expect(await readStoredCell(address)).toEqual({
      category_id: null,
      product_id: f.mojito,
      zone_id: null,
      station_id: null,
      no_preparation: 1,
      no_category: 0,
    });
    await scoped((tx) => clearRoutingCell(tx, address));
    expect(await readStoredCell(address)).toBeUndefined();
  });

  it("accepts caller UUID spellings and stores the canonical one", async () => {
    const f = await setup();
    const upper: CellAddress = {
      row: { kind: "product", productId: f.mojito.toUpperCase() },
      zoneId: f.terrace.toUpperCase(),
    };
    await scoped((tx) => setRoutingCell(tx, upper, station(f.bar.toUpperCase())));
    await scoped((tx) => setRoutingCell(tx, upper, station(f.kitchen.toUpperCase())));
    expect(await readStoredCells()).toEqual([
      {
        category_id: null,
        product_id: f.mojito,
        zone_id: f.terrace,
        station_id: f.kitchen,
        no_preparation: 0,
        no_category: 0,
      },
    ]);
    await scoped((tx) => clearRoutingCell(tx, upper));
    expect(await readStoredCells()).toEqual([]);
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
      await expect(scoped((tx) => setRoutingCell(tx, address, noPrep))).rejects.toMatchObject({
        code: "route.subject_not_found",
        params,
      });
      await expect(scoped((tx) => clearRoutingCell(tx, address))).rejects.toMatchObject({
        code: "route.subject_not_found",
        params,
      });
    }
    expect(await readStoredCells()).toEqual([]);
  });

  it("refuses an inactive or unknown station", async () => {
    const f = await setup();
    const address: CellAddress = { row: { kind: "category", categoryId: f.drinks }, zoneId: null };
    for (const stationId of [f.switchedOff, randomUUID()])
      await expect(
        scoped((tx) => setRoutingCell(tx, address, station(stationId))),
      ).rejects.toMatchObject({ code: "route.station_inactive", params: { stationId } });
    expect(await readStoredCells()).toEqual([]);
  });

  it("refuses an inactive or unknown zone", async () => {
    const f = await setup();
    await scoped(async (tx) =>
      tx.execute(sql`update floor_zones set active = false where id = ${f.inside}`),
    );
    for (const zoneId of [f.inside, randomUUID()]) {
      const address: CellAddress = { row: { kind: "category", categoryId: f.drinks }, zoneId };
      await expect(
        scoped((tx) => setRoutingCell(tx, address, station(f.bar))),
      ).rejects.toMatchObject({ code: "service_zone.not_found", params: { zoneId } });
    }
    expect(await readStoredCells()).toEqual([]);
  });

  it("refuses moving an active zone with a cell into a switched-off department and leaves the cell as it was", async () => {
    const f = await setup();
    const address: CellAddress = {
      row: { kind: "category", categoryId: f.drinks },
      zoneId: f.terrace,
    };
    await scoped((tx) => setRoutingCell(tx, address, station(f.bar)));
    const before = await readStoredCells();
    expect(before).toEqual([expect.objectContaining({ zone_id: f.terrace, station_id: f.bar })]);
    const closed = await scoped((tx) =>
      createDepartment(tx, { name: "Closed", orderStart: "table" }),
    );
    await scoped((tx) =>
      (async () => {
        await tx.execute(
          sql`update floor_zones set active = false where id in (select id as zone_id from floor_zones where department_id = ${closed.id})`,
        );
        await tx.execute(sql`update departments set active = false where id = ${closed.id}`);
      })(),
    );
    await expect(
      scoped((tx) => configureZone(tx, { zoneId: f.terrace, departmentId: closed.id })),
    ).rejects.toMatchObject({
      code: "department.not_found",
      params: { departmentId: closed.id },
    });
    expect(await readStoredCells()).toEqual(before);
    await scoped((tx) => clearRoutingCell(tx, address));
    expect(await readStoredCells()).toEqual([]);
  });

  it("refuses an active zone whose department is switched off", async () => {
    const f = await setup();
    const [dining] = await db.select({ id: departments.id }).from(departments);
    await db.update(departments).set({ active: false }).where(eq(departments.id, dining!.id));
    const address: CellAddress = {
      row: { kind: "category", categoryId: f.drinks },
      zoneId: f.terrace,
    };
    await expect(scoped((tx) => setRoutingCell(tx, address, station(f.bar)))).rejects.toMatchObject(
      { code: "service_zone.not_found", params: { zoneId: f.terrace } },
    );
    expect(await readStoredCells()).toEqual([]);
  });

  it("a No category cell and an All categories cell at the same zone are separate: setting, replacing and clearing one leaves the other", async () => {
    const f = await setup();
    const all: CellAddress = { row: { kind: "all" }, zoneId: f.terrace };
    const none: CellAddress = { row: { kind: "no_category" }, zoneId: f.terrace };
    const allRow = {
      category_id: null,
      product_id: null,
      zone_id: f.terrace,
      station_id: f.bar,
      no_preparation: 0,
      no_category: 0,
    };
    const noneRow = (stationId: string) => ({
      category_id: null,
      product_id: null,
      zone_id: f.terrace,
      station_id: stationId,
      no_preparation: 0,
      no_category: 1,
    });
    await scoped((tx) => setRoutingCell(tx, all, station(f.bar)));
    await scoped((tx) => setRoutingCell(tx, none, station(f.kitchen)));
    expect(await readStoredCells()).toEqual([allRow, noneRow(f.kitchen)]);
    await scoped((tx) => setRoutingCell(tx, none, station(f.bar)));
    expect(await readStoredCells()).toEqual([allRow, noneRow(f.bar)]);
    await scoped((tx) => clearRoutingCell(tx, none));
    expect(await readStoredCells()).toEqual([allRow]);
    await scoped((tx) => setRoutingCell(tx, none, station(f.kitchen)));
    await scoped((tx) => setRoutingCell(tx, all, station(f.kitchen)));
    expect(await readStoredCells()).toEqual([
      { ...allRow, station_id: f.kitchen },
      noneRow(f.kitchen),
    ]);
    await scoped((tx) => clearRoutingCell(tx, all));
    expect(await readStoredCells()).toEqual([noneRow(f.kitchen)]);
  });

  it("stores explicit No preparation on No category × Every zone, and clears it", async () => {
    await setup();
    const address: CellAddress = { row: { kind: "no_category" }, zoneId: null };
    await scoped((tx) => setRoutingCell(tx, address, noPrep));
    expect(await readStoredCells()).toEqual([
      {
        category_id: null,
        product_id: null,
        zone_id: null,
        station_id: null,
        no_preparation: 1,
        no_category: 1,
      },
    ]);
    await scoped((tx) => clearRoutingCell(tx, address));
    expect(await readStoredCells()).toEqual([]);
  });

  it("refuses an inactive zone and an inactive station for a No category cell with the same codes as any row", async () => {
    const f = await setup();
    await scoped(async (tx) =>
      tx.execute(sql`update floor_zones set active = false where id = ${f.inside}`),
    );
    const inside: CellAddress = { row: { kind: "no_category" }, zoneId: f.inside };
    await expect(scoped((tx) => setRoutingCell(tx, inside, station(f.bar)))).rejects.toMatchObject({
      code: "service_zone.not_found",
      params: { zoneId: f.inside },
    });
    await expect(scoped((tx) => clearRoutingCell(tx, inside))).rejects.toMatchObject({
      code: "service_zone.not_found",
      params: { zoneId: f.inside },
    });
    for (const zoneId of [null, f.terrace])
      await expect(
        scoped((tx) =>
          setRoutingCell(tx, { row: { kind: "no_category" }, zoneId }, station(f.switchedOff)),
        ),
      ).rejects.toMatchObject({
        code: "route.station_inactive",
        params: { stationId: f.switchedOff },
      });
    expect(await readStoredCells()).toEqual([]);
  });

  it("refuses the All × Every zone address for both set and clear", async () => {
    const f = await setup();
    const address: CellAddress = { row: { kind: "all" }, zoneId: null };
    for (const write of [
      (tx: Transaction) => setRoutingCell(tx, address, station(f.kitchen)),
      (tx: Transaction) => setRoutingCell(tx, address, noPrep),
      (tx: Transaction) => clearRoutingCell(tx, address),
    ])
      await expect(scoped(write)).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "address" },
      });
    expect(await readStoredCells()).toEqual([]);
  });

  it("never changes the default station when clearing", async () => {
    const f = await setup();
    const address: CellAddress = { row: { kind: "all" }, zoneId: f.terrace };
    await scoped((tx) => setRoutingCell(tx, address, station(f.kitchen)));
    await scoped((tx) => clearRoutingCell(tx, address));
    const defaults = await db
      .select({ id: kitchenStations.id, isDefault: kitchenStations.isDefault })
      .from(kitchenStations)
      .where(sql`true`);
    expect(defaults.filter((row) => row.isDefault).map((row) => row.id)).toEqual([f.bar]);
    expect(await readStoredCells()).toEqual([]);
  });

  it("two queued transactions writing one coordinate leave one row holding the second value", async () => {
    const f = await setup();
    const address: CellAddress = {
      row: { kind: "category", categoryId: f.drinks },
      zoneId: f.terrace,
    };
    await Promise.all([
      scoped((tx) => setRoutingCell(tx, address, station(f.bar))),
      scoped((tx) => setRoutingCell(tx, address, station(f.kitchen))),
    ]);
    expect(await readStoredCells()).toEqual([
      {
        category_id: f.drinks,
        product_id: null,
        zone_id: f.terrace,
        station_id: f.kitchen,
        no_preparation: 0,
        no_category: 0,
      },
    ]);
  });
});
