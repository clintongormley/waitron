import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createMenuItem,
  createMenuSection,
  createProduct,
  writeContentLanguages,
} from "@waitron/catalogue";
import {
  asAppUser,
  CORE_MIGRATIONS,
  floorZones,
  kitchenStations,
  locations,
  tills,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId, tillId as brandTillId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  copyOrderServiceContext,
  copyWorkingLineContext,
  configureZone,
  createDepartment,
  createPreparationRoute,
  deactivateDepartment,
  deletePreparationRoute,
  allowMenuInZone,
  getOrderServiceContext,
  listWorkingLineContexts,
  listServiceZones,
  listVenueReadiness,
  listZoneOffers,
  recordOrderServiceContext,
  recordWorkingLineContexts,
  resolvePreparationRoutes,
  resolveNewOrderZone,
  resolveZoneOffer,
  resolveZoneContext,
} from "./operations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;

beforeAll(() => {
  db = suite.db;
});

async function scoped<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/**
 * The venue's fixture rows, through the insert BUILDER rather than raw SQL.
 *
 * Two things the raw statements relied on PostgreSQL for are gone. `array['en-GB']` is refused at
 * prepare — `near "['en-GB']": syntax error` — because SQLite has no array literal and
 * `invoice_locales` is now a JSON array in a TEXT column that `labelList` encodes. And each table's
 * `id` and `created_at` are JavaScript `$defaultFn` generators rather than SQL DEFAULTs, which only
 * the builder runs; measured, a raw insert is refused with `NOT NULL constraint failed: <table>.id`.
 * Same shape as every converted fixture in the tree (`packages/identity/test/fixtures.ts`). Each
 * returns the new row's id, which is the one thing every call site read off the raw result.
 */
async function seedLocation(name: string): Promise<string> {
  const [row] = await db
    .insert(locations)
    .values({ name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  return row!.id;
}

async function seedZone(locationId: LocationId, name: string): Promise<string> {
  const [row] = await db
    .insert(floorZones)
    .values({ locationId, name })
    .returning({ id: floorZones.id });
  return row!.id;
}

async function seedStation(locationId: LocationId, name: string, active = true): Promise<string> {
  const [row] = await db
    .insert(kitchenStations)
    .values({ locationId, name, active })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

async function seedTill(locationId: LocationId, name: string): Promise<string> {
  const [row] = await db.insert(tills).values({ locationId, name }).returning({ id: tills.id });
  return row!.id;
}

/**
 * The drizzle session the two query-count cases below spy on.
 *
 * `tx.session`, not `tx._.session`. Drizzle's PostgreSQL database put the session on `_` beside the
 * schema; its SQLite database assigns `this.session` and puts only
 * `{ schema, fullSchema, tableNamesMap }` on `_` (`drizzle-orm/sqlite-core/db.js`, read against
 * 0.45.2). Measured, the old path handed `vi.spyOn` `undefined`: "The vi.spyOn() function could not
 * find an object to spy upon". The cast is because `session` is a constructor parameter marked
 * `@internal`, so it is on the object at runtime and off the published type.
 */
const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }).session;

async function seedUnitTenant(): Promise<{
  eachUnitId: string;
  kgUnitId: string;
}> {
  // Raw SQL still, but with `id` named and the `::jsonb` casts gone: `units.name` and
  // `abbreviation` are TEXT columns holding JSON here, and the cast is refused at prepare with
  // `unrecognized token: ":"`. `units.id` has no SQL DEFAULT, for the reason the helpers above give.
  const seeded = await db.execute<{ id: string; seed_key: "each" | "kg" }>(sql`
    insert into units (id, seed_key, name, abbreviation, precision, hardware_unit) values
      (${randomUUID()}, 'each', '{"en":"each"}', '{"en":"ea"}', 0, null),
      (${randomUUID()}, 'kg', '{"en":"kg"}', '{"en":"kg"}', 3, 'kg')
    returning id, seed_key`);
  return {
    eachUnitId: seeded.rows.find((unit) => unit.seed_key === "each")!.id,
    kgUnitId: seeded.rows.find((unit) => unit.seed_key === "kg")!.id,
  };
}

describe("venue service routing", () => {
  it("reports incomplete active zones and refuses to deactivate their department", async () => {
    await seedUnitTenant();
    const location = await seedLocation("Venue");
    const locationId = brandLocationId(location);
    const zone = await seedZone(locationId, "Terrace");

    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        { name: "Restaurant", defaultServiceMode: "table_tab" },
      );
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        { code: "zone.department_missing", zoneId: zone, zoneName: "Terrace" },
      ]);

      await configureZone(
        tx,
        { locationId },
        {
          zoneId: zone,
          departmentId: department.id,
        },
      );
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        { code: "zone.menu_missing", zoneId: zone, zoneName: "Terrace" },
      ]);

      const menu = await createCatalogue(tx, { name: "Terrace menu" });
      await allowMenuInZone(tx, { locationId }, zone, menu.id, {
        makeDefault: true,
      });
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        {
          code: "zone.menu_empty",
          zoneId: zone,
          zoneName: "Terrace",
          menuId: menu.id,
          menuName: "Terrace menu",
        },
      ]);

      const category = await createCategory(tx, { name: { en: "Drinks" } });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Sparkling water",
        customerName: { en: "Sparkling water", fr: "Eau pétillante" },
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      const section = await createMenuSection(tx, {
        menuId: menu.id,
        name: { en: "Drinks", fr: "Boissons" },
      });
      await createMenuItem(tx, {
        menuId: menu.id,
        productId: product.id,
        sectionId: section.id,
        grossPrice: "3.00",
      });
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        {
          code: "zone.route_missing",
          zoneId: zone,
          zoneName: "Terrace",
          productId: product.id,
          productName: "Sparkling water",
        },
      ]);
      await writeContentLanguages(tx, {
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
      // The readiness list is staff-facing, so it keeps naming the product by its staff name even
      // though the venue's default language changed and the product has French customer text.
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        {
          code: "zone.route_missing",
          zoneId: zone,
          zoneName: "Terrace",
          productId: product.id,
          productName: "Sparkling water",
        },
      ]);
      // A blank staff name is storable — `products.name` is only NOT NULL — so the list falls back
      // to the product id rather than rendering an empty name. Written with raw SQL because no
      // write path reachable from here produces a blank one.
      await tx.execute(sql`update products set name = '' where id = ${product.id}`);
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        {
          code: "zone.route_missing",
          zoneId: zone,
          zoneName: "Terrace",
          productId: product.id,
          productName: product.id,
        },
      ]);
      await tx.execute(sql`update products set name = 'Sparkling water' where id = ${product.id}`);
      await createPreparationRoute(
        tx,
        { locationId },
        {
          productId: product.id,
          target: { kind: "no_preparation" },
        },
      );
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([]);
      await expect(deactivateDepartment(tx, { locationId }, department.id)).rejects.toMatchObject({
        code: "department.has_active_zones",
        params: { departmentId: department.id, zoneId: zone },
      });

      await tx.execute(sql`update floor_zones set active = false where id = ${zone}`);
      await expect(
        deactivateDepartment(tx, { locationId }, department.id),
      ).resolves.toBeUndefined();
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        { code: "venue.department_missing" },
      ]);
    });
  });

  it("routes one cocktail to the bar serving its service zone", async () => {
    await seedUnitTenant();
    const location = await seedLocation("Venue");
    const locationId = brandLocationId(location);
    const upstairsZone = await seedZone(locationId, "Upstairs");
    const downstairsZone = await seedZone(locationId, "Downstairs");
    const upstairsBar = await seedStation(locationId, "Upstairs bar");
    const downstairsBar = await seedStation(locationId, "Downstairs bar");

    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        {
          name: "Restaurant and bar",
          defaultServiceMode: "table_tab",
        },
      );
      await configureZone(
        tx,
        { locationId },
        {
          zoneId: upstairsZone,
          departmentId: department.id,
        },
      );
      await configureZone(
        tx,
        { locationId },
        {
          zoneId: downstairsZone,
          departmentId: department.id,
          serviceMode: "prepay",
        },
      );
      await expect(listServiceZones(tx, { locationId })).resolves.toEqual([
        {
          id: downstairsZone,
          name: "Downstairs",
          departmentId: department.id,
          departmentName: "Restaurant and bar",
          serviceMode: "prepay",
          serviceModeOverride: "prepay",
        },
        {
          id: upstairsZone,
          name: "Upstairs",
          departmentId: department.id,
          departmentName: "Restaurant and bar",
          serviceMode: "table_tab",
          serviceModeOverride: null,
        },
      ]);
      const menu = await createCatalogue(tx, { name: "Drinks" });
      const category = await createCategory(tx, { name: { en: "Cocktails" } });
      const negroni = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Negroni",
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
      });
      await createPreparationRoute(
        tx,
        { locationId },
        {
          zoneId: upstairsZone,
          categoryId: category.id,
          target: { kind: "station", stationId: upstairsBar },
        },
      );
      await createPreparationRoute(
        tx,
        { locationId },
        {
          zoneId: downstairsZone,
          categoryId: category.id,
          target: { kind: "station", stationId: downstairsBar },
        },
      );

      await expect(
        resolvePreparationRoutes(tx, { locationId }, upstairsZone, [negroni.id]),
      ).resolves.toEqual(new Map([[negroni.id, { kind: "station", stationId: upstairsBar }]]));
      await expect(
        resolvePreparationRoutes(tx, { locationId }, downstairsZone, [negroni.id]),
      ).resolves.toEqual(new Map([[negroni.id, { kind: "station", stationId: downstairsBar }]]));
    });
  });

  it("inherits service mode, lists zone offers, and freezes the order context", async () => {
    const { kgUnitId } = await seedUnitTenant();
    const location = await seedLocation("Venue");
    const locationId = brandLocationId(location);
    const zone = await seedZone(locationId, "Deli counter");
    const till = await seedTill(locationId, "Deli till");
    const nodeId = await seedNode(db, locationId);

    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        {
          name: "Deli",
          defaultServiceMode: "prepay",
        },
      );
      await configureZone(
        tx,
        { locationId },
        {
          zoneId: zone,
          departmentId: department.id,
        },
      );
      const menu = await createCatalogue(tx, { name: "Deli takeaway" });
      const category = await createCategory(tx, { name: { en: "Cold cuts" } });
      const ham = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Sliced ham",
        pricingUnit: "weight",
        unitPrice: "0.00",
        vatClass: "reduced",
      });
      const section = await createMenuSection(tx, {
        menuId: menu.id,
        name: { en: "Counter" },
      });
      const offer = await createMenuItem(tx, {
        menuId: menu.id,
        productId: ham.id,
        sectionId: section.id,
        grossPrice: "24.90",
      });
      const hiddenMenu = await createCatalogue(tx, { name: "Staff" });
      const hiddenSection = await createMenuSection(tx, {
        menuId: hiddenMenu.id,
        name: { en: "Staff" },
      });
      const hiddenOffer = await createMenuItem(tx, {
        menuId: hiddenMenu.id,
        productId: ham.id,
        sectionId: hiddenSection.id,
        grossPrice: "1.00",
      });
      await allowMenuInZone(tx, { locationId }, zone, menu.id, {
        makeDefault: true,
      });
      await tx.execute(sql`
        update zone_service_policies set is_counter_default = true
        where zone_id = ${zone}`);

      await tx.execute(sql`
        insert into working_orders (id, till_id, node_id, order_number, opened_at) values ('00000000-0000-4000-8000-000000000001', ${brandTillId(till)}, ${nodeId}, 1, ${new Date().toISOString()})`);
      await recordOrderServiceContext(
        tx,
        { locationId },
        "00000000-0000-4000-8000-000000000001",
        zone,
      );
      const workingLineId = "00000000-0000-4000-8000-000000000002";
      await tx.insert(workingOrderLines).values({
        id: workingLineId,
        workingOrderId: "00000000-0000-4000-8000-000000000001",
        lineNo: 1,
        productId: ham.id,
        name: "Sliced ham",
        descriptions: { "en-GB": "Sliced ham" },
        // 250 g, counted in whole thousandths, beside a rate in whole basis points.
        quantity: 250,
        unitPrice: 2264,
        unitPriceGross: 2490,
        vatRate: 1000,
        lineTotal: 623,
        category: "Cold cuts",
      });
      await recordWorkingLineContexts(tx, { locationId }, "00000000-0000-4000-8000-000000000001", [
        { workingOrderLineId: workingLineId, menuItemId: offer.id },
      ]);
      await configureZone(
        tx,
        { locationId },
        {
          zoneId: zone,
          departmentId: department.id,
          serviceMode: "invoice_first",
        },
      );

      await expect(resolveZoneContext(tx, { locationId }, zone)).resolves.toMatchObject({
        serviceMode: "invoice_first",
      });
      await expect(
        getOrderServiceContext(tx, { locationId }, "00000000-0000-4000-8000-000000000001"),
      ).resolves.toEqual({
        zoneId: zone,
        departmentId: department.id,
        serviceMode: "prepay",
      });
      const visible = await listZoneOffers(tx, { locationId }, zone);
      expect(visible.defaultMenuId).toBe(menu.id);
      expect(visible.menus).toEqual([{ id: menu.id, name: "Deli takeaway", isDefault: true }]);
      await expect(resolveNewOrderZone(tx, { locationId }, {})).resolves.toMatchObject({
        zoneId: zone,
        departmentId: department.id,
        serviceMode: "invoice_first",
      });
      expect(visible.offers).toHaveLength(1);
      expect(visible.offers[0]).toMatchObject({
        id: offer.id,
        productId: ham.id,
        grossPrice: "24.90",
      });
      await expect(resolveZoneOffer(tx, { locationId }, zone, offer.id)).resolves.toMatchObject({
        id: offer.id,
        productId: ham.id,
        grossPrice: "24.90",
      });
      await expect(
        resolveZoneOffer(tx, { locationId }, zone, hiddenOffer.id),
      ).rejects.toMatchObject({ code: "service_zone.offer_not_allowed" });
      await tx.execute(sql`
        update catalogues set name = 'Renamed menu'
        where id = ${menu.id}`);
      await tx.execute(sql`
        update departments set name = 'Renamed department'
        where id = ${department.id}`);
      await expect(
        listWorkingLineContexts(tx, { locationId }, "00000000-0000-4000-8000-000000000001"),
      ).resolves.toEqual([
        expect.objectContaining({
          workingOrderLineId: workingLineId,
          menuItemId: offer.id,
          menuName: "Deli takeaway",
          categoryName: "Cold cuts",
          unitId: kgUnitId,
          unitName: { en: "kg" },
          unitPrecision: 3,
          hardwareUnit: "kg",
          vatClass: "reduced",
        }),
      ]);
      const attribution = await tx.execute<{
        menu_name: string;
        department_name: string;
        category_name: string;
      }>(sql`
        select menu_name, department_name, category_name
        from working_line_contexts
        where working_order_line_id = ${workingLineId}`);
      expect(attribution.rows).toEqual([
        {
          menu_name: "Deli takeaway",
          department_name: "Deli",
          category_name: "Cold cuts",
        },
      ]);

      const copiedOrderId = "00000000-0000-4000-8000-000000000003";
      const copiedLineId = "00000000-0000-4000-8000-000000000004";
      await tx.execute(sql`
        insert into working_orders (id, till_id, node_id, order_number, opened_at) values (${copiedOrderId}, ${brandTillId(till)}, ${nodeId}, 2, ${new Date().toISOString()})`);
      await tx.insert(workingOrderLines).values({
        id: copiedLineId,
        workingOrderId: copiedOrderId,
        lineNo: 1,
        productId: ham.id,
        name: "Sliced ham",
        descriptions: { "en-GB": "Sliced ham" },
        // 100 g, in thousandths like the line above.
        quantity: 100,
        unitPrice: 2264,
        unitPriceGross: 2490,
        vatRate: 1000,
        lineTotal: 249,
        category: "Cold cuts",
      });
      await copyOrderServiceContext(
        tx,
        { locationId },
        "00000000-0000-4000-8000-000000000001",
        copiedOrderId,
      );
      await copyWorkingLineContext(tx, { locationId }, workingLineId, copiedLineId);
      await expect(getOrderServiceContext(tx, { locationId }, copiedOrderId)).resolves.toEqual({
        zoneId: zone,
        departmentId: department.id,
        serviceMode: "prepay",
      });
      await expect(listWorkingLineContexts(tx, { locationId }, copiedOrderId)).resolves.toEqual([
        expect.objectContaining({
          workingOrderLineId: copiedLineId,
          menuItemId: offer.id,
          menuName: "Deli takeaway",
        }),
      ]);
    });
  });

  it("records a working line context for a product with no unit (Each)", async () => {
    // The sentinel Each id must survive the working_line_contexts.unit_id write, which is `uuid NOT
    // NULL`. This proves the cross-package sentinel decision: an empty-string id would be rejected by
    // the uuid column on the first sale of a no-unit product.
    await seedUnitTenant();
    const location = await seedLocation("Venue");
    const locationId = brandLocationId(location);
    const zone = await seedZone(locationId, "Deli counter");
    const till = await seedTill(locationId, "Deli till");
    const nodeId = await seedNode(db, locationId);

    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        { name: "Deli", defaultServiceMode: "prepay" },
      );
      await configureZone(tx, { locationId }, { zoneId: zone, departmentId: department.id });
      const menu = await createCatalogue(tx, { name: "Deli takeaway" });
      // A product with NO stored unit: create it, then delete its product_units row so the offer read
      // resolves it to the synthetic Each unit (the sentinel-id path).
      const sweets = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Loose sweets",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      await tx.execute(sql`delete from product_units where product_id = ${sweets.id}`);
      const section = await createMenuSection(tx, {
        menuId: menu.id,
        name: { en: "Counter" },
      });
      const offer = await createMenuItem(tx, {
        menuId: menu.id,
        productId: sweets.id,
        sectionId: section.id,
        grossPrice: "1.20",
      });
      await allowMenuInZone(tx, { locationId }, zone, menu.id, {
        makeDefault: true,
      });
      await tx.execute(sql`
        update zone_service_policies set is_counter_default = true
        where zone_id = ${zone}`);

      const orderId = "00000000-0000-4000-8000-000000000101";
      const workingLineId = "00000000-0000-4000-8000-000000000102";
      await tx.execute(sql`
        insert into working_orders (id, till_id, node_id, order_number, opened_at)
        values (${orderId}, ${brandTillId(till)}, ${nodeId}, 1, ${new Date().toISOString()})`);
      await recordOrderServiceContext(tx, { locationId }, orderId, zone);
      await tx.insert(workingOrderLines).values({
        id: workingLineId,
        workingOrderId: orderId,
        lineNo: 1,
        productId: sweets.id,
        name: "Loose sweets",
        descriptions: { "en-GB": "Loose sweets" },
        quantity: 1000,
        unitPrice: 109,
        unitPriceGross: 120,
        vatRate: 1000,
        lineTotal: 120,
        category: "Uncategorised",
      });

      await expect(
        recordWorkingLineContexts(tx, { locationId }, orderId, [
          { workingOrderLineId: workingLineId, menuItemId: offer.id },
        ]),
      ).resolves.not.toThrow();

      const ctx = await tx.execute<{ unit_id: string }>(sql`
        select unit_id from working_line_contexts
        where working_order_line_id = ${workingLineId}`);
      // The sentinel, not "" (which the uuid column rejects).
      expect(ctx.rows[0]!.unit_id).toBe("00000000-0000-0000-0000-000000000001");
    });
  });

  it("refuses missing configuration and supports explicit no-preparation", async () => {
    await seedUnitTenant();
    const location = await seedLocation("Venue");
    const locationId = brandLocationId(location);
    const zone = await seedZone(locationId, "Terrace");

    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        {
          name: "Restaurant",
          tradingName: "Terrace restaurant",
          defaultServiceMode: "table_tab",
        },
      );
      await expect(
        configureZone(
          tx,
          { locationId },
          {
            zoneId: "00000000-0000-4000-8000-000000000099",
            departmentId: department.id,
          },
        ),
      ).rejects.toMatchObject({ code: "service_zone.not_found" });
      await expect(
        configureZone(
          tx,
          { locationId },
          {
            zoneId: zone,
            departmentId: "00000000-0000-4000-8000-000000000099",
          },
        ),
      ).rejects.toMatchObject({ code: "department.not_found" });
      await expect(
        allowMenuInZone(tx, { locationId }, zone, "00000000-0000-4000-8000-000000000099"),
      ).rejects.toMatchObject({ code: "catalogue.not_found" });

      const menu = await createCatalogue(tx, { name: "Terrace" });
      await expect(allowMenuInZone(tx, { locationId }, zone, menu.id)).rejects.toMatchObject({
        code: "service_zone.not_found",
      });
      await configureZone(
        tx,
        { locationId },
        {
          zoneId: zone,
          departmentId: department.id,
          serviceMode: "ticket_then_pay",
        },
      );
      await allowMenuInZone(tx, { locationId }, zone, menu.id);
      await expect(listZoneOffers(tx, { locationId }, zone)).resolves.toEqual({
        defaultMenuId: null,
        menus: [{ id: menu.id, name: "Terrace", isDefault: false }],
        offers: [],
      });
      await expect(
        getOrderServiceContext(tx, { locationId }, "00000000-0000-4000-8000-000000000099"),
      ).rejects.toMatchObject({ code: "order.service_context_missing" });

      const category = await createCategory(tx, { name: { en: "Packaged" } });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Crisps",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "reduced",
      });
      const routeId = await createPreparationRoute(
        tx,
        { locationId },
        {
          productId: product.id,
          target: { kind: "no_preparation" },
        },
      );
      await expect(
        resolvePreparationRoutes(tx, { locationId }, zone, [product.id]),
      ).resolves.toEqual(new Map([[product.id, { kind: "no_preparation" }]]));
      await deletePreparationRoute(tx, { locationId }, routeId);
      await expect(
        resolvePreparationRoutes(tx, { locationId }, zone, [product.id]),
      ).rejects.toMatchObject({
        code: "route.missing",
        params: { zoneId: zone, productId: product.id },
      });
      await expect(
        resolvePreparationRoutes(tx, { locationId }, zone, [
          "00000000-0000-4000-8000-000000000099",
        ]),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
        params: { subject: "product", id: "00000000-0000-4000-8000-000000000099" },
      });
    });
  });

  it("refuses a missing route and a route to an inactive station", async () => {
    await seedUnitTenant();
    const location = await seedLocation("Venue");
    const locationId = brandLocationId(location);
    const zone = await seedZone(locationId, "Interior");
    const station = await seedStation(locationId, "Closed bar", false);

    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        {
          name: "Restaurant",
          defaultServiceMode: "table_tab",
        },
      );
      await configureZone(
        tx,
        { locationId },
        {
          zoneId: zone,
          departmentId: department.id,
        },
      );
      const menu = await createCatalogue(tx, { name: "Drinks" });
      const category = await createCategory(tx, { name: { en: "Cocktails" } });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Negroni",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      await expect(
        resolvePreparationRoutes(tx, { locationId }, zone, [product.id]),
      ).rejects.toMatchObject({
        code: "route.missing",
        params: { zoneId: zone, productId: product.id },
      });
      await expect(
        createPreparationRoute(
          tx,
          { locationId },
          {
            categoryId: category.id,
            target: { kind: "station", stationId: station },
          },
        ),
      ).rejects.toMatchObject({ code: "route.station_inactive" });
    });
  });
});

async function seedRoutingVenue() {
  await seedUnitTenant();
  const location = await seedLocation("Venue");
  const otherLocation = await seedLocation("Second venue");
  const locationId = brandLocationId(location);
  const zone = await seedZone(locationId, "Dining room");
  const otherZone = await seedZone(locationId, "Terrace");
  const cfg = { locationId };
  await scoped(async (tx) => {
    const department = await createDepartment(tx, cfg, {
      name: "Restaurant",
      defaultServiceMode: "table_tab",
    });
    await configureZone(tx, cfg, { zoneId: zone, departmentId: department.id });
    await configureZone(tx, cfg, { zoneId: otherZone, departmentId: department.id });
  });
  return {
    cfg,
    otherLocationId: otherLocation,
    zoneId: zone,
    otherZoneId: otherZone,
  };
}

async function insertStation(tx: Transaction, locationId: string, name: string): Promise<string> {
  const [row] = await tx
    .insert(kitchenStations)
    .values({ locationId: brandLocationId(locationId), name })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

async function productWithCategory(
  tx: Transaction,
  menuId: string,
  name: string,
  withCategory = true,
): Promise<{ id: string; categoryId: string }> {
  const category = withCategory
    ? await createCategory(tx, { name: { en: `${name} category` } })
    : null;
  const product = await createProduct(tx, {
    catalogueId: menuId,
    categoryId: category?.id ?? null,
    name,
    pricingUnit: "each",
    unitPrice: "0.00",
    vatClass: "general",
  });
  return { id: product.id, categoryId: category?.id ?? "" };
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string; params: unknown }> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error(`expected an AppError, got ${String(error)}`);
  return { code: error.code, params: error.params };
}

const station = (stationId: string) => ({ kind: "station" as const, stationId });
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000099";

describe("resolvePreparationRoutes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks the most specific route for every product in one batch", async () => {
    const { cfg, zoneId, otherZoneId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const at = (name: string) => insertStation(tx, cfg.locationId, name);
      const zoneProduct = await at("Zone product winner");
      const zoneCategory = await at("Zone category winner");
      const venueProduct = await at("Venue product winner");
      const venueCategory = await at("Venue category winner");
      const uncategorised = await at("Uncategorised winner");
      const losingZoneCategory = await at("Losing zone category");
      const losingVenueProduct = await at("Losing venue product");
      const losingVenueCategory = await at("Losing venue category");
      const otherZone = await at("Other zone");
      const menu = await createCatalogue(tx, { name: "Precedence" });
      const p4 = await productWithCategory(tx, menu.id, "Rank four");
      const p3 = await productWithCategory(tx, menu.id, "Rank three");
      const p2 = await productWithCategory(tx, menu.id, "Rank two");
      const p1 = await productWithCategory(tx, menu.id, "Rank one");
      const bare = await productWithCategory(tx, menu.id, "No category", false);
      const skipped = await productWithCategory(tx, menu.id, "No preparation");
      const route = (input: Parameters<typeof createPreparationRoute>[2]) =>
        createPreparationRoute(tx, cfg, input);

      await route({ zoneId, productId: p4.id, target: station(zoneProduct) });
      await route({ zoneId, categoryId: p4.categoryId, target: station(losingZoneCategory) });
      await route({ productId: p4.id, target: station(losingVenueProduct) });
      await route({ categoryId: p4.categoryId, target: station(losingVenueCategory) });

      await route({ zoneId, categoryId: p3.categoryId, target: station(zoneCategory) });
      await route({ productId: p3.id, target: station(losingVenueProduct) });
      await route({ categoryId: p3.categoryId, target: station(losingVenueCategory) });
      await route({ zoneId: otherZoneId, productId: p3.id, target: station(otherZone) });

      await route({ productId: p2.id, target: station(venueProduct) });
      await route({ categoryId: p2.categoryId, target: station(losingVenueCategory) });
      await route({ zoneId: otherZoneId, productId: p2.id, target: station(otherZone) });

      await route({ categoryId: p1.categoryId, target: station(venueCategory) });
      await route({ zoneId: otherZoneId, categoryId: p1.categoryId, target: station(otherZone) });

      await route({ productId: bare.id, target: station(uncategorised) });

      await route({ productId: skipped.id, target: { kind: "no_preparation" } });
      await route({ categoryId: skipped.categoryId, target: station(losingVenueCategory) });

      await expect(
        resolvePreparationRoutes(tx, cfg, zoneId, [
          p4.id,
          p3.id,
          p2.id,
          p1.id,
          bare.id,
          skipped.id,
        ]),
      ).resolves.toEqual(
        new Map<string, unknown>([
          [p4.id, station(zoneProduct)],
          [p3.id, station(zoneCategory)],
          [p2.id, station(venueProduct)],
          [p1.id, station(venueCategory)],
          [bare.id, station(uncategorised)],
          [skipped.id, { kind: "no_preparation" }],
        ]),
      );
    });
  });

  /**
   * WHAT THIS CASE LOST. It used to pass a THIRD spelling, `{` + the 32 digits with no hyphens +
   * `}`, and expect it to resolve to the same product and be folded into the first spelling. That
   * spelling was accepted because PostgreSQL's uuid INPUT PARSER accepted it, and no parser accepts
   * it now — the id column is plain `text` and the bytes are compared as they arrive. So the
   * braced form is no longer a spelling of this id at all, and the case pins what it does instead:
   * `shared.invalid_id`, refused by `normaliseUuid` before any query runs.
   *
   * Nothing was weakened to get there. The surviving half is CASE, which is the half that was
   * actually broken: before `storedUuid` was taken through to SQL, the upper-cased id below was
   * refused `route.subject_not_found` because the bind value never matched the stored row. Both
   * halves of the old case's subject are still checked — an id still resolves however it is cased,
   * and two spellings of one product still collapse to the first — with two cased spellings
   * standing where the cased and braced pair stood.
   */
  it("matches a product id however the caller CASES it, keyed by the caller's spelling", async () => {
    const { cfg, zoneId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const grill = await insertStation(tx, cfg.locationId, "Grill");
      const menu = await createCatalogue(tx, { name: "Spelling" });
      const routed = await productWithCategory(tx, menu.id, "Routed");
      const unrouted = await productWithCategory(tx, menu.id, "Unrouted");
      await createPreparationRoute(tx, cfg, { productId: routed.id, target: station(grill) });
      const upper = routed.id.toUpperCase();
      const braced = `{${routed.id.replaceAll("-", "")}}`;
      expect(upper).not.toBe(routed.id);

      await expect(resolvePreparationRoutes(tx, cfg, zoneId, [upper])).resolves.toEqual(
        new Map([[upper, station(grill)]]),
      );
      // Two spellings of one product: the map carries the FIRST one the caller used, once.
      await expect(resolvePreparationRoutes(tx, cfg, zoneId, [upper, routed.id])).resolves.toEqual(
        new Map([[upper, station(grill)]]),
      );
      await expect(resolvePreparationRoutes(tx, cfg, zoneId, [routed.id, upper])).resolves.toEqual(
        new Map([[routed.id, station(grill)]]),
      );
      await expect(rejection(resolvePreparationRoutes(tx, cfg, zoneId, [braced]))).resolves.toEqual(
        {
          code: "shared.invalid_id",
          params: { kind: "ProductId", value: braced },
        },
      );
      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, zoneId, [unrouted.id.toUpperCase()])),
      ).resolves.toEqual({
        code: "route.missing",
        params: { zoneId, productId: unrouted.id.toUpperCase() },
      });
    });
  });

  it("throws the first failing product's coded error in input order", async () => {
    const { cfg, zoneId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const grill = await insertStation(tx, cfg.locationId, "Grill");
      const closedBar = await insertStation(tx, cfg.locationId, "Closed bar");
      const menu = await createCatalogue(tx, { name: "Errors" });
      const ok = await productWithCategory(tx, menu.id, "Routed");
      const missing = await productWithCategory(tx, menu.id, "Unrouted");
      const inactive = await productWithCategory(tx, menu.id, "Closed");
      await createPreparationRoute(tx, cfg, { productId: ok.id, target: station(grill) });
      await createPreparationRoute(tx, cfg, { productId: inactive.id, target: station(closedBar) });
      await tx.execute(sql`update kitchen_stations set active = false where id = ${closedBar}`);

      const missingRoute = { code: "route.missing", params: { zoneId, productId: missing.id } };
      const inactiveStation = {
        code: "route.station_inactive",
        params: { stationId: closedBar },
      };
      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, zoneId, [ok.id, missing.id, inactive.id])),
      ).resolves.toEqual(missingRoute);
      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, zoneId, [ok.id, inactive.id, missing.id])),
      ).resolves.toEqual(inactiveStation);
      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, zoneId, [missing.id, UNKNOWN_ID])),
      ).resolves.toEqual(missingRoute);
      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, zoneId, [UNKNOWN_ID, missing.id])),
      ).resolves.toEqual({
        code: "route.subject_not_found",
        params: { subject: "product", id: UNKNOWN_ID },
      });
      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, UNKNOWN_ID, [ok.id])),
      ).resolves.toEqual({ code: "service_zone.not_found", params: { zoneId: UNKNOWN_ID } });
    });
  });

  it("ignores another location's routes and stations", async () => {
    const { cfg, zoneId, otherLocationId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const elsewhere = await insertStation(tx, otherLocationId, "Elsewhere");
      const menu = await createCatalogue(tx, { name: "Scoping" });
      const routedElsewhere = await productWithCategory(tx, menu.id, "Routed elsewhere");
      const stationElsewhere = await productWithCategory(tx, menu.id, "Station elsewhere");
      await createPreparationRoute(
        tx,
        { locationId: brandLocationId(otherLocationId) },
        { categoryId: routedElsewhere.categoryId, target: station(elsewhere) },
      );
      // createPreparationRoute refuses a route to another location's station, so it is written directly.
      await tx.execute(sql`
        insert into preparation_routes (id, location_id, product_id, station_id)
        values (${randomUUID()}, ${cfg.locationId}, ${stationElsewhere.id}, ${elsewhere})`);

      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, zoneId, [routedElsewhere.id])),
      ).resolves.toEqual({
        code: "route.missing",
        params: { zoneId, productId: routedElsewhere.id },
      });
      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, zoneId, [stationElsewhere.id])),
      ).resolves.toEqual({ code: "route.station_inactive", params: { stationId: elsewhere } });
    });
  });

  it("issues the same three queries for one product as for five", async () => {
    const { cfg, zoneId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Counting" });
      const expected = new Map<string, unknown>();
      for (const name of ["One", "Two", "Three", "Four", "Five"]) {
        const stationId = await insertStation(tx, cfg.locationId, name);
        const product = await productWithCategory(tx, menu.id, name);
        await createPreparationRoute(tx, cfg, {
          productId: product.id,
          target: station(stationId),
        });
        expected.set(product.id, station(stationId));
      }
      const productIds = [...expected.keys()];
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");

      await expect(resolvePreparationRoutes(tx, cfg, zoneId, [productIds[0]!])).resolves.toEqual(
        new Map([[productIds[0]!, expected.get(productIds[0]!)]]),
      );
      expect(prepared).toHaveBeenCalledTimes(3);

      prepared.mockClear();
      await expect(resolvePreparationRoutes(tx, cfg, zoneId, productIds)).resolves.toEqual(
        expected,
      );
      expect(prepared).toHaveBeenCalledTimes(3);
    });
  });

  it("returns an empty map without querying when there are no products", async () => {
    const { cfg } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      await expect(resolvePreparationRoutes(tx, cfg, UNKNOWN_ID, [])).resolves.toEqual(new Map());
      expect(prepared).not.toHaveBeenCalled();

      // Control: the spy does see this function's queries, so the zero above is not a blind seam.
      await expect(
        rejection(resolvePreparationRoutes(tx, cfg, UNKNOWN_ID, [UNKNOWN_ID])),
      ).resolves.toEqual({ code: "service_zone.not_found", params: { zoneId: UNKNOWN_ID } });
      expect(prepared).toHaveBeenCalledTimes(1);
    });
  });

  it("reports every unroutable product in a zone, in menu order", async () => {
    const { cfg, zoneId, otherZoneId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const grill = await insertStation(tx, cfg.locationId, "Grill");
      const closedBar = await insertStation(tx, cfg.locationId, "Closed bar");
      const menu = await createCatalogue(tx, { name: "Dining" });
      const section = await createMenuSection(tx, {
        menuId: menu.id,
        name: { en: "Everything" },
      });
      const inactive = await productWithCategory(tx, menu.id, "Closed cocktail");
      const ok = await productWithCategory(tx, menu.id, "Steak");
      const missing = await productWithCategory(tx, menu.id, "Mystery dish");
      for (const [displayOrder, product] of [inactive, ok, missing].entries()) {
        await createMenuItem(tx, {
          menuId: menu.id,
          productId: product.id,
          sectionId: section.id,
          grossPrice: "5.00",
          displayOrder,
        });
      }
      await allowMenuInZone(tx, cfg, zoneId, menu.id, { makeDefault: true });
      // The second zone is left without a menu so only the first zone's routes are reported.
      await createPreparationRoute(tx, cfg, { productId: ok.id, target: station(grill) });
      await createPreparationRoute(tx, cfg, { productId: inactive.id, target: station(closedBar) });
      await tx.execute(sql`update kitchen_stations set active = false where id = ${closedBar}`);

      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([
        { code: "zone.menu_missing", zoneId: otherZoneId, zoneName: "Terrace" },
        {
          code: "zone.route_missing",
          zoneId,
          zoneName: "Dining room",
          productId: inactive.id,
          productName: "Closed cocktail",
        },
        {
          code: "zone.route_missing",
          zoneId,
          zoneName: "Dining room",
          productId: missing.id,
          productName: "Mystery dish",
        },
      ]);
    });
  });
});
