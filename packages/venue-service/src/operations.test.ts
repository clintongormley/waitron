import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  addShortcut,
  buildMenuDocument,
  createHomeLayout,
  listHomeLayouts,
  setDeviceHomeLayout,
  createCatalogue,
  createCategory,
  createExtraList,
  createOptionList,
  addMember,
  addProductToMenu,
  createProduct,
  createSectionIn,
  deactivateCatalogue,
  menuDocumentHash,
  publishMenu,
  readMenuStructure,
  setProductVariants,
  updateMenuItem,
  updateOptionList,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  captureError,
  deviceProfiles,
  engineErrorMessage,
  devices,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "@waitron/db";
import type { ZoneMenu, ZoneMenuState } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createException, resolveMakers, setClaim } from "./routing-store.js";
import {
  copyOrderServiceContext,
  copyWorkingLineContext,
  configureZone,
  createDepartment,
  deactivateDepartment,
  allowMenuInZone,
  findOrderServiceContext,
  findOrderServiceModes,
  findOrderServiceZones,
  getOrderServiceContext,
  listDepartmentHours,
  listDepartments,
  listWorkingLineContexts,
  listServiceZones,
  listVenueReadiness,
  listZoneOffers,
  recordOrderServiceContext,
  recordWorkingLineContexts,
  replaceDepartmentHours,
  resolveNewOrderZone,
  resolveZoneContext,
  retargetOrderServiceContext,
  setDeviceDefaultZone,
  clearDeviceDefaultZone,
  listDeviceDefaultZones,
  menuState,
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
    return fn(tx);
  });
}

async function seedLocation(name: string, withDefault = true): Promise<string> {
  const [row] = await db
    .insert(locations)
    .values({ name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  if (withDefault) {
    await db
      .insert(kitchenStations)
      .values({ locationId: brandLocationId(row!.id), name: "Default prep", isDefault: true });
  }
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

/**
 * The drizzle session the two query-count cases below spy on. `session` is marked `@internal`, so
 * it is on the object at runtime and off the published type.
 */
const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }).session;

/** A served menu's version fields, without its structure and layouts. */
const versionOf = ({ id, name, isDefault, versionId }: ZoneMenu) => ({
  id,
  name,
  isDefault,
  versionId,
});
const stateVersionOf = ({ menuId, versionId }: ZoneMenuState["menus"][number]) => ({
  menuId,
  versionId,
});

/** Publishes the menu's working state, as the dashboard's preview-then-publish does; the version id. */
async function publish(tx: Transaction, menuId: string): Promise<string> {
  const { document } = await buildMenuDocument(tx, menuId);
  return (await publishMenu(tx, menuId, menuDocumentHash(document), "person-1")).versionId;
}

/** Makes a copy of the menu's live version, in the document format before VAT was frozen, live. */
async function liveInEarlierFormat(tx: Transaction, menuId: string, versionId: string) {
  const earlier = randomUUID();
  await tx.execute(sql`
    insert into menu_versions (id, menu_id, number, document, content_hash, published_at, published_by)
    select ${earlier}, menu_id, number + 1, json_set(document, '$.format', 1), 'earlier',
      published_at, published_by
    from menu_versions where id = ${versionId}`);
  await tx.execute(
    sql`update menu_publications set version_id = ${earlier} where menu_id = ${menuId}`,
  );
}

async function seedUnitTenant(): Promise<{
  eachUnitId: string;
  kgUnitId: string;
}> {
  // `id` is named because only the insert builder generates one.
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
  it("reports an inactive default station before missing departments", async () => {
    const locationId = brandLocationId(await seedLocation("No departments", false));
    await db.insert(kitchenStations).values({
      locationId,
      name: "Default prep",
      isDefault: true,
      active: false,
    });

    await scoped(async (tx) => {
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        { code: "venue.default_station_missing" },
        { code: "venue.department_missing" },
      ]);
    });
  });

  it("counts a menu reaching a product only through nested sections as not empty", async () => {
    await seedUnitTenant();
    const locationId = brandLocationId(await seedLocation("Venue"));
    const zone = await seedZone(locationId, "Terrace");
    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        { name: "Restaurant", defaultServiceMode: "table_tab" },
      );
      await configureZone(tx, { locationId }, { zoneId: zone, departmentId: department.id });
      const menu = await createCatalogue(tx, { name: "Terrace menu" });
      await allowMenuInZone(tx, { locationId }, zone, menu.id, { makeDefault: true });
      const { rootSectionId } = await readMenuStructure(tx, menu.id);
      const drinks = await createSectionIn(tx, rootSectionId, { internalName: "Drinks" });
      const soft = await createSectionIn(tx, drinks.id, { internalName: "Soft drinks" });
      const menuEmpty = {
        code: "zone.menu_empty",
        zoneId: zone,
        zoneName: "Terrace",
        menuId: menu.id,
        menuName: "Terrace menu",
      };
      // Sections alone sell nothing.
      await publish(tx, menu.id);
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([menuEmpty]);

      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Lemonade",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      await addMember(tx, soft.id, { kind: "product", productId: product.id });
      await publish(tx, menu.id);
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([]);
    });
  });

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
        { code: "zone.menu_unpublished", zoneId: zone, zoneName: "Terrace" },
      ]);
      await publish(tx, menu.id);
      await expect(listVenueReadiness(tx, { locationId })).resolves.toEqual([
        {
          code: "zone.menu_empty",
          zoneId: zone,
          zoneName: "Terrace",
          menuId: menu.id,
          menuName: "Terrace menu",
        },
      ]);

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
      const category = await createCategory(tx, { name: "Cocktails" });
      const negroni = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Negroni",
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
      });
      await createException(
        tx,
        { locationId },
        {
          zoneId: upstairsZone,
          categoryId: category.id,
          productId: null,
          target: { kind: "station", stationId: upstairsBar },
        },
      );
      await createException(
        tx,
        { locationId },
        {
          zoneId: downstairsZone,
          categoryId: category.id,
          productId: null,
          target: { kind: "station", stationId: downstairsBar },
        },
      );

      await expect(
        resolveMakers(
          tx,
          { locationId },
          upstairsZone,
          [negroni.id],
          new Date("2026-10-02T18:30:00Z"),
        ),
      ).resolves.toEqual(
        new Map([
          [negroni.id, { kind: "made", route: { kind: "station", stationId: upstairsBar } }],
        ]),
      );
      await expect(
        resolveMakers(
          tx,
          { locationId },
          downstairsZone,
          [negroni.id],
          new Date("2026-10-02T18:30:00Z"),
        ),
      ).resolves.toEqual(
        new Map([
          [negroni.id, { kind: "made", route: { kind: "station", stationId: downstairsBar } }],
        ]),
      );
    });
  });

  it("inherits service mode, lists zone offers, and freezes the order context", async () => {
    const { kgUnitId } = await seedUnitTenant();
    const location = await seedLocation("Venue");
    const locationId = brandLocationId(location);
    const zone = await seedZone(locationId, "Deli counter");
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
      const category = await createCategory(tx, { name: "Cold cuts" });
      const ham = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Sliced ham",
        pricingUnit: "weight",
        unitPrice: "0.00",
        vatClass: "reduced",
      });
      const offer = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: ham.id,
        grossPrice: "24.90",
      });
      const hiddenMenu = await createCatalogue(tx, { name: "Staff" });
      const hiddenOffer = await addProductToMenu(tx, {
        menuId: hiddenMenu.id,
        productId: ham.id,
        grossPrice: "1.00",
      });
      await allowMenuInZone(tx, { locationId }, zone, menu.id, {
        makeDefault: true,
      });
      const versionId = await publish(tx, menu.id);
      await publish(tx, hiddenMenu.id);
      await tx.execute(sql`
        update zone_service_policies set is_counter_default = true
        where zone_id = ${zone}`);

      await tx.execute(sql`
        insert into working_orders (id, source, location_id, node_id, order_number, opened_at) values ('00000000-0000-4000-8000-000000000001', 'dashboard', ${locationId}, ${nodeId}, 1, ${new Date().toISOString()})`);
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
        // 250 g, counted in whole thousandths.
        quantity: 250,
        unitPriceGross: 2490,
        vatClass: "reduced",
        lineTotal: 623,
        category: "Cold cuts",
      });
      await recordWorkingLineContexts(
        tx,
        { locationId },
        "00000000-0000-4000-8000-000000000001",
        [{ workingOrderLineId: workingLineId, menuItemId: offer.id }],
        await listZoneOffers(tx, { locationId }, zone),
      );
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
      expect(visible.menus.map(versionOf)).toEqual([
        { id: menu.id, name: "Deli takeaway", isDefault: true, versionId },
      ]);
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
      // Published, but on a menu the zone does not sell.
      await expect(
        recordWorkingLineContexts(
          tx,
          { locationId },
          "00000000-0000-4000-8000-000000000001",
          [{ workingOrderLineId: workingLineId, menuItemId: hiddenOffer.id }],
          visible,
        ),
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
        insert into working_orders (id, source, location_id, node_id, order_number, opened_at) values (${copiedOrderId}, 'dashboard', ${locationId}, ${nodeId}, 2, ${new Date().toISOString()})`);
      await tx.insert(workingOrderLines).values({
        id: copiedLineId,
        workingOrderId: copiedOrderId,
        lineNo: 1,
        productId: ham.id,
        name: "Sliced ham",
        descriptions: { "en-GB": "Sliced ham" },
        // 100 g, in thousandths like the line above.
        quantity: 100,
        unitPriceGross: 2490,
        vatClass: "reduced",
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
    await seedUnitTenant();
    const location = await seedLocation("Venue");
    const locationId = brandLocationId(location);
    const zone = await seedZone(locationId, "Deli counter");
    const nodeId = await seedNode(db, locationId);

    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        { name: "Deli", defaultServiceMode: "prepay" },
      );
      await configureZone(tx, { locationId }, { zoneId: zone, departmentId: department.id });
      const menu = await createCatalogue(tx, { name: "Deli takeaway" });
      // Deleting its product_units row makes the offer read resolve it to the synthetic Each unit.
      const sweets = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Loose sweets",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      await tx.execute(sql`delete from product_units where product_id = ${sweets.id}`);
      const offer = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: sweets.id,
        grossPrice: "1.20",
      });
      await allowMenuInZone(tx, { locationId }, zone, menu.id, {
        makeDefault: true,
      });
      await publish(tx, menu.id);
      await tx.execute(sql`
        update zone_service_policies set is_counter_default = true
        where zone_id = ${zone}`);

      const orderId = "00000000-0000-4000-8000-000000000101";
      const workingLineId = "00000000-0000-4000-8000-000000000102";
      await tx.execute(sql`
        insert into working_orders (id, source, location_id, node_id, order_number, opened_at)
        values (${orderId}, 'dashboard', ${locationId}, ${nodeId}, 1, ${new Date().toISOString()})`);
      await recordOrderServiceContext(tx, { locationId }, orderId, zone);
      await tx.insert(workingOrderLines).values({
        id: workingLineId,
        workingOrderId: orderId,
        lineNo: 1,
        productId: sweets.id,
        name: "Loose sweets",
        descriptions: { "en-GB": "Loose sweets" },
        quantity: 1000,
        unitPriceGross: 120,
        vatClass: "reduced",
        lineTotal: 120,
        category: "Uncategorised",
      });

      await expect(
        recordWorkingLineContexts(
          tx,
          { locationId },
          orderId,
          [{ workingOrderLineId: workingLineId, menuItemId: offer.id }],
          await listZoneOffers(tx, { locationId }, zone),
        ),
      ).resolves.not.toThrow();

      const ctx = await tx.execute<{ unit_id: string }>(sql`
        select unit_id from working_line_contexts
        where working_order_line_id = ${workingLineId}`);
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
      const versionId = await publish(tx, menu.id);
      const terrace = await listZoneOffers(tx, { locationId }, zone);
      expect({ ...terrace, menus: terrace.menus.map(versionOf) }).toEqual({
        defaultMenuId: null,
        menus: [{ id: menu.id, name: "Terrace", isDefault: false, versionId }],
        offers: [],
      });
      await expect(
        getOrderServiceContext(tx, { locationId }, "00000000-0000-4000-8000-000000000099"),
      ).rejects.toMatchObject({ code: "order.service_context_missing" });
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
  const category = withCategory ? await createCategory(tx, { name: `${name} category` }) : null;
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

describe("routing outcomes and menu readiness", () => {
  it("uses a matching exception ahead of its folder claim and keeps the claim in another zone", async () => {
    const { cfg, zoneId, otherZoneId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const kitchen = await insertStation(tx, cfg.locationId, "Kitchen");
      const bar = await insertStation(tx, cfg.locationId, "Bar");
      const menu = await createCatalogue(tx, { name: "Drinks" });
      const cocktail = await productWithCategory(tx, menu.id, "Cocktail");
      await setClaim(tx, cfg, cocktail.categoryId, station(kitchen));
      await createException(tx, cfg, {
        zoneId,
        categoryId: null,
        productId: cocktail.id,
        target: station(bar),
      });

      await expect(
        resolveMakers(tx, cfg, zoneId, [cocktail.id], new Date("2026-10-02T18:30:00Z")),
      ).resolves.toEqual(new Map([[cocktail.id, { kind: "made", route: station(bar) }]]));
      await expect(
        resolveMakers(tx, cfg, otherZoneId, [cocktail.id], new Date("2026-10-02T18:30:00Z")),
      ).resolves.toEqual(new Map([[cocktail.id, { kind: "made", route: station(kitchen) }]]));
    });
  });

  it("treats a switched-off folder claim without a fallback as a dead end", async () => {
    const { cfg, zoneId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const kitchen = await insertStation(tx, cfg.locationId, "Kitchen");
      const closedGrill = await insertStation(tx, cfg.locationId, "Closed grill");
      const parent = await createCategory(tx, { name: "Food" });
      const child = await createCategory(tx, { name: "Grilled", parentId: parent.id });
      const menu = await createCatalogue(tx, { name: "Menu" });
      const steak = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: child.id,
        name: "Steak",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      await setClaim(tx, cfg, parent.id, station(kitchen));
      await setClaim(tx, cfg, child.id, station(closedGrill));
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, closedGrill));

      await expect(
        resolveMakers(tx, cfg, zoneId, [steak.id], new Date("2026-10-02T18:30:00Z")),
      ).resolves.toEqual(new Map([[steak.id, { kind: "no_replacement", stationId: closedGrill }]]));
    });
  });

  // A sold-out product remains visible and still fills the live menu.
  it("serves an Unavailable product marked while readiness still judges its setup", async () => {
    const { cfg, zoneId, otherZoneId } = await seedRoutingVenue();
    await scoped(async (tx) => {
      const menu = await createCatalogue(tx, { name: "Tapas" });
      const croquetas = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Croquetas",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
        available: false,
      });
      const offer = await addProductToMenu(tx, {
        menuId: menu.id,
        productId: croquetas.id,
        grossPrice: "6.00",
      });
      await allowMenuInZone(tx, cfg, zoneId, menu.id, { makeDefault: true });
      await publish(tx, menu.id);

      const served = (await listZoneOffers(tx, cfg, zoneId)).offers;
      expect(served.map((row) => [row.id, row.available])).toEqual([[offer.id, false]]);
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([
        { code: "zone.menu_missing", zoneId: otherZoneId, zoneName: "Terrace" },
      ]);

      await tx.execute(sql`update products set available = true where id = ${croquetas.id}`);
      expect(
        (await listZoneOffers(tx, cfg, zoneId)).offers.map((row) => [row.id, row.available]),
      ).toEqual([[offer.id, true]]);
    });
  });
});

describe("departments", () => {
  it("gives a newly configured zone blank quick-sale and receipt overrides", async () => {
    const locationId = brandLocationId(await seedLocation("Zone policy defaults"));
    const zoneId = await seedZone(locationId, "Terrace");
    await scoped(async (tx) => {
      const department = await createDepartment(
        tx,
        { locationId },
        {
          name: "Restaurant",
          defaultServiceMode: "prepay",
        },
      );
      await configureZone(tx, { locationId }, { zoneId, departmentId: department.id });
    });

    const policies = await db.execute<{
      paid_when: string | null;
      collection_number: string | null;
      receipt_print_mode: string | null;
    }>(sql`
      select paid_when, collection_number, receipt_print_mode
      from zone_sale_policies where zone_id = ${zoneId}`);
    expect(policies.rows).toEqual([
      { paid_when: null, collection_number: null, receipt_print_mode: null },
    ]);
  });

  it("gives a newly created department the quick-sale and receipt defaults", async () => {
    const cfg = { locationId: brandLocationId(await seedLocation("New department policies")) };
    const department = await scoped((tx) =>
      createDepartment(tx, cfg, { name: "Terrace", defaultServiceMode: "prepay" }),
    );

    const policies = await db.execute<{
      paid_when: string;
      collection_number: string;
      receipt_print_mode: string;
      print_trading_name: number;
    }>(sql`
      select paid_when, collection_number, receipt_print_mode, print_trading_name
      from department_sale_policies where department_id = ${department.id}`);
    expect(policies.rows).toEqual([
      {
        paid_when: "prepay",
        collection_number: "none",
        receipt_print_mode: "auto",
        print_trading_name: 1,
      },
    ]);
  });

  it("refuses hours and deactivation for a department outside this venue, and an empty set clears the hours", async () => {
    const here = { locationId: brandLocationId(await seedLocation("Venue")) };
    const there = { locationId: brandLocationId(await seedLocation("Second venue")) };
    await scoped(async (tx) => {
      const department = await createDepartment(tx, here, {
        name: "Restaurant",
        defaultServiceMode: "table_tab",
      });
      const elsewhere = await createDepartment(tx, there, {
        name: "Elsewhere",
        defaultServiceMode: "table_tab",
      });
      const openingHours = [{ weekday: 1, opensAt: "09:00", closesAt: "17:00" }];
      await replaceDepartmentHours(tx, here, department.id, openingHours);
      await replaceDepartmentHours(tx, there, elsewhere.id, openingHours);

      for (const departmentId of [elsewhere.id, UNKNOWN_ID]) {
        const notFound = { code: "department.not_found", params: { departmentId } };
        await expect(
          rejection(replaceDepartmentHours(tx, here, departmentId, [])),
        ).resolves.toEqual(notFound);
        await expect(rejection(deactivateDepartment(tx, here, departmentId))).resolves.toEqual(
          notFound,
        );
      }
      await expect(listDepartmentHours(tx, there)).resolves.toEqual([
        { departmentId: elsewhere.id, weekday: 1, opensAt: "09:00:00", closesAt: "17:00:00" },
      ]);
      await expect(listDepartments(tx, there)).resolves.toEqual([
        expect.objectContaining({ id: elsewhere.id, active: true }),
      ]);

      await replaceDepartmentHours(tx, here, department.id, []);
      await expect(listDepartmentHours(tx, here)).resolves.toEqual([]);
    });
  });
});

/** A venue selling one product from one menu in two zones, each zone under its own department. */
async function seedSellingVenue() {
  await seedUnitTenant();
  const locationId = brandLocationId(await seedLocation("Venue"));
  const cfg = { locationId };
  const diningZone = await seedZone(locationId, "Dining room");
  const barZone = await seedZone(locationId, "Bar");
  const nodeId = await seedNode(db, locationId);
  return scoped(async (tx) => {
    const restaurant = await createDepartment(tx, cfg, {
      name: "Restaurant",
      defaultServiceMode: "table_tab",
    });
    const bar = await createDepartment(tx, cfg, { name: "Bar", defaultServiceMode: "table_tab" });
    await configureZone(tx, cfg, { zoneId: diningZone, departmentId: restaurant.id });
    await configureZone(tx, cfg, { zoneId: barZone, departmentId: bar.id, serviceMode: "prepay" });
    const menu = await createCatalogue(tx, { name: "All day" });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Tortilla",
      pricingUnit: "each",
      unitPrice: "0.00",
      vatClass: "general",
    });
    const offer = await addProductToMenu(tx, {
      menuId: menu.id,
      productId: product.id,
      grossPrice: "4.50",
    });
    for (const zoneId of [diningZone, barZone]) {
      await allowMenuInZone(tx, cfg, zoneId, menu.id, { makeDefault: true });
    }
    const versionId = await publish(tx, menu.id);
    return {
      cfg,
      menuId: menu.id,
      versionId,
      diningZone,
      barZone,
      restaurantId: restaurant.id,
      barId: bar.id,
      productId: product.id,
      menuItemId: offer.id,
      nodeId,
    };
  });
}

type SellingVenue = Awaited<ReturnType<typeof seedSellingVenue>>;

async function openOrder(tx: Transaction, venue: SellingVenue, orderNumber: number) {
  const id = randomUUID();
  await tx.execute(sql`
    insert into working_orders (id, source, location_id, node_id, order_number, opened_at)
    values (${id}, 'dashboard', ${venue.cfg.locationId}, ${venue.nodeId}, ${orderNumber}, ${new Date().toISOString()})`);
  return id;
}

async function addLine(tx: Transaction, venue: SellingVenue, orderId: string, lineNo: number) {
  const id = randomUUID();
  await tx.insert(workingOrderLines).values({
    id,
    workingOrderId: orderId,
    lineNo,
    productId: venue.productId,
    name: "Tortilla",
    descriptions: { "en-GB": "Tortilla" },
    quantity: 1000,
    unitPriceGross: 450,
    vatClass: "reduced",
    lineTotal: 450,
    category: "Uncategorised",
  });
  return id;
}

async function seedDevice(venue: SellingVenue, label: string): Promise<string> {
  const [profile] = await db
    .insert(deviceProfiles)
    .values({ name: label, formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  const [device] = await db
    .insert(devices)
    .values({
      locationId: venue.cfg.locationId,
      deviceProfileId: profile!.id,
      label,
      tokenHash: "scrypt$00$00",
    })
    .returning({ id: devices.id });
  return device!.id;
}

describe("order service context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns to the counter default after a device default is cleared", async () => {
    const venue = await seedSellingVenue();
    const deviceId = await seedDevice(venue, "Bar till");
    await scoped(async (tx) => {
      await tx.execute(
        sql`update zone_service_policies set is_counter_default = true where zone_id = ${venue.diningZone}`,
      );
      await setDeviceDefaultZone(tx, venue.cfg, deviceId, venue.barZone);
      expect(await listDeviceDefaultZones(tx, venue.cfg)).toContainEqual({
        deviceId,
        zoneId: venue.barZone,
      });
      await clearDeviceDefaultZone(tx, venue.cfg, deviceId);
      await clearDeviceDefaultZone(tx, venue.cfg, deviceId);
      expect(await listDeviceDefaultZones(tx, venue.cfg)).not.toContainEqual(
        expect.objectContaining({ deviceId }),
      );
      expect(await resolveNewOrderZone(tx, venue.cfg, { deviceId })).toMatchObject({
        zoneId: venue.diningZone,
      });
    });
  });

  it("starts a device's new order in its own default zone ahead of the venue's counter default", async () => {
    const venue = await seedSellingVenue();
    const { cfg } = venue;
    const counterTill = await seedDevice(venue, "Counter till");
    const barTill = await seedDevice(venue, "Bar till");
    await scoped(async (tx) => {
      await tx.execute(sql`
        update zone_service_policies set is_counter_default = true
        where zone_id = ${venue.diningZone}`);
      // Set twice: the second call re-points the device rather than keeping its first zone.
      await setDeviceDefaultZone(tx, cfg, barTill, venue.diningZone);
      await setDeviceDefaultZone(tx, cfg, barTill, venue.barZone);

      await expect(resolveNewOrderZone(tx, cfg, { deviceId: barTill })).resolves.toEqual({
        zoneId: venue.barZone,
        departmentId: venue.barId,
        departmentName: "Bar",
        serviceMode: "prepay",
        defaultMenuId: expect.any(String),
      });
      await expect(resolveNewOrderZone(tx, cfg, { deviceId: counterTill })).resolves.toMatchObject({
        zoneId: venue.diningZone,
        departmentId: venue.restaurantId,
      });
    });
  });

  it("moves an order onto another zone's department and service mode, keeping its line snapshots", async () => {
    const venue = await seedSellingVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const orderId = await openOrder(tx, venue, 1);
      await recordOrderServiceContext(tx, cfg, orderId, venue.diningZone);
      const lineId = await addLine(tx, venue, orderId, 1);
      await recordWorkingLineContexts(
        tx,
        cfg,
        orderId,
        [{ workingOrderLineId: lineId, menuItemId: venue.menuItemId }],
        await listZoneOffers(tx, cfg, venue.diningZone),
      );

      await retargetOrderServiceContext(tx, cfg, orderId, venue.barZone);

      await expect(getOrderServiceContext(tx, cfg, orderId)).resolves.toEqual({
        zoneId: venue.barZone,
        departmentId: venue.barId,
        serviceMode: "prepay",
      });
      const snapshot = await tx.execute<{ department_id: string; department_name: string }>(sql`
        select department_id, department_name from working_line_contexts
        where working_order_line_id = ${lineId}`);
      expect(snapshot.rows).toEqual([
        { department_id: venue.restaurantId, department_name: "Restaurant" },
      ]);
    });
  });

  it("records nothing for an empty round, even on an order that has no service context", async () => {
    const venue = await seedSellingVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const orderId = await openOrder(tx, venue, 1);
      const offers = await listZoneOffers(tx, cfg, venue.diningZone);
      await expect(
        recordWorkingLineContexts(tx, cfg, orderId, [], offers),
      ).resolves.toBeUndefined();

      // Control: a round with a line on the same order needs the context the order lacks.
      const lineId = await addLine(tx, venue, orderId, 1);
      await expect(
        rejection(
          recordWorkingLineContexts(
            tx,
            cfg,
            orderId,
            [{ workingOrderLineId: lineId, menuItemId: venue.menuItemId }],
            offers,
          ),
        ),
      ).resolves.toEqual({
        code: "order.service_context_missing",
        params: { workingOrderId: orderId },
      });
      await expect(listWorkingLineContexts(tx, cfg, orderId)).resolves.toEqual([]);
    });
  });

  it("resolves a menu item once however many lines of the round share it", async () => {
    const venue = await seedSellingVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const orderId = await openOrder(tx, venue, 1);
      await recordOrderServiceContext(tx, cfg, orderId, venue.diningZone);
      const [first, second, third] = [
        await addLine(tx, venue, orderId, 1),
        await addLine(tx, venue, orderId, 2),
        await addLine(tx, venue, orderId, 3),
      ];
      const line = (workingOrderLineId: string) => ({
        workingOrderLineId,
        menuItemId: venue.menuItemId,
      });
      const offers = await listZoneOffers(tx, cfg, venue.diningZone);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");

      await recordWorkingLineContexts(tx, cfg, orderId, [line(first!)], offers);
      const oneLine = prepared.mock.calls.length;
      prepared.mockClear();
      await recordWorkingLineContexts(tx, cfg, orderId, [line(second!), line(third!)], offers);
      expect(prepared).toHaveBeenCalledTimes(oneLine);

      const recorded = await listWorkingLineContexts(tx, cfg, orderId);
      expect(recorded.map((row) => [row.workingOrderLineId, row.menuItemId]).sort()).toEqual(
        [first!, second!, third!].map((id) => [id, venue.menuItemId]).sort(),
      );
    });
  });

  it("copies no snapshot from an order or a line that never had one", async () => {
    const venue = await seedSellingVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const from = await openOrder(tx, venue, 1);
      const to = await openOrder(tx, venue, 2);
      const fromLine = await addLine(tx, venue, from, 1);
      const toLine = await addLine(tx, venue, to, 1);

      await expect(copyOrderServiceContext(tx, cfg, from, to)).resolves.toBeUndefined();
      await expect(copyWorkingLineContext(tx, cfg, fromLine, toLine)).resolves.toBeUndefined();

      await expect(findOrderServiceContext(tx, cfg, to)).resolves.toBeNull();
      await expect(listWorkingLineContexts(tx, cfg, to)).resolves.toEqual([]);
    });
  });
});

const NO_ICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WITH_ICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * {@link seedSellingVenue}'s dining room with a second published menu, Dinner, after All day:
 * Lemonade at 3.00 with its Large variant, an extras list offering Extra lemon and Extra mint, and
 * an options list; and Burger.
 */
async function seedTwoMenuVenue() {
  const venue = await seedSellingVenue();
  const { cfg } = venue;
  return scoped(async (tx) => {
    const dinner = await createCatalogue(tx, { name: "Dinner" });
    const make = async (name: string, unitPrice: string) =>
      (
        await createProduct(tx, {
          catalogueId: dinner.id,
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
          allergens: {},
        })
      ).id;
    const lemonade = await make("Lemonade", "3.00");
    const [large] = await setProductVariants(
      tx,
      lemonade,
      [
        {
          name: "Large",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "3.50",
          available: true,
        },
      ],
      "en",
    );
    const burger = await make("Burger", "12.00");
    const extraLemon = await make("Extra lemon", "0.50");
    const extraMint = await make("Extra mint", "0.50");
    const offMenu = await make("Off menu", "1.00");
    const extrasList = (
      await createExtraList(
        tx,
        {
          name: "Extras",
          minPicks: 0,
          maxPicks: 2,
          items: [
            { productId: extraLemon, price: "0.40" },
            { productId: extraMint, price: "0.40" },
          ],
        },
        "en",
      )
    ).id;
    const iceList = (
      await createOptionList(
        tx,
        {
          name: "Ice",
          defaultLabelId: NO_ICE,
          labels: [
            { id: NO_ICE, name: "No ice", available: true },
            { id: WITH_ICE, name: "With ice", available: true },
          ],
        },
        "en",
      )
    ).id;
    await writeProductModifiers(tx, lemonade, [
      { kind: "extras", id: extrasList },
      { kind: "options", id: iceList },
    ]);
    const lemonadeOffer = (await addProductToMenu(tx, { menuId: dinner.id, productId: lemonade }))
      .id;

    const burgerOffer = (await addProductToMenu(tx, { menuId: dinner.id, productId: burger })).id;
    await allowMenuInZone(tx, cfg, venue.diningZone, dinner.id, { displayOrder: 1 });
    return {
      ...venue,
      dinner: dinner.id,
      dinnerVersionId: await publish(tx, dinner.id),
      lemonade,
      large: large!.id,
      burger,
      extraLemon,
      extraMint,
      offMenu,
      extrasList,
      iceList,
      lemonadeOffer,
      burgerOffer,
    };
  });
}

describe("zone offers from the published menus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records a round's line snapshots in as many queries however many distinct offers it holds", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const orderId = await openOrder(tx, venue, 1);
      await recordOrderServiceContext(tx, cfg, orderId, venue.diningZone);
      const lineIds = [];
      for (const lineNo of [1, 2, 3, 4]) lineIds.push(await addLine(tx, venue, orderId, lineNo));
      const offers = await listZoneOffers(tx, cfg, venue.diningZone);
      const round = (lines: { workingOrderLineId: string; menuItemId: string }[]) =>
        recordWorkingLineContexts(tx, cfg, orderId, lines, offers);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");

      await round([{ workingOrderLineId: lineIds[0]!, menuItemId: venue.menuItemId }]);
      const oneOffer = prepared.mock.calls.length;
      prepared.mockClear();
      // Three different offers, from two menus' versions.
      await round([
        { workingOrderLineId: lineIds[1]!, menuItemId: venue.menuItemId },
        { workingOrderLineId: lineIds[2]!, menuItemId: venue.lemonadeOffer },
        { workingOrderLineId: lineIds[3]!, menuItemId: venue.burgerOffer },
      ]);
      expect(prepared).toHaveBeenCalledTimes(oneOffer);
    });
  });

  it("records the version each line's offer was served from, and refuses an offer the snapshot lacks", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const orderId = await openOrder(tx, venue, 1);
      await recordOrderServiceContext(tx, cfg, orderId, venue.diningZone);
      const [allDay, dinner, stranger] = [
        await addLine(tx, venue, orderId, 1),
        await addLine(tx, venue, orderId, 2),
        await addLine(tx, venue, orderId, 3),
      ];
      const offers = await listZoneOffers(tx, cfg, venue.diningZone);
      await recordWorkingLineContexts(
        tx,
        cfg,
        orderId,
        [
          { workingOrderLineId: allDay!, menuItemId: venue.menuItemId },
          { workingOrderLineId: dinner!, menuItemId: venue.burgerOffer },
        ],
        offers,
      );
      const recorded = await tx.execute<{ working_order_line_id: string; menu_version_id: string }>(
        sql`select working_order_line_id, menu_version_id from working_line_contexts`,
      );
      expect(
        recorded.rows.map((row) => [row.working_order_line_id, row.menu_version_id]).sort(),
      ).toEqual(
        [
          [allDay, venue.versionId],
          [dinner, venue.dinnerVersionId],
        ].sort(),
      );

      await expect(
        rejection(
          recordWorkingLineContexts(
            tx,
            cfg,
            orderId,
            [{ workingOrderLineId: stranger!, menuItemId: UNKNOWN_ID }],
            offers,
          ),
        ),
      ).resolves.toEqual({
        code: "service_zone.offer_not_allowed",
        params: { zoneId: venue.diningZone, menuItemId: UNKNOWN_ID },
      });

      await expect(
        recordWorkingLineContexts(
          tx,
          cfg,
          orderId,
          [{ workingOrderLineId: stranger!, menuItemId: venue.menuItemId }],
          { ...offers, menus: [] },
        ),
      ).rejects.toThrow(/no live version/);

      const noSuchVersion = await captureError(() =>
        recordWorkingLineContexts(
          tx,
          cfg,
          orderId,
          [{ workingOrderLineId: stranger!, menuItemId: venue.menuItemId }],
          { ...offers, menus: offers.menus.map((menu) => ({ ...menu, versionId: UNKNOWN_ID })) },
        ),
      );
      expect(engineErrorMessage(noSuchVersion)).toContain("FOREIGN KEY constraint failed");
    });
  });

  it("serves each menu's live version, not its working state, with the version id", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await updateMenuItem(tx, venue.dinner, venue.lemonadeOffer, { grossPrice: "2.50" });
      await updateProduct(tx, venue.lemonade, {
        allergens: { sulphites: { presence: "contains" } },
      });

      const served = await listZoneOffers(tx, cfg, venue.diningZone);
      expect(served.menus.map(versionOf)).toEqual([
        { id: venue.menuId, name: "All day", isDefault: true, versionId: venue.versionId },
        { id: venue.dinner, name: "Dinner", isDefault: false, versionId: venue.dinnerVersionId },
      ]);
      const lemonade = served.offers.find((offer) => offer.id === venue.lemonadeOffer)!;
      expect(lemonade).toMatchObject({ unitPrice: "3.00", allergens: {}, available: true });

      const republished = await publish(tx, venue.dinner);
      const after = await listZoneOffers(tx, cfg, venue.diningZone);
      expect(after.menus[1]).toMatchObject({ id: venue.dinner, versionId: republished });
      expect(after.offers.find((offer) => offer.id === venue.lemonadeOffer)).toMatchObject({
        unitPrice: "2.50",
        allergens: { sulphites: { presence: "contains" } },
      });
    });
  });

  it("serves the VAT class the live version froze, and no rate, until the menu is republished", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await updateProduct(tx, venue.lemonade, { vatClass: "reduced" });
      await updateProduct(tx, venue.extraLemon, { vatClass: "super_reduced" });
      const lemonadeOf = async () =>
        (await listZoneOffers(tx, cfg, venue.diningZone)).offers.find(
          (offer) => offer.id === venue.lemonadeOffer,
        )!;
      const frozen = { vatClass: "general" };
      const served = await lemonadeOf();
      expect(served).toMatchObject(frozen);
      expect(served).not.toHaveProperty("vatRate");
      expect(served.variants[0]).toMatchObject(frozen);
      const extras = served.offeredModifiers[0]!;
      expect(extras.kind === "extras" && extras.items[0]).toMatchObject(frozen);

      await publish(tx, venue.dinner);
      const republished = await lemonadeOf();
      expect(republished).toMatchObject({ vatClass: "reduced" });
      expect(republished.variants[0]).toMatchObject({ vatClass: "reduced" });
      const after = republished.offeredModifiers[0]!;
      expect(after.kind === "extras" && after.items[0]).toMatchObject({
        vatClass: "super_reduced",
      });
    });
  });

  it("sells nothing from a live version published before its document froze VAT", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await liveInEarlierFormat(tx, venue.dinner, venue.dinnerVersionId);
      const served = await listZoneOffers(tx, cfg, venue.diningZone);
      expect(served.menus.map((menu) => menu.id)).toEqual([venue.menuId]);
      expect(served.offers.map((offer) => offer.id)).toEqual([venue.menuItemId]);
      expect((await menuState(tx, venue.diningZone)).menus.map(stateVersionOf)).toEqual([
        { menuId: venue.menuId, versionId: venue.versionId },
      ]);
    });
  });

  it("serves an unavailable or inactive product marked, in its place", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const before = (await listZoneOffers(tx, cfg, venue.diningZone)).offers.map((o) => o.id);
      expect(before).toEqual([venue.menuItemId, venue.lemonadeOffer, venue.burgerOffer]);
      await updateProduct(tx, venue.lemonade, { available: false });
      await updateProduct(tx, venue.burger, { active: false });

      const served = (await listZoneOffers(tx, cfg, venue.diningZone)).offers;
      expect(served.map((offer) => [offer.id, offer.available])).toEqual([
        [venue.menuItemId, true],
        [venue.lemonadeOffer, false],
        [venue.burgerOffer, false],
      ]);
    });
  });

  it("leaves a zone's unpublished menus out, and falls back to its first published menu", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const brunch = await createCatalogue(tx, { name: "Brunch" });
      await allowMenuInZone(tx, cfg, venue.diningZone, brunch.id, { makeDefault: true });
      const served = await listZoneOffers(tx, cfg, venue.diningZone);
      expect(served.defaultMenuId).toBe(venue.menuId);
      expect(served.menus.map((menu) => [menu.id, menu.isDefault])).toEqual([
        [venue.menuId, true],
        [venue.dinner, false],
      ]);

      // The bar zone sells All day alone; with only an unpublished menu it sells nothing.
      await allowMenuInZone(tx, cfg, venue.barZone, brunch.id, { makeDefault: true });
      await tx.execute(
        sql`delete from zone_menus where zone_id = ${venue.barZone} and menu_id = ${venue.menuId}`,
      );
      await expect(listZoneOffers(tx, cfg, venue.barZone)).resolves.toEqual({
        defaultMenuId: null,
        menus: [],
        offers: [],
      });
    });
  });

  it("reports a zone whose menus are all unpublished, and judges emptiness on the live version", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([]);

      const brunch = await createCatalogue(tx, { name: "Brunch" });
      await allowMenuInZone(tx, cfg, venue.barZone, brunch.id, { makeDefault: true });
      await tx.execute(
        sql`delete from zone_menus where zone_id = ${venue.barZone} and menu_id = ${venue.menuId}`,
      );
      // The dining room's unpublished Brunch is beside published menus, so it is not reported.
      await allowMenuInZone(tx, cfg, venue.diningZone, brunch.id);
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([
        { code: "zone.menu_unpublished", zoneId: venue.barZone, zoneName: "Bar" },
      ]);

      await publish(tx, brunch.id);
      const brunchEmpty = (zoneId: string, zoneName: string) => ({
        code: "zone.menu_empty",
        zoneId,
        zoneName,
        menuId: brunch.id,
        menuName: "Brunch",
      });
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([
        brunchEmpty(venue.barZone, "Bar"),
        brunchEmpty(venue.diningZone, "Dining room"),
      ]);

      // Added to the working state only: the live version is still empty.
      await addProductToMenu(tx, { menuId: brunch.id, productId: venue.burger });
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([
        brunchEmpty(venue.barZone, "Bar"),
        brunchEmpty(venue.diningZone, "Dining room"),
      ]);
      await publish(tx, brunch.id);
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([]);
    });
  });

  it("reports a zone whose only published menu is live in the format before VAT was frozen", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([]);
      // The bar sells All day alone; the dining room still has Dinner in the current format.
      await liveInEarlierFormat(tx, venue.menuId, venue.versionId);
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([
        { code: "zone.menu_unpublished", zoneId: venue.barZone, zoneName: "Bar" },
      ]);
    });
  });

  it("sells nothing from a published menu once it is deactivated, and keeps selling an active one beside it", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await deactivateCatalogue(tx, venue.menuId);

      const dining = await listZoneOffers(tx, cfg, venue.diningZone);
      expect(dining.defaultMenuId).toBe(venue.dinner);
      expect(dining.menus.map((menu) => menu.id)).toEqual([venue.dinner]);
      expect(dining.offers.map((offer) => offer.id)).toEqual([
        venue.lemonadeOffer,
        venue.burgerOffer,
      ]);
      expect((await menuState(tx, venue.diningZone)).menus.map(stateVersionOf)).toEqual([
        { menuId: venue.dinner, versionId: venue.dinnerVersionId },
      ]);
      await expect(
        rejection(
          listZoneOffers(tx, cfg, venue.diningZone, {
            asserted: [{ menuId: venue.menuId, versionId: venue.versionId }],
          }),
        ),
      ).resolves.toEqual({
        code: "menu.version_changed",
        params: { menus: [{ menuId: venue.menuId, liveVersionId: null }] },
      });

      // The bar sells All day alone.
      await expect(listZoneOffers(tx, cfg, venue.barZone)).resolves.toEqual({
        defaultMenuId: null,
        menus: [],
        offers: [],
      });
    });
  });

  it("reports a zone whose only published menu is deactivated", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([]);
      // The bar sells All day alone; the dining room still has Dinner, which stays active.
      await deactivateCatalogue(tx, venue.menuId);
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([
        { code: "zone.menu_unpublished", zoneId: venue.barZone, zoneName: "Bar" },
      ]);
    });
  });

  it("lists what the zone's live menus hold that cannot be sold now, one query per table", async () => {
    const venue = await seedTwoMenuVenue();
    await scoped(async (tx) => {
      const menus = [
        { menuId: venue.menuId, versionId: venue.versionId },
        { menuId: venue.dinner, versionId: venue.dinnerVersionId },
      ];
      const before = await menuState(tx, venue.diningZone);
      expect({ ...before, menus: before.menus.map(stateVersionOf) }).toEqual({
        menus,
        unavailable: { products: [], optionLabels: [] },
      });

      await updateProduct(tx, venue.burger, { available: false });
      await updateProduct(tx, venue.productId, { active: false });
      await tx.execute(sql`update products set available = false where id = ${venue.large}`);
      await updateProduct(tx, venue.extraMint, { available: false });
      await updateProduct(tx, venue.offMenu, { available: false });
      await updateOptionList(
        tx,
        venue.iceList,
        {
          name: "Ice",
          defaultLabelId: NO_ICE,
          labels: [
            { id: NO_ICE, name: "No ice", available: true },
            { id: WITH_ICE, name: "With ice", available: false },
          ],
        },
        "en",
      );
      // Neither is in a live version: a list the offer publishes only in its working state, and a
      // list no offer carries.
      const sides = (
        await createExtraList(
          tx,
          { name: "Sides", minPicks: 0, maxPicks: 1, items: [{ productId: venue.burger }] },
          "en",
        )
      ).id;
      await writeProductModifiers(tx, venue.lemonade, [
        { kind: "extras", id: venue.extrasList },
        { kind: "extras", id: sides },
        { kind: "options", id: venue.iceList },
      ]);
      await createOptionList(
        tx,
        {
          name: "Sauce",
          labels: [
            { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Aioli", available: false },
            { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Ketchup", available: true },
          ],
        },
        "en",
      );

      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      const { menus: served, unavailable } = await menuState(tx, venue.diningZone);
      expect(prepared).toHaveBeenCalledTimes(4);
      expect(served.map(stateVersionOf)).toEqual(menus);
      expect({ ...unavailable, products: [...unavailable.products].sort() }).toEqual({
        products: [venue.productId, venue.burger, venue.large, venue.extraMint].sort(),
        optionLabels: [WITH_ICE],
      });
      await expect(menuState(tx, UNKNOWN_ID)).resolves.toEqual({
        menus: [],
        unavailable: { products: [], optionLabels: [] },
      });
    });
  });

  it("lists an option label deleted since publishing, which the served offer marks unavailable", async () => {
    const venue = await seedTwoMenuVenue();
    await scoped(async (tx) => {
      await updateOptionList(
        tx,
        venue.iceList,
        {
          name: "Ice",
          defaultLabelId: NO_ICE,
          labels: [{ id: NO_ICE, name: "No ice", available: true }],
        },
        "en",
      );
      expect((await menuState(tx, venue.diningZone)).unavailable.optionLabels).toEqual([WITH_ICE]);
      const lemonade = (await listZoneOffers(tx, venue.cfg, venue.diningZone)).offers.find(
        (offer) => offer.id === venue.lemonadeOffer,
      )!;
      const ice = lemonade.offeredModifiers.find((entry) => entry.kind === "options")!;
      expect(
        ice.kind === "options" && ice.labels.map((label) => [label.id, label.available]),
      ).toEqual([
        [NO_ICE, true],
        [WITH_ICE, false],
      ]);
    });
  });

  it("serves only the offers named, as the whole zone serves them, with every menu listed", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await updateProduct(tx, venue.extraMint, { available: false });
      const whole = await listZoneOffers(tx, cfg, venue.diningZone);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      const named = await listZoneOffers(tx, cfg, venue.diningZone, {
        menuItemIds: [venue.lemonadeOffer, UNKNOWN_ID],
      });
      expect(named).toEqual({
        ...whole,
        offers: whole.offers.filter((offer) => offer.id === venue.lemonadeOffer),
      });
      // The live rows are read for the named offer's products alone.
      const productReads = prepared.mock.calls
        .map(([query]) => query as unknown as { sql: string; params: unknown[] })
        .filter((query) => /from "products"/.test(query.sql));
      expect(productReads).toHaveLength(1);
      expect(productReads[0]!.params).not.toContain(venue.burger);
      expect(productReads[0]!.params).toContain(venue.lemonade);
    });
  });

  it("reads the live versions once for every zone, however many share a menu", async () => {
    const venue = await seedTwoMenuVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      await allowMenuInZone(tx, cfg, venue.barZone, venue.dinner);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      await expect(listVenueReadiness(tx, cfg)).resolves.toEqual([]);
      const sqlOf = prepared.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
      expect(sqlOf.filter((text) => /from "menu_publications"/.test(text))).toHaveLength(1);
      expect(sqlOf.filter((text) => /from "zone_menus"/.test(text))).toHaveLength(1);
    });
  });
});

describe("each served menu's structure and home layouts", () => {
  /**
   * Dinner gains a "Drinks" section (customer name "Something to drink") holding Cola, and a
   * "Counter" layout with Drinks and Burger as shortcuts; Dinner is republished.
   */
  async function seedDinnerLayouts() {
    const venue = await seedTwoMenuVenue();
    return scoped(async (tx) => {
      const cola = (
        await createProduct(tx, {
          catalogueId: venue.dinner,
          categoryId: null,
          name: "Cola",
          pricingUnit: "each",
          unitPrice: "2.00",
          vatClass: "general",
          allergens: {},
        })
      ).id;
      const drinks = (
        await createSectionIn(tx, (await readMenuStructure(tx, venue.dinner)).rootSectionId, {
          internalName: "Drinks",
          names: { en: "Something to drink" },
        })
      ).id;
      await addMember(tx, drinks, { kind: "product", productId: cola });
      const counter = (await createHomeLayout(tx, venue.dinner, "Counter")).id;
      await addShortcut(tx, counter, { kind: "section", sectionId: drinks });
      await addShortcut(tx, counter, { kind: "product", productId: venue.burger });
      const dinnerVersionId = await publish(tx, venue.dinner);
      const defaultOf = async (menuId: string) => (await listHomeLayouts(tx, menuId))[0]!.id;
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: `Handheld ${randomUUID()}`, formFactor: "phone-portrait" })
        .returning({ id: deviceProfiles.id });
      return {
        ...venue,
        dinnerVersionId,
        cola,
        drinks,
        counter,
        dinnerHome: await defaultOf(venue.dinner),
        allDayHome: await defaultOf(venue.menuId),
        profile: profile!.id,
      };
    });
  }

  it("serves the live structure and layouts, and the default layout to a device with no profile", async () => {
    const venue = await seedDinnerLayouts();
    await scoped(async (tx) => {
      const colaOffer = (await listZoneOffers(tx, venue.cfg, venue.diningZone)).offers.find(
        (offer) => offer.productId === venue.cola,
      )!.id;
      const served = await listZoneOffers(tx, venue.cfg, venue.diningZone);
      expect(served.menus[1]).toEqual({
        id: venue.dinner,
        name: "Dinner",
        isDefault: false,
        versionId: venue.dinnerVersionId,
        structure: {
          members: [
            { kind: "product", menuItemId: venue.lemonadeOffer, productId: venue.lemonade },
            { kind: "product", menuItemId: venue.burgerOffer, productId: venue.burger },
            {
              kind: "section",
              sectionId: venue.drinks,
              internalName: "Drinks",
              names: { en: "Something to drink" },
              image: null,
              color: null,
              members: [{ kind: "product", menuItemId: colaOffer, productId: venue.cola }],
            },
          ],
        },
        homeLayouts: [
          { id: venue.dinnerHome, name: "Home", tiles: [] },
          {
            id: venue.counter,
            name: "Counter",
            tiles: [
              { kind: "section", sectionId: venue.drinks },
              { kind: "product", productId: venue.burger },
            ],
          },
        ],
        defaultHomeLayoutId: venue.dinnerHome,
        homeLayoutId: venue.dinnerHome,
        layoutFallback: null,
      });
      expect((await menuState(tx, venue.diningZone)).menus).toEqual([
        {
          menuId: venue.menuId,
          versionId: venue.versionId,
          homeLayoutId: venue.allDayHome,
          layoutFallback: null,
        },
        {
          menuId: venue.dinner,
          versionId: venue.dinnerVersionId,
          homeLayoutId: venue.dinnerHome,
          layoutFallback: null,
        },
      ]);
    });
  });

  it("serves each menu the layout the device's profile chose for it, in the offers and the menu state alike", async () => {
    const venue = await seedDinnerLayouts();
    await scoped(async (tx) => {
      await setDeviceHomeLayout(tx, venue.profile, venue.dinner, venue.counter);
      const expected = [
        { id: venue.menuId, homeLayoutId: venue.allDayHome, layoutFallback: null },
        { id: venue.dinner, homeLayoutId: venue.counter, layoutFallback: null },
      ];
      const offers = await listZoneOffers(tx, venue.cfg, venue.diningZone, {
        deviceProfileId: venue.profile,
      });
      expect(
        offers.menus.map(({ id, homeLayoutId, layoutFallback }) => ({
          id,
          homeLayoutId,
          layoutFallback,
        })),
      ).toEqual(expected);
      const state = await menuState(tx, venue.diningZone, { deviceProfileId: venue.profile });
      expect(
        state.menus.map(({ menuId, homeLayoutId, layoutFallback }) => ({
          id: menuId,
          homeLayoutId,
          layoutFallback,
        })),
      ).toEqual(expected);
      // A layout chosen after the publish is not in the live version yet.
      const bar = (await createHomeLayout(tx, venue.menuId, "Bar")).id;
      await setDeviceHomeLayout(tx, venue.profile, venue.menuId, bar);
      expect(
        (await menuState(tx, venue.diningZone, { deviceProfileId: venue.profile })).menus[0],
      ).toMatchObject({
        homeLayoutId: venue.allDayHome,
        layoutFallback: "layout_unpublished",
      });
    });
  });

  it("leaves out of the structure an offer whose product is Inactive, keeping its section in place (D5)", async () => {
    const venue = await seedDinnerLayouts();
    await scoped(async (tx) => {
      const colaOffer = (await listZoneOffers(tx, venue.cfg, venue.diningZone)).offers.find(
        (offer) => offer.productId === venue.cola,
      )!.id;
      await updateProduct(tx, venue.cola, { active: false });
      await publish(tx, venue.dinner);
      const served = await listZoneOffers(tx, venue.cfg, venue.diningZone);
      expect(served.offers.map((offer) => offer.id)).not.toContain(colaOffer);
      expect(served.menus[1]!.structure.members.at(-1)).toMatchObject({
        kind: "section",
        sectionId: venue.drinks,
        members: [],
      });
    });
  });
});

describe("findOrderServiceModes", () => {
  it("reads every named order's frozen service mode in one query, leaving out an order with none", async () => {
    const venue = await seedSellingVenue();
    const { cfg } = venue;
    await scoped(async (tx) => {
      const dining = await openOrder(tx, venue, 1);
      const bar = await openOrder(tx, venue, 2);
      const none = await openOrder(tx, venue, 3);
      await recordOrderServiceContext(tx, cfg, dining, venue.diningZone);
      await recordOrderServiceContext(tx, cfg, bar, venue.barZone);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      prepared.mockClear();

      const modes = await findOrderServiceModes(tx, cfg, [dining, bar, none]);

      expect(prepared).toHaveBeenCalledTimes(1);
      expect(modes).toEqual(
        new Map([
          [dining, "table_tab"],
          [bar, "prepay"],
        ]),
      );
    });
  });

  it("reads nothing for no orders", async () => {
    const venue = await seedSellingVenue();
    await scoped(async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      prepared.mockClear();
      await expect(findOrderServiceModes(tx, venue.cfg, [])).resolves.toEqual(new Map());
      expect(prepared).not.toHaveBeenCalled();
    });
  });

  it("does not read another location's orders", async () => {
    const venue = await seedSellingVenue();
    const elsewhere = { locationId: brandLocationId(await seedLocation("Elsewhere")) };
    await scoped(async (tx) => {
      const order = await openOrder(tx, venue, 1);
      await recordOrderServiceContext(tx, venue.cfg, order, venue.diningZone);
      await expect(findOrderServiceModes(tx, elsewhere, [order])).resolves.toEqual(new Map());
    });
  });
});

describe("findOrderServiceZones", () => {
  it("reads recorded zones for many orders, omitting orders without context", async () => {
    const venue = await seedSellingVenue();
    await scoped(async (tx) => {
      const dining = await openOrder(tx, venue, 1);
      const bar = await openOrder(tx, venue, 2);
      const none = await openOrder(tx, venue, 3);
      await recordOrderServiceContext(tx, venue.cfg, dining, venue.diningZone);
      await recordOrderServiceContext(tx, venue.cfg, bar, venue.barZone);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      prepared.mockClear();

      expect(await findOrderServiceZones(tx, venue.cfg, [dining, bar, none])).toEqual(
        new Map([
          [dining, venue.diningZone],
          [bar, venue.barZone],
        ]),
      );
      expect(prepared).toHaveBeenCalledTimes(1);
    });
  });

  it("reads nothing for an empty list or another location", async () => {
    const venue = await seedSellingVenue();
    const elsewhere = { locationId: brandLocationId(await seedLocation("Elsewhere zones")) };
    await scoped(async (tx) => {
      const order = await openOrder(tx, venue, 1);
      await recordOrderServiceContext(tx, venue.cfg, order, venue.diningZone);
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      prepared.mockClear();
      expect(await findOrderServiceZones(tx, venue.cfg, [])).toEqual(new Map());
      expect(prepared).not.toHaveBeenCalled();
      expect(await findOrderServiceZones(tx, elsewhere, [order])).toEqual(new Map());
    });
  });
});
