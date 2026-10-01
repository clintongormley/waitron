import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createProduct,
  deleteCatalogueItems,
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
import { chooseMaker, type RouteTarget } from "./routing.js";
import {
  describeMakers,
  createException,
  deleteException,
  explainRoute,
  loadRoutingRules,
  previewRoutingChange,
  removeClaim,
  resolveMakers,
  reorderExceptions,
  routingModel,
  setClaim,
  updateException,
  validateRoutingInput,
} from "./routing-store.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import { configureZone, createDepartment } from "./operations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
const noPrep: RouteTarget = { kind: "no_preparation" };

async function fixture(tx: Transaction) {
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
  const drinks = (await createCategory(tx, { name: "Drinks" })).id;
  const beer = (await createCategory(tx, { name: "Beer", parentId: drinks })).id;
  const cocktails = (await createCategory(tx, { name: "Cocktails", parentId: drinks })).id;
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
  const mojito = await product("Mojito", cocktails);
  const bread = await product("Bread", null);
  const [variant] = await tx
    .insert(products)
    .values({ catalogueId: menu.id, parentId: mojito, name: "Large", categoryId: null })
    .returning();
  const input = {
    zoneId: terrace!.id,
    categoryId: drinks,
    productId: null,
    target: { kind: "station", stationId: bar } as RouteTarget,
  };
  return {
    cfg,
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
    input,
  };
}
const scoped = (fn: (tx: Transaction) => Promise<void>) => withTransaction(db, fn);

describe("route explanation", () => {
  it("describes active variants and zone-sensitive rules without a service zone", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      await createException(tx, f.cfg, {
        zoneId: f.terrace,
        categoryId: f.cocktails,
        productId: null,
        target: { kind: "station", stationId: f.terraceBar },
      });
      const makers = await describeMakers(tx, f.cfg);
      expect(makers.get(f.mojito)).toEqual({
        route: { kind: "station", stationId: f.bar },
        variesByZone: true,
      });
      expect(makers.get(f.variant)).toEqual({
        route: { kind: "station", stationId: f.bar },
        variesByZone: true,
      });
      expect(makers.get(f.bread)).toEqual({
        route: { kind: "station", stationId: f.bar },
        variesByZone: false,
      });
    }));
  it("names a matching exception, including a variant's parent product", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const id = await createException(tx, f.cfg, {
        zoneId: f.terrace,
        categoryId: null,
        productId: f.mojito,
        target: { kind: "station", stationId: f.terraceBar },
      });
      expect(await explainRoute(tx, f.cfg, f.variant, f.terrace)).toMatchObject({
        route: { kind: "station", stationId: f.terraceBar },
        decidedBy: { kind: "exception", exceptionId: id },
        skipped: [],
        stations: expect.arrayContaining([{ id: f.terraceBar, name: "Terrace Bar", active: true }]),
      });
    }));

  it("names a claim after skipping a switched-off exception", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      const id = await createException(tx, f.cfg, {
        zoneId: f.terrace,
        categoryId: f.cocktails,
        productId: null,
        target: { kind: "station", stationId: f.terraceBar },
      });
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.terraceBar));
      expect(await explainRoute(tx, f.cfg, f.mojito, f.terrace)).toMatchObject({
        route: { kind: "station", stationId: f.bar },
        decidedBy: { kind: "claim", categoryId: f.drinks },
        skipped: [{ decision: { kind: "exception", exceptionId: id }, stationId: f.terraceBar }],
        stations: expect.arrayContaining([
          { id: f.terraceBar, name: "Terrace Bar", active: false },
        ]),
      });
    }));

  it("names the default and reports no route when no active default remains", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      expect(await explainRoute(tx, f.cfg, f.bread, null)).toMatchObject({
        route: { kind: "station", stationId: f.bar },
        decidedBy: { kind: "default" },
      });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      expect(await explainRoute(tx, f.cfg, f.bread, null)).toMatchObject({
        route: null,
        decidedBy: null,
      });
    }));
});

describe("stored preparation rules", () => {
  it("moves a claim from one station to another and removes it idempotently", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      expect((await routingModel(tx, f.cfg)).claims).toEqual([
        {
          categoryId: f.drinks,
          target: { kind: "station", stationId: f.terraceBar },
          stationOff: false,
        },
      ]);
      await setClaim(tx, f.cfg, f.drinks, noPrep);
      expect((await loadRoutingRules(tx, f.cfg)).claims.get(f.drinks)).toEqual(noPrep);
      await removeClaim(tx, f.cfg, f.drinks);
      await removeClaim(tx, f.cfg, f.drinks);
      expect((await routingModel(tx, f.cfg)).claims).toEqual([]);
    }));

  it("refuses inactive stations, missing folders, missing products, variants and missing zones", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await expect(
        setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.switchedOff }),
      ).rejects.toMatchObject({ code: "route.station_inactive" });
      await expect(setClaim(tx, f.cfg, randomUUID(), noPrep)).rejects.toMatchObject({
        code: "route.subject_not_found",
        params: { subject: "category" },
      });
      for (const productId of [randomUUID(), f.variant])
        await expect(
          createException(tx, f.cfg, { zoneId: null, categoryId: null, productId, target: noPrep }),
        ).rejects.toMatchObject({
          code: "route.subject_not_found",
          params: { subject: "product" },
        });
      await expect(
        createException(tx, f.cfg, { ...f.input, zoneId: randomUUID() }),
      ).rejects.toMatchObject({ code: "service_zone.not_found" });
      await expect(
        createException(tx, f.cfg, { ...f.input, categoryId: randomUUID() }),
      ).rejects.toMatchObject({ code: "route.subject_not_found", params: { subject: "category" } });
      await expect(
        createException(tx, f.cfg, {
          ...f.input,
          target: { kind: "station", stationId: f.switchedOff },
        }),
      ).rejects.toMatchObject({ code: "route.station_inactive" });
    }));

  it("refuses dual subjects and empty conditions before storage", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await expect(
        validateRoutingInput(tx, f.cfg, { ...f.input, productId: f.mojito }),
      ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "subject" } });
      await expect(
        createException(tx, f.cfg, {
          zoneId: null,
          categoryId: null,
          productId: null,
          target: noPrep,
        }),
      ).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "condition" },
      });
    }));

  it("appends exceptions and reorders only an exact full list without changing rejected orders", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const a = await createException(tx, f.cfg, f.input);
      const b = await createException(tx, f.cfg, { ...f.input, categoryId: f.cocktails });
      expect(
        (await routingModel(tx, f.cfg)).exceptions.map((e) => [e.id, e.position, e.neverMatches]),
      ).toEqual([
        [a, 0, false],
        [b, 1, true],
      ]);
      await reorderExceptions(tx, f.cfg, [b, a]);
      for (const ids of [[b], [b, b], [b, a, randomUUID()], [b, randomUUID()]])
        await expect(reorderExceptions(tx, f.cfg, ids)).rejects.toMatchObject({
          code: "management.request_invalid",
          params: { field: "ids" },
        });
      expect(
        (await routingModel(tx, f.cfg)).exceptions.map((e) => [e.id, e.position, e.neverMatches]),
      ).toEqual([
        [b, 0, false],
        [a, 1, false],
      ]);
      await deleteException(tx, f.cfg, a);
      const c = await createException(tx, f.cfg, { ...f.input, target: noPrep });
      expect((await routingModel(tx, f.cfg)).exceptions.map((e) => [e.id, e.position])).toEqual([
        [b, 0],
        [c, 1],
      ]);
      await updateException(tx, f.cfg, b, {
        zoneId: null,
        categoryId: null,
        productId: f.mojito,
        target: noPrep,
      });
      expect((await routingModel(tx, f.cfg)).exceptions[0]).toMatchObject({
        id: b,
        position: 0,
        zoneId: null,
        categoryId: null,
        productId: f.mojito,
        target: noPrep,
      });
      await expect(deleteException(tx, f.cfg, a)).rejects.toMatchObject({
        code: "route.not_found",
      });
      await expect(updateException(tx, f.cfg, a, f.input)).rejects.toMatchObject({
        code: "route.not_found",
      });
    }));

  it("scopes reads and every write to its location", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx),
        other = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, noPrep);
      await removeClaim(tx, other.cfg, f.drinks);
      const ownRules = await loadRoutingRules(tx, f.cfg);
      const otherRules = await loadRoutingRules(tx, other.cfg);
      expect(ownRules.claims.get(f.drinks)).toEqual(noPrep);
      expect(otherRules.claims.size).toBe(0);
      expect(ownRules.activeStationIds).toEqual(new Set([f.bar, f.terraceBar]));
      expect(otherRules.activeStationIds).toEqual(new Set([other.bar, other.terraceBar]));
      expect(ownRules.defaultStationId).toBe(f.bar);
      expect(otherRules.defaultStationId).toBe(other.bar);
      for (const input of [
        { ...f.input, zoneId: other.terrace },
        { ...f.input, target: { kind: "station", stationId: other.bar } as RouteTarget },
      ])
        await expect(createException(tx, f.cfg, input)).rejects.toMatchObject({
          code:
            input.zoneId === other.terrace ? "service_zone.not_found" : "route.station_inactive",
        });
      await expect(
        setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: other.bar }),
      ).rejects.toMatchObject({ code: "route.station_inactive" });
      const a = await createException(tx, f.cfg, f.input);
      const b = await createException(tx, other.cfg, other.input);
      await expect(updateException(tx, other.cfg, a, other.input)).rejects.toMatchObject({
        code: "route.not_found",
      });
      await expect(deleteException(tx, other.cfg, a)).rejects.toMatchObject({
        code: "route.not_found",
      });
      await expect(reorderExceptions(tx, f.cfg, [b])).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "ids" },
      });
      expect((await routingModel(tx, f.cfg)).exceptions.map((e) => [e.id, e.position])).toEqual([
        [a, 0],
      ]);
      expect((await routingModel(tx, other.cfg)).exceptions.map((e) => [e.id, e.position])).toEqual(
        [[b, 0]],
      );
    }));

  it("flags a product caught with all variants, but permits a variant in another folder", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const earlier = await createException(tx, f.cfg, f.input);
      const product = await createException(tx, f.cfg, {
        ...f.input,
        categoryId: null,
        productId: f.mojito,
      });
      expect(
        (await routingModel(tx, f.cfg)).exceptions.find((e) => e.id === product)?.neverMatches,
      ).toBe(true);
      await tx.update(products).set({ categoryId: f.food }).where(eq(products.id, f.variant));
      expect(
        (await routingModel(tx, f.cfg)).exceptions.find((e) => e.id === product)?.neverMatches,
      ).toBe(false);
      await tx.update(products).set({ categoryId: null }).where(eq(products.id, f.variant));
      await updateException(tx, f.cfg, earlier, { ...f.input, zoneId: null, target: noPrep });
      expect(
        (await routingModel(tx, f.cfg)).exceptions.find((e) => e.id === product)?.neverMatches,
      ).toBe(true);
      await updateException(tx, f.cfg, product, {
        ...f.input,
        zoneId: null,
        categoryId: null,
        productId: f.mojito,
      });
      await updateException(tx, f.cfg, earlier, f.input);
      expect(
        (await routingModel(tx, f.cfg)).exceptions.find((e) => e.id === product)?.neverMatches,
      ).toBe(false);
      await updateException(tx, f.cfg, product, {
        ...f.input,
        categoryId: null,
        productId: f.mojito,
      });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      const model = await routingModel(tx, f.cfg);
      expect(model.exceptions.find((e) => e.id === product)).toMatchObject({
        neverMatches: false,
        stationOff: true,
      });
      expect(model.defaultStationId).toBeNull();
    }));

  it("lists unclaimed top-level folders including those without details, and active unfiled top-level products", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const [plain] = await tx.insert(categories).values({ name: "Plain" }).returning();
      await setClaim(tx, f.cfg, f.drinks, noPrep);
      const model = await routingModel(tx, f.cfg);
      expect(model.unassigned.folders).toContainEqual({ id: f.food, name: "Food" });
      expect(model.unassigned.folders).toContainEqual({ id: plain!.id, name: "Plain" });
      expect(
        model.unassigned.folders.some((c) => [f.drinks, f.beer, f.cocktails].includes(c.id)),
      ).toBe(false);
      expect(model.unassigned.products).toContainEqual({ id: f.bread, name: "Bread" });
      expect(model.unassigned.products.some((p) => [f.mojito, f.variant].includes(p.id))).toBe(
        false,
      );
      await tx.update(products).set({ active: false }).where(eq(products.id, f.bread));
      expect(
        (await routingModel(tx, f.cfg)).unassigned.products.some((p) => p.id === f.bread),
      ).toBe(false);
      expect(model.defaultStationId).toBe(f.bar);
      expect(model.stations).toEqual([{ id: f.bar, name: "Bar", active: true }]);
    }));

  it("cascades folder rules and moves its product to the nearest surviving claim", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      await setClaim(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await createException(tx, f.cfg, { ...f.input, categoryId: f.cocktails });
      await deleteCatalogueItems(tx, { productIds: [], categoryIds: [f.cocktails] }, "move_up");
      const model = await routingModel(tx, f.cfg);
      expect(model.claims.some((c) => c.categoryId === f.cocktails)).toBe(false);
      expect(model.exceptions).toEqual([]);
      const [moved] = await tx
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, f.mojito));
      expect(moved!.categoryId).toBe(f.drinks);
      expect(
        chooseMaker(
          await loadRoutingRules(tx, f.cfg),
          { productId: f.mojito, routedProductId: f.mojito, categoryId: moved!.categoryId },
          f.terrace,
        ),
      ).toMatchObject({ decidedBy: { kind: "claim", categoryId: f.drinks } });
    }));

  it("names an inactive station still referenced by a claim or exception", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.beer, { kind: "station", stationId: f.bar });
      await createException(tx, f.cfg, {
        ...f.input,
        target: { kind: "station", stationId: f.terraceBar },
      });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      const model = await routingModel(tx, f.cfg);
      expect(model.claims).toContainEqual({
        categoryId: f.beer,
        target: { kind: "station", stationId: f.bar },
        stationOff: true,
      });
      expect(model.stations).toContainEqual({ id: f.bar, name: "Bar", active: false });
      expect(model.stations).toContainEqual({
        id: f.terraceBar,
        name: "Terrace Bar",
        active: true,
      });
    }));

  it("exports both rule tables with their location columns", () => {
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables).toContainEqual({
      name: "station_claims",
      locationColumns: ["location_id"],
    });
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables).toContainEqual({
      name: "route_exceptions",
      locationColumns: ["location_id"],
    });
  });

  it("names the default even when switched off without a claim or exception", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      const model = await routingModel(tx, f.cfg);
      expect(model.defaultStationId).toBeNull();
      expect(model.stations).toEqual([{ id: f.bar, name: "Bar", active: false }]);
    }));

  it("permits a service-zone-only exception and keeps its no-preparation target", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const id = await createException(tx, f.cfg, {
        zoneId: f.terrace,
        categoryId: null,
        productId: null,
        target: noPrep,
      });
      expect((await routingModel(tx, f.cfg)).exceptions).toEqual([
        {
          id,
          position: 0,
          zoneId: f.terrace,
          categoryId: null,
          productId: null,
          target: noPrep,
          neverMatches: false,
          stationOff: false,
        },
      ]);
    }));
});

describe("resolveMakers", () => {
  it("keeps the database read count constant as a batch grows", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const prepared = vi.spyOn(session, "prepareQuery");
      try {
        expect(await resolveMakers(tx, f.cfg, null, [f.mojito])).toEqual(
          new Map([[f.mojito, { kind: "station", stationId: f.terraceBar }]]),
        );
        const reads = prepared.mock.calls.length;
        expect(reads).toBeGreaterThan(0);
        prepared.mockClear();
        expect(await resolveMakers(tx, f.cfg, null, [f.mojito, f.bread, f.variant])).toEqual(
          new Map([
            [f.mojito, { kind: "station", stationId: f.terraceBar }],
            [f.bread, { kind: "station", stationId: f.bar }],
            [f.variant, { kind: "station", stationId: f.terraceBar }],
          ]),
        );
        expect(prepared.mock.calls.length).toBe(reads);
        prepared.mockClear();
        expect(await resolveMakers(tx, f.cfg, randomUUID(), [])).toEqual(new Map());
        expect(prepared).not.toHaveBeenCalled();
      } finally {
        prepared.mockRestore();
      }
    }));

  it("routes an order with no service zone by claims and the default", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      const made = await resolveMakers(tx, f.cfg, null, [f.mojito, f.bread]);
      expect(made.get(f.mojito)).toEqual({ kind: "station", stationId: f.terraceBar });
      expect(made.get(f.bread)).toEqual({ kind: "station", stationId: f.bar });
    }));
  it("answers null for every product when the default is off and nothing matches", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      expect((await resolveMakers(tx, f.cfg, f.terrace, [f.bread])).get(f.bread)).toBeNull();
    }));
  it("refuses an unknown product and an unknown zone", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await expect(resolveMakers(tx, f.cfg, null, [randomUUID()])).rejects.toMatchObject({
        code: "route.subject_not_found",
      });
      await expect(resolveMakers(tx, f.cfg, randomUUID(), [f.bread])).rejects.toMatchObject({
        code: "service_zone.not_found",
      });
    }));
  it("keeps the first caller spelling and the effective variant folder", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      const upper = f.variant.toUpperCase();
      expect(await resolveMakers(tx, f.cfg, null, [upper, f.variant])).toEqual(
        new Map([[upper, { kind: "station", stationId: f.terraceBar }]]),
      );
      expect(await resolveMakers(tx, f.cfg, null, [f.variant, upper])).toEqual(
        new Map([[f.variant, { kind: "station", stationId: f.terraceBar }]]),
      );
    }));
});
describe("assigning an unfiled product from Prep stations", () => {
  it("makes repeated assignments effective before an earlier broad exception without duplicating the product rule", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const broad = await createException(tx, f.cfg, {
        zoneId: f.terrace,
        categoryId: null,
        productId: null,
        target: noPrep,
      });
      const unrelated = await createException(tx, f.cfg, {
        zoneId: null,
        categoryId: f.drinks,
        productId: null,
        target: { kind: "station", stationId: f.bar },
      });
      const product = { productId: f.bread, routedProductId: f.bread, categoryId: null };
      expect(chooseMaker(await loadRoutingRules(tx, f.cfg), product, f.terrace).route).toEqual(
        noPrep,
      );
      const { assignUnfiledProduct } = await import("./routing-store.js");
      await assignUnfiledProduct(tx, f.cfg, f.bread, { kind: "station", stationId: f.terraceBar });
      expect(chooseMaker(await loadRoutingRules(tx, f.cfg), product, f.terrace).route).toEqual({
        kind: "station",
        stationId: f.terraceBar,
      });
      await assignUnfiledProduct(tx, f.cfg, f.bread, { kind: "station", stationId: f.bar });
      expect(chooseMaker(await loadRoutingRules(tx, f.cfg), product, f.terrace).route).toEqual({
        kind: "station",
        stationId: f.bar,
      });
      const model = await routingModel(tx, f.cfg);
      expect(
        model.exceptions.filter((e) => e.productId === f.bread && e.zoneId === null),
      ).toHaveLength(1);
      expect(
        model.exceptions.filter((e) => e.id === broad || e.id === unrelated).map((e) => e.id),
      ).toEqual([broad, unrelated]);
    }));
});

describe("routing previews", () => {
  it("shows a claim move in every active zone without writing it", async () =>
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
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      const before = await routingModel(tx, f.cfg);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "claim",
        categoryId: f.drinks,
        target: { kind: "station", stationId: f.terraceBar },
      });
      expect(moves.filter((m) => m.productId === f.mojito && m.zoneId === f.terrace)).toEqual([
        {
          productId: f.mojito,
          productName: "Mojito",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: { kind: "station", stationId: f.bar },
          to: { kind: "station", stationId: f.terraceBar },
        },
      ]);
      expect(moves.some((m) => m.productId === f.variant && m.zoneId === f.terrace)).toBe(true);
      expect(moves.filter((m) => m.productId === lager.id)).toEqual([
        {
          productId: lager.id,
          productName: "Lager",
          zoneId: inside!.id,
          zoneName: "Inside",
          from: { kind: "station", stationId: f.bar },
          to: { kind: "station", stationId: f.terraceBar },
        },
        {
          productId: lager.id,
          productName: "Lager",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: { kind: "station", stationId: f.bar },
          to: { kind: "station", stationId: f.terraceBar },
        },
      ]);
      expect(await routingModel(tx, f.cfg)).toEqual(before);
    }));
  it("rejects an inactive destination with the write code", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await expect(
        previewRoutingChange(tx, f.cfg, {
          kind: "claim",
          categoryId: f.drinks,
          target: { kind: "station", stationId: f.switchedOff },
        }),
      ).rejects.toMatchObject({ code: "route.station_inactive" });
    }));
  it("previews a no-change edit as no moves", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const id = await createException(tx, f.cfg, f.input);
      expect(
        await previewRoutingChange(tx, f.cfg, { kind: "exception", id, input: f.input }),
      ).toEqual([]);
    }));
  it("uses one zone-less comparison when every service zone is off", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.terrace));
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "claim",
        categoryId: f.drinks,
        target: { kind: "station", stationId: f.terraceBar },
      });
      expect(moves.filter((m) => m.productId === f.mojito)).toEqual([
        expect.objectContaining({ productId: f.mojito, zoneId: null, zoneName: null }),
      ]);
    }));
  it("reorders terrace exceptions and moves Mojito there only", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const [inside] = await tx
        .insert(floorZones)
        .values({ ...f.cfg, name: "Inside" })
        .returning();
      const first = await createException(tx, f.cfg, {
        ...f.input,
        target: { kind: "station", stationId: f.bar },
      });
      const second = await createException(tx, f.cfg, {
        ...f.input,
        target: { kind: "station", stationId: f.terraceBar },
      });
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "exception_order",
        ids: [second, first],
      });
      expect(moves.filter((m) => m.productId === f.mojito)).toEqual([
        {
          productId: f.mojito,
          productName: "Mojito",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: { kind: "station", stationId: f.bar },
          to: { kind: "station", stationId: f.terraceBar },
        },
      ]);
      expect(moves.some((m) => m.zoneId === inside!.id)).toBe(false);
      expect((await routingModel(tx, f.cfg)).exceptions.map((e) => e.id)).toEqual([first, second]);
    }));
  it("puts an unfiled assignment before a broader zone exception", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await createException(tx, f.cfg, {
        zoneId: f.terrace,
        categoryId: null,
        productId: null,
        target: noPrep,
      });
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "assignment",
        productId: f.bread,
        target: { kind: "station", stationId: f.terraceBar },
      });
      expect(moves.find((m) => m.productId === f.bread && m.zoneId === f.terrace)).toMatchObject({
        from: noPrep,
        to: { kind: "station", stationId: f.terraceBar },
      });
      expect((await routingModel(tx, f.cfg)).exceptions).toHaveLength(1);
    }));
});
