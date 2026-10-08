import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  kitchenStations,
  locations,
  products,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { configureZone, createDepartment } from "./operations.js";
import * as routing from "./routing.js";
import { previewRoutingChange } from "./routing-store.js";

vi.mock("./routing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routing.js")>();
  return {
    ...actual,
    chooseMaker: vi.fn(actual.chooseMaker),
    chooseExtraMakerBeside: vi.fn(actual.chooseExtraMakerBeside),
  };
});

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function fixture(tx: Transaction) {
  const [loc] = await tx
    .insert(locations)
    .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning();
  const cfg = { locationId: locationId(loc!.id) };
  const department = await createDepartment(tx, cfg, {
    name: "Dining",
    defaultServiceMode: "table_tab",
  });
  const zones: string[] = [];
  for (const name of ["Terrace", "Patio"]) {
    const [zone] = await tx
      .insert(floorZones)
      .values({ ...cfg, name })
      .returning();
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId: department.id });
    zones.push(zone!.id);
  }
  const [bar, kitchen] = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Bar", isDefault: true },
      { ...cfg, name: "Kitchen" },
    ])
    .returning();
  const food = (await createCategory(tx, { name: "Food" })).id;
  const menu = await createCatalogue(tx, { name: "Menu" });
  const product = async (name: string, categoryId: string | null) =>
    (
      await createProduct(tx, {
        catalogueId: menu.id,
        name,
        categoryId,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      })
    ).id;
  const burger = await product("Burger", food);
  const soup = await product("Soup", food);
  const bread = await product("Bread", null);
  const cheese = await product("Cheese", null);
  const [large] = await tx
    .insert(products)
    .values({ catalogueId: menu.id, parentId: burger, name: "Large", categoryId: null })
    .returning();
  const list = await createExtraList(
    tx,
    {
      name: "Toppings",
      minPicks: 0,
      maxPicks: 1,
      active: true,
      items: [{ productId: cheese, price: "0.50" }],
    },
    "en",
  );
  await writeProductModifiers(tx, burger, [{ kind: "extras", id: list.id }]);
  await writeProductModifiers(tx, soup, [{ kind: "extras", id: list.id }]);
  return {
    cfg,
    terrace: zones[0]!,
    patio: zones[1]!,
    bar: bar!.id,
    kitchen: kitchen!.id,
    burger,
    large: large!.id,
    soup,
    bread,
    cheese,
  };
}

const chooseMakerCalls = () =>
  new Set(
    vi
      .mocked(routing.chooseMaker)
      .mock.calls.map(([, product, zoneId]) => `${product.productId}|${zoneId}`),
  );
const extraCalls = () =>
  new Set(
    vi
      .mocked(routing.chooseExtraMakerBeside)
      .mock.calls.map(([, , extra, zoneId]) => `${extra.productId}|${zoneId}`),
  );

describe("what a routing preview works out", () => {
  it("chooses a maker only for the changed product's lineage, in the changed zone", async () =>
    withTransaction(db, async (tx) => {
      const f = await fixture(tx);
      vi.mocked(routing.chooseMaker).mockClear();
      vi.mocked(routing.chooseExtraMakerBeside).mockClear();
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: { kind: "product", productId: f.burger }, zoneId: f.terrace },
        target: { kind: "station", stationId: f.kitchen },
      });
      expect(moves.map((move) => [move.productId, move.zoneId, move.dish?.productId])).toEqual([
        [f.burger, f.terrace, undefined],
        [f.large, f.terrace, undefined],
      ]);
      expect(chooseMakerCalls()).toEqual(
        new Set([`${f.burger}|${f.terrace}`, `${f.large}|${f.terrace}`]),
      );
      expect(extraCalls()).toEqual(new Set([`${f.cheese}|${f.terrace}`]));
    }));

  it("works out an out-of-reach dish's choice once for an in-reach extra it offers", async () =>
    withTransaction(db, async (tx) => {
      const f = await fixture(tx);
      vi.mocked(routing.chooseMaker).mockClear();
      vi.mocked(routing.chooseExtraMakerBeside).mockClear();
      await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: { kind: "product", productId: f.cheese }, zoneId: f.patio },
        target: { kind: "station", stationId: f.kitchen },
      });
      const calls = vi
        .mocked(routing.chooseMaker)
        .mock.calls.map(([, product, zoneId]) => `${product.productId}|${zoneId}`)
        .sort();
      expect(calls).toEqual(
        [
          `${f.burger}|${f.patio}`,
          `${f.soup}|${f.patio}`,
          `${f.cheese}|${f.patio}`,
          `${f.cheese}|${f.patio}`,
        ].sort(),
      );
      expect(extraCalls()).toEqual(new Set([`${f.cheese}|${f.patio}`]));
    }));
});
