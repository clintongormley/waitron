import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
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
  setCategoryStation,
  setDefaultStation,
  setProductCourse,
  setProductStation,
  updateCourse,
  updateStation,
} from "./kitchen.js";
import "./errors.js";

// PGlite, not real Postgres: these are CONFIG verbs — plain inserts/by-id UPDATEs with no privilege or
// concurrency dimension. The `till.configure` gate lives on the ROUTE (Task 7), and cross-tenant RLS +
// the `WHERE is_default` partial-unique under `app_user` are already proven against real Postgres in
// packages/db's kitchen-stations.rls.test.ts (Task 1). PGlite serialises every query onto one backend,
// so it would be a FALSE PASS for a concurrency test — but there is no concurrency here, so it is the
// correct lighter target (CLAUDE.md §4), the same choice tables.ts's FP-1/FP-2 config suite makes.
const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(): Promise<TillConfig> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
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

describe("kitchen-station config", () => {
  it("creates/lists/renames/deactivates a station and flips the default atomically", async () => {
    const cfg = await setupVenue();
    // Each verb runs in its own transaction (the tables.ts idiom) — setDefaultStation's clear-then-set
    // atomicity is INTERNAL to that verb's own tx, so per-call transactions preserve it while keeping
    // the name_taken abort from poisoning a shared transaction (CLAUDE.md §4 order-independence).
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
    // Same display_order (0) → tie-broken by name (Alpha, Barra, Zebra). Defaults applied: displayOrder
    // 0, isDefault false, active true — the exact Station shape (no createdAt).
    expect(list).toEqual([
      { id: expect.any(String), name: "Alpha", displayOrder: 0, isDefault: false, active: true },
      { id: expect.any(String), name: "Barra", displayOrder: 0, isDefault: false, active: true },
      { id: expect.any(String), name: "Zebra", displayOrder: 0, isDefault: false, active: true },
    ]);
  });

  it("createStation with isDefault adopts the station as THE default, clearing any prior (single default kept)", async () => {
    // The clear-first branch of createStation: a second default-on-create must DEMOTE the first, never
    // trip the `WHERE is_default` partial unique nor mis-surface as station.name_taken.
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
      { id, name: "Parrilla", displayOrder: 9, isDefault: false, active: true },
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
    // 10_000_000_000 overflows the int4 `display_order` column (22003 numeric_value_out_of_range) — NOT
    // the name unique. So `isUniqueViolation` is false and both verbs rethrow the raw driver error
    // rather than mistranslating it (the false branch of each catch — the negative control tables.ts's
    // create/update verbs each carry).
    const cfg = await setupVenue();
    const createErr = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Big", displayOrder: 10_000_000_000 }),
    ).catch((e: unknown) => e);
    expect(createErr).toBeInstanceOf(Error);
    expect(createErr).not.toBeInstanceOf(AppError);

    const { id } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Ord" }));
    const updateErr = await asApp(cfg, (tx) =>
      updateStation(tx, cfg, id, { displayOrder: 10_000_000_000 }),
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
    // A deactivated station cannot be the fallback — requireLiveStation's `active = false` branch.
    const { id } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Old" }));
    await asApp(cfg, (tx) => deactivateStation(tx, cfg, id));
    await expect(asApp(cfg, (tx) => setDefaultStation(tx, cfg, id))).rejects.toMatchObject({
      code: "station.not_found",
      params: { stationId: id },
    });
  });
});

// Read a category's / product's snapshotted routing column back — the load-bearing assertion for the
// routing verbs (a null-only check would prove nothing about the UPDATE).
async function categoryStation(categoryId: string): Promise<string | null> {
  const { rows } = await db.execute<{ station_id: string | null }>(
    sql`select station_id from categories where id = ${categoryId}`,
  );
  return rows[0]!.station_id;
}
async function productStation(productId: string): Promise<string | null> {
  const { rows } = await db.execute<{ station_id: string | null }>(
    sql`select station_id from products where id = ${productId}`,
  );
  return rows[0]!.station_id;
}
async function productCourse(productId: string): Promise<string | null> {
  const { rows } = await db.execute<{ course_id: string | null }>(
    sql`select course_id from products where id = ${productId}`,
  );
  return rows[0]!.course_id;
}
async function seedCategory(cfg: TillConfig): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into categories (tenant_id, name) values (${cfg.tenantId}, 'Food') returning id`,
  );
  return rows[0]!.id;
}
async function seedProduct(cfg: TillConfig): Promise<string> {
  const cat = await db.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${cfg.tenantId}, 'Menu') returning id`,
  );
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
    values (${cfg.tenantId}, ${cat.rows[0]!.id}, '{}'::jsonb, 'each', 1.00, 'general') returning id`);
  return rows[0]!.id;
}

describe("routing config", () => {
  it("setCategoryStation sets then clears the category's default station", async () => {
    const cfg = await setupVenue();
    const categoryId = await seedCategory(cfg);
    const { id: stationId } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Cocina" }));
    await asApp(cfg, (tx) => setCategoryStation(tx, cfg, categoryId, stationId));
    expect(await categoryStation(categoryId)).toBe(stationId);
    await asApp(cfg, (tx) => setCategoryStation(tx, cfg, categoryId, null));
    expect(await categoryStation(categoryId)).toBeNull();
  });

  it("setProductStation sets then clears the product's override station", async () => {
    const cfg = await setupVenue();
    const productId = await seedProduct(cfg);
    const { id: stationId } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Plancha" }));
    await asApp(cfg, (tx) => setProductStation(tx, cfg, productId, stationId));
    expect(await productStation(productId)).toBe(stationId);
    await asApp(cfg, (tx) => setProductStation(tx, cfg, productId, null));
    expect(await productStation(productId)).toBeNull();
  });

  it("setCategoryStation / setProductStation reject an inactive or absent station with station.not_found", async () => {
    const cfg = await setupVenue();
    const categoryId = await seedCategory(cfg);
    const productId = await seedProduct(cfg);
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => setCategoryStation(tx, cfg, categoryId, missing)),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: missing } });
    await expect(
      asApp(cfg, (tx) => setProductStation(tx, cfg, productId, missing)),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: missing } });
    // A deactivated station is not a live routing target either — requireLiveStation's inactive branch.
    const { id: dead } = await asApp(cfg, (tx) => createStation(tx, cfg, { name: "Retired" }));
    await asApp(cfg, (tx) => deactivateStation(tx, cfg, dead));
    await expect(
      asApp(cfg, (tx) => setCategoryStation(tx, cfg, categoryId, dead)),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: dead } });
    await expect(
      asApp(cfg, (tx) => setProductStation(tx, cfg, productId, dead)),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: dead } });
  });
});

// KDS-2 course config verbs — mirror the station-config suite above EXACTLY, minus the default concept
// (kitchen_courses has no `is_default`; a null course simply fires earliest, spec §2b). Same lighter
// PGlite target for the same reason (config verbs, no privilege/concurrency dimension — the RLS + grants
// live in packages/db's kitchen-courses.rls.test.ts against real Postgres).
describe("kitchen-course config", () => {
  it("creates/lists/updates/deactivates a course and orders by display_order then name", async () => {
    const cfg = await setupVenue();
    const { id: a } = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Principales", displayOrder: 1 }),
    );
    await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 }));
    // Same display_order tie-break by name: create two at 0 and confirm Alpha precedes Zebra.
    await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Zebra", displayOrder: 0 }));
    await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Alpha", displayOrder: 0 }));
    const list = await asApp(cfg, (tx) => listCourses(tx, cfg));
    // Ordered display_order asc then name asc: (0)Alpha, (0)Entrantes, (0)Zebra, (1)Principales.
    expect(list.map((c) => c.name)).toEqual(["Alpha", "Entrantes", "Zebra", "Principales"]);
    // The exact Course shape (id/name/displayOrder/active — no createdAt, no isDefault).
    expect(list[3]).toEqual({ id: a, name: "Principales", displayOrder: 1, active: true });
    // Rename + reorder, then deactivate (deactivated courses drop out of the active-only list).
    await asApp(cfg, (tx) => updateCourse(tx, cfg, a, { name: "Segundos", displayOrder: 9 }));
    await asApp(cfg, (tx) => deactivateCourse(tx, cfg, a));
    expect((await asApp(cfg, (tx) => listCourses(tx, cfg))).some((c) => c.id === a)).toBe(false);
    // Reactivation is updateCourse({ active: true }).
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

  it("createCourse and updateCourse rethrow a NON-unique DB error raw, not as course.name_taken", async () => {
    // display_order overflow (22003) is not the name unique — the false branch of each catch, the
    // negative control the station verbs carry.
    const cfg = await setupVenue();
    const createErr = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Big", displayOrder: 10_000_000_000 }),
    ).catch((e: unknown) => e);
    expect(createErr).toBeInstanceOf(Error);
    expect(createErr).not.toBeInstanceOf(AppError);
    const { id } = await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Ord" }));
    const updateErr = await asApp(cfg, (tx) =>
      updateCourse(tx, cfg, id, { displayOrder: 10_000_000_000 }),
    ).catch((e: unknown) => e);
    expect(updateErr).toBeInstanceOf(Error);
    expect(updateErr).not.toBeInstanceOf(AppError);
  });
});

describe("product-course config", () => {
  it("setProductCourse sets then clears the product's default course", async () => {
    const cfg = await setupVenue();
    const productId = await seedProduct(cfg);
    const { id: courseId } = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Principales" }),
    );
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, courseId));
    expect(await productCourse(productId)).toBe(courseId);
    await asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, null));
    expect(await productCourse(productId)).toBeNull();
  });

  it("setProductCourse rejects an inactive or absent course with course.not_found", async () => {
    const cfg = await setupVenue();
    const productId = await seedProduct(cfg);
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, missing)),
    ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: missing } });
    // A deactivated course is not a live routing target either — requireLiveCourse's inactive branch.
    const { id: dead } = await asApp(cfg, (tx) => createCourse(tx, cfg, { name: "Retired" }));
    await asApp(cfg, (tx) => deactivateCourse(tx, cfg, dead));
    await expect(
      asApp(cfg, (tx) => setProductCourse(tx, cfg, productId, dead)),
    ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: dead } });
  });
});
