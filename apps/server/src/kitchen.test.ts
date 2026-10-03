import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  catalogues,
  locations,
  products,
  tills,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import {
  createCourse,
  createStation,
  deactivateCourse,
  deactivateStation,
  listCourses,
  listStations,
  moveCourse,
  setDefaultStation,
  setProductCourse,
  updateCourse,
  updateStation,
} from "./kitchen.js";
import "./errors.js";

// The one-default partial unique is pinned in packages/db/src/schema/kitchen-stations.test.ts.
const LOCALE = "es-ES";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(): Promise<TillConfig> {
  await seedTenant(db);
  // Inserted through the table definitions, not as raw SQL: the ids and `created_at` come from
  // `$defaultFn` generators, which a raw insert never reaches.
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
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

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

describe("kitchen-station config", () => {
  it("creates/lists/renames/deactivates a station and flips the default atomically", async () => {
    const cfg = await setupVenue();
    const { id: a } = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Cocina", isDefault: true }),
    );
    const { id: b } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Barra" }));
    await asApp(cfg, (tx) => setDefaultStation(tx, cfg, b)); // must clear a's default in the same tx
    const list = await asApp(cfg, (tx) => listStations(tx, cfg));
    expect(list.find((s) => s.id === b)!.isDefault).toBe(true);
    expect(list.find((s) => s.id === a)!.isDefault).toBe(false);
    await expect(
      asApp(cfg, (tx) => createStation(tx, cfg, { name: "Cocina" })),
    ).rejects.toMatchObject({ code: "station.name_taken" });
  });

  it("defaults displayOrder to 0 and isDefault to false, and lists active stations by display_order then name", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Zebra", displayOrder: 0 }));
    await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Alpha", displayOrder: 0 }));
    await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Barra" }));
    const list = await asApp(cfg, (tx) => listStations(tx, cfg));
    const defaultThresholds = {
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    };
    expect(list).toEqual([
      {
        id: expect.any(String),
        name: "Alpha",
        displayOrder: 0,
        isDefault: false,
        active: true,
        showsRestOfOrder: false,
        ...defaultThresholds,
      },
      {
        id: expect.any(String),
        name: "Barra",
        displayOrder: 0,
        isDefault: false,
        active: true,
        showsRestOfOrder: false,
        ...defaultThresholds,
      },
      {
        id: expect.any(String),
        name: "Zebra",
        displayOrder: 0,
        isDefault: false,
        active: true,
        showsRestOfOrder: false,
        ...defaultThresholds,
      },
    ]);
  });

  it("createStation with isDefault adopts the station as THE default, clearing any prior (single default kept)", async () => {
    const cfg = await setupVenue();
    const { id: a } = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Cocina", isDefault: true }),
    );
    const { id: c } = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Plancha", isDefault: true }),
    );
    const list = await asApp(cfg, (tx) => listStations(tx, cfg));
    expect(list.find((s) => s.id === a)!.isDefault).toBe(false);
    expect(list.find((s) => s.id === c)!.isDefault).toBe(true);
    expect(list.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("updateStation renames, reorders and reactivates (the name/displayOrder/active patch branches)", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Plancha", displayOrder: 5 }),
    );
    await asApp(cfg, (tx) => updateStation(tx, cfg, id, { name: "Parrilla", displayOrder: 2 }));
    expect((await asApp(cfg, (tx) => listStations(tx, cfg))).map((s) => s.name)).toEqual([
      "Parrilla",
    ]);
    await asApp(cfg, (tx) => deactivateStation(tx, cfg, id));
    expect(await asApp(cfg, (tx) => listStations(tx, cfg))).toEqual([]);
    await asApp(cfg, (tx) => updateStation(tx, cfg, id, { active: true, displayOrder: 9 }));
    expect(await asApp(cfg, (tx) => listStations(tx, cfg))).toEqual([
      {
        id,
        name: "Parrilla",
        displayOrder: 9,
        isDefault: false,
        active: true,
        showsRestOfOrder: false,
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      },
    ]);
  });

  it("updateStation surfaces a name collision as station.name_taken", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Cocina" }));
    const { id } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Barra" }));
    await expect(
      asApp(cfg, (tx) => updateStation(tx, cfg, id, { name: "Cocina" })),
    ).rejects.toMatchObject({ code: "station.name_taken", params: { name: "Cocina" } });
  });

  it("updateStation and deactivateStation throw station.not_found for an unknown id", async () => {
    const cfg = await setupVenue();
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => updateStation(tx, cfg, missing, { name: "X" })),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: missing } });
    await expect(asApp(cfg, (tx) => deactivateStation(tx, cfg, missing))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: missing },
    });
  });

  it("createStation and updateStation rethrow a NON-unique DB error raw, not as station.name_taken", async () => {
    // Each half provokes a refusal that is not the name unique. CREATE: a location id naming no row
    // fails the location foreign key. UPDATE: warm 99 above the untouched default overdue (10) fails
    // `kitchen_stations_thresholds_ordered`.
    const cfg = await setupVenue();
    const badCfg: TillConfig = { ...cfg, locationId: brandLocationId(randomUUID()) };
    const createErr = await asApp(cfg, (tx) => createStation(tx, badCfg, { name: "Big" })).catch(
      (e: unknown) => e,
    );
    expect(createErr).toBeInstanceOf(Error);
    expect(createErr).not.toBeInstanceOf(AppError);

    const { id } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Ord" }));
    const updateErr = await asApp(cfg, (tx) =>
      updateStation(tx, cfg, id, { warmAfterMinutes: 99 }),
    ).catch((e: unknown) => e);
    expect(updateErr).toBeInstanceOf(Error);
    expect(updateErr).not.toBeInstanceOf(AppError);
  });

  it("setDefaultStation throws station.not_found for an absent OR a deactivated station", async () => {
    const cfg = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => setDefaultStation(tx, cfg, missing))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: missing },
    });
    const { id } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Old" }));
    await asApp(cfg, (tx) => deactivateStation(tx, cfg, id));
    await expect(asApp(cfg, (tx) => setDefaultStation(tx, cfg, id))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: id },
    });
  });
});

async function productCourse(productId: string): Promise<string | null> {
  const { rows } = await db.execute<{ course_id: string | null }>(
    sql`select course_id from products where id = ${productId}`,
  );
  return rows[0]!.course_id;
}
async function seedProduct(): Promise<string> {
  const [cat] = await db
    .insert(catalogues)
    .values({ name: "Menu" })
    .returning({ id: catalogues.id });
  // `unit_price` counts whole cents: 1.00 EUR.
  const [row] = await db
    .insert(products)
    .values({
      catalogueId: cat!.id,
      name: "Routed product",
      pricingUnit: "each",
      unitPrice: 100,
      vatClass: "general",
    })
    .returning({ id: products.id });
  return row!.id;
}

/** A variant of `parentId`: a `products` row with a parent, inheriting every routing column. */
async function seedVariant(parentId: string): Promise<string> {
  const { rows } = await db.execute<{ catalogue_id: string }>(
    sql`select catalogue_id from products where id = ${parentId}`,
  );
  const [row] = await db
    .insert(products)
    .values({ catalogueId: rows[0]!.catalogue_id, parentId, name: "Routed variant" })
    .returning({ id: products.id });
  return row!.id;
}

describe("kitchen-course config", () => {
  it("creates/lists/updates/deactivates a course and orders by display_order then name", async () => {
    const cfg = await setupVenue();
    const { id: a } = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Principales", displayOrder: 1 }),
    );
    await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 }));
    await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Zebra", displayOrder: 0 }));
    await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Alpha", displayOrder: 0 }));
    const list = await asApp(cfg, (tx) => listCourses(tx, cfg));
    expect(list.map((c) => c.name)).toEqual(["Alpha", "Entrantes", "Zebra", "Principales"]);
    expect(list[3]).toEqual({ id: a, name: "Principales", displayOrder: 1, active: true });
    await asApp(cfg, (tx) => updateCourse(tx, cfg, a, { name: "Segundos", displayOrder: 9 }));
    await asApp(cfg, (tx) => deactivateCourse(tx, cfg, a));
    expect((await asApp(cfg, (tx) => listCourses(tx, cfg))).some((c) => c.id === a)).toBe(false);
    await asApp(cfg, (tx) => updateCourse(tx, cfg, a, { active: true }));
    expect(await asApp(cfg, (tx) => listCourses(tx, cfg))).toContainEqual({
      id: a,
      name: "Segundos",
      displayOrder: 9,
      active: true,
    });
  });

  it("createCourse defaults displayOrder to 0", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Postres" }));
    const [only] = await asApp(cfg, (tx) => listCourses(tx, cfg));
    expect(only).toEqual({ id, name: "Postres", displayOrder: 0, active: true });
  });

  it("createCourse and updateCourse surface a duplicate name as course.name_taken", async () => {
    const cfg = await setupVenue();
    await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Entrantes" }));
    await expect(
      asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Entrantes" })),
    ).rejects.toMatchObject({ code: "course.name_taken", params: { name: "Entrantes" } });
    const { id } = await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Principales" }));
    await expect(
      asApp(cfg, (tx) => updateCourse(tx, cfg, id, { name: "Entrantes" })),
    ).rejects.toMatchObject({ code: "course.name_taken", params: { name: "Entrantes" } });
  });

  it("updateCourse and deactivateCourse throw course.not_found for an unknown id", async () => {
    const cfg = await setupVenue();
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => updateCourse(tx, cfg, missing, { name: "X" })),
    ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: missing } });
    await expect(asApp(cfg, (tx) => deactivateCourse(tx, cfg, missing))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: missing },
    });
  });

  it("createCourse rethrows a NON-unique DB error raw, not as course.name_taken", async () => {
    // A location id naming no row fails the location foreign key, not the name unique. The
    // `updateCourse` half is the last suite in this file.
    const cfg = await setupVenue();
    const badCfg: TillConfig = { ...cfg, locationId: brandLocationId(randomUUID()) };
    const createErr = await asApp(cfg, (tx) => createCourse(tx, badCfg, { name: "Big" })).catch(
      (e: unknown) => e,
    );
    expect(createErr).toBeInstanceOf(Error);
    expect(createErr).not.toBeInstanceOf(AppError);
  });
});

describe("moveCourse", () => {
  /** Four courses created out of name order, so their firing order is A, B, C, D. */
  async function fourCourses(cfg: TillConfig): Promise<string[]> {
    const ids: string[] = [];
    for (const [name, displayOrder] of [
      ["A", 0],
      ["B", 5],
      ["C", 5],
      ["D", 20],
    ] as const) {
      ids.push((await asApp(cfg, (tx) => createCourse(tx, cfg, { name, displayOrder }))).id);
    }
    return ids;
  }

  async function storedOrders(ids: string[]): Promise<number[]> {
    const orders: number[] = [];
    for (const id of ids) {
      const { rows } = await db.execute<{ display_order: number }>(
        sql`select display_order from kitchen_courses where id = ${id}`,
      );
      orders.push(Number(rows[0]!.display_order));
    }
    return orders;
  }

  it("moves a course down, renumbers every active course 0..n-1 and returns the list", async () => {
    const cfg = await setupVenue();
    const [a, b, c, d] = await fourCourses(cfg);
    const moved = await asApp(cfg, (tx) => moveCourse(tx, cfg, a!, 2));
    expect(moved).toEqual([
      { id: b, name: "B", displayOrder: 0, active: true },
      { id: c, name: "C", displayOrder: 1, active: true },
      { id: a, name: "A", displayOrder: 2, active: true },
      { id: d, name: "D", displayOrder: 3, active: true },
    ]);
    expect(await storedOrders([b!, c!, a!, d!])).toEqual([0, 1, 2, 3]);
    expect(await asApp(cfg, (tx) => listCourses(tx, cfg))).toEqual(moved);
  });

  it("moves a course up", async () => {
    const cfg = await setupVenue();
    const [a, b, c, d] = await fourCourses(cfg);
    const moved = await asApp(cfg, (tx) => moveCourse(tx, cfg, d!, 1));
    expect(moved.map((x) => x.id)).toEqual([a, d, b, c]);
    expect(moved.map((x) => x.displayOrder)).toEqual([0, 1, 2, 3]);
    expect(await storedOrders([a!, d!, b!, c!])).toEqual([0, 1, 2, 3]);
  });

  it("treats a position past the end as last", async () => {
    const cfg = await setupVenue();
    const [a, b, c, d] = await fourCourses(cfg);
    const moved = await asApp(cfg, (tx) => moveCourse(tx, cfg, b!, 99));
    expect(moved.map((x) => x.id)).toEqual([a, c, d, b]);
    expect(await storedOrders([a!, c!, d!, b!])).toEqual([0, 1, 2, 3]);
  });

  it("counts only active courses and leaves an inactive one's stored order alone", async () => {
    const cfg = await setupVenue();
    const [a, b, c, d] = await fourCourses(cfg);
    await asApp(cfg, (tx) => deactivateCourse(tx, cfg, b!));
    const moved = await asApp(cfg, (tx) => moveCourse(tx, cfg, a!, 1));
    expect(moved.map((x) => x.id)).toEqual([c, a, d]);
    expect(moved.map((x) => x.displayOrder)).toEqual([0, 1, 2]);
    expect(await storedOrders([b!])).toEqual([5]);
  });

  it("refuses an inactive course with course.not_found and changes nothing", async () => {
    const cfg = await setupVenue();
    const [a, b, c, d] = await fourCourses(cfg);
    await asApp(cfg, (tx) => deactivateCourse(tx, cfg, b!));
    await expect(asApp(cfg, (tx) => moveCourse(tx, cfg, b!, 0))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: b },
    });
    expect(await storedOrders([a!, b!, c!, d!])).toEqual([0, 5, 5, 20]);
  });

  it("refuses an unknown id, or another venue's course, with course.not_found", async () => {
    const cfg = await setupVenue();
    await fourCourses(cfg);
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => moveCourse(tx, cfg, missing, 0))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: missing },
    });
    const other = await setupVenue();
    const [elsewhere] = await fourCourses(other);
    await expect(asApp(cfg, (tx) => moveCourse(tx, cfg, elsewhere!, 0))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: elsewhere },
    });
  });
});

describe("product-course config", () => {
  it("setProductCourse sets then clears the product's default course", async () => {
    const cfg = await setupVenue();
    const productId = await seedProduct();
    const { id: courseId } = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Principales" }),
    );
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, courseId));
    expect(await productCourse(productId)).toBe(courseId);
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, null));
    expect(await productCourse(productId)).toBeNull();
  });

  it("setProductCourse leaves a variant's id alone, as it does an id naming no product", async () => {
    const cfg = await setupVenue();
    const productId = await seedProduct();
    const variantId = await seedVariant(productId);
    const { id: courseId } = await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Postres" }));
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, variantId, courseId));
    expect(await productCourse(variantId)).toBeNull();
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, courseId));
    expect(await productCourse(productId)).toBe(courseId);
  });

  it("setProductCourse rejects an inactive or absent course with course.not_found", async () => {
    const cfg = await setupVenue();
    const productId = await seedProduct();
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, missing)),
    ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: missing } });
    const { id: dead } = await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Retired" }));
    await asApp(cfg, (tx) => deactivateCourse(tx, cfg, dead));
    await expect(
      asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, dead)),
    ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: dead } });
  });
});

describe("updateCourse with a refusal that is not the name unique", () => {
  it("rethrows it raw rather than relabelling it course.name_taken", async () => {
    const cfg = await setupVenue();
    const { id } = await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Entrantes" }));
    // `kitchen_courses` declares no CHECK, so a temporary trigger supplies the non-unique refusal.
    await db.execute(sql`
      create trigger kitchen_courses_refuse_update before update on kitchen_courses
      begin select raise(abort, 'course update refused'); end`);
    try {
      const refusal = await asApp(cfg, (tx) =>
        updateCourse(tx, cfg, id, { name: "Primeros" }),
      ).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal).not.toBeInstanceOf(AppError);
      expect(String(refusal)).toMatch(/course update refused/);
    } finally {
      await db.execute(sql`drop trigger kitchen_courses_refuse_update`);
    }
  });
});
