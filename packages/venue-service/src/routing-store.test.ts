import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  addProductToMenu,
  buildMenuDocument,
  removeMember,
  createExtraList,
  createProduct,
  menuDocumentHash,
  publishMenu,
  updateProduct,
  writeProductModifiers,
  sectionMembers,
  sections,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
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
  chooseExtraMakerBeside,
  chooseMaker,
  selectRoutingCell,
  selectionRulesFromModel,
  targetKey,
  type MakerChoice,
  type ProductFacts,
  type RouteTarget,
  type RoutingRules,
  type RoutingModel,
  type RoutingMoment,
  type RoutingRow,
} from "./routing.js";
import {
  describeMakers,
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
import { configureZone, createDepartment, listZoneOffers } from "./operations.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import { departments } from "./schema/service.js";
import {
  replaceMenuWeek,
  resolveDepartmentService,
  saveMenuPeriod,
  updateMenuPeriod,
} from "./menu-timetable.js";
import type { CellAddress, RoutingCell, RoutingMove } from "./routing-types.js";
import { closeStationForToday, setStationFallback, setStationToday } from "./station-times.js";
import { seedStationWeek } from "./testing/station-week.js";
import { saveSpecialDate } from "./hours.js";
import { specialDates } from "./schema/hours.js";
import { offerMenuThroughZone } from "./testing/zone-menus.js";

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
    orderStart: "table",
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
    menu: menu.id,
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
const factsOf = (
  productId: string,
  routedProductId: string,
  categoryId: string | null,
): ProductFacts => ({ productId, routedProductId, categoryId });
/** The stored rules' whole choice: the deciding cell and any fallback steps beside the route. */
const storedChoice = async (
  tx: Transaction,
  cfg: Parameters<typeof loadRoutingRules>[1],
  facts: ProductFacts,
  zoneId: string | null,
  today: { businessDay: string | null; moment: RoutingMoment } | null = null,
): Promise<MakerChoice> =>
  chooseMaker(
    await loadRoutingRules(tx, cfg, today?.businessDay ?? null),
    facts,
    zoneId,
    today?.moment ?? null,
  );

describe("maker descriptions and the deciding cell", () => {
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
        resolveMakers(tx, f.cfg, null, [randomUUID()], new Date("2026-10-02T22:00:00Z")),
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
      const at = new Date("2026-10-02T22:00:00Z");
      expect((await resolveMakers(tx, f.cfg, f.terrace, [f.variant], at)).get(f.variant)).toEqual({
        kind: "made",
        route: station(f.terraceBar),
      });
      expect(
        await storedChoice(tx, f.cfg, factsOf(f.variant, f.mojito, f.cocktails), f.terrace),
      ).toEqual({
        route: station(f.terraceBar),
        decidedBy: { kind: "cell", address },
        fallbacks: [],
        noReplacement: false,
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
      const resolver = await routingAt(tx, f.cfg, new Date("2026-10-02T22:00:00Z"));
      expect((await resolver.makers(f.terrace, [f.mojito])).get(f.mojito)).toEqual({
        kind: "no_replacement",
        stationId: f.terraceBar,
      });
      expect((await resolver.stations()).get(f.terraceBar)).toMatchObject({
        name: "Terrace Bar",
        active: false,
      });
      expect(
        await storedChoice(tx, f.cfg, factsOf(f.mojito, f.mojito, f.cocktails), f.terrace),
      ).toEqual({
        route: null,
        decidedBy: { kind: "cell", address },
        fallbacks: [{ stationId: f.terraceBar, why: "switched_off" }],
        noReplacement: true,
      });
    }));

  it("names the default and reports no route when no active default remains", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const at = new Date("2026-10-02T22:00:00Z");
      const bread = factsOf(f.bread, f.bread, null);
      expect((await resolveMakers(tx, f.cfg, null, [f.bread], at)).get(f.bread)).toEqual({
        kind: "made",
        route: station(f.bar),
      });
      expect(await storedChoice(tx, f.cfg, bread, null)).toMatchObject({
        route: { kind: "station", stationId: f.bar },
        decidedBy: { kind: "default" },
      });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      expect((await resolveMakers(tx, f.cfg, null, [f.bread], at)).get(f.bread)).toEqual({
        kind: "no_station",
      });
      expect(await storedChoice(tx, f.cfg, bread, null)).toMatchObject({
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
          { id: inside!.id, name: "Upstairs", departmentId: f.department },
          { id: f.terrace, name: "Terrace", departmentId: f.department },
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
        periods: [],
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
      expect(own.zones).toEqual([{ id: f.terrace, name: "Terrace", departmentId: f.department }]);
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
  it("reads today's chosen destination into routing and both station snapshots", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const at = new Date("2026-10-02T18:00:00Z");
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.drinks, station(f.terraceBar));
      await closeStationForToday(tx, f.cfg, f.terraceBar, f.bar, at);
      const expected = {
        open: false,
        active: true,
        isDefault: false,
        name: "Terrace Bar",
        byHand: "closed",
        sendsTo: f.bar,
        why: "closed_by_hand",
      };
      expect((await stationStates(tx, f.cfg, at)).get(f.terraceBar)).toEqual(expected);
      const resolver = await routingAt(tx, f.cfg, at);
      expect((await resolver.stations()).get(f.terraceBar)).toEqual(expected);
      expect((await resolver.makers(null, [f.mojito])).get(f.mojito)).toEqual({
        kind: "made",
        route: station(f.bar),
      });
      expect(
        (await routingModel(tx, f.cfg, at)).stationTimes.find(
          (row) => row.stationId === f.terraceBar,
        )?.closedSendsTo,
      ).toBe(f.bar);
      const tomorrow = new Date("2026-10-03T18:00:00Z");
      expect((await stationStates(tx, f.cfg, tomorrow)).get(f.terraceBar)).toEqual({
        open: true,
        active: true,
        isDefault: false,
        name: "Terrace Bar",
        byHand: null,
        sendsTo: null,
        why: "open",
      });
      expect((await resolveMakers(tx, f.cfg, null, [f.mojito], tomorrow)).get(f.mojito)).toEqual({
        kind: "made",
        route: station(f.terraceBar),
      });
    }));

  it("folds scheduled open reasons and preserves manual and switched-off reasons", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const at = new Date("2026-10-02T18:00:00Z");
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "19:00", closesAt: "21:00" },
      ]);
      expect((await stationStates(tx, f.cfg, at)).get(f.terraceBar)).toMatchObject({
        open: true,
        why: "open",
        byHand: null,
        sendsTo: null,
      });
      await setStationToday(tx, f.cfg, f.terraceBar, "open", at);
      expect((await stationStates(tx, f.cfg, at)).get(f.terraceBar)).toMatchObject({
        open: true,
        why: "opened_by_hand",
        byHand: "open",
        sendsTo: null,
      });
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      expect((await stationStates(tx, f.cfg, at)).get(f.terraceBar)).toMatchObject({
        open: true,
        why: "open",
        byHand: null,
        sendsTo: null,
      });
      expect((await stationStates(tx, f.cfg, at)).get(f.switchedOff)).toMatchObject({
        open: false,
        why: "switched_off",
        byHand: null,
        sendsTo: null,
      });
    }));

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
      expect(states.get(f.bar)).toEqual({
        open: true,
        isDefault: true,
        active: true,
        name: "Bar",
        byHand: null,
        sendsTo: null,
        why: "default",
      });
      expect(states.get(f.terraceBar)).toEqual({
        open: false,
        isDefault: false,
        active: true,
        name: "Terrace Bar",
        byHand: null,
        sendsTo: null,
        why: "out_of_hours",
      });
      expect(states.get(f.switchedOff)).toEqual({
        open: false,
        isDefault: false,
        active: false,
        name: "Off",
        byHand: null,
        sendsTo: null,
        why: "switched_off",
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
          periodIds: null,
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
          periodIds: null,
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
          periodIds: null,
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
          periodIds: null,
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
          periodIds: null,
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
          periodIds: null,
        },
        {
          productId: f.variant,
          productName: "Large",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: noPrep,
          to: station(f.terraceBar),
          toNoReplacement: false,
          periodIds: null,
        },
        {
          productId: f.mojito,
          productName: "Mojito",
          zoneId: inside!.id,
          zoneName: "Inside",
          from: noPrep,
          to: station(f.bar),
          toNoReplacement: false,
          periodIds: null,
        },
        {
          productId: f.mojito,
          productName: "Mojito",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: noPrep,
          to: station(f.terraceBar),
          toNoReplacement: false,
          periodIds: null,
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
          periodIds: null,
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
          periodIds: null,
        },
        {
          productId: lager.id,
          productName: "Lager",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: station(f.bar),
          to: station(f.terraceBar),
          toNoReplacement: false,
          periodIds: null,
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
          periodIds: null,
        },
        {
          productId: half,
          productName: "Half",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: station(f.terraceBar),
          to: noPrep,
          toNoReplacement: false,
          periodIds: null,
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

  describe("an extra and its dish", () => {
    async function withExtras(tx: Transaction, listActive = true) {
      const f = await fixture(tx);
      const product = async (name: string, categoryId: string | null) =>
        (
          await createProduct(tx, {
            catalogueId: f.menu,
            name,
            categoryId,
            pricingUnit: "each",
            unitPrice: "3.00",
            vatClass: "general",
          })
        ).id;
      const burger = await product("Burger", f.food);
      const cheese = await product("Cheese", null);
      const list = await createExtraList(
        tx,
        {
          name: "Toppings",
          minPicks: 0,
          maxPicks: 2,
          active: listActive,
          items: [{ productId: cheese, price: "0.50" }],
        },
        "en",
      );
      await writeProductModifiers(tx, burger, [{ kind: "extras", id: list.id }]);
      await setRoutingCell(
        tx,
        f.cfg,
        { row: productRow(burger), zoneId: null },
        station(f.terraceBar),
      );
      return { ...f, burger, cheese, toppings: list.id, product };
    }
    const extraMoves = (moves: RoutingMove[]) => moves.filter((move) => move.dish !== undefined);
    /** Adds `dishes` to the fixture's menu, serves it through Terrace's department and publishes it. */
    async function serveAndPublish(
      tx: Transaction,
      f: Awaited<ReturnType<typeof withExtras>>,
      dishes: readonly string[],
    ) {
      await offerMenuThroughZone(tx, f.cfg, f.terrace, f.menu);
      for (const productId of dishes) await addProductToMenu(tx, { menuId: f.menu, productId });
      const { document } = await buildMenuDocument(tx, f.menu);
      await publishMenu(tx, f.menu, menuDocumentHash(document), "person-1");
    }
    const cheeseToBar = (f: { cheese: string; bar: string }) =>
      ({
        kind: "cell",
        address: { row: productRow(f.cheese), zoneId: null },
        target: station(f.bar),
      }) as const;

    it("lists an extra that stops following its dish when its own cell names the default station", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const moves = await previewRoutingChange(tx, f.cfg, cheeseToBar(f));
        expect(extraMoves(moves)).toEqual([
          {
            productId: f.cheese,
            productName: "Cheese",
            zoneId: f.terrace,
            zoneName: "Terrace",
            from: station(f.terraceBar),
            to: station(f.bar),
            toNoReplacement: false,
            periodIds: null,
            dish: { productId: f.burger, productName: "Burger" },
          },
        ]);
      }));

    it("lists an extra's move during a period its dish's cell has a line for", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const [downstairs] = await tx
          .insert(kitchenStations)
          .values({ ...f.cfg, name: "Downstairs bar" })
          .returning();
        const lunch = (
          await saveMenuPeriod(tx, f.cfg, f.department, {
            name: "Lunch",
            menuId: f.menu,
            staffMenuIds: [],
          })
        ).id;
        const [burgerCell] = await tx
          .select({ id: routingCells.id })
          .from(routingCells)
          .where(eq(routingCells.productId, f.burger));
        await tx.insert(routingCellPeriods).values({
          cellId: burgerCell!.id,
          periodId: lunch,
          departmentId: f.department,
          stationId: downstairs!.id,
        });
        const address: CellAddress = { row: productRow(f.cheese), zoneId: null };
        await setRoutingCell(tx, f.cfg, address, station(f.bar));
        const moves = await previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address,
          target: null,
        });
        expect(
          extraMoves(moves).map((move) => [move.productId, move.from, move.to, move.periodIds]),
        ).toEqual([
          [f.cheese, station(f.bar), station(f.terraceBar), null],
          [f.cheese, station(f.bar), station(downstairs!.id), [lunch]],
        ]);
      }));

    it("lists an extra's move during a period its own cell has a line for", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const [downstairs] = await tx
          .insert(kitchenStations)
          .values({ ...f.cfg, name: "Downstairs bar" })
          .returning();
        const lunch = (
          await saveMenuPeriod(tx, f.cfg, f.department, {
            name: "Lunch",
            menuId: f.menu,
            staffMenuIds: [],
          })
        ).id;
        const address: CellAddress = { row: productRow(f.cheese), zoneId: null };
        await setRoutingCell(tx, f.cfg, address, station(f.bar));
        const [cheeseCell] = await tx
          .select({ id: routingCells.id })
          .from(routingCells)
          .where(eq(routingCells.productId, f.cheese));
        await tx.insert(routingCellPeriods).values({
          cellId: cheeseCell!.id,
          periodId: lunch,
          departmentId: f.department,
          stationId: downstairs!.id,
        });
        const moves = await previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address,
          target: station(f.bar),
          periods: [],
        });
        expect(
          extraMoves(moves).map((move) => [move.productId, move.from, move.to, move.periodIds]),
        ).toEqual([[f.cheese, station(downstairs!.id), station(f.bar), [lunch]]]);
      }));

    it("lists an extra that goes back to following its dish when its cell is cleared", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const address: CellAddress = { row: productRow(f.cheese), zoneId: null };
        await setRoutingCell(tx, f.cfg, address, station(f.bar));
        const moves = await previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address,
          target: null,
        });
        expect(extraMoves(moves)).toEqual([
          {
            productId: f.cheese,
            productName: "Cheese",
            zoneId: f.terrace,
            zoneName: "Terrace",
            from: station(f.bar),
            to: station(f.terraceBar),
            toNoReplacement: false,
            periodIds: null,
            dish: { productId: f.burger, productName: "Burger" },
          },
        ]);
      }));

    it("lists no extra move when the extra follows its dish before and after", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const moves = await previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address: { row: productRow(f.burger), zoneId: null },
          target: station(f.bar),
        });
        expect(moves.filter((move) => move.productId === f.burger)).toEqual([
          expect.objectContaining({ from: station(f.terraceBar), to: station(f.bar) }),
        ]);
        expect(extraMoves(moves)).toEqual([]);
      }));

    it("lists no extra move when the extra's cell names its dish's own station", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const moves = await previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address: { row: productRow(f.cheese), zoneId: null },
          target: station(f.terraceBar),
        });
        expect(extraMoves(moves)).toEqual([]);
      }));

    it("lists no extra move for an extras list that is Inactive", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx, false);
        const moves = await previewRoutingChange(tx, f.cfg, cheeseToBar(f));
        expect(extraMoves(moves)).toEqual([]);
      }));

    it("lists an extra the published menu still offers after its list is detached from the dish", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        await serveAndPublish(tx, f, [f.burger]);
        await writeProductModifiers(tx, f.burger, []);
        const served = (await listZoneOffers(tx, f.cfg, f.terrace)).offers;
        expect(
          served.flatMap((offer) =>
            offer.offeredModifiers.flatMap((entry) =>
              entry.kind === "extras"
                ? entry.items.map((item) => [offer.productId, item.productId])
                : [],
            ),
          ),
        ).toEqual([[f.burger, f.cheese]]);
        const moves = await previewRoutingChange(tx, f.cfg, cheeseToBar(f));
        expect(extraMoves(moves)).toEqual([
          {
            productId: f.cheese,
            productName: "Cheese",
            zoneId: f.terrace,
            zoneName: "Terrace",
            from: station(f.terraceBar),
            to: station(f.bar),
            toNoReplacement: false,
            periodIds: null,
            dish: { productId: f.burger, productName: "Burger" },
          },
        ]);
      }));

    it("lists no extra move for an extra made Inactive since the menu was published", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        await serveAndPublish(tx, f, [f.burger]);
        await tx.update(products).set({ active: false }).where(eq(products.id, f.cheese));
        const moves = await previewRoutingChange(tx, f.cfg, cheeseToBar(f));
        expect(extraMoves(moves)).toEqual([]);
      }));

    it("lists an extra only a published menu offers in the zones that serve that menu", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const [patio] = await tx
          .insert(floorZones)
          .values({ ...f.cfg, name: "Patio" })
          .returning();
        const takeaway = await createDepartment(tx, f.cfg, {
          name: "Takeaway",
          orderStart: "table",
        });
        await configureZone(tx, f.cfg, { zoneId: patio!.id, departmentId: takeaway.id });
        await serveAndPublish(tx, f, [f.burger]);
        await writeProductModifiers(tx, f.burger, []);
        const moves = await previewRoutingChange(tx, f.cfg, cheeseToBar(f));
        expect(extraMoves(moves)).toEqual([
          expect.objectContaining({ productId: f.cheese, zoneId: f.terrace }),
        ]);
      }));

    it("reads what the published menus offer in the same number of queries for more dishes and zones", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        await serveAndPublish(tx, f, [f.burger]);
        const session = (
          tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
        ).session;
        const reads = async () => {
          const prepared = vi.spyOn(session, "prepareQuery");
          try {
            const moves = await previewRoutingChange(tx, f.cfg, cheeseToBar(f));
            return { reads: prepared.mock.calls.length, extraMoves: extraMoves(moves).length };
          } finally {
            prepared.mockRestore();
          }
        };
        const oneDish = await reads();
        expect(oneDish.extraMoves).toBe(1);

        const [patio] = await tx
          .insert(floorZones)
          .values({ ...f.cfg, name: "Patio" })
          .returning();
        await configureZone(tx, f.cfg, { zoneId: patio!.id, departmentId: f.department });
        const dishes = [await f.product("Soup", f.food), await f.product("Pie", f.food)];
        for (const dish of dishes) {
          await writeProductModifiers(tx, dish, [{ kind: "extras", id: f.toppings }]);
          await setRoutingCell(
            tx,
            f.cfg,
            { row: productRow(dish), zoneId: null },
            station(f.terraceBar),
          );
        }
        const second = await createCatalogue(tx, { name: "Second menu" });
        await offerMenuThroughZone(tx, f.cfg, patio!.id, second.id, { displayOrder: 1 });
        await addProductToMenu(tx, { menuId: second.id, productId: dishes[1]! });
        const { document } = await buildMenuDocument(tx, second.id);
        await publishMenu(tx, second.id, menuDocumentHash(document), "person-1");
        await serveAndPublish(tx, f, [dishes[0]!]);
        expect(await reads()).toEqual({ reads: oneDish.reads, extraMoves: 6 });
      }));

    it("lists no extra move while the dish's station is switched off with no replacement", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        await tx
          .update(kitchenStations)
          .set({ active: false })
          .where(eq(kitchenStations.id, f.terraceBar));
        const moves = await previewRoutingChange(tx, f.cfg, cheeseToBar(f));
        expect(extraMoves(moves)).toEqual([]);
      }));

    it("marks an extra that comes to wait on a dish with no replacement station", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const [pass] = await tx
          .insert(kitchenStations)
          .values({ ...f.cfg, name: "Pass" })
          .returning();
        await setCategoryCell(tx, f.cfg, f.food, station(pass!.id));
        await tx
          .update(kitchenStations)
          .set({ active: false })
          .where(eq(kitchenStations.id, pass!.id));
        await setRoutingCell(
          tx,
          f.cfg,
          { row: productRow(f.cheese), zoneId: null },
          station(f.bar),
        );
        const moves = await previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address: { row: productRow(f.burger), zoneId: null },
          target: null,
        });
        expect(extraMoves(moves)).toEqual([
          {
            productId: f.cheese,
            productName: "Cheese",
            zoneId: f.terrace,
            zoneName: "Terrace",
            from: station(f.bar),
            to: null,
            toNoReplacement: true,
            periodIds: null,
            dish: { productId: f.burger, productName: "Burger" },
          },
        ]);
      }));

    it("orders one extra's moves by the name of its dish", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const soup = await f.product("Soup", f.food);
        await writeProductModifiers(tx, soup, [{ kind: "extras", id: f.toppings }]);
        await setRoutingCell(
          tx,
          f.cfg,
          { row: productRow(soup), zoneId: null },
          station(f.terraceBar),
        );
        const moves = await previewRoutingChange(tx, f.cfg, cheeseToBar(f));
        expect(extraMoves(moves).map((move) => move.dish)).toEqual([
          { productId: f.burger, productName: "Burger" },
          { productId: soup, productName: "Soup" },
        ]);
      }));

    it("names an extra that is a variant by its product and its variant", async () =>
      scoped(async (tx) => {
        const f = await withExtras(tx);
        const sides = (await createCategory(tx, { name: "Sides" })).id;
        const large = async (name: string) => {
          const [variant] = await tx
            .insert(products)
            .values({
              catalogueId: f.menu,
              parentId: await f.product(name, sides),
              name: "Large",
              categoryId: null,
            })
            .returning();
          return variant!.id;
        };
        const sizes = await createExtraList(
          tx,
          {
            name: "Sizes",
            minPicks: 0,
            maxPicks: 2,
            active: true,
            items: [
              { productId: await large("Olives"), price: "1.00" },
              { productId: await large("Chips"), price: "1.00" },
            ],
          },
          "en",
        );
        await writeProductModifiers(tx, f.burger, [{ kind: "extras", id: sizes.id }]);
        const moves = await previewRoutingChange(tx, f.cfg, {
          kind: "cell",
          address: { row: categoryRow(sides), zoneId: null },
          target: station(f.bar),
        });
        expect(extraMoves(moves).map((move) => [move.productName, move.dish])).toEqual([
          ["Chips (Large)", { productId: f.burger, productName: "Burger" }],
          ["Olives (Large)", { productId: f.burger, productName: "Burger" }],
        ]);
      }));
  });

  it("reports exactly what working out every product in every zone reports, for every kind of change", async () =>
    scoped(async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({ name: "Venue", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
        .returning();
      const cfg = { locationId: locationId(loc!.id) };
      const zone = async (name: string) => {
        const [row] = await tx
          .insert(floorZones)
          .values({ ...cfg, name })
          .returning();
        const department = await createDepartment(tx, cfg, {
          name: `${name} service`,
          orderStart: "table",
        });
        await configureZone(tx, cfg, { zoneId: row!.id, departmentId: department.id });
        return row!.id;
      };
      const terrace = await zone("Terrace");
      const patio = await zone("Patio");
      const [bar, kitchen, grill, fryer, pass] = await tx
        .insert(kitchenStations)
        .values([
          { ...cfg, name: "Bar", isDefault: true },
          { ...cfg, name: "Kitchen" },
          { ...cfg, name: "Grill" },
          { ...cfg, name: "Fryer" },
          { ...cfg, name: "Pass" },
        ])
        .returning();
      const food = (await createCategory(tx, { name: "Food" })).id;
      const mains = (await createCategory(tx, { name: "Mains", parentId: food })).id;
      const grills = (await createCategory(tx, { name: "Grills", parentId: mains })).id;
      const drinks = (await createCategory(tx, { name: "Drinks" })).id;
      const sides = (await createCategory(tx, { name: "Sides" })).id;
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
      const variant = async (parentId: string, name: string, categoryId: string | null) => {
        const [row] = await tx
          .insert(products)
          .values({ catalogueId: menu.id, parentId, name, categoryId })
          .returning();
        return row!.id;
      };
      const steak = await product("Steak", grills);
      const pasta = await product("Pasta", mains);
      const salad = await product("Salad", food);
      const wine = await product("Wine", drinks);
      const bread = await product("Bread", null);
      const chips = await product("Chips", sides);
      const cheese = await product("Cheese", null);
      const sauce = await product("Sauce", grills);
      const retired = await product("Retired", grills);
      await updateProduct(tx, retired, { active: false });
      const bigSteak = await variant(steak, "Large", null);
      const halfBread = await variant(bread, "Half", food);
      const list = async (name: string, items: readonly string[]) =>
        (
          await createExtraList(
            tx,
            {
              name,
              minPicks: 0,
              maxPicks: 2,
              active: true,
              items: items.map((productId) => ({ productId, price: "0.50" })),
            },
            "en",
          )
        ).id;
      await writeProductModifiers(tx, steak, [
        { kind: "extras", id: await list("Toppings", [chips, cheese]) },
      ]);
      // Pasta offers Sauce only through the menu Terrace serves: detached since it was published.
      await writeProductModifiers(tx, pasta, [
        { kind: "extras", id: await list("Sauces", [sauce]) },
      ]);
      await offerMenuThroughZone(tx, cfg, terrace, menu.id);
      await addProductToMenu(tx, { menuId: menu.id, productId: pasta });
      const { document } = await buildMenuDocument(tx, menu.id);
      await publishMenu(tx, menu.id, menuDocumentHash(document), "person-1");
      await writeProductModifiers(tx, pasta, []);

      await setRoutingCell(tx, cfg, { row: categoryRow(food), zoneId: null }, station(kitchen!.id));
      await setRoutingCell(
        tx,
        cfg,
        { row: categoryRow(grills), zoneId: terrace },
        station(grill!.id),
      );
      await setRoutingCell(tx, cfg, { row: categoryRow(drinks), zoneId: null }, station(pass!.id));
      await setRoutingCell(tx, cfg, { row: productRow(chips), zoneId: null }, station(fryer!.id));
      await setRoutingCell(tx, cfg, { row: noCategoryRow, zoneId: patio }, station(kitchen!.id));
      await setRoutingCell(tx, cfg, { row: allCategories, zoneId: terrace }, noPrep);
      await setStationFallback(tx, cfg, fryer!.id, grill!.id);
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(inArray(kitchenStations.id, [fryer!.id, pass!.id]));

      const active: readonly ProductFacts[] = [
        { productId: steak, routedProductId: steak, categoryId: grills },
        { productId: pasta, routedProductId: pasta, categoryId: mains },
        { productId: salad, routedProductId: salad, categoryId: food },
        { productId: wine, routedProductId: wine, categoryId: drinks },
        { productId: bread, routedProductId: bread, categoryId: null },
        { productId: chips, routedProductId: chips, categoryId: sides },
        { productId: cheese, routedProductId: cheese, categoryId: null },
        { productId: sauce, routedProductId: sauce, categoryId: grills },
        { productId: bigSteak, routedProductId: steak, categoryId: grills },
        { productId: halfBread, routedProductId: bread, categoryId: null },
      ];
      const offers: readonly [string, string, readonly string[]][] = [
        [steak, chips, [terrace, patio]],
        [steak, cheese, [terrace, patio]],
        [pasta, sauce, [terrace]],
      ];
      const facts = (id: string) => active.find((p) => p.productId === id)!;
      const moveKey = (move: {
        productId: string;
        dish?: { productId: string };
        zoneId: string | null;
        from: RouteTarget | null;
        to: RouteTarget | null;
        toNoReplacement: boolean;
      }) =>
        JSON.stringify([
          move.productId,
          move.dish?.productId ?? null,
          move.zoneId,
          targetKey(move.from),
          targetKey(move.to),
          move.toNoReplacement,
        ]);
      const placement = (rules: RoutingRules, dish: MakerChoice, extra: string, zoneId: string) => {
        const made = chooseExtraMakerBeside(rules, dish, facts(extra), zoneId, null)?.outcome;
        return made?.kind === "made"
          ? { follows: false, target: station(made.stationId), noReplacement: false }
          : { follows: true, target: dish.route, noReplacement: dish.noReplacement };
      };
      const reference = (before: RoutingRules, after: RoutingRules) => {
        const keys: string[] = [];
        for (const zoneId of [terrace, patio]) {
          for (const p of active) {
            const from = chooseMaker(before, p, zoneId, null);
            const to = chooseMaker(after, p, zoneId, null);
            if (
              targetKey(from.route) !== targetKey(to.route) ||
              from.noReplacement !== to.noReplacement
            )
              keys.push(
                moveKey({
                  ...p,
                  zoneId,
                  from: from.route,
                  to: to.route,
                  toNoReplacement: to.noReplacement,
                }),
              );
          }
          for (const [dish, extra, inZones] of offers) {
            if (!inZones.includes(zoneId)) continue;
            const from = placement(
              before,
              chooseMaker(before, facts(dish), zoneId, null),
              extra,
              zoneId,
            );
            const to = placement(
              after,
              chooseMaker(after, facts(dish), zoneId, null),
              extra,
              zoneId,
            );
            if ((from.follows && to.follows) || targetKey(from.target) === targetKey(to.target))
              continue;
            keys.push(
              moveKey({
                productId: extra,
                dish: { productId: dish },
                zoneId,
                from: from.target,
                to: to.target,
                toNoReplacement: to.noReplacement,
              }),
            );
          }
        }
        return keys.sort();
      };

      const rows = [
        productRow(steak),
        productRow(chips),
        categoryRow(food),
        categoryRow(grills),
        noCategoryRow,
        allCategories,
      ];
      const targets: (RouteTarget | null)[] = [station(bar!.id), station(grill!.id), noPrep, null];
      let dishMoves = 0;
      let extraMoveCount = 0;
      for (const row of rows)
        for (const zoneId of [terrace, patio, null]) {
          if (row.kind === "all" && zoneId === null) continue;
          const address: CellAddress = { row, zoneId };
          for (const target of targets) {
            const moves = await previewRoutingChange(tx, cfg, { kind: "cell", address, target });
            const before = await loadRoutingRules(tx, cfg, null);
            const saved = await tx.select().from(routingCells);
            if (target === null) await clearRoutingCell(tx, cfg, address);
            else await setRoutingCell(tx, cfg, address, target);
            const after = await loadRoutingRules(tx, cfg, null);
            await tx.delete(routingCells);
            await tx.insert(routingCells).values(saved);
            expect([address, target, moves.map(moveKey).sort()]).toEqual([
              address,
              target,
              reference(before, after),
            ]);
            dishMoves += moves.filter((move) => move.dish === undefined).length;
            extraMoveCount += moves.filter((move) => move.dish !== undefined).length;
          }
        }
      expect(dishMoves).toBeGreaterThan(50);
      expect(extraMoveCount).toBeGreaterThan(5);
    }));
});

/** Where the mojito is made with no zone at `at`, and the Terrace Bar's state then. */
async function routedAt(tx: Transaction, f: Awaited<ReturnType<typeof fixture>>, at: Date) {
  const resolver = await routingAt(tx, f.cfg, at);
  return {
    mojito: (await resolver.makers(null, [f.mojito])).get(f.mojito),
    terraceBar: (await resolver.stations()).get(f.terraceBar),
  };
}

describe("timed routing", () => {
  /** Friday 2 October 2026 at 22:00 in a venue on UTC, before its 06:00 cutover moves the day. */
  const fridayLate = {
    at: new Date("2026-10-02T22:00:00Z"),
    businessDay: "2026-10-02",
    moment: { weekday: 5, timeOfDay: "22:00" },
  };
  it("uses Friday hours and names the fallback, while now honors today's open", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await seedStationWeek(tx, f.cfg, f.terraceBar, [
        { weekday: 5, opensAt: "18:00", closesAt: "21:00" },
      ]);
      await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
      const { at } = fridayLate;
      const mojito = factsOf(f.mojito, f.mojito, f.cocktails);
      expect(await storedChoice(tx, f.cfg, mojito, null, fridayLate)).toEqual({
        route: { kind: "station", stationId: f.bar },
        decidedBy: { kind: "cell", address: { row: categoryRow(f.cocktails), zoneId: null } },
        fallbacks: [{ stationId: f.terraceBar, why: "out_of_hours" }],
        noReplacement: false,
      });
      expect(await routedAt(tx, f, at)).toMatchObject({
        mojito: { kind: "made", route: station(f.bar) },
        terraceBar: { open: false, why: "out_of_hours" },
      });
      await setStationToday(tx, f.cfg, f.terraceBar, "open", at);
      expect(await routedAt(tx, f, at)).toMatchObject({
        mojito: { kind: "made", route: station(f.terraceBar) },
        terraceBar: { open: true, why: "opened_by_hand" },
      });
      expect(await storedChoice(tx, f.cfg, mojito, null, fridayLate)).toMatchObject({
        route: station(f.terraceBar),
        fallbacks: [],
      });
      await setStationToday(tx, f.cfg, f.terraceBar, "closed", at);
      expect(await routedAt(tx, f, at)).toMatchObject({
        mojito: { kind: "made", route: station(f.bar) },
        terraceBar: { open: false, why: "closed_by_hand" },
      });
      expect(await storedChoice(tx, f.cfg, mojito, null, fridayLate)).toMatchObject({
        route: station(f.bar),
        fallbacks: [{ stationId: f.terraceBar, why: "closed_by_hand" }],
      });
    }));
  it("does not apply hours while the venue clock cannot be read", async () =>
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
      expect(await routedAt(tx, f, fridayLate.at)).toMatchObject({
        mojito: { kind: "made", route: station(f.terraceBar) },
        terraceBar: { open: true, why: "open" },
      });
    }));
  it("routes now around today's manual closure", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const { at } = fridayLate;
      await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
      await setStationToday(tx, f.cfg, f.terraceBar, "closed", at);
      expect(await routedAt(tx, f, at)).toMatchObject({
        mojito: { kind: "made", route: station(f.bar) },
        terraceBar: { open: false, why: "closed_by_hand" },
      });
      expect(
        await storedChoice(tx, f.cfg, factsOf(f.mojito, f.mojito, f.cocktails), null, fridayLate),
      ).toMatchObject({
        route: { kind: "station", stationId: f.bar },
        fallbacks: [{ stationId: f.terraceBar, why: "closed_by_hand" }],
      });
    }));
});

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
    toppings,
    chips,
    cheese,
    chipsVariant: variant!.id,
    grill: grill!.id,
    fryer: fryer!.id,
  };
}

describe("extra maker resolution", () => {
  it("places each chosen extra against the dish's final station and names its cell", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.grill });
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.mojito], fixedInstant)).get(f.mojito),
      ).toEqual({ kind: "made", route: station(f.grill) });
      expect(
        await resolveExtraMakers(
          tx,
          f.cfg,
          null,
          [
            { key: "chips", productId: f.chips, dishStationId: f.grill },
            { key: "cheese", productId: f.cheese, dishStationId: f.grill },
          ],
          fixedInstant,
        ),
      ).toEqual(
        new Map([
          ["chips", { kind: "made", stationId: f.fryer }],
          ["cheese", { kind: "follows_dish", why: "no_rule" }],
        ]),
      );
      const rules = await loadRoutingRules(tx, f.cfg, null);
      const dish = chooseMaker(rules, factsOf(f.mojito, f.mojito, f.cocktails), null, null);
      expect(
        [factsOf(f.chips, f.chips, f.sides), factsOf(f.cheese, f.cheese, f.toppings)].map((extra) =>
          chooseExtraMakerBeside(rules, dish, extra, null, null),
        ),
      ).toEqual([
        {
          outcome: { kind: "made", stationId: f.fryer },
          decidedBy: { kind: "cell", address: { row: categoryRow(f.sides), zoneId: null } },
          fallbacks: [],
        },
        {
          outcome: { kind: "follows_dish", why: "no_rule" },
          decidedBy: { kind: "default" },
          fallbacks: [],
        },
      ]);
    }));
  it("gives no extra a maker while its dish's cell's station is closed with no replacement", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.grill });
      await setStationToday(tx, f.cfg, f.grill, "closed", fixedInstant);
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.mojito], fixedInstant)).get(f.mojito),
      ).toEqual({ kind: "no_replacement", stationId: f.grill });
      const today = { businessDay: "2026-10-02", moment: { weekday: 5, timeOfDay: "18:30" } };
      const rules = await loadRoutingRules(tx, f.cfg, today.businessDay);
      const dish = chooseMaker(rules, factsOf(f.mojito, f.mojito, f.cocktails), null, today.moment);
      expect(dish.route).toBeNull();
      expect(
        chooseExtraMakerBeside(rules, dish, factsOf(f.chips, f.chips, f.sides), null, today.moment),
      ).toBeNull();
    }));
  it("treats a dish with no preparation as having no station when placing an extra", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setCategoryCell(tx, f.cfg, f.cocktails, noPrep);
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.mojito], fixedInstant)).get(f.mojito),
      ).toEqual({ kind: "made", route: noPrep });
      expect(
        await resolveExtraMakers(
          tx,
          f.cfg,
          null,
          [{ key: "chips", productId: f.chips, dishStationId: null }],
          fixedInstant,
        ),
      ).toEqual(new Map([["chips", { kind: "made", stationId: f.fryer }]]));
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
      const mojito = factsOf(f.mojito, f.mojito, f.cocktails);
      expect(await storedChoice(tx, f.cfg, mojito, f.terrace)).toMatchObject({
        route: station(f.bar),
        decidedBy: { kind: "default" },
        fallbacks: [],
      });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      expect(
        await (await routingAt(tx, f.cfg, fixedInstant)).makers(f.terrace, [f.mojito, f.bread]),
      ).toEqual(
        new Map([
          [f.mojito, { kind: "no_station" }],
          [f.bread, { kind: "no_station" }],
        ]),
      );
      expect(await storedChoice(tx, f.cfg, mojito, f.terrace)).toMatchObject({
        route: null,
        decidedBy: null,
        noReplacement: false,
      });
    }));

  it("a product's Every zone cell beats its parent category's Terrace cell, and clearing it shows the Terrace cell with its origin", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const terraceCell: CellAddress = { row: categoryRow(f.cocktails), zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, terraceCell, station(f.terraceBar));
      const productCell: CellAddress = { row: productRow(f.mojito), zoneId: null };
      await setRoutingCell(tx, f.cfg, productCell, station(f.bar));
      const both = [
        factsOf(f.mojito, f.mojito, f.cocktails),
        factsOf(f.variant, f.mojito, f.cocktails),
      ];
      const ids = [f.mojito, f.variant];
      for (const facts of both)
        expect(await storedChoice(tx, f.cfg, facts, f.terrace)).toMatchObject({
          route: station(f.bar),
          decidedBy: { kind: "cell", address: productCell },
        });
      expect(await (await routingAt(tx, f.cfg, fixedInstant)).makers(f.terrace, ids)).toEqual(
        new Map(ids.map((id) => [id, { kind: "made", route: station(f.bar) }])),
      );
      await clearRoutingCell(tx, f.cfg, productCell);
      for (const facts of both) {
        const chosen = await storedChoice(tx, f.cfg, facts, f.terrace);
        expect(chosen.route).toEqual(station(f.terraceBar));
        expect(chosen.decidedBy).toEqual({ kind: "cell", address: terraceCell });
      }
      expect(await (await routingAt(tx, f.cfg, fixedInstant)).makers(f.terrace, ids)).toEqual(
        new Map(ids.map((id) => [id, { kind: "made", route: station(f.terraceBar) }])),
      );
      expect(
        await (await routingAt(tx, f.cfg, fixedInstant)).makers(f.terrace, [f.mojito]),
      ).toEqual(new Map([[f.mojito, { kind: "made", route: station(f.terraceBar) }]]));
    }));

  it("an uncategorised product and a variant of it route by stored No category cells, after their own product cells and before All categories", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const half = await breadVariant(tx, f);
      const factsById = new Map([
        [f.bread, factsOf(f.bread, f.bread, null)],
        [half, factsOf(half, f.bread, null)],
        [f.mojito, factsOf(f.mojito, f.mojito, f.cocktails)],
        [f.variant, factsOf(f.variant, f.mojito, f.cocktails)],
      ]);
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
          expect(await storedChoice(tx, f.cfg, factsById.get(id)!, f.terrace), id).toMatchObject({
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

  it("routes a variant and an extra by the parent-owned cell and its category path", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const variantCell: CellAddress = { row: productRow(f.chips), zoneId: f.terrace };
      await setRoutingCell(tx, f.cfg, variantCell, station(f.grill));
      const extrasCell: CellAddress = { row: categoryRow(f.extras), zoneId: null };
      await setRoutingCell(tx, f.cfg, extrasCell, station(f.terraceBar));
      const variant = factsOf(f.chipsVariant, f.chips, f.sides);
      const rules = await loadRoutingRules(tx, f.cfg, null);
      const dish = chooseMaker(rules, variant, f.terrace, null);
      expect(dish.route).toEqual(station(f.grill));
      expect(dish.decidedBy).toEqual({ kind: "cell", address: variantCell });
      expect(
        (await resolveMakers(tx, f.cfg, f.terrace, [f.chipsVariant], fixedInstant)).get(
          f.chipsVariant,
        ),
      ).toEqual({ kind: "made", route: station(f.grill) });
      expect(
        [variant, factsOf(f.cheese, f.cheese, f.toppings)].map((extra) =>
          chooseExtraMakerBeside(rules, dish, extra, f.terrace, null),
        ),
      ).toEqual([
        {
          outcome: { kind: "follows_dish", why: "same_station" },
          decidedBy: { kind: "cell", address: variantCell },
          fallbacks: [],
        },
        {
          outcome: { kind: "made", stationId: f.terraceBar },
          decidedBy: { kind: "cell", address: extrasCell },
          fallbacks: [],
        },
      ]);
      expect(
        await resolveExtraMakers(
          tx,
          f.cfg,
          f.terrace,
          [
            { key: "variant", productId: f.chipsVariant, dishStationId: f.grill },
            { key: "cheese", productId: f.cheese, dishStationId: f.grill },
          ],
          fixedInstant,
        ),
      ).toEqual(
        new Map([
          ["variant", { kind: "follows_dish", why: "same_station" }],
          ["cheese", { kind: "made", stationId: f.terraceBar }],
        ]),
      );
      expect(
        (await resolveMakers(tx, f.cfg, null, [f.chipsVariant], fixedInstant)).get(f.chipsVariant),
      ).toEqual({ kind: "made", route: station(f.fryer) });
      expect((await storedChoice(tx, f.cfg, variant, null)).decidedBy).toEqual({
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
      expect((await resolveMakers(tx, f.cfg, null, [f.chips], fixedInstant)).get(f.chips)).toEqual({
        kind: "made",
        route: station(f.bar),
      });
      const chosen = await storedChoice(tx, f.cfg, factsOf(f.chips, f.chips, f.sides), null, {
        businessDay: "2026-10-02",
        moment: { weekday: 5, timeOfDay: "18:30" },
      });
      expect(chosen.route).toEqual(station(f.bar));
      expect(chosen.decidedBy).toEqual({ kind: "cell", address });
      expect(chosen.fallbacks).toEqual([{ stationId: f.terraceBar, why: "closed_by_hand" }]);
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
        byHand: null,
        sendsTo: null,
        why: "open",
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
        closeWholeVenue: false,
        cells: [
          { subject: { kind: "station", id: stationId }, cell: { mode: "closed", periods: [] } },
        ],
      },
      SAVED_AT,
    );

  it("routes by a date's special hours, and by the standard week on the same weekday a week later", async () =>
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
      // 18:00 UTC is 20:00 in Madrid on both Fridays.
      expect(await routedAt(tx, f, new Date("2026-10-09T18:00:00Z"))).toMatchObject({
        mojito: { kind: "made", route: station(f.bar) },
        terraceBar: { open: false, why: "out_of_hours" },
      });
      expect(await routedAt(tx, f, new Date("2026-10-16T18:00:00Z"))).toMatchObject({
        mojito: { kind: "made", route: station(f.terraceBar) },
        terraceBar: { open: true, why: "open" },
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

describe("routing on repeating named days", () => {
  it("routes a dish away from a closed station every Christmas, retaining the default station", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid", dayCutover: "06:00:00" })
        .where(eq(locations.id, f.cfg.locationId));
      await setCategoryCell(tx, f.cfg, f.cocktails, station(f.terraceBar));
      await setStationFallback(tx, f.cfg, f.terraceBar, f.bar);
      await tx.insert(specialDates).values({
        locationId: f.cfg.locationId,
        date: "2026-12-25",
        name: "Navidad",
        repeatOn: "12-25",
        closeWholeVenue: true,
      });
      for (const instant of ["2026-12-25T12:00:00Z", "2027-12-25T12:00:00Z"]) {
        const resolver = await routingAt(tx, f.cfg, new Date(instant));
        expect(await resolver.makers(null, [f.mojito])).toEqual(
          new Map([[f.mojito, { kind: "made", route: station(f.bar) }]]),
        );
        expect((await resolver.stations()).get(f.terraceBar)).toMatchObject({ open: false });
        expect((await resolver.stations()).get(f.bar)).toMatchObject({
          open: true,
          isDefault: true,
        });
      }
      for (const instant of ["2025-12-25T12:00:00Z", "2027-12-26T12:00:00Z"]) {
        expect(
          await (await routingAt(tx, f.cfg, new Date(instant))).makers(null, [f.mojito]),
        ).toEqual(new Map([[f.mojito, { kind: "made", route: station(f.terraceBar) }]]));
      }
      const model = await routingModel(tx, f.cfg, new Date("2027-01-01T12:00:00Z"));
      expect(model.stationTimes.find((row) => row.stationId === f.terraceBar)).toMatchObject({
        specialDateRestricts: true,
      });
    }));
});

describe("routing during a service period", () => {
  /** Cocktails' Every zone cell: Upstairs bar, and Downstairs bar during Lunch (12:00–14:00 UTC);
   * Afternoon (14:00–18:00) has no line. */
  async function periodFixture(tx: Transaction) {
    const f = await fixture(tx);
    await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
    const [dining] = await tx
      .insert(floorZones)
      .values({ ...f.cfg, name: "Dining room" })
      .returning();
    await configureZone(tx, f.cfg, { zoneId: dining!.id, departmentId: f.department });
    const [upstairs, downstairs] = await tx
      .insert(kitchenStations)
      .values([
        { ...f.cfg, name: "Upstairs bar" },
        { ...f.cfg, name: "Downstairs bar" },
      ])
      .returning();
    const period = async (name: string) =>
      (await saveMenuPeriod(tx, f.cfg, f.department, { name, menuId: f.menu, staffMenuIds: [] }))
        .id;
    const lunch = await period("Lunch");
    const afternoon = await period("Afternoon");
    await replaceMenuWeek(
      tx,
      f.cfg,
      f.department,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: [
          { periodId: lunch, startsAt: "12:00", endsAt: "14:00" },
          { periodId: afternoon, startsAt: "14:00", endsAt: "18:00" },
        ],
      })),
      fridayAt("10:00"),
    );
    await setCategoryCell(tx, f.cfg, f.cocktails, station(upstairs!.id));
    const [cell] = await tx
      .select({ id: routingCells.id })
      .from(routingCells)
      .where(eq(routingCells.categoryId, f.cocktails));
    await tx.insert(routingCellPeriods).values({
      cellId: cell!.id,
      periodId: lunch,
      departmentId: f.department,
      stationId: downstairs!.id,
    });
    return { ...f, dining: dining!.id, upstairs: upstairs!.id, downstairs: downstairs!.id };
  }
  const fridayAt = (time: string) => new Date(`2026-10-02T${time}:00Z`);
  const made = (stationId: string) => ({ kind: "made", route: station(stationId) });

  it("routes a cocktail Downstairs inside Lunch and Upstairs inside Afternoon, which has no line", async () =>
    scoped(async (tx) => {
      const f = await periodFixture(tx);
      const lunch = await routingAt(tx, f.cfg, fridayAt("13:00"));
      expect(await lunch.makers(f.terrace, [f.mojito])).toEqual(
        new Map([[f.mojito, made(f.downstairs)]]),
      );
      expect(
        await lunch.extraMakers(f.terrace, [
          { key: "x", productId: f.mojito, dishStationId: f.bar },
        ]),
      ).toEqual(new Map([["x", { kind: "made", stationId: f.downstairs }]]));
      expect(await lunch.makers(null, [f.mojito])).toEqual(new Map([[f.mojito, made(f.upstairs)]]));
      const afternoon = await routingAt(tx, f.cfg, fridayAt("14:10"));
      expect(await afternoon.makers(f.terrace, [f.mojito])).toEqual(
        new Map([[f.mojito, made(f.upstairs)]]),
      );
      expect(await resolveMakers(tx, f.cfg, f.dining, [f.mojito], fridayAt("12:30"))).toEqual(
        new Map([[f.mojito, made(f.downstairs)]]),
      );
    }));

  it("reads a department's period once per routing call, however many dishes and zones", async () =>
    scoped(async (tx) => {
      const f = await periodFixture(tx);
      const at = fridayAt("13:00");
      const asked: string[] = [];
      const resolver = await routingAt(tx, f.cfg, at, {
        runningPeriod: async (departmentId) => {
          asked.push(departmentId);
          return (await resolveDepartmentService(tx, f.cfg, departmentId, at)).periodId;
        },
      });
      expect(await resolver.makers(f.terrace, [f.mojito, f.variant])).toEqual(
        new Map([
          [f.mojito, made(f.downstairs)],
          [f.variant, made(f.downstairs)],
        ]),
      );
      await resolver.makers(f.dining, [f.mojito]);
      await resolver.extraMakers(f.terrace, [
        { key: "x", productId: f.mojito, dishStationId: f.bar },
      ]);
      expect(asked).toEqual([f.department]);
    }));

  it("asks for no period when no cell has period lines", async () =>
    scoped(async (tx) => {
      const f = await periodFixture(tx);
      await tx.delete(routingCellPeriods);
      const asked: string[] = [];
      const resolver = await routingAt(tx, f.cfg, fridayAt("13:00"), {
        runningPeriod: async (departmentId) => {
          asked.push(departmentId);
          return (await resolveDepartmentService(tx, f.cfg, departmentId, fridayAt("13:00")))
            .periodId;
        },
      });
      expect(await resolver.makers(f.terrace, [f.mojito])).toEqual(
        new Map([[f.mojito, made(f.upstairs)]]),
      );
      expect(asked).toEqual([]);
    }));

  it("uses Any other time and asks for no period while the venue's clock cannot be read", async () =>
    scoped(async (tx) => {
      const f = await periodFixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      const asked: string[] = [];
      const resolver = await routingAt(tx, f.cfg, fridayAt("13:00"), {
        runningPeriod: async (departmentId) => {
          asked.push(departmentId);
          return null;
        },
      });
      expect(await resolver.makers(f.terrace, [f.mojito])).toEqual(
        new Map([[f.mojito, made(f.upstairs)]]),
      );
      expect(asked).toEqual([]);
    }));
});

describe("saving a cell's period choices", () => {
  /** Cocktails hold Mojito (with its Large variant) and Daiquiri. Dining's Lunch menu holds Mojito
   * alone; Brunch's menus hold only Bread; Staff lunch's customer menu holds Bread and its
   * staff-only menu is Lunch's. The Patio serves the Bar department, whose own Lunch exists too. */
  async function choicesFixture(tx: Transaction) {
    const f = await fixture(tx);
    const [upstairs, downstairs] = await tx
      .insert(kitchenStations)
      .values([
        { ...f.cfg, name: "Upstairs bar" },
        { ...f.cfg, name: "Downstairs bar" },
      ])
      .returning();
    const daiquiri = (
      await createProduct(tx, {
        catalogueId: f.menu,
        name: "Daiquiri",
        categoryId: f.cocktails,
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      })
    ).id;
    const lunchMenu = (await createCatalogue(tx, { name: "Lunch menu" })).id;
    await addProductToMenu(tx, { menuId: lunchMenu, productId: f.mojito });
    const breadMenu = (await createCatalogue(tx, { name: "Bread menu" })).id;
    await addProductToMenu(tx, { menuId: breadMenu, productId: f.bread });
    const period = async (
      departmentId: string,
      name: string,
      menuId: string,
      staffMenuIds: string[] = [],
    ) =>
      (
        await saveMenuPeriod(tx, f.cfg, departmentId, {
          name,
          menuId,
          staffMenuIds,
          colour: "blue",
        })
      ).id;
    const lunch = await period(f.department, "Lunch", lunchMenu);
    const brunch = await period(f.department, "Brunch", breadMenu);
    const staffLunch = await period(f.department, "Staff lunch", breadMenu, [lunchMenu]);
    const barDepartment = (await createDepartment(tx, f.cfg, { name: "Bar", orderStart: "table" }))
      .id;
    const [patio] = await tx
      .insert(floorZones)
      .values({ ...f.cfg, name: "Patio" })
      .returning();
    await configureZone(tx, f.cfg, { zoneId: patio!.id, departmentId: barDepartment });
    const barLunch = await period(barDepartment, "Lunch", lunchMenu);
    return {
      ...f,
      upstairs: upstairs!.id,
      downstairs: downstairs!.id,
      daiquiri,
      lunchMenu,
      breadMenu,
      lunch,
      brunch,
      staffLunch,
      barDepartment,
      barLunch,
      patio: patio!.id,
    };
  }
  type Choices = Awaited<ReturnType<typeof choicesFixture>>;
  const at = new Date("2026-10-02T13:00:00Z");
  const everyZone = (f: Choices): CellAddress => ({ row: categoryRow(f.cocktails), zoneId: null });
  const terraceCell = (f: Choices): CellAddress => ({
    row: categoryRow(f.cocktails),
    zoneId: f.terrace,
  });
  const line = (periodId: string, target: RouteTarget) => ({ periodId, target });
  const modelCell = async (tx: Transaction, f: Choices, address: CellAddress) =>
    (await routingModel(tx, f.cfg, at)).cells.find(
      (cell) => cellKey(cell) === cellKey({ ...address, target: noPrep }),
    );
  const storedLines = (tx: Transaction) =>
    tx
      .select({ periodId: routingCellPeriods.periodId, stationId: routingCellPeriods.stationId })
      .from(routingCellPeriods);

  it("gives each zone of the model its department, or null where it serves none", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      const [garden] = await tx
        .insert(floorZones)
        .values({ ...f.cfg, name: "Garden" })
        .returning();
      const { zones } = await routingModel(tx, f.cfg, at);
      expect(zones).toEqual([
        { id: garden!.id, name: "Garden", departmentId: null },
        { id: f.patio, name: "Patio", departmentId: f.barDepartment },
        { id: f.terrace, name: "Terrace", departmentId: f.department },
      ]);
    }));

  it("refuses a cell with period lines at a zone that serves no department, writing nothing", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      const [garden] = await tx
        .insert(floorZones)
        .values({ ...f.cfg, name: "Garden" })
        .returning();
      const address: CellAddress = { row: categoryRow(f.cocktails), zoneId: garden!.id };
      for (const write of [
        () =>
          setRoutingCell(tx, f.cfg, address, station(f.upstairs), [
            line(f.lunch, station(f.downstairs)),
          ]),
        () =>
          previewRoutingChange(tx, f.cfg, {
            kind: "cell",
            address,
            target: station(f.upstairs),
            periods: [line(f.lunch, station(f.downstairs))],
          }),
      ])
        await expect(write()).rejects.toMatchObject({
          code: "service_zone.not_found",
          params: { zoneId: garden!.id },
        });
      expect(await storedLines(tx)).toEqual([]);
      expect(
        await tx.select().from(routingCells).where(eq(routingCells.zoneId, garden!.id)),
      ).toEqual([]);
    }));

  it("keeps a cell's lines when a save leaves them out, and clears them with an empty list", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
      ]);
      expect(await modelCell(tx, f, everyZone(f))).toEqual({
        ...everyZone(f),
        target: station(f.upstairs),
        periods: [line(f.lunch, station(f.downstairs))],
      });
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.bar));
      expect(await modelCell(tx, f, everyZone(f))).toEqual({
        ...everyZone(f),
        target: station(f.bar),
        periods: [line(f.lunch, station(f.downstairs))],
      });
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.bar), []);
      expect(await modelCell(tx, f, everyZone(f))).toEqual({
        ...everyZone(f),
        target: station(f.bar),
      });
      expect(await storedLines(tx)).toEqual([]);
    }));

  it("deletes a cell's lines when the cell is cleared", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
        line(f.staffLunch, noPrep),
      ]);
      expect(await storedLines(tx)).toHaveLength(2);
      await clearRoutingCell(tx, f.cfg, everyZone(f));
      expect(await storedLines(tx)).toEqual([]);
      expect(await modelCell(tx, f, everyZone(f))).toBeUndefined();
    }));

  it("refuses another department's period, an unknown or repeated period, a period offering none of the row and a switched-off station, writing nothing", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      const unknown = randomUUID();
      for (const [address, lines, code, params] of [
        [
          terraceCell(f),
          [line(f.barLunch, station(f.downstairs))],
          "route.period_invalid",
          { periodId: f.barLunch, reason: "other_department" },
        ],
        [
          everyZone(f),
          [line(unknown, station(f.downstairs))],
          "route.subject_not_found",
          { subject: "period", id: unknown },
        ],
        [
          everyZone(f),
          [line(f.lunch, station(f.downstairs)), line(f.lunch, noPrep)],
          "route.period_invalid",
          { periodId: f.lunch, reason: "repeated" },
        ],
        [
          everyZone(f),
          [line(f.brunch, station(f.downstairs))],
          "route.period_invalid",
          { periodId: f.brunch, reason: "not_offered" },
        ],
        [
          everyZone(f),
          [line(f.lunch, station(f.switchedOff))],
          "route.station_inactive",
          { stationId: f.switchedOff },
        ],
      ] as const) {
        await expect(
          setRoutingCell(tx, f.cfg, address, station(f.upstairs), [...lines]),
          JSON.stringify(params),
        ).rejects.toMatchObject({ code, params });
      }
      expect(await storedLines(tx)).toEqual([]);
      expect((await routingModel(tx, f.cfg, at)).cells).toEqual([]);
    }));

  it("checks a product row's line against that product alone", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      const lunchLine = [line(f.lunch, station(f.downstairs))];
      await setRoutingCell(
        tx,
        f.cfg,
        { row: productRow(f.mojito), zoneId: null },
        station(f.upstairs),
        lunchLine,
      );
      await expect(
        setRoutingCell(
          tx,
          f.cfg,
          { row: productRow(f.daiquiri), zoneId: null },
          station(f.upstairs),
          lunchLine,
        ),
      ).rejects.toMatchObject({
        code: "route.period_invalid",
        params: { periodId: f.lunch, reason: "not_offered" },
      });
      expect(await storedLines(tx)).toEqual([{ periodId: f.lunch, stationId: f.downstairs }]);
    }));

  it("accepts a period whose staff-only menu alone reaches the row, and lets Every zone hold two departments' periods", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.staffLunch, station(f.downstairs)),
        line(f.barLunch, noPrep),
      ]);
      expect((await modelCell(tx, f, everyZone(f)))?.periods).toEqual(
        expect.arrayContaining([
          line(f.staffLunch, station(f.downstairs)),
          line(f.barLunch, noPrep),
        ]),
      );
    }));

  it("keeps a stored line its period's menus no longer offer while its station is unchanged, and checks it once its station changes", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
      ]);
      await updateMenuPeriod(tx, f.cfg, f.lunch, { menuId: f.breadMenu, staffMenuIds: [] });
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.bar), [
        line(f.lunch, station(f.downstairs)),
      ]);
      expect(await modelCell(tx, f, everyZone(f))).toEqual({
        ...everyZone(f),
        target: station(f.bar),
        periods: [{ ...line(f.lunch, station(f.downstairs)), notOffered: true }],
      });
      await expect(
        setRoutingCell(tx, f.cfg, everyZone(f), station(f.bar), [
          line(f.lunch, station(f.upstairs)),
        ]),
      ).rejects.toMatchObject({
        code: "route.period_invalid",
        params: { periodId: f.lunch, reason: "not_offered" },
      });
      expect(await storedLines(tx)).toEqual([{ periodId: f.lunch, stationId: f.downstairs }]);
    }));

  describe("marking a stored line its period's menus no longer offer", () => {
    const lunchRootMember = async (tx: Transaction, f: Choices, productId: string) => {
      const [member] = await tx
        .select({ id: sectionMembers.id, sectionId: sectionMembers.sectionId })
        .from(sectionMembers)
        .innerJoin(sections, eq(sections.id, sectionMembers.sectionId))
        .where(
          and(
            eq(sections.ownerMenuId, f.lunchMenu),
            eq(sections.role, "menu_root"),
            eq(sectionMembers.productId, productId),
          ),
        );
      return member!;
    };
    const takeOffLunchMenu = async (tx: Transaction, f: Choices, productId: string) => {
      const member = await lunchRootMember(tx, f, productId);
      await removeMember(tx, member.sectionId, member.id);
    };
    const mojitoRow = (f: Choices): CellAddress => ({ row: productRow(f.mojito), zoneId: null });

    it("leaves a product row's line unmarked while its period's menu offers the product, marks it once the product leaves the menu, and still saves the cell unchanged", async () =>
      scoped(async (tx) => {
        const f = await choicesFixture(tx);
        await setRoutingCell(tx, f.cfg, mojitoRow(f), station(f.upstairs), [
          line(f.lunch, station(f.downstairs)),
        ]);
        expect(await modelCell(tx, f, mojitoRow(f))).toStrictEqual({
          ...mojitoRow(f),
          target: station(f.upstairs),
          periods: [line(f.lunch, station(f.downstairs))],
        });
        await takeOffLunchMenu(tx, f, f.mojito);
        const marked = {
          ...mojitoRow(f),
          target: station(f.upstairs),
          periods: [{ ...line(f.lunch, station(f.downstairs)), notOffered: true }],
        };
        expect(await modelCell(tx, f, mojitoRow(f))).toStrictEqual(marked);
        await setRoutingCell(tx, f.cfg, mojitoRow(f), station(f.upstairs), [
          line(f.lunch, station(f.downstairs)),
        ]);
        expect(await modelCell(tx, f, mojitoRow(f))).toStrictEqual(marked);
      }));

    it("leaves a line unmarked while only the period's staff-only menu offers the product", async () =>
      scoped(async (tx) => {
        const f = await choicesFixture(tx);
        await setRoutingCell(tx, f.cfg, mojitoRow(f), station(f.upstairs), [
          line(f.staffLunch, station(f.downstairs)),
        ]);
        expect((await modelCell(tx, f, mojitoRow(f)))?.periods).toStrictEqual([
          line(f.staffLunch, station(f.downstairs)),
        ]);
        await takeOffLunchMenu(tx, f, f.mojito);
        expect((await modelCell(tx, f, mojitoRow(f)))?.periods).toStrictEqual([
          { ...line(f.staffLunch, station(f.downstairs)), notOffered: true },
        ]);
      }));

    it("leaves a category row's line unmarked while any active product of its subtree is on the period's menus, and marks it when none is", async () =>
      scoped(async (tx) => {
        const f = await choicesFixture(tx);
        const drinksRow: CellAddress = { row: categoryRow(f.drinks), zoneId: null };
        await setRoutingCell(tx, f.cfg, drinksRow, station(f.upstairs), [
          line(f.lunch, station(f.downstairs)),
        ]);
        const periodsOf = async () => (await modelCell(tx, f, drinksRow))?.periods;
        expect(await periodsOf()).toStrictEqual([line(f.lunch, station(f.downstairs))]);
        await addProductToMenu(tx, { menuId: f.lunchMenu, productId: f.daiquiri });
        await takeOffLunchMenu(tx, f, f.mojito);
        expect(await periodsOf()).toStrictEqual([line(f.lunch, station(f.downstairs))]);
        await updateProduct(tx, f.daiquiri, { active: false });
        expect(await periodsOf()).toStrictEqual([
          { ...line(f.lunch, station(f.downstairs)), notOffered: true },
        ]);
      }));

    it("marks every line of a category row with no active product", async () =>
      scoped(async (tx) => {
        const f = await choicesFixture(tx);
        const beerRow: CellAddress = { row: categoryRow(f.beer), zoneId: null };
        await setRoutingCell(tx, f.cfg, beerRow, station(f.upstairs));
        const [cell] = await tx
          .select({ id: routingCells.id })
          .from(routingCells)
          .where(eq(routingCells.categoryId, f.beer));
        await tx.insert(routingCellPeriods).values(
          [f.lunch, f.staffLunch].map((periodId) => ({
            cellId: cell!.id,
            periodId,
            departmentId: f.department,
            stationId: f.downstairs,
          })),
        );
        expect((await modelCell(tx, f, beerRow))?.periods).toStrictEqual([
          { ...line(f.lunch, station(f.downstairs)), notOffered: true },
          { ...line(f.staffLunch, station(f.downstairs)), notOffered: true },
        ]);
      }));

    it("counts a variant on the period's menu for its parent's row", async () =>
      scoped(async (tx) => {
        const f = await choicesFixture(tx);
        const [root] = await tx
          .select({ id: sections.id })
          .from(sections)
          .where(and(eq(sections.ownerMenuId, f.breadMenu), eq(sections.role, "menu_root")));
        const [variantMember] = await tx
          .insert(sectionMembers)
          .values({ sectionId: root!.id, position: 9, productId: f.variant })
          .returning();
        await setRoutingCell(tx, f.cfg, mojitoRow(f), station(f.upstairs), [
          line(f.brunch, station(f.downstairs)),
        ]);
        expect((await modelCell(tx, f, mojitoRow(f)))?.periods).toStrictEqual([
          line(f.brunch, station(f.downstairs)),
        ]);
        await tx.delete(sectionMembers).where(eq(sectionMembers.id, variantMember!.id));
        expect((await modelCell(tx, f, mojitoRow(f)))?.periods).toStrictEqual([
          { ...line(f.brunch, station(f.downstairs)), notOffered: true },
        ]);
      }));

    it("marks a stored line whose period is not one of the venue's, last, rather than failing the read", async () =>
      scoped(async (tx) => {
        const f = await choicesFixture(tx);
        const [elsewhere] = await tx
          .insert(locations)
          .values({
            name: "Elsewhere",
            invoiceLocales: ["en-GB"],
            operationDescription: "Hospitality",
          })
          .returning();
        const otherCfg = { locationId: locationId(elsewhere!.id) };
        const otherDepartment = await createDepartment(tx, otherCfg, {
          name: "Dining",
          orderStart: "table",
        });
        const otherLunch = (
          await saveMenuPeriod(tx, otherCfg, otherDepartment.id, {
            name: "Lunch",
            menuId: f.lunchMenu,
            staffMenuIds: [],
            colour: "blue",
          })
        ).id;
        await setRoutingCell(tx, f.cfg, mojitoRow(f), station(f.upstairs));
        const [cell] = await tx
          .select({ id: routingCells.id })
          .from(routingCells)
          .where(eq(routingCells.productId, f.mojito));
        for (const [periodId, departmentId] of [
          [otherLunch, otherDepartment.id],
          [f.lunch, f.department],
        ])
          await tx.insert(routingCellPeriods).values({
            cellId: cell!.id,
            periodId: periodId!,
            departmentId: departmentId!,
            stationId: f.downstairs,
          });
        expect((await modelCell(tx, f, mojitoRow(f)))?.periods).toStrictEqual([
          line(f.lunch, station(f.downstairs)),
          { ...line(otherLunch, station(f.downstairs)), notOffered: true },
        ]);
      }));

    it("reads no product list when no cell stores a period line", async () =>
      scoped(async (tx) => {
        const f = await choicesFixture(tx);
        const session = (
          tx as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } }
        ).session;
        const prepared = vi.spyOn(session, "prepareQuery");
        const productListReads = () =>
          prepared.mock.calls.filter(([query]) => query.sql.includes("coalesce(")).length;
        try {
          await routingModel(tx, f.cfg, at);
          expect(productListReads()).toBe(0);
          await setRoutingCell(tx, f.cfg, mojitoRow(f), station(f.upstairs), [
            line(f.lunch, station(f.downstairs)),
          ]);
          prepared.mockClear();
          await routingModel(tx, f.cfg, at);
          expect(productListReads()).toBe(1);
        } finally {
          prepared.mockRestore();
        }
      }));
  });

  it("checks every line sent to pin an inherited cell, as the cell stores none of them", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
        line(f.barLunch, station(f.downstairs)),
      ]);
      await expect(
        setRoutingCell(tx, f.cfg, terraceCell(f), station(f.upstairs), [
          line(f.lunch, station(f.downstairs)),
          line(f.barLunch, station(f.downstairs)),
        ]),
      ).rejects.toMatchObject({
        code: "route.period_invalid",
        params: { periodId: f.barLunch, reason: "other_department" },
      });
      await expect(
        setRoutingCell(
          tx,
          f.cfg,
          { row: productRow(f.daiquiri), zoneId: null },
          station(f.upstairs),
          [line(f.lunch, station(f.downstairs))],
        ),
      ).rejects.toMatchObject({
        code: "route.period_invalid",
        params: { periodId: f.lunch, reason: "not_offered" },
      });
      await updateMenuPeriod(tx, f.cfg, f.lunch, { menuId: f.breadMenu, staffMenuIds: [] });
      await expect(
        setRoutingCell(tx, f.cfg, terraceCell(f), station(f.upstairs), [
          line(f.lunch, station(f.downstairs)),
        ]),
      ).rejects.toMatchObject({
        code: "route.period_invalid",
        params: { periodId: f.lunch, reason: "not_offered" },
      });
      expect(await storedLines(tx)).toHaveLength(2);
      expect(await modelCell(tx, f, terraceCell(f))).toBeUndefined();
    }));

  it("drops a zone's lines for its old department's periods when the zone moves department, keeping its plain choices", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, terraceCell(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
      ]);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
      ]);
      await configureZone(tx, f.cfg, { zoneId: f.terrace, departmentId: f.barDepartment });
      expect(await modelCell(tx, f, terraceCell(f))).toEqual({
        ...terraceCell(f),
        target: station(f.upstairs),
      });
      expect((await modelCell(tx, f, everyZone(f)))?.periods).toEqual([
        line(f.lunch, station(f.downstairs)),
      ]);
      await configureZone(tx, f.cfg, { zoneId: f.patio, departmentId: f.barDepartment });
      expect(await storedLines(tx)).toEqual([{ periodId: f.lunch, stationId: f.downstairs }]);
    }));

  it("routes by a saved No preparation line while its period runs, an extra then following its dish", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
      await replaceMenuWeek(
        tx,
        f.cfg,
        f.department,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [{ periodId: f.lunch, startsAt: "12:00", endsAt: "14:00" }],
        })),
        new Date("2026-10-02T10:00:00Z"),
      );
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [line(f.lunch, noPrep)]);
      const lunch = await routingAt(tx, f.cfg, at);
      expect(await lunch.makers(f.terrace, [f.mojito])).toEqual(
        new Map([[f.mojito, { kind: "made", route: noPrep }]]),
      );
      expect(
        await lunch.extraMakers(f.terrace, [
          { key: "x", productId: f.mojito, dishStationId: f.bar },
        ]),
      ).toEqual(new Map([["x", { kind: "follows_dish", why: "no_preparation" }]]));
      const later = await routingAt(tx, f.cfg, new Date("2026-10-02T15:00:00Z"));
      expect(await later.makers(f.terrace, [f.mojito])).toEqual(
        new Map([[f.mojito, { kind: "made", route: station(f.upstairs) }]]),
      );
    }));

  it("previews adding a Lunch line as moves during Lunch alone, merging periods that move alike", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs));
      const summary = (moves: RoutingMove[]) =>
        moves.map((move) => [move.productId, move.zoneId, move.from, move.to, move.periodIds]);
      const lunchOnly = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: everyZone(f),
        target: station(f.upstairs),
        periods: [line(f.lunch, station(f.downstairs))],
      });
      expect(summary(lunchOnly)).toEqual(
        [f.daiquiri, f.variant, f.mojito].map((productId) => [
          productId,
          f.terrace,
          station(f.upstairs),
          station(f.downstairs),
          [f.lunch],
        ]),
      );
      const both = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: everyZone(f),
        target: station(f.bar),
        periods: [line(f.lunch, station(f.downstairs)), line(f.staffLunch, station(f.downstairs))],
      });
      expect(
        both
          .filter((move) => move.productId === f.mojito)
          .map((move) => [
            move.zoneId,
            move.from,
            move.to,
            move.periodIds && [...move.periodIds].sort(),
          ]),
      ).toEqual(
        expect.arrayContaining([
          [f.terrace, station(f.upstairs), station(f.downstairs), [f.lunch, f.staffLunch].sort()],
          [f.terrace, station(f.upstairs), station(f.bar), null],
          [f.patio, station(f.upstairs), station(f.bar), null],
        ]),
      );
      expect(both.filter((move) => move.productId === f.mojito)).toHaveLength(3);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
      ]);
      const dropped = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: everyZone(f),
        target: station(f.upstairs),
        periods: [],
      });
      expect(summary(dropped.filter((move) => move.productId === f.mojito))).toEqual([
        [f.mojito, f.terrace, station(f.downstairs), station(f.upstairs), [f.lunch]],
      ]);
      const kept = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: everyZone(f),
        target: station(f.upstairs),
      });
      expect(kept).toEqual([]);
    }));

  it("previews pinning a zone cell that leaves out an inherited Lunch line as a move during Lunch", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
      ]);
      await setRoutingCell(tx, f.cfg, { row: productRow(f.bread), zoneId: null }, station(f.bar), [
        line(f.brunch, station(f.downstairs)),
      ]);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: terraceCell(f),
        target: station(f.bar),
        periods: [],
      });
      // Brunch, named only by Bread's cell, adds no copy of the untimed moves.
      expect(
        moves.map((move) => [move.productId, move.zoneId, move.from, move.to, move.periodIds]),
      ).toEqual(
        [f.daiquiri, f.variant, f.mojito].flatMap((productId) => [
          [productId, f.terrace, station(f.upstairs), station(f.bar), null],
          [productId, f.terrace, station(f.downstairs), station(f.bar), [f.lunch]],
        ]),
      );
    }));

  it("previews clearing a pinned zone cell whose parent has a Lunch line as a move during Lunch", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
      ]);
      await setRoutingCell(tx, f.cfg, { row: productRow(f.bread), zoneId: null }, station(f.bar), [
        line(f.brunch, station(f.downstairs)),
      ]);
      await setRoutingCell(tx, f.cfg, terraceCell(f), station(f.upstairs));
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: terraceCell(f),
        target: null,
      });
      expect(
        moves.map((move) => [move.productId, move.zoneId, move.from, move.to, move.periodIds]),
      ).toEqual(
        [f.daiquiri, f.variant, f.mojito].map((productId) => [
          productId,
          f.terrace,
          station(f.upstairs),
          station(f.downstairs),
          [f.lunch],
        ]),
      );
    }));

  it("lists an all-day move once, not again under a period another product's cell names", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs), [
        line(f.lunch, station(f.downstairs)),
      ]);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: { row: { kind: "all" }, zoneId: f.terrace },
        target: station(f.downstairs),
      });
      expect(
        moves.map((move) => [move.productId, move.zoneId, move.from, move.to, move.periodIds]),
      ).toEqual([[f.bread, f.terrace, station(f.bar), station(f.downstairs), null]]);
    }));

  it("lists a merged move's periods in the routing model's period order", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      // Whichever id sorts first runs later in the week, so id order and period order disagree.
      const [late, early] = [f.lunch, f.staffLunch].sort();
      await replaceMenuWeek(
        tx,
        f.cfg,
        f.department,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [
            { periodId: early!, startsAt: "11:00", endsAt: "12:00" },
            { periodId: late!, startsAt: "12:00", endsAt: "13:00" },
          ],
        })),
        new Date("2026-10-02T10:00:00Z"),
      );
      const order = (await routingModel(tx, f.cfg, at)).periods
        .map((period) => period.id)
        .filter((id) => id === early || id === late);
      expect(order).toEqual([early, late]);
      await setRoutingCell(tx, f.cfg, everyZone(f), station(f.upstairs));
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "cell",
        address: everyZone(f),
        target: station(f.upstairs),
        periods: [line(late!, station(f.downstairs)), line(early!, station(f.downstairs))],
      });
      const mojito = moves.filter((move) => move.productId === f.mojito);
      expect(mojito.map((move) => move.periodIds)).toEqual([order]);
    }));

  it("gives each period its department and the products its menus reach, a variant by its parent, in the department's period order", async () =>
    scoped(async (tx) => {
      const f = await choicesFixture(tx);
      await replaceMenuWeek(
        tx,
        f.cfg,
        f.department,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 0
              ? [{ periodId: f.brunch, startsAt: "09:00", endsAt: "10:00" }]
              : weekday === 1
                ? [{ periodId: f.staffLunch, startsAt: "13:00", endsAt: "15:00" }]
                : weekday === 2
                  ? [{ periodId: f.lunch, startsAt: "12:00", endsAt: "14:00" }]
                  : [],
        })),
        new Date("2026-10-02T10:00:00Z"),
      );
      const [root] = await tx
        .select({ id: sections.id })
        .from(sections)
        .where(and(eq(sections.ownerMenuId, f.breadMenu), eq(sections.role, "menu_root")));
      await tx
        .insert(sectionMembers)
        .values({ sectionId: root!.id, position: 9, productId: f.variant });
      const [rootless] = await tx.insert(catalogues).values({ name: "No root" }).returning();
      const aperitivo = (
        await saveMenuPeriod(tx, f.cfg, f.department, {
          name: "Aperitivo",
          menuId: rootless!.id,
          staffMenuIds: [],
          colour: "blue",
        })
      ).id;
      const { periods } = await routingModel(tx, f.cfg, at);
      const dining = { departmentId: f.department, departmentName: "Dining" };
      // Monday first: Sunday's Brunch is the week's last, though weekday 0; Aperitivo, placed on no
      // day, comes after every placed period.
      expect(periods.filter((period) => period.departmentId === f.department)).toEqual([
        {
          id: f.staffLunch,
          ...dining,
          name: "Staff lunch",
          colour: "blue",
          productIds: [f.bread, f.mojito],
        },
        { id: f.lunch, ...dining, name: "Lunch", colour: "blue", productIds: [f.mojito] },
        {
          id: f.brunch,
          ...dining,
          name: "Brunch",
          colour: "blue",
          productIds: [f.bread, f.mojito],
        },
        { id: aperitivo, ...dining, name: "Aperitivo", colour: "blue", productIds: [] },
      ]);
      expect(periods.find((period) => period.id === f.barLunch)).toEqual({
        id: f.barLunch,
        departmentId: f.barDepartment,
        departmentName: "Bar",
        name: "Lunch",
        colour: "blue",
        productIds: [f.mojito],
      });
      await tx
        .update(departments)
        .set({ active: false })
        .where(eq(departments.id, f.barDepartment));
      const after = (await routingModel(tx, f.cfg, at)).periods;
      expect(after.find((period) => period.id === f.barLunch)).toEqual({
        id: f.barLunch,
        departmentId: f.barDepartment,
        departmentName: "Bar",
        departmentInactive: true,
        name: "Lunch",
        colour: "blue",
        productIds: [f.mojito],
      });
      expect(after.filter((period) => "departmentInactive" in period).map(({ id }) => id)).toEqual([
        f.barLunch,
      ]);
    }));
});
