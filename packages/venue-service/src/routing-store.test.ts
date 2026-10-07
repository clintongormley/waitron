import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  categories,
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
import {
  selectRoutingCell,
  selectionRulesFromModel,
  type RouteTarget,
  type RoutingModel,
  type RoutingMoment,
  type RoutingRow,
} from "./routing.js";
import {
  describeMakers,
  explainRoute,
  loadRoutingRules,
  previewRoutingChange,
  resolveMakers,
  resolveExtraMakers,
  routingAt,
  stationStates,
  routingModel,
  setRoutingCell,
  clearRoutingCell,
} from "./routing-store.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import { configureZone, createDepartment } from "./operations.js";
import { routingCells } from "./schema/routing.js";
import type { CellAddress, RoutingCell } from "./routing-types.js";
import { setStationFallback, setStationToday } from "./station-times.js";
import { seedStationWeek } from "./testing/station-week.js";
import { clockChangeAfter, minutesAfter } from "./testing/clock-change.js";
import { saveSpecialDate } from "./hours.js";

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
const categoryRow = (categoryId: string) => ({ kind: "category" as const, categoryId });
const productRow = (productId: string) => ({ kind: "product" as const, productId });
const setCategoryCell = (
  tx: Transaction,
  cfg: { locationId: string },
  categoryId: string,
  target: RouteTarget,
) => setRoutingCell(tx, cfg as never, { row: categoryRow(categoryId), zoneId: null }, target);

/** `suffix` tells apart the names of a second fixture in one database, where root categories and
 * Active products may not share a name with the first's. */
async function fixture(tx: Transaction, suffix = "") {
  const [loc] = await tx
    .insert(locations)
    .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning();
  const cfg = { locationId: locationId(loc!.id) };
  const [terrace] = await tx
    .insert(floorZones)
    .values({ ...cfg, name: "Terrace" })
    .returning();
  const department = await createDepartment(tx, cfg, {
    name: "Dining",
    defaultServiceMode: "table_tab",
  });
  await configureZone(tx, cfg, { zoneId: terrace!.id, departmentId: department.id });
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Bar", isDefault: true },
      { ...cfg, name: "Terrace Bar" },
      { ...cfg, name: "Off", active: false },
    ])
    .returning();
  const bar = stations[0]!.id,
    terraceBar = stations[1]!.id,
    switchedOff = stations[2]!.id;
  const drinks = (await createCategory(tx, { name: `Drinks${suffix}` })).id;
  const beer = (await createCategory(tx, { name: "Beer", parentId: drinks })).id;
  const cocktails = (await createCategory(tx, { name: "Cocktails", parentId: drinks })).id;
  const food = (await createCategory(tx, { name: `Food${suffix}` })).id;
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
  const mojito = await product(`Mojito${suffix}`, cocktails);
  const bread = await product(`Bread${suffix}`, null);
  const [variant] = await tx
    .insert(products)
    .values({ catalogueId: menu.id, parentId: mojito, name: "Large", categoryId: null })
    .returning();
  return {
    cfg,
    department: department.id,
    terrace: terrace!.id,
    bar,
    terraceBar,
    switchedOff,
    drinks,
    beer,
    cocktails,
    food,
    mojito,
    bread,
    variant: variant!.id,
  };
}
const scoped = (fn: (tx: Transaction) => Promise<void>) => withTransaction(db, fn);
const noCategoryRow = { kind: "no_category" as const };
/** A variant of the uncategorised bread that stores a category of its own (Food). */
async function breadVariant(tx: Transaction, f: { bread: string; food: string }) {
  const [bread] = await tx
    .select({ catalogueId: products.catalogueId })
    .from(products)
    .where(eq(products.id, f.bread));
  const [half] = await tx
    .insert(products)
    .values({
      catalogueId: bread!.catalogueId,
      parentId: f.bread,
      name: "Half",
      categoryId: f.food,
    })
    .returning();
  return half!.id;
}
const cellKey = (cell: RoutingCell) =>
  `${cell.row.kind}:${cell.row.kind === "category" ? cell.row.categoryId : cell.row.kind === "product" ? cell.row.productId : ""}:${cell.zoneId ?? ""}`;
const sortCells = (cells: readonly RoutingCell[]) =>
  [...cells].sort((a, b) => cellKey(a).localeCompare(cellKey(b)));

describe("route explanation", () => {
  it("loads a frozen cell list, so routing a whole catalogue indexes it once", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, station(f.bar));
      expect(Object.isFrozen((await loadRoutingRules(tx, f.cfg, null)).cells)).toBe(true);
    }));
  it("names the unavailable station when an inactive maker has no fallback", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, {
        kind: "station",
        stationId: f.terraceBar,
      });
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.terraceBar));
      expect((await describeMakers(tx, f.cfg)).get(f.mojito)).toEqual({
        route: null,
        variesByZone: false,
        noReplacement: true,
        unavailableStationId: f.terraceBar,
      });
    }));
  it("omits variants whose parent product is inactive from maker descriptions", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(products).set({ active: false }).where(eq(products.id, f.mojito));
      const makers = await describeMakers(tx, f.cfg);
      expect(makers.has(f.mojito)).toBe(false);
      expect(makers.has(f.variant)).toBe(false);
      expect(makers.get(f.bread)).toEqual({
        route: { kind: "station", stationId: f.bar },
        variesByZone: false,
        noReplacement: false,
        unavailableStationId: null,
      });
    }));

  it("rejects an unknown product", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await expect(
        explainRoute(tx, f.cfg, randomUUID(), null, {
          kind: "now",
          at: new Date("2026-10-02T22:00:00Z"),
        }),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
        params: { subject: "product" },
      });
    }));
  it("describes active variants and zone-sensitive rules without a service zone", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      await setRoutingCell(
        tx,
        f.cfg,
        { row: categoryRow(f.cocktails), zoneId: f.terrace },
        station(f.terraceBar),
      );
      const makers = await describeMakers(tx, f.cfg);
      expect(makers.get(f.mojito)).toEqual({
        route: { kind: "station", stationId: f.bar },
        variesByZone: true,
        noReplacement: false,
        unavailableStationId: null,
      });
      expect(makers.get(f.variant)).toEqual({
        route: { kind: "station", stationId: f.bar },
        variesByZone: true,
        noReplacement: false,
        unavailableStationId: null,
      });
      expect(makers.get(f.bread)).toEqual({
        route: { kind: "station", stationId: f.bar },
        variesByZone: false,
        noReplacement: false,
        unavailableStationId: null,
      });
    }));
  it("varies by zone when an All categories × zone cell changes the outcome", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setRoutingCell(
        tx,
        f.cfg,
        { row: { kind: "all" }, zoneId: f.terrace },
        station(f.terraceBar),
      );
      const makers = await describeMakers(tx, f.cfg);
      for (const id of [f.mojito, f.variant, f.bread])
        expect(makers.get(id)).toEqual({
          route: station(f.bar),
          variesByZone: true,
          noReplacement: false,
          unavailableStationId: null,
        });
      await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.terrace));
      expect((await describeMakers(tx, f.cfg)).get(f.bread)).toMatchObject({
        variesByZone: false,
      });
    }));
  it("does not vary when a zone cell names the same station as Every zone", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, station(f.terraceBar));
      await setRoutingCell(
        tx,
        f.cfg,
        { row: categoryRow(f.cocktails), zoneId: f.terrace },
        station(f.terraceBar),
      );
      expect((await describeMakers(tx, f.cfg)).get(f.mojito)).toEqual({
        route: station(f.terraceBar),
        variesByZone: false,
        noReplacement: false,
        unavailableStationId: null,
      });
    }));
  it("does not vary for a shadowed parent zone cell under the child's own Every zone", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setRoutingCell(
        tx,
        f.cfg,
        { row: categoryRow(f.drinks), zoneId: f.terrace },
        station(f.terraceBar),
      );
      await setCategoryCell(tx, f.cfg, f.cocktails, station(f.bar));
      const makers = await describeMakers(tx, f.cfg);
      expect(makers.get(f.mojito)).toEqual({
        route: station(f.bar),
        variesByZone: false,
        noReplacement: false,
        unavailableStationId: null,
      });
      const lager = await createProduct(tx, {
        catalogueId: (await createCatalogue(tx, { name: "Beers" })).id,
        name: "Lager",
        categoryId: f.beer,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      expect((await describeMakers(tx, f.cfg)).get(lager.id)).toMatchObject({
        variesByZone: true,
      });
    }));
  it("varies when a zone's station fails with no replacement", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setRoutingCell(
        tx,
        f.cfg,
        { row: categoryRow(f.cocktails), zoneId: f.terrace },
        station(f.terraceBar),
      );
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(inArray(kitchenStations.id, [f.bar, f.terraceBar]));
      const makers = await describeMakers(tx, f.cfg);
      expect(makers.get(f.mojito)).toEqual({
        route: null,
        variesByZone: true,
        noReplacement: false,
        unavailableStationId: null,
      });
      expect(makers.get(f.bread)).toMatchObject({ route: null, variesByZone: false });
    }));
  it("an uncategorised product varies by zone when a No category × zone cell changes its outcome; a categorised product does not", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const half = await breadVariant(tx, f);
      await setRoutingCell(
        tx,
        f.cfg,
        { row: noCategoryRow, zoneId: f.terrace },
        station(f.terraceBar),
      );
      const makers = await describeMakers(tx, f.cfg);
      for (const id of [f.bread, half])
        expect(makers.get(id), id).toEqual({
          route: station(f.bar),
          variesByZone: true,
          noReplacement: false,
          unavailableStationId: null,
        });
      for (const id of [f.mojito, f.variant])
        expect(makers.get(id), id).toEqual({
          route: station(f.bar),
          variesByZone: false,
          noReplacement: false,
          unavailableStationId: null,
        });
    }));
  it("decides varies-by-zone among several zones where only some have cells, an inactive one ignored", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const zone = async (name: string) => {
        const [row] = await tx
          .insert(floorZones)
          .values({ ...f.cfg, name })
          .returning();
        await configureZone(tx, f.cfg, { zoneId: row!.id, departmentId: f.department });
        return row!.id;
      };
      const patio = await zone("Patio");
      await zone("Hall");
      const old = await zone("Old");
      const soup = (
        await createProduct(tx, {
          catalogueId: (await createCatalogue(tx, { name: "Kitchen" })).id,
          name: "Soup",
          categoryId: f.food,
          pricingUnit: "each",
          unitPrice: "3.00",
          vatClass: "general",
        })
      ).id;
      await setRoutingCell(
        tx,
        f.cfg,
        { row: { kind: "all" }, zoneId: f.terrace },
        station(f.terraceBar),
      );
      await setRoutingCell(
        tx,
        f.cfg,
        { row: categoryRow(f.cocktails), zoneId: patio },
        station(f.terraceBar),
      );
      await setCategoryCell(tx, f.cfg, f.food, station(f.bar));
      await setRoutingCell(tx, f.cfg, { row: categoryRow(f.food), zoneId: old }, noPrep);
      await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, old));
      const makers = await describeMakers(tx, f.cfg);
      const expected = (variesByZone: boolean) => ({
        route: station(f.bar),
        variesByZone,
        noReplacement: false,
        unavailableStationId: null,
      });
      expect(makers.get(f.mojito)).toEqual(expected(true));
      expect(makers.get(f.variant)).toEqual(expected(true));
      expect(makers.get(f.bread)).toEqual(expected(true));
      expect(makers.get(soup)).toEqual(expected(false));
    }));
  it("names the matching cell, including a variant's parent product cell", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const address: CellAddress = { row: productRow(f.mojito), zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, address, station(f.terraceBar));
      const explained = await explainRoute(tx, f.cfg, f.variant, f.terrace, {
        kind: "now",
        at: new Date("2026-10-02T22:00:00Z"),
      });
      expect(explained.decidedBy).toEqual({ kind: "cell", address });
      expect(explained).toMatchObject({
        route: { kind: "station", stationId: f.terraceBar },
        fallbacks: [],
        noReplacement: false,
        stations: expect.arrayContaining([{ id: f.terraceBar, name: "Terrace Bar", active: true }]),
      });
    }));

  it("names a cell whose station is switched off as a dead end", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      const address: CellAddress = { row: categoryRow(f.cocktails), zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, address, station(f.terraceBar));
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.terraceBar));
      const explained = await explainRoute(tx, f.cfg, f.mojito, f.terrace, {
        kind: "now",
        at: new Date("2026-10-02T22:00:00Z"),
      });
      expect(explained.decidedBy).toEqual({ kind: "cell", address });
      expect(explained).toMatchObject({
        route: null,
        fallbacks: [{ stationId: f.terraceBar, why: "switched_off" }],
        noReplacement: true,
        stations: expect.arrayContaining([
          { id: f.terraceBar, name: "Terrace Bar", active: false },
        ]),
      });
    }));

  it("names the default and reports no route when no active default remains", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      expect(
        await explainRoute(tx, f.cfg, f.bread, null, {
          kind: "now",
          at: new Date("2026-10-02T22:00:00Z"),
        }),
      ).toMatchObject({
        route: { kind: "station", stationId: f.bar },
        decidedBy: { kind: "default" },
      });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      expect(
        await explainRoute(tx, f.cfg, f.bread, null, {
          kind: "now",
          at: new Date("2026-10-02T22:00:00Z"),
        }),
      ).toMatchObject({
        route: null,
        decidedBy: null,
      });
    }));
});

describe("stored preparation rules", () => {
  it("routingModel returns active-zone columns in display order, the category tree, active top-level products by main category, explicit cells and referenced inactive station names", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
      await tx.update(floorZones).set({ displayOrder: 2 }).where(eq(floorZones.id, f.terrace));
      const [inside, garden] = await tx
        .insert(floorZones)
        .values([
          { ...f.cfg, name: "Upstairs", displayOrder: 1 },
          { ...f.cfg, name: "Garden", displayOrder: 0, active: false },
        ])
        .returning();
      await configureZone(tx, f.cfg, { zoneId: inside!.id, departmentId: f.department });
      const [plain] = await tx.insert(categories).values({ name: "Plain" }).returning();
      const written: RoutingCell[] = [
        { row: categoryRow(f.drinks), zoneId: null, target: station(f.bar) },
        { row: categoryRow(f.cocktails), zoneId: f.terrace, target: station(f.terraceBar) },
        { row: productRow(f.mojito), zoneId: null, target: noPrep },
        { row: { kind: "all" }, zoneId: inside!.id, target: station(f.terraceBar) },
      ];
      for (const { target, ...address } of written)
        await setRoutingCell(tx, f.cfg, address, target);
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.terraceBar));
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.zones.some((zone) => zone.id === garden!.id)).toBe(false);
      expect({ ...model, cells: sortCells(model.cells) }).toEqual({
        zones: [
          { id: inside!.id, name: "Upstairs" },
          { id: f.terrace, name: "Terrace" },
        ],
        categories: [
          { id: f.beer, name: "Beer", parentId: f.drinks },
          { id: f.cocktails, name: "Cocktails", parentId: f.drinks },
          { id: f.drinks, name: "Drinks", parentId: null },
          { id: f.food, name: "Food", parentId: null },
          { id: plain!.id, name: "Plain", parentId: null },
        ],
        products: [
          { id: f.bread, name: "Bread", categoryId: null },
          { id: f.mojito, name: "Mojito", categoryId: f.cocktails },
        ],
        cells: sortCells(written),
        defaultStationId: f.bar,
        stations: [
          { id: f.bar, name: "Bar", active: true },
          { id: f.switchedOff, name: "Off", active: false },
          { id: f.terraceBar, name: "Terrace Bar", active: false },
        ],
        stationTimes: model.stationTimes,
        todayEnds: model.todayEnds,
        clockReadable: true,
      });
      expect(model.stationTimes.map((times) => times.stationId)).toEqual([
        f.bar,
        f.switchedOff,
        f.terraceBar,
      ]);
    }));

  it("routingModel lists stored No category cells, and keeps one when no product is uncategorised", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const written: RoutingCell[] = [
        { row: noCategoryRow, zoneId: null, target: noPrep },
        { row: noCategoryRow, zoneId: f.terrace, target: station(f.terraceBar) },
        { row: { kind: "all" }, zoneId: f.terrace, target: station(f.bar) },
      ];
      for (const { target, ...address } of written)
        await setRoutingCell(tx, f.cfg, address, target);
      const at = new Date("2026-10-02T18:00:00Z");
      const model = await routingModel(tx, f.cfg, at);
      expect(sortCells(model.cells)).toEqual(sortCells(written));
      expect(model.products.filter((product) => product.categoryId === null)).toEqual([
        { id: f.bread, name: "Bread", categoryId: null },
      ]);
      await tx.update(products).set({ categoryId: f.food }).where(eq(products.id, f.bread));
      const categorised = await routingModel(tx, f.cfg, at);
      expect(categorised.products.filter((product) => product.categoryId === null)).toEqual([]);
      expect(sortCells(categorised.cells)).toEqual(sortCells(written));
    }));

  it("reads the cells and zones of its own location only", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx),
        other = await fixture(tx, " (other venue)");
      await setCategoryCell(tx, f.cfg, f.drinks, noPrep);
      await setRoutingCell(
        tx,
        other.cfg,
        { row: categoryRow(other.drinks), zoneId: other.terrace },
        station(other.bar),
      );
      const own = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(own.cells).toEqual([{ row: categoryRow(f.drinks), zoneId: null, target: noPrep }]);
      expect(own.zones).toEqual([{ id: f.terrace, name: "Terrace" }]);
      expect((await loadRoutingRules(tx, other.cfg, null)).cells).toEqual([
        { row: categoryRow(other.drinks), zoneId: other.terrace, target: station(other.bar) },
      ]);
    }));

  it("variants are not grid products, even with a stored category of their own", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(products).set({ categoryId: f.food }).where(eq(products.id, f.variant));
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.products.map((product) => product.id)).toEqual([f.bread, f.mojito]);
    }));

  it("lists a sold-out product and an extras-only product as grid products", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(products).set({ available: false }).where(eq(products.id, f.bread));
      await tx
        .update(products)
        .set({ ordering: "not_sold_separately" })
        .where(eq(products.id, f.mojito));
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.products).toEqual([
        { id: f.bread, name: "Bread", categoryId: null },
        { id: f.mojito, name: "Mojito", categoryId: f.cocktails },
      ]);
    }));

  it("keeps a disabled product's cells stored but out of the model, and shows them again when the product is enabled", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const cells: RoutingCell[] = [
        { row: productRow(f.mojito), zoneId: f.terrace, target: station(f.terraceBar) },
        { row: productRow(f.bread), zoneId: null, target: noPrep },
      ];
      for (const { target, ...address } of cells) await setRoutingCell(tx, f.cfg, address, target);
      const at = new Date("2026-10-02T18:00:00Z");
      const before = await routingModel(tx, f.cfg, at);
      expect(sortCells(before.cells)).toEqual(sortCells(cells));
      const storedMojito = () =>
        tx
          .select({ stationId: routingCells.stationId, zoneId: routingCells.zoneId })
          .from(routingCells)
          .where(eq(routingCells.productId, f.mojito));
      await tx.update(products).set({ active: false }).where(eq(products.id, f.mojito));
      expect(await storedMojito()).toEqual([{ stationId: f.terraceBar, zoneId: f.terrace }]);
      const hidden = await routingModel(tx, f.cfg, at);
      expect(hidden.products.map((product) => product.id)).toEqual([f.bread]);
      expect(hidden.cells).toEqual([cells[1]]);
      await tx.update(products).set({ active: true }).where(eq(products.id, f.mojito));
      const shown = await routingModel(tx, f.cfg, at);
      expect(shown.products.map((product) => product.id)).toEqual([f.bread, f.mojito]);
      expect(sortCells(shown.cells)).toEqual(sortCells(cells));
    }));

  it("names an inactive station still referenced by a cell", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.beer, { kind: "station", stationId: f.bar });
      await setRoutingCell(
        tx,
        f.cfg,
        { row: categoryRow(f.drinks), zoneId: f.terrace },
        station(f.terraceBar),
      );
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.cells).toContainEqual({
        row: categoryRow(f.beer),
        zoneId: null,
        target: { kind: "station", stationId: f.bar },
      });
      expect(model.stations).toContainEqual({ id: f.bar, name: "Bar", active: false });
      expect(model.stations).toContainEqual({ id: f.switchedOff, name: "Off", active: false });
      expect(model.stationTimes).toContainEqual(
        expect.objectContaining({
          stationId: f.switchedOff,
          status: { open: false, why: "switched_off" },
        }),
      );
      expect(model.stations).toContainEqual({
        id: f.terraceBar,
        name: "Terrace Bar",
        active: true,
      });
    }));

  it("exports routing cells with their location column", () => {
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables).toContainEqual({
      name: "routing_cells",
      locationColumns: ["location_id"],
    });
  });

  it("names the default even when switched off without a cell", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.defaultStationId).toBeNull();
      expect(model.stations).toContainEqual({ id: f.bar, name: "Bar", active: false });
      expect(model.stations).toContainEqual({ id: f.switchedOff, name: "Off", active: false });
    }));
});

describe("the browser's selection rules", () => {
  it("choose the cell the server's rules choose, for every row and zone, after a trip over the wire", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const [upstairs] = await tx
        .insert(floorZones)
        .values({ ...f.cfg, name: "Upstairs" })
        .returning();
      await configureZone(tx, f.cfg, { zoneId: upstairs!.id, departmentId: f.department });
      const written: RoutingCell[] = [
        { row: productRow(f.mojito), zoneId: null, target: station(f.terraceBar) },
        { row: categoryRow(f.cocktails), zoneId: f.terrace, target: station(f.bar) },
        { row: categoryRow(f.drinks), zoneId: upstairs!.id, target: station(f.terraceBar) },
        { row: categoryRow(f.food), zoneId: f.terrace, target: noPrep },
        { row: productRow(f.bread), zoneId: f.terrace, target: station(f.terraceBar) },
        { row: { kind: "all" }, zoneId: upstairs!.id, target: noPrep },
      ];
      for (const { target, ...address } of written)
        await setRoutingCell(tx, f.cfg, address, target);
      const rows: [RoutingRow, string | null][] = [
        [{ kind: "all" }, null],
        [categoryRow(f.drinks), null],
        [categoryRow(f.beer), null],
        [categoryRow(f.cocktails), null],
        [categoryRow(f.food), null],
        [productRow(f.mojito), f.cocktails],
        [productRow(f.bread), null],
      ];
      const zones = [null, f.terrace, upstairs!.id];
      const at = new Date("2026-10-02T18:00:00Z");
      const compare = async () => {
        const server = await loadRoutingRules(tx, f.cfg, null);
        const model: RoutingModel = JSON.parse(JSON.stringify(await routingModel(tx, f.cfg, at)));
        const browser = selectionRulesFromModel(model);
        const categoryOf = new Map(
          model.products.map((product) => [product.id, product.categoryId]),
        );
        const chosen = new Map<string, ReturnType<typeof selectRoutingCell>>();
        for (const [row, categoryId] of rows) {
          const browserCategory = row.kind === "product" ? categoryOf.get(row.productId)! : null;
          for (const zoneId of zones) {
            const expected = selectRoutingCell(server, row, zoneId, categoryId);
            expect(
              selectRoutingCell(browser, row, zoneId, browserCategory),
              `${JSON.stringify(row)} × ${zoneId}`,
            ).toEqual(expected);
            chosen.set(JSON.stringify([row, zoneId]), expected);
          }
        }
        return (row: RoutingRow, zoneId: string | null) =>
          chosen.get(JSON.stringify([row, zoneId]));
      };
      const decided = (row: RoutingRow, zoneId: string | null) => ({
        kind: "cell",
        address: { row, zoneId },
      });
      const active = await compare();
      // Same-row Every zone beats the parent's Terrace cell.
      expect(active(productRow(f.mojito), f.terrace)?.decidedBy).toEqual(
        decided(productRow(f.mojito), null),
      );
      // An ancestor's zone cell.
      expect(active(categoryRow(f.beer), upstairs!.id)?.decidedBy).toEqual(
        decided(categoryRow(f.drinks), upstairs!.id),
      );
      expect(active(categoryRow(f.food), f.terrace)?.target).toEqual(noPrep);
      // A product with no category: its own cell, then All categories, then the default.
      expect(active(productRow(f.bread), f.terrace)?.decidedBy).toEqual(
        decided(productRow(f.bread), f.terrace),
      );
      expect(active(productRow(f.bread), upstairs!.id)?.target).toEqual(noPrep);
      expect(active(productRow(f.bread), null)).toEqual({
        target: station(f.bar),
        decidedBy: { kind: "default" },
      });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      const inactiveDefault = await compare();
      expect(inactiveDefault(productRow(f.bread), null)).toEqual({ target: null, decidedBy: null });
    }));

  it("match the server's for the No category row and an uncategorised product", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const [upstairs] = await tx
        .insert(floorZones)
        .values({ ...f.cfg, name: "Upstairs" })
        .returning();
      await configureZone(tx, f.cfg, { zoneId: upstairs!.id, departmentId: f.department });
      const [inside] = await tx
        .insert(floorZones)
        .values({ ...f.cfg, name: "Inside" })
        .returning();
      await configureZone(tx, f.cfg, { zoneId: inside!.id, departmentId: f.department });
      const written: RoutingCell[] = [
        { row: productRow(f.bread), zoneId: inside!.id, target: station(f.bar) },
        { row: noCategoryRow, zoneId: f.terrace, target: station(f.terraceBar) },
        { row: noCategoryRow, zoneId: null, target: noPrep },
        { row: { kind: "all" }, zoneId: f.terrace, target: station(f.bar) },
        { row: { kind: "all" }, zoneId: upstairs!.id, target: station(f.terraceBar) },
      ];
      for (const { target, ...address } of written)
        await setRoutingCell(tx, f.cfg, address, target);
      const rows: [RoutingRow, string | null][] = [
        [{ kind: "all" }, null],
        [noCategoryRow, null],
        [categoryRow(f.drinks), null],
        [productRow(f.bread), null],
        [productRow(f.mojito), f.cocktails],
      ];
      const zones = [null, f.terrace, upstairs!.id, inside!.id];
      const server = await loadRoutingRules(tx, f.cfg, null);
      const model: RoutingModel = JSON.parse(
        JSON.stringify(await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))),
      );
      const browser = selectionRulesFromModel(model);
      const categoryOf = new Map(model.products.map((product) => [product.id, product.categoryId]));
      const chosen = new Map<string, ReturnType<typeof selectRoutingCell>>();
      for (const [row, categoryId] of rows) {
        const browserCategory = row.kind === "product" ? categoryOf.get(row.productId)! : null;
        for (const zoneId of zones) {
          const expected = selectRoutingCell(server, row, zoneId, categoryId);
          expect(
            selectRoutingCell(browser, row, zoneId, browserCategory),
            `${JSON.stringify(row)} × ${zoneId}`,
          ).toEqual(expected);
          chosen.set(JSON.stringify([row, zoneId]), expected);
        }
      }
      const pick = (row: RoutingRow, zoneId: string | null) =>
        chosen.get(JSON.stringify([row, zoneId]))?.decidedBy;
      const cellAt = (row: RoutingRow, zoneId: string | null) => ({
        kind: "cell",
        address: { row, zoneId },
      });
      expect(pick(productRow(f.bread), inside!.id)).toEqual(
        cellAt(productRow(f.bread), inside!.id),
      );
      expect(pick(productRow(f.bread), f.terrace)).toEqual(cellAt(noCategoryRow, f.terrace));
      // No category × Every zone beats All categories × Upstairs.
      expect(pick(productRow(f.bread), upstairs!.id)).toEqual(cellAt(noCategoryRow, null));
      expect(pick(noCategoryRow, upstairs!.id)).toEqual(cellAt(noCategoryRow, null));
      // A categorised product and a category row never read a No category cell.
      expect(pick(productRow(f.mojito), f.terrace)).toEqual(cellAt({ kind: "all" }, f.terrace));
      expect(pick(categoryRow(f.drinks), null)).toEqual({ kind: "default" });
      expect(pick(categoryRow(f.drinks), upstairs!.id)).toEqual(
        cellAt({ kind: "all" }, upstairs!.id),
      );
    }));
});

describe("resolveMakers", () => {
  it("sends a closed station's work to its fallback, and an open one's to itself", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
      ]);
      await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.mojito], new Date("2026-10-02T18:30:00Z"))).get(
          f.mojito,
        ),
      ).toEqual({
        kind: "made",
        route: { kind: "station", stationId: f.terraceBar },
      });
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.mojito], new Date("2026-10-02T20:00:00Z"))).get(
          f.mojito,
        ),
      ).toEqual({
        kind: "made",
        route: { kind: "station", stationId: f.bar },
      });
    }));

  it("answers no_replacement for a closed station with no fallback", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      await setStationToday(tx, f.cfg, f.terraceBar, "closed", new Date("2026-10-02T18:00:00Z"));
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.mojito], new Date("2026-10-02T18:30:00Z"))).get(
          f.mojito,
        ),
      ).toEqual({
        kind: "no_replacement",
        stationId: f.terraceBar,
      });
    }));

  it("sends a switched-off station's work to its fallback", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.terraceBar));
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.mojito], new Date("2026-10-02T18:30:00Z"))).get(
          f.mojito,
        ),
      ).toEqual({
        kind: "made",
        route: { kind: "station", stationId: f.bar },
      });
    }));
  it("ignores hours when the venue's clock cannot be read", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
      ]);
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.mojito], new Date("2026-10-02T20:00:00Z"))).get(
          f.mojito,
        ),
      ).toEqual({
        kind: "made",
        route: { kind: "station", stationId: f.terraceBar },
      });
    }));
  it("reports every station's active and open state at an instant", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
      ]);
      const states = await stationStates(tx, f.cfg, new Date("2026-10-02T20:00:00Z"));
      expect(states.get(f.bar)).toEqual({ open: true, isDefault: true, active: true, name: "Bar" });
      expect(states.get(f.terraceBar)).toEqual({
        open: false,
        isDefault: false,
        active: true,
        name: "Terrace Bar",
      });
      expect(states.get(f.switchedOff)).toEqual({
        open: false,
        isDefault: false,
        active: false,
        name: "Off",
      });
    }));
  it("keeps the database read count constant as a batch grows", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const prepared = vi.spyOn(session, "prepareQuery");
      try {
        expect(
          await resolveMakers(tx, f.cfg, null, [f.mojito], new Date("2026-10-02T18:30:00Z")),
        ).toEqual(
          new Map([
            [f.mojito, { kind: "made", route: { kind: "station", stationId: f.terraceBar } }],
          ]),
        );
        const reads = prepared.mock.calls.length;
        expect(reads).toBeGreaterThan(0);
        prepared.mockClear();
        expect(
          await resolveMakers(
            tx,
            f.cfg,
            null,
            [f.mojito, f.bread, f.variant],
            new Date("2026-10-02T18:30:00Z"),
          ),
        ).toEqual(
          new Map([
            [f.mojito, { kind: "made", route: { kind: "station", stationId: f.terraceBar } }],
            [f.bread, { kind: "made", route: { kind: "station", stationId: f.bar } }],
            [f.variant, { kind: "made", route: { kind: "station", stationId: f.terraceBar } }],
          ]),
        );
        expect(prepared.mock.calls.length).toBe(reads);
        prepared.mockClear();
        expect(
          await resolveMakers(tx, f.cfg, randomUUID(), [], new Date("2026-10-02T18:30:00Z")),
        ).toEqual(new Map());
        expect(prepared).not.toHaveBeenCalled();
      } finally {
        prepared.mockRestore();
      }
    }));

  it("routes an order with no service zone by cells and the default", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      const made = await resolveMakers(
        tx,
        f.cfg,
        null,
        [f.mojito, f.bread],
        new Date("2026-10-02T18:30:00Z"),
      );
      expect(made.get(f.mojito)).toEqual({
        kind: "made",
        route: { kind: "station", stationId: f.terraceBar },
      });
      expect(made.get(f.bread)).toEqual({
        kind: "made",
        route: { kind: "station", stationId: f.bar },
      });
    }));
  it("answers null for every product when the default is off and nothing matches", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      expect(
        (
          await resolveMakers(tx, f.cfg, f.terrace, [f.bread], new Date("2026-10-02T18:30:00Z"))
        ).get(f.bread),
      ).toEqual({ kind: "no_station" });
    }));
  it("refuses an unknown product and an unknown zone", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await expect(
        resolveMakers(tx, f.cfg, null, [randomUUID()], new Date("2026-10-02T18:30:00Z")),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
      });
      await expect(
        resolveMakers(tx, f.cfg, randomUUID(), [f.bread], new Date("2026-10-02T18:30:00Z")),
      ).rejects.toMatchObject({
        code: "service_zone.not_found",
      });
    }));
  it("routes a variant holding a stored category of its own by its product's folder", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      await tx.update(products).set({ categoryId: f.food }).where(eq(products.id, f.variant));
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.variant], new Date("2026-10-02T18:30:00Z"))).get(
          f.variant,
        ),
      ).toEqual({ kind: "made", route: { kind: "station", stationId: f.terraceBar } });
    }));
  it("keeps the first caller spelling and the effective variant folder", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      const upper = f.variant.toUpperCase();
      expect(
        await resolveMakers(tx, f.cfg, null, [upper, f.variant], new Date("2026-10-02T18:30:00Z")),
      ).toEqual(
        new Map([[upper, { kind: "made", route: { kind: "station", stationId: f.terraceBar } }]]),
      );
      expect(
        await resolveMakers(tx, f.cfg, null, [f.variant, upper], new Date("2026-10-02T18:30:00Z")),
      ).toEqual(
        new Map([
          [f.variant, { kind: "made", route: { kind: "station", stationId: f.terraceBar } }],
        ]),
      );
    }));
});
describe("routing previews", () => {
  const storedCells = (tx: Transaction) => tx.select().from(routingCells).orderBy(routingCells.id);
  const allCategories = { kind: "all" as const };

  it("marks a preview that exposes a disabled station with no fallback as no replacement", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, station(f.terraceBar));
      await setCategoryCell(tx, f.cfg, f.cocktails, station(f.bar));
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.terraceBar));
      const before = await storedCells(tx);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: categoryRow(f.cocktails), zoneId: null },
        target: null,
      });
      expect(moves.filter((move) => move.productId === f.mojito)).toEqual([
        {
          productId: f.mojito,
          productName: "Mojito",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: station(f.bar),
          to: null,
          toNoReplacement: true,
        },
      ]);
      expect(await storedCells(tx)).toEqual(before);
    }));
  it("reports a preview from no replacement to no default station", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, station(f.terraceBar));
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(inArray(kitchenStations.id, [f.bar, f.terraceBar]));
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: categoryRow(f.drinks), zoneId: null },
        target: null,
      });
      expect(moves.filter((move) => move.productId === f.mojito)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: null,
          to: null,
          toNoReplacement: false,
        }),
      ]);
    }));
  it("previews a zone cell over a saved broader cell without writing it", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.food, noPrep);
      const before = await storedCells(tx);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: categoryRow(f.cocktails), zoneId: f.terrace },
        target: noPrep,
      });
      expect(moves.filter((move) => move.productId === f.mojito)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: station(f.bar),
          to: noPrep,
          toNoReplacement: false,
        }),
      ]);
      expect(await storedCells(tx)).toEqual(before);
    }));

  it("previews a revised product cell without writing it", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const address: CellAddress = { row: productRow(f.bread), zoneId: null };
      await setRoutingCell(tx, f.cfg, address, noPrep);
      const before = await storedCells(tx);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address,
        target: station(f.terraceBar),
      });
      expect(moves.filter((move) => move.productId === f.bread)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: noPrep,
          to: station(f.terraceBar),
          toNoReplacement: false,
        }),
      ]);
      expect(await storedCells(tx)).toEqual(before);
    }));

  it("previews a product cell in place of its stored value, as one cell", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setRoutingCell(
        tx,
        f.cfg,
        { row: productRow(f.bread), zoneId: f.terrace },
        station(f.bar),
      );
      const before = await storedCells(tx);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: productRow(f.bread.toUpperCase()), zoneId: f.terrace.toUpperCase() },
        target: station(f.terraceBar.toUpperCase()),
      });
      expect(moves.filter((move) => move.productId === f.bread)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: station(f.bar),
          to: station(f.terraceBar),
          toNoReplacement: false,
        }),
      ]);
      expect(before).toHaveLength(1);
      expect(await storedCells(tx)).toEqual(before);
    }));

  it("shows the default after clearing a category cell without removing the stored cell", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, noPrep);
      const before = await storedCells(tx);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: categoryRow(f.drinks), zoneId: null },
        target: null,
      });
      expect(moves.filter((move) => move.productId === f.mojito)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: noPrep,
          to: station(f.bar),
        }),
      ]);
      expect(await storedCells(tx)).toEqual(before);
    }));

  it("previews clearing a cell, exposing the parent's zone cell", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const [inside] = await tx
        .insert(floorZones)
        .values({ ...f.cfg, name: "Inside" })
        .returning();
      await setRoutingCell(
        tx,
        f.cfg,
        { row: categoryRow(f.drinks), zoneId: f.terrace },
        station(f.terraceBar),
      );
      const productEveryZone: CellAddress = { row: productRow(f.mojito), zoneId: null };
      await setRoutingCell(tx, f.cfg, productEveryZone, noPrep);
      const before = await storedCells(tx);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: productEveryZone,
        target: null,
      });
      expect(moves).toEqual([
        {
          productId: f.variant,
          productName: "Large",
          zoneId: inside!.id,
          zoneName: "Inside",
          from: noPrep,
          to: station(f.bar),
          toNoReplacement: false,
        },
        {
          productId: f.variant,
          productName: "Large",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: noPrep,
          to: station(f.terraceBar),
          toNoReplacement: false,
        },
        {
          productId: f.mojito,
          productName: "Mojito",
          zoneId: inside!.id,
          zoneName: "Inside",
          from: noPrep,
          to: station(f.bar),
          toNoReplacement: false,
        },
        {
          productId: f.mojito,
          productName: "Mojito",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: noPrep,
          to: station(f.terraceBar),
          toNoReplacement: false,
        },
      ]);
      expect(await storedCells(tx)).toEqual(before);
      expect(
        await previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address: { row: productRow(f.bread), zoneId: null },
          target: null,
        }),
      ).toEqual([]);
    }));

  it("refuses the All categories × Every zone address, a variant and an unknown subject, writing nothing", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setCategoryCell(tx, f.cfg, f.drinks, noPrep);
      const before = await storedCells(tx);
      for (const target of [station(f.terraceBar), null])
        await expect(
          previewRoutingChange(tx, f.cfg, {
            kind: "cell",
            address: { row: allCategories, zoneId: null },
            target,
          }),
        ).rejects.toMatchObject({
          code: "management.request_invalid",
          params: { field: "address" },
        });
      for (const productId of [randomUUID(), f.variant])
        await expect(
          previewRoutingChange(tx, f.cfg, {
            kind: "cell",
            address: { row: productRow(productId), zoneId: null },
            target: noPrep,
          }),
        ).rejects.toMatchObject({
          code: "route.subject_not_found",
          params: { subject: "product", id: productId },
        });
      const categoryId = randomUUID();
      await expect(
        previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address: { row: categoryRow(categoryId), zoneId: null },
          target: null,
        }),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
        params: { subject: "category", id: categoryId },
      });
      expect(await storedCells(tx)).toEqual(before);
    }));

  it("previews setting a cell in every active zone without writing it", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const [inside] = await tx
        .insert(floorZones)
        .values({ ...f.cfg, name: "Inside" })
        .returning();
      const menu = await createCatalogue(tx, { name: "Drinks menu" });
      const lager = await createProduct(tx, {
        catalogueId: menu.id,
        name: "Lager",
        categoryId: f.beer,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      await setCategoryCell(tx, f.cfg, f.drinks, station(f.bar));
      const before = await storedCells(tx);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: categoryRow(f.drinks), zoneId: null },
        target: station(f.terraceBar),
      });
      expect(moves.filter((m) => m.productId === f.mojito && m.zoneId === f.terrace)).toEqual([
        {
          productId: f.mojito,
          productName: "Mojito",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: station(f.bar),
          to: station(f.terraceBar),
          toNoReplacement: false,
        },
      ]);
      expect(moves.some((m) => m.productId === f.variant && m.zoneId === f.terrace)).toBe(true);
      expect(moves.filter((m) => m.productId === lager.id)).toEqual([
        {
          productId: lager.id,
          productName: "Lager",
          zoneId: inside!.id,
          zoneName: "Inside",
          from: station(f.bar),
          to: station(f.terraceBar),
          toNoReplacement: false,
        },
        {
          productId: lager.id,
          productName: "Lager",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: station(f.bar),
          to: station(f.terraceBar),
          toNoReplacement: false,
        },
      ]);
      expect(moves.some((m) => m.productId === f.bread)).toBe(false);
      expect(await storedCells(tx)).toEqual(before);
    }));
  it("rejects an inactive destination with the write code", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await expect(
        previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address: { row: categoryRow(f.drinks), zoneId: null },
          target: station(f.switchedOff),
        }),
      ).rejects.toMatchObject({
        code: "route.station_inactive",
        params: { stationId: f.switchedOff },
      });
    }));
  it("previews setting and clearing a No category cell: only uncategorised products and their variants move", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const half = await breadVariant(tx, f);
      await setRoutingCell(
        tx,
        f.cfg,
        { row: { kind: "all" }, zoneId: f.terrace },
        station(f.terraceBar),
      );
      const categorised = [f.mojito, f.variant];
      const address: CellAddress = { row: noCategoryRow, zoneId: f.terrace };
      const before = await storedCells(tx);
      const set = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address,
        target: noPrep,
      });
      expect(set).toEqual([
        {
          productId: f.bread,
          productName: "Bread",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: station(f.terraceBar),
          to: noPrep,
          toNoReplacement: false,
        },
        {
          productId: half,
          productName: "Half",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: station(f.terraceBar),
          to: noPrep,
          toNoReplacement: false,
        },
      ]);
      expect(set.filter((m) => categorised.includes(m.productId))).toEqual([]);
      expect(await storedCells(tx)).toEqual(before);
      await setRoutingCell(tx, f.cfg, address, noPrep);
      const stored = await storedCells(tx);
      const cleared = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address,
        target: null,
      });
      expect(cleared).toEqual([
        expect.objectContaining({ productId: f.bread, from: noPrep, to: station(f.terraceBar) }),
        expect.objectContaining({ productId: half, from: noPrep, to: station(f.terraceBar) }),
      ]);
      expect(cleared.filter((m) => categorised.includes(m.productId))).toEqual([]);
      expect(await storedCells(tx)).toEqual(stored);
    }));
  it("previews a no-change write as no moves", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const address: CellAddress = { row: categoryRow(f.drinks), zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, address, station(f.bar));
      expect(
        await previewRoutingChange(tx, f.cfg, { kind: "cell", address, target: station(f.bar) }),
      ).toEqual([]);
    }));
  it("uses one zone-less comparison when every service zone is off", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.terrace));
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: categoryRow(f.drinks), zoneId: null },
        target: station(f.terraceBar),
      });
      expect(moves.filter((m) => m.productId === f.mojito)).toEqual([
        expect.objectContaining({ productId: f.mojito, zoneId: null, zoneName: null }),
      ]);
    }));
});

describe("timed routing explanation", () => {
  it("uses Friday hours and names the fallback, while now honors today's open", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "18:00", closesAt: "21:00" },
      ]);
      await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
      const at = new Date("2026-10-02T22:00:00Z");
      const scheduled = await explainRoute(tx, f.cfg, f.mojito, null, {
        kind: "at",
        moment: { weekday: 5, timeOfDay: "22:00" },
      });
      expect(scheduled).toMatchObject({
        route: { kind: "station", stationId: f.bar },
        fallbacks: [{ stationId: f.terraceBar, why: "out_of_hours" }],
        noReplacement: false,
        clockReadable: true,
      });
      await setStationToday(tx, f.cfg, f.terraceBar, "open", at);
      expect(await explainRoute(tx, f.cfg, f.mojito, null, { kind: "now", at })).toMatchObject({
        route: { kind: "station", stationId: f.terraceBar },
        fallbacks: [],
        clockReadable: true,
      });
      expect(
        await explainRoute(tx, f.cfg, f.mojito, null, {
          kind: "at",
          moment: { weekday: 5, timeOfDay: "22:00" },
        }),
      ).toEqual(scheduled);
      await setStationToday(tx, f.cfg, f.terraceBar, "closed", at);
      expect(await explainRoute(tx, f.cfg, f.mojito, null, { kind: "now", at })).toMatchObject({
        route: { kind: "station", stationId: f.bar },
        fallbacks: [{ stationId: f.terraceBar, why: "closed_by_hand" }],
      });
    }));
  it("reports an unreadable venue clock and does not apply hours", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "18:00", closesAt: "21:00" },
      ]);
      expect(
        await explainRoute(tx, f.cfg, f.mojito, null, {
          kind: "now",
          at: new Date("2026-10-02T22:00:00Z"),
        }),
      ).toMatchObject({
        route: { kind: "station", stationId: f.terraceBar },
        clockReadable: false,
        fallbacks: [],
      });
    }));
});

it("explains now with today's manual closure", async () =>
  scoped(async (tx) => {
    const f = await fixture(tx);
    const at = new Date("2026-10-02T22:00:00Z");
    await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
    await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
    await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
    await setStationToday(tx, f.cfg, f.terraceBar, "closed", at);
    expect(await explainRoute(tx, f.cfg, f.mojito, null, { kind: "now", at })).toMatchObject({
      route: { kind: "station", stationId: f.bar },
      fallbacks: [{ stationId: f.terraceBar, why: "closed_by_hand" }],
    });
  }));

const fixedInstant = new Date("2026-10-02T18:30:00Z");
async function extrasFixture(tx: Transaction) {
  const f = await fixture(tx);
  await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
  const [grill, fryer] = await tx
    .insert(kitchenStations)
    .values([
      { ...f.cfg, name: "Grill" },
      { ...f.cfg, name: "Fryer" },
    ])
    .returning();
  const extras = (await createCategory(tx, { name: "Extras" })).id;
  const sides = (await createCategory(tx, { name: "Sides", parentId: extras })).id;
  const toppings = (await createCategory(tx, { name: "Toppings", parentId: extras })).id;
  const menu = await createCatalogue(tx, { name: "Extras menu" });
  const product = async (name: string, categoryId: string) =>
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
  const chips = await product("Chips", sides);
  const cheese = await product("Cheese", toppings);
  const [variant] = await tx
    .insert(products)
    .values({ catalogueId: menu.id, parentId: chips, name: "Large chips", categoryId: null })
    .returning();
  await setCategoryCell(tx, f.cfg, sides, { kind: "station", stationId: fryer!.id });
  return {
    ...f,
    extras,
    sides,
    chips,
    cheese,
    chipsVariant: variant!.id,
    grill: grill!.id,
    fryer: fryer!.id,
  };
}

describe("extra maker resolution", () => {
  it("explains each chosen extra against the dish's final station and names its cell", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.grill });
      const result = await explainRoute(
        tx,
        f.cfg,
        f.mojito,
        null,
        { kind: "now", at: fixedInstant },
        [f.chips, f.cheese],
      );
      expect(result.extras).toEqual([
        {
          productId: f.chips,
          outcome: { kind: "made", stationId: f.fryer },
          decidedBy: { kind: "cell", address: { row: categoryRow(f.sides), zoneId: null } },
          fallbacks: [],
        },
        {
          productId: f.cheese,
          outcome: { kind: "follows_dish", why: "no_rule" },
          decidedBy: { kind: "default" },
          fallbacks: [],
        },
      ]);
      expect(result.extrasWaitOnDish).toBe(false);
      expect(result.stations).toContainEqual({ id: f.fryer, name: "Fryer", active: true });
    }));
  it("waits for the dish's station before explaining extras when its cell's station is closed", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.grill });
      await setStationToday(tx, f.cfg, f.grill, "closed", fixedInstant);
      expect(
        await explainRoute(tx, f.cfg, f.mojito, null, { kind: "now", at: fixedInstant }, [f.chips]),
      ).toMatchObject({ route: null, extras: [], extrasWaitOnDish: true });
      const id = randomUUID();
      await expect(
        explainRoute(tx, f.cfg, f.mojito, null, { kind: "now", at: fixedInstant }, [id]),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
        params: { subject: "product", id },
      });
    }));
  it("treats a dish with no preparation as having no station when explaining an extra", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, noPrep);
      expect(
        await explainRoute(tx, f.cfg, f.mojito, null, { kind: "now", at: fixedInstant }, [f.chips]),
      ).toMatchObject({
        route: noPrep,
        extrasWaitOnDish: false,
        extras: [{ productId: f.chips, outcome: { kind: "made", stationId: f.fryer } }],
      });
    }));
  it("splits extras with a cell of their own while extras without one follow their dish", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      expect(
        await resolveExtraMakers(
          tx,
          f.cfg,
          null,
          [
            { key: "a", productId: f.chips, dishStationId: f.grill },
            { key: "b", productId: f.cheese, dishStationId: f.grill },
            { key: "c", productId: f.chips, dishStationId: f.fryer },
          ],
          fixedInstant,
        ),
      ).toEqual(
        new Map([
          ["a", { kind: "made", stationId: f.fryer }],
          ["b", { kind: "follows_dish", why: "no_rule" }],
          ["c", { kind: "follows_dish", why: "same_station" }],
        ]),
      );
    }));
  it("rejects an unknown extra product", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const id = randomUUID();
      await expect(
        resolveExtraMakers(
          tx,
          f.cfg,
          null,
          [{ key: "missing", productId: id, dishStationId: f.grill }],
          fixedInstant,
        ),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
        params: { subject: "product", id },
      });
    }));
  it("answers an empty list without checking its zone or reading product facts", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const resolver = await routingAt(tx, f.cfg, fixedInstant);
      const read = vi.spyOn(tx, "select");
      try {
        expect(await resolveExtraMakers(tx, f.cfg, randomUUID(), [], fixedInstant)).toEqual(
          new Map(),
        );
        expect(await resolver.extraMakers(randomUUID(), [])).toEqual(new Map());
        expect(read).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    }));
  it("follows the dish when the extra's station is closed with no fallback", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setStationToday(tx, f.cfg, f.fryer, "closed", fixedInstant);
      expect(
        await resolveExtraMakers(
          tx,
          f.cfg,
          null,
          [{ key: "a", productId: f.chips, dishStationId: f.grill }],
          fixedInstant,
        ),
      ).toEqual(new Map([["a", { kind: "follows_dish", why: "no_replacement" }]]));
    }));
  it("uses canonical product spellings and effective variant folders while preserving every pick key", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      expect(
        await resolveExtraMakers(
          tx,
          f.cfg,
          null,
          [
            { key: "a", productId: f.chipsVariant.toUpperCase(), dishStationId: f.grill },
            { key: "b", productId: f.chipsVariant, dishStationId: null },
          ],
          fixedInstant,
        ),
      ).toEqual(
        new Map([
          ["a", { kind: "made", stationId: f.fryer }],
          ["b", { kind: "made", stationId: f.fryer }],
        ]),
      );
    }));
});

describe("routing from cells", () => {
  it("with no cells, routes to the implicit default, and with no active default reports no route rather than inventing one", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const resolver = await routingAt(tx, f.cfg, fixedInstant);
      expect(await resolver.makers(f.terrace, [f.mojito, f.bread, f.variant])).toEqual(
        new Map([
          [f.mojito, { kind: "made", route: station(f.bar) }],
          [f.bread, { kind: "made", route: station(f.bar) }],
          [f.variant, { kind: "made", route: station(f.bar) }],
        ]),
      );
      expect(
        await explainRoute(tx, f.cfg, f.mojito, f.terrace, { kind: "now", at: fixedInstant }),
      ).toMatchObject({ route: station(f.bar), decidedBy: { kind: "default" }, fallbacks: [] });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      expect(
        await (await routingAt(tx, f.cfg, fixedInstant)).makers(f.terrace, [f.mojito, f.bread]),
      ).toEqual(
        new Map([
          [f.mojito, { kind: "no_station" }],
          [f.bread, { kind: "no_station" }],
        ]),
      );
      const explained = await explainRoute(tx, f.cfg, f.mojito, f.terrace, {
        kind: "now",
        at: fixedInstant,
      });
      expect(explained).toMatchObject({ route: null, decidedBy: null, noReplacement: false });
    }));

  it("a product's Every zone cell beats its parent category's Terrace cell, and clearing it shows the Terrace cell with its origin", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const terraceCell: CellAddress = { row: categoryRow(f.cocktails), zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, terraceCell, station(f.terraceBar));
      const productCell: CellAddress = { row: productRow(f.mojito), zoneId: null };
      await setRoutingCell(tx, f.cfg, productCell, station(f.bar));
      const when = { kind: "now", at: fixedInstant } as const;
      for (const id of [f.mojito, f.variant])
        expect(await explainRoute(tx, f.cfg, id, f.terrace, when)).toMatchObject({
          route: station(f.bar),
          decidedBy: { kind: "cell", address: productCell },
        });
      await clearRoutingCell(tx, f.cfg, productCell);
      for (const id of [f.mojito, f.variant]) {
        const explained = await explainRoute(tx, f.cfg, id, f.terrace, when);
        expect(explained.route).toEqual(station(f.terraceBar));
        expect(explained.decidedBy).toEqual({ kind: "cell", address: terraceCell });
      }
      expect(
        await (await routingAt(tx, f.cfg, fixedInstant)).makers(f.terrace, [f.mojito]),
      ).toEqual(new Map([[f.mojito, { kind: "made", route: station(f.terraceBar) }]]));
    }));

  it("an uncategorised product and a variant of it route by stored No category cells, after their own product cells and before All categories", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const half = await breadVariant(tx, f);
      const when = { kind: "now", at: fixedInstant } as const;
      const allTerrace: CellAddress = { row: { kind: "all" }, zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, allTerrace, station(f.terraceBar));
      // Half stores Food; a Food cell must not decide for it.
      await setRoutingCell(
        tx,
        f.cfg,
        { row: categoryRow(f.food), zoneId: f.terrace },
        station(f.bar),
      );
      const routed = async (
        ids: readonly string[],
        route: RouteTarget,
        decidedBy: unknown,
      ): Promise<void> => {
        for (const id of ids)
          expect(await explainRoute(tx, f.cfg, id, f.terrace, when), id).toMatchObject({
            route,
            decidedBy,
          });
        const makers = await (await routingAt(tx, f.cfg, fixedInstant)).makers(f.terrace, ids);
        expect(makers).toEqual(new Map(ids.map((id) => [id, { kind: "made", route }])));
      };
      const cell = (address: CellAddress) => ({ kind: "cell", address });
      await routed([f.bread, half], station(f.terraceBar), cell(allTerrace));

      const noCategoryTerrace: CellAddress = { row: noCategoryRow, zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, noCategoryTerrace, noPrep);
      await routed([f.bread, half], noPrep, cell(noCategoryTerrace));
      await routed([f.mojito, f.variant], station(f.terraceBar), cell(allTerrace));

      const breadEvery: CellAddress = { row: productRow(f.bread), zoneId: null };
      await setRoutingCell(tx, f.cfg, breadEvery, station(f.bar));
      await routed([f.bread, half], station(f.bar), cell(breadEvery));
      await clearRoutingCell(tx, f.cfg, breadEvery);

      await clearRoutingCell(tx, f.cfg, noCategoryTerrace);
      const noCategoryEvery: CellAddress = { row: noCategoryRow, zoneId: null };
      await setRoutingCell(tx, f.cfg, noCategoryEvery, station(f.bar));
      await routed([f.bread, half], station(f.bar), cell(noCategoryEvery));
      await routed([f.mojito, f.variant], station(f.terraceBar), cell(allTerrace));
      await clearRoutingCell(tx, f.cfg, noCategoryEvery);
      await routed([f.bread, half], station(f.terraceBar), cell(allTerrace));
    }));

  it("explains a variant and an extra by the parent-owned cell and its category path", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const variantCell: CellAddress = { row: productRow(f.chips), zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, variantCell, station(f.grill));
      const extrasCell: CellAddress = { row: categoryRow(f.extras), zoneId: null };
      await setRoutingCell(tx, f.cfg, extrasCell, station(f.terraceBar));
      const explained = await explainRoute(
        tx,
        f.cfg,
        f.chipsVariant,
        f.terrace,
        { kind: "now", at: fixedInstant },
        [f.chipsVariant, f.cheese],
      );
      expect(explained.route).toEqual(station(f.grill));
      expect(explained.decidedBy).toEqual({ kind: "cell", address: variantCell });
      expect(explained.extras).toEqual([
        {
          productId: f.chipsVariant,
          outcome: { kind: "follows_dish", why: "same_station" },
          decidedBy: { kind: "cell", address: variantCell },
          fallbacks: [],
        },
        {
          productId: f.cheese,
          outcome: { kind: "made", stationId: f.terraceBar },
          decidedBy: { kind: "cell", address: extrasCell },
          fallbacks: [],
        },
      ]);
      const elsewhere = await explainRoute(tx, f.cfg, f.chipsVariant, null, {
        kind: "now",
        at: fixedInstant,
      });
      expect(elsewhere.route).toEqual(station(f.fryer));
      expect(elsewhere.decidedBy).toEqual({
        kind: "cell",
        address: { row: categoryRow(f.sides), zoneId: null },
      });
    }));

  it("keeps an explicit cell's origin when its fallback lands on the default station", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const address: CellAddress = { row: categoryRow(f.sides), zoneId: null };
      await setRoutingCell(tx, f.cfg, address, station(f.terraceBar));
      await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
      await setStationToday(tx, f.cfg, f.terraceBar, "closed", fixedInstant);
      const explained = await explainRoute(tx, f.cfg, f.chips, null, {
        kind: "now",
        at: fixedInstant,
      });
      expect(explained.route).toEqual(station(f.bar));
      expect(explained.decidedBy).toEqual({ kind: "cell", address });
      expect(explained.fallbacks).toEqual([{ stationId: f.terraceBar, why: "closed_by_hand" }]);
      expect(
        await resolveExtraMakers(
          tx,
          f.cfg,
          null,
          [
            { key: "a", productId: f.chips, dishStationId: f.grill },
            { key: "b", productId: f.cheese, dishStationId: f.grill },
          ],
          fixedInstant,
        ),
      ).toEqual(
        new Map([
          ["a", { kind: "made", stationId: f.bar }],
          ["b", { kind: "follows_dish", why: "no_rule" }],
        ]),
      );
    }));
});

describe("routingAt", () => {
  it("answers station state from the snapshot opened before a hand closure", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const resolver = await routingAt(tx, f.cfg, fixedInstant);
      await setStationToday(tx, f.cfg, f.terraceBar, "closed", fixedInstant);
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.terraceBar));
      expect((await resolver.stations()).get(f.terraceBar)).toEqual({
        open: true,
        active: true,
        isDefault: false,
        name: "Terrace Bar",
      });
      expect((await resolver.stations()).get(f.switchedOff)).toMatchObject({ active: false });
      expect((await resolver.stations()).get(f.bar)).toMatchObject({ isDefault: true });
      expect(
        (await (await routingAt(tx, f.cfg, fixedInstant)).stations()).get(f.terraceBar),
      ).toMatchObject({ open: false });
    }));
  it("answers an empty maker question without validating an unrelated zone", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const resolver = await routingAt(tx, f.cfg, fixedInstant);
      expect(await resolver.makers(randomUUID(), [])).toEqual(new Map());
    }));
  it("keeps a station available when the venue clock cannot apply its hours", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "18:00", closesAt: "21:00" },
      ]);
      const resolver = await routingAt(tx, f.cfg, new Date("2026-10-02T22:00:00Z"));
      expect(await resolver.makers(null, [f.mojito])).toEqual(
        new Map([
          [f.mojito, { kind: "made", route: { kind: "station", stationId: f.terraceBar } }],
        ]),
      );
    }));
  it("answers both questions exactly as their wrappers do", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const extras = [
        { key: "a", productId: f.chips, dishStationId: f.grill },
        { key: "b", productId: f.cheese, dishStationId: f.grill },
      ];
      const resolver = await routingAt(tx, f.cfg, fixedInstant);
      expect(resolver.at).toEqual(fixedInstant);
      expect(await resolver.makers(null, [f.chips, f.cheese])).toEqual(
        await resolveMakers(tx, f.cfg, null, [f.chips, f.cheese], fixedInstant),
      );
      expect(await resolver.extraMakers(null, extras)).toEqual(
        await resolveExtraMakers(tx, f.cfg, null, extras, fixedInstant),
      );
    }));
  it("refuses an unknown zone before an unknown product in both questions", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const resolver = await routingAt(tx, f.cfg, fixedInstant);
      const zone = randomUUID(),
        productId = randomUUID();
      await expect(resolver.makers(zone, [productId])).rejects.toMatchObject({
        code: "service_zone.not_found",
      });
      await expect(
        resolver.extraMakers(zone, [{ key: "a", productId, dishStationId: f.grill }]),
      ).rejects.toMatchObject({ code: "service_zone.not_found" });
    }));
  it("keeps the opening rules for both questions after a cell changes", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const resolver = await routingAt(tx, f.cfg, fixedInstant);
      await setCategoryCell(tx, f.cfg, f.sides, { kind: "station", stationId: f.grill });
      const extras = [{ key: "a", productId: f.chips, dishStationId: f.grill }];
      expect(await resolver.extraMakers(null, extras)).toEqual(
        new Map([["a", { kind: "made", stationId: f.fryer }]]),
      );
      expect(await resolver.makers(null, [f.chips])).toEqual(
        new Map([[f.chips, { kind: "made", route: { kind: "station", stationId: f.fryer } }]]),
      );
      const fresh = await routingAt(tx, f.cfg, fixedInstant);
      expect(await fresh.extraMakers(null, extras)).toEqual(
        new Map([["a", { kind: "follows_dish", why: "same_station" }]]),
      );
      expect(await fresh.makers(null, [f.chips])).toEqual(
        new Map([[f.chips, { kind: "made", route: { kind: "station", stationId: f.grill } }]]),
      );
    }));
});

describe("hours from special dates", () => {
  const SAVED_AT = new Date("2026-09-01T10:00:00Z");
  const closedOn = (
    tx: Transaction,
    cfg: { locationId: string },
    date: string,
    stationId: string,
  ) =>
    saveSpecialDate(
      tx,
      cfg as never,
      null,
      {
        date,
        name: `Closed ${date}`,
        colour: "red",
        closeWholeVenue: false,
        cells: [
          { subject: { kind: "station", id: stationId }, cell: { mode: "closed", periods: [] } },
        ],
      },
      SAVED_AT,
    );

  it("previews a date and local time with its special hours, and a weekday with the standard week alone", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "18:00", closesAt: "23:00" },
      ]);
      await closedOn(tx, f.cfg, "2026-10-09", f.terraceBar);
      const preview = (moment: RoutingMoment) =>
        explainRoute(tx, f.cfg, f.mojito, null, { kind: "at", moment });
      expect(await preview({ weekday: 5, timeOfDay: "20:00" })).toMatchObject({
        route: { kind: "station", stationId: f.terraceBar },
        fallbacks: [],
      });
      expect(
        await preview({ civilDate: "2026-10-09", weekday: 5, timeOfDay: "20:00" }),
      ).toMatchObject({
        route: { kind: "station", stationId: f.bar },
        fallbacks: [{ stationId: f.terraceBar, why: "out_of_hours" }],
      });
      expect(
        await preview({ civilDate: "2026-10-16", weekday: 5, timeOfDay: "20:00" }),
      ).toMatchObject({ route: { kind: "station", stationId: f.terraceBar }, fallbacks: [] });
    }));

  it("refuses to preview a local time the clock skips on that date", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      const forward = clockChangeAfter("Europe/Madrid", "2027-01-01T00:00:00Z", "forward");
      const preview = (timeOfDay: string) =>
        explainRoute(tx, f.cfg, f.mojito, null, {
          kind: "at",
          moment: { civilDate: forward.date, weekday: 0, timeOfDay },
        });
      await expect(preview(minutesAfter(forward.before, 1))).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "time" },
      });
      await expect(preview(forward.after)).resolves.toMatchObject({ clockReadable: true });
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      await expect(preview(minutesAfter(forward.before, 1))).resolves.toMatchObject({
        route: { kind: "station", stationId: f.bar },
      });
    }));

  it("reads the same number of times however many stations and special dates there are", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      const at = new Date("2026-10-09T18:00:00Z");
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "18:00", closesAt: "23:00" },
      ]);
      await closedOn(tx, f.cfg, "2026-10-09", f.terraceBar);
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const reads = async () => {
        const prepared = vi.spyOn(session, "prepareQuery");
        try {
          await (await routingAt(tx, f.cfg, at)).stations();
          await stationStates(tx, f.cfg, at);
          await routingModel(tx, f.cfg, at);
          return prepared.mock.calls.length;
        } finally {
          prepared.mockRestore();
        }
      };
      const few = await reads();
      const more = await tx
        .insert(kitchenStations)
        .values([
          { ...f.cfg, name: "Grill" },
          { ...f.cfg, name: "Fryer" },
          { ...f.cfg, name: "Pass" },
        ])
        .returning();
      for (const row of more)
        await seedStationWeek(tx, f.cfg, row.id, [
          { weekday: 5, opensAt: "12:00", closesAt: "16:00" },
          { weekday: 6, opensAt: "12:00", closesAt: "16:00" },
        ]);
      await closedOn(tx, f.cfg, "2026-10-08", more[0]!.id);
      await closedOn(tx, f.cfg, "2026-10-10", more[1]!.id);
      expect(await reads()).toBe(few);
      expect((await stationStates(tx, f.cfg, at)).get(f.terraceBar)).toMatchObject({ open: false });
    }));
});
