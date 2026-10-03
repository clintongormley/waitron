import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
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
  resolveExtraMakers,
  routingAt,
  stationStates,
  reorderExceptions,
  routingModel,
  setClaim,
  updateException,
  validateRoutingInput,
} from "./routing-store.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import { configureZone, createDepartment } from "./operations.js";
import { routeExceptions } from "./schema/routing.js";
import { replaceStationHours, setStationFallback, setStationToday } from "./station-times.js";

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
  it("names the unavailable station when an inactive maker has no fallback", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.cocktails, {
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
  it("names a matching exception, including a variant's parent product", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const id = await createException(tx, f.cfg, {
        zoneId: f.terrace,
        categoryId: null,
        productId: f.mojito,
        target: { kind: "station", stationId: f.terraceBar },
      });
      expect(
        await explainRoute(tx, f.cfg, f.variant, f.terrace, {
          kind: "now",
          at: new Date("2026-10-02T22:00:00Z"),
        }),
      ).toMatchObject({
        route: { kind: "station", stationId: f.terraceBar },
        decidedBy: { kind: "exception", exceptionId: id },
        fallbacks: [],
        noReplacement: false,
        stations: expect.arrayContaining([{ id: f.terraceBar, name: "Terrace Bar", active: true }]),
      });
    }));

  it("names a switched-off exception as a dead end", async () =>
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
      expect(
        await explainRoute(tx, f.cfg, f.mojito, f.terrace, {
          kind: "now",
          at: new Date("2026-10-02T22:00:00Z"),
        }),
      ).toMatchObject({
        route: null,
        decidedBy: { kind: "exception", exceptionId: id },
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
  it("moves a claim from one station to another and removes it idempotently", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).claims).toEqual([
        {
          categoryId: f.drinks,
          target: { kind: "station", stationId: f.terraceBar },
          stationOff: false,
        },
      ]);
      await setClaim(tx, f.cfg, f.drinks, noPrep);
      expect((await loadRoutingRules(tx, f.cfg, null)).claims.get(f.drinks)).toEqual(noPrep);
      await removeClaim(tx, f.cfg, f.drinks);
      await removeClaim(tx, f.cfg, f.drinks);
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).claims).toEqual([]);
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
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.map((e) => [
          e.id,
          e.position,
          e.neverMatches,
        ]),
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
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.map((e) => [
          e.id,
          e.position,
          e.neverMatches,
        ]),
      ).toEqual([
        [b, 0, false],
        [a, 1, false],
      ]);
      await deleteException(tx, f.cfg, a);
      const c = await createException(tx, f.cfg, { ...f.input, target: noPrep });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.map((e) => [
          e.id,
          e.position,
        ]),
      ).toEqual([
        [b, 0],
        [c, 1],
      ]);
      await updateException(tx, f.cfg, b, {
        zoneId: null,
        categoryId: null,
        productId: f.mojito,
        target: noPrep,
      });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions[0],
      ).toMatchObject({
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
      const ownRules = await loadRoutingRules(tx, f.cfg, null);
      const otherRules = await loadRoutingRules(tx, other.cfg, null);
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
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.map((e) => [
          e.id,
          e.position,
        ]),
      ).toEqual([[a, 0]]);
      expect(
        (await routingModel(tx, other.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.map(
          (e) => [e.id, e.position],
        ),
      ).toEqual([[b, 0]]);
    }));

  it("flags a product caught with all variants, a variant's stored category of its own included", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const earlier = await createException(tx, f.cfg, f.input);
      const product = await createException(tx, f.cfg, {
        ...f.input,
        categoryId: null,
        productId: f.mojito,
      });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.find(
          (e) => e.id === product,
        )?.neverMatches,
      ).toBe(true);
      await tx.update(products).set({ categoryId: f.food }).where(eq(products.id, f.variant));
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.find(
          (e) => e.id === product,
        )?.neverMatches,
      ).toBe(true);
      await tx.update(products).set({ categoryId: null }).where(eq(products.id, f.variant));
      await updateException(tx, f.cfg, earlier, { ...f.input, zoneId: null, target: noPrep });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.find(
          (e) => e.id === product,
        )?.neverMatches,
      ).toBe(true);
      await updateException(tx, f.cfg, product, {
        ...f.input,
        zoneId: null,
        categoryId: null,
        productId: f.mojito,
      });
      await updateException(tx, f.cfg, earlier, f.input);
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.find(
          (e) => e.id === product,
        )?.neverMatches,
      ).toBe(false);
      await updateException(tx, f.cfg, product, {
        ...f.input,
        categoryId: null,
        productId: f.mojito,
      });
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, f.bar));
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.exceptions.find((e) => e.id === product)).toMatchObject({
        neverMatches: true,
        stationOff: true,
      });
      expect(model.defaultStationId).toBeNull();
    }));

  it("lists unclaimed top-level folders including those without details, and active unfiled top-level products", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const [plain] = await tx.insert(categories).values({ name: "Plain" }).returning();
      await setClaim(tx, f.cfg, f.drinks, noPrep);
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
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
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).unassigned.products.some(
          (p) => p.id === f.bread,
        ),
      ).toBe(false);
      expect(model.defaultStationId).toBe(f.bar);
      expect(model.stations).toContainEqual({ id: f.bar, name: "Bar", active: true });
      expect(model.stations).toContainEqual({ id: f.switchedOff, name: "Off", active: false });
    }));

  it("cascades folder rules and moves its product to the nearest surviving claim", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.bar });
      await setClaim(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await createException(tx, f.cfg, { ...f.input, categoryId: f.cocktails });
      await deleteCatalogueItems(tx, { productIds: [], categoryIds: [f.cocktails] }, "move_up");
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.claims.some((c) => c.categoryId === f.cocktails)).toBe(false);
      expect(model.exceptions).toEqual([]);
      const [moved] = await tx
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, f.mojito));
      expect(moved!.categoryId).toBe(f.drinks);
      expect(
        chooseMaker(
          await loadRoutingRules(tx, f.cfg, null),
          { productId: f.mojito, routedProductId: f.mojito, categoryId: moved!.categoryId },
          f.terrace,
          null,
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
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.claims).toContainEqual({
        categoryId: f.beer,
        target: { kind: "station", stationId: f.bar },
        stationOff: true,
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
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.defaultStationId).toBeNull();
      expect(model.stations).toContainEqual({ id: f.bar, name: "Bar", active: false });
      expect(model.stations).toContainEqual({ id: f.switchedOff, name: "Off", active: false });
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
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions).toEqual([
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
  it("sends a closed station's work to its fallback, and an open one's to itself", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Europe/Madrid" })
        .where(eq(locations.id, f.cfg.locationId));
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      await replaceStationHours(tx, f.cfg, f.terraceBar, [
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
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
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
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
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
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      await replaceStationHours(tx, f.cfg, f.terraceBar, [
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
      await replaceStationHours(tx, f.cfg, f.terraceBar, [
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
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
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

  it("routes an order with no service zone by claims and the default", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
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
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
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
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
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
describe("assigning an unfiled product from Prep stations", () => {
  it("rejects products that are absent, filed, or variants", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const { assignUnfiledProduct } = await import("./routing-store.js");
      for (const productId of [randomUUID(), f.mojito, f.variant])
        await expect(assignUnfiledProduct(tx, f.cfg, productId, noPrep)).rejects.toMatchObject({
          code: "route.subject_not_found",
          params: { subject: "product" },
        });
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions).toEqual(
        [],
      );
    }));

  it("collapses repeated product assignments to one effective rule", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.insert(routeExceptions).values([
        {
          locationId: f.cfg.locationId,
          position: 2,
          zoneId: null,
          categoryId: null,
          productId: f.bread,
          stationId: f.bar,
          noPreparation: false,
        },
        {
          locationId: f.cfg.locationId,
          position: 3,
          zoneId: null,
          categoryId: null,
          productId: f.bread,
          stationId: null,
          noPreparation: true,
        },
      ]);
      const { assignUnfiledProduct } = await import("./routing-store.js");
      await assignUnfiledProduct(tx, f.cfg, f.bread, { kind: "station", stationId: f.terraceBar });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions,
      ).toMatchObject([
        { productId: f.bread, target: { kind: "station", stationId: f.terraceBar } },
      ]);
    }));

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
      expect(
        chooseMaker(await loadRoutingRules(tx, f.cfg, null), product, f.terrace, null).route,
      ).toEqual(noPrep);
      const { assignUnfiledProduct } = await import("./routing-store.js");
      await assignUnfiledProduct(tx, f.cfg, f.bread, { kind: "station", stationId: f.terraceBar });
      expect(
        chooseMaker(await loadRoutingRules(tx, f.cfg, null), product, f.terrace, null).route,
      ).toEqual({
        kind: "station",
        stationId: f.terraceBar,
      });
      await assignUnfiledProduct(tx, f.cfg, f.bread, { kind: "station", stationId: f.bar });
      expect(
        chooseMaker(await loadRoutingRules(tx, f.cfg, null), product, f.terrace, null).route,
      ).toEqual({
        kind: "station",
        stationId: f.bar,
      });
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(
        model.exceptions.filter((e) => e.productId === f.bread && e.zoneId === null),
      ).toHaveLength(1);
      expect(
        model.exceptions.filter((e) => e.id === broad || e.id === unrelated).map((e) => e.id),
      ).toEqual([broad, unrelated]);
    }));
});

describe("routing previews", () => {
  it("marks a preview that exposes a switched-off rule as no replacement", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, { kind: "station", stationId: f.terraceBar });
      const id = await createException(tx, f.cfg, {
        zoneId: null,
        categoryId: f.drinks,
        productId: null,
        target: { kind: "station", stationId: f.bar },
      });
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.terraceBar));
      const moves = await previewRoutingChange(tx, f.cfg, { kind: "exception_delete", id });
      expect(moves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ productId: f.mojito, to: null, toNoReplacement: true }),
        ]),
      );
    }));
  it("reports a preview from no replacement to no default station", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const id = await createException(tx, f.cfg, {
        zoneId: null,
        categoryId: f.drinks,
        productId: null,
        target: { kind: "station", stationId: f.terraceBar },
      });
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(inArray(kitchenStations.id, [f.bar, f.terraceBar]));
      const moves = await previewRoutingChange(tx, f.cfg, { kind: "exception_delete", id });
      expect(moves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            productId: f.mojito,
            from: null,
            to: null,
            toNoReplacement: false,
          }),
        ]),
      );
    }));
  it("previews an appended exception over a saved broader rule without saving it", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await createException(tx, f.cfg, {
        zoneId: null,
        categoryId: f.food,
        productId: null,
        target: noPrep,
      });
      const before = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "exception",
        id: null,
        input: {
          zoneId: f.terrace,
          categoryId: f.cocktails,
          productId: null,
          target: noPrep,
        },
      });
      expect(moves.filter((move) => move.productId === f.mojito)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: { kind: "station", stationId: f.bar },
          to: noPrep,
        }),
      ]);
      expect(await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).toEqual(before);
    }));

  it("previews a revised assignment ahead of broader exceptions without saving it", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const { assignUnfiledProduct } = await import("./routing-store.js");
      await assignUnfiledProduct(tx, f.cfg, f.bread, noPrep);
      const before = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "assignment",
        productId: f.bread,
        target: { kind: "station", stationId: f.terraceBar },
      });
      expect(moves.filter((move) => move.productId === f.bread)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: noPrep,
          to: { kind: "station", stationId: f.terraceBar },
          toNoReplacement: false,
        }),
      ]);
      expect(await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).toEqual(before);
    }));

  it("previews replacing duplicate product assignments as one rule", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.insert(routeExceptions).values([
        {
          locationId: f.cfg.locationId,
          position: 2,
          zoneId: null,
          categoryId: null,
          productId: f.bread,
          stationId: f.bar,
          noPreparation: false,
        },
        {
          locationId: f.cfg.locationId,
          position: 3,
          zoneId: null,
          categoryId: null,
          productId: f.bread,
          stationId: null,
          noPreparation: true,
        },
      ]);
      const before = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "assignment",
        productId: f.bread,
        target: { kind: "station", stationId: f.terraceBar },
      });
      expect(moves.filter((move) => move.productId === f.bread)).toEqual([
        expect.objectContaining({
          from: { kind: "station", stationId: f.bar },
          to: { kind: "station", stationId: f.terraceBar },
          toNoReplacement: false,
        }),
      ]);
      expect(await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).toEqual(before);
    }));

  it("shows the fallback after removing a claim without removing the stored claim", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await setClaim(tx, f.cfg, f.drinks, noPrep);
      const moves = await previewRoutingChange(tx, f.cfg, {
        kind: "claim",
        categoryId: f.drinks,
        target: null,
      });
      expect(moves.filter((move) => move.productId === f.mojito)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: noPrep,
          to: { kind: "station", stationId: f.bar },
        }),
      ]);
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).claims,
      ).toMatchObject([{ categoryId: f.drinks, target: noPrep }]);
    }));

  it("shows the fallback after deleting an exception and rejects unknown exception ids", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const id = await createException(tx, f.cfg, {
        zoneId: f.terrace,
        categoryId: f.cocktails,
        productId: null,
        target: noPrep,
      });
      const moves = await previewRoutingChange(tx, f.cfg, { kind: "exception_delete", id });
      expect(moves.filter((move) => move.productId === f.mojito)).toEqual([
        expect.objectContaining({
          zoneId: f.terrace,
          from: noPrep,
          to: { kind: "station", stationId: f.bar },
        }),
      ]);
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions,
      ).toMatchObject([{ id }]);
      for (const change of [
        { kind: "exception_delete", id: randomUUID() } as const,
        { kind: "exception", id: randomUUID(), input: f.input } as const,
      ])
        await expect(previewRoutingChange(tx, f.cfg, change)).rejects.toMatchObject({
          code: "route.not_found",
        });
    }));

  it("rejects invalid preview orders and missing unfiled products without writing", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      const id = await createException(tx, f.cfg, f.input);
      for (const ids of [[], [id, id], [randomUUID()]])
        await expect(
          previewRoutingChange(tx, f.cfg, { kind: "exception_order", ids }),
        ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "ids" } });
      for (const productId of [randomUUID(), f.mojito, f.variant])
        await expect(
          previewRoutingChange(tx, f.cfg, { kind: "assignment", productId, target: noPrep }),
        ).rejects.toMatchObject({
          code: "route.subject_not_found",
          params: { subject: "product" },
        });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions,
      ).toMatchObject([{ id }]);
    }));

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
      const before = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
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
          from: { kind: "station", stationId: f.bar },
          to: { kind: "station", stationId: f.terraceBar },
          toNoReplacement: false,
        },
        {
          productId: lager.id,
          productName: "Lager",
          zoneId: f.terrace,
          zoneName: "Terrace",
          from: { kind: "station", stationId: f.bar },
          to: { kind: "station", stationId: f.terraceBar },
          toNoReplacement: false,
        },
      ]);
      expect(await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).toEqual(before);
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
          toNoReplacement: false,
        },
      ]);
      expect(moves.some((m) => m.zoneId === inside!.id)).toBe(false);
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions.map(
          (e) => e.id,
        ),
      ).toEqual([first, second]);
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
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).exceptions,
      ).toHaveLength(1);
    }));
});

describe("timed routing explanation", () => {
  it("uses Friday hours and names the fallback, while now honors today's open", async () =>
    scoped(async (tx) => {
      const f = await fixture(tx);
      await tx.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, f.cfg.locationId));
      await setClaim(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await replaceStationHours(tx, f.cfg, f.terraceBar, [
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
      await setClaim(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await replaceStationHours(tx, f.cfg, f.terraceBar, [
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
    await setClaim(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
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
  await setClaim(tx, f.cfg, sides, { kind: "station", stationId: fryer!.id });
  return {
    ...f,
    sides,
    chips,
    cheese,
    chipsVariant: variant!.id,
    grill: grill!.id,
    fryer: fryer!.id,
  };
}

describe("extra maker resolution", () => {
  it("explains each chosen extra against the dish's final station and names its claim", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setClaim(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.grill });
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
          decidedBy: { kind: "claim", categoryId: f.sides },
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
  it("waits for the dish's station before explaining extras when its claimed station is closed", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      await setClaim(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.grill });
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
      await setClaim(tx, f.cfg, f.cocktails, noPrep);
      expect(
        await explainRoute(tx, f.cfg, f.mojito, null, { kind: "now", at: fixedInstant }, [f.chips]),
      ).toMatchObject({
        route: noPrep,
        extrasWaitOnDish: false,
        extras: [{ productId: f.chips, outcome: { kind: "made", stationId: f.fryer } }],
      });
    }));
  it("splits claimed extras while unclaimed extras follow their dish", async () =>
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
      await setClaim(tx, f.cfg, f.cocktails, { kind: "station", stationId: f.terraceBar });
      await replaceStationHours(tx, f.cfg, f.terraceBar, [
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
  it("keeps the opening rules for both questions after a claim changes", async () =>
    scoped(async (tx) => {
      const f = await extrasFixture(tx);
      const resolver = await routingAt(tx, f.cfg, fixedInstant);
      await setClaim(tx, f.cfg, f.sides, { kind: "station", stationId: f.grill });
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
