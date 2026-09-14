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
import { asAppUser, CORE_MIGRATIONS, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  AppError,
  locationId as brandLocationId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
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

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;

beforeAll(() => {
  db = suite.db;
});

async function scoped<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void tenantId;
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

async function seedUnitTenant(): Promise<{
  tenantId: ReturnType<typeof brandTenantId>;
  eachUnitId: string;
  kgUnitId: string;
}> {
  const tenantId = brandTenantId(await seedTenant(db));
  const seeded = await db.execute<{ id: string; seed_key: "each" | "kg" }>(sql`
    insert into units (tenant_id, seed_key, name, abbreviation, precision, hardware_unit) values
      (${tenantId}, 'each', '{"en":"each"}'::jsonb, '{"en":"ea"}'::jsonb, 0, null),
      (${tenantId}, 'kg', '{"en":"kg"}'::jsonb, '{"en":"kg"}'::jsonb, 3, 'kg')
    returning id, seed_key`);
  return {
    tenantId,
    eachUnitId: seeded.rows.find((unit) => unit.seed_key === "each")!.id,
    kgUnitId: seeded.rows.find((unit) => unit.seed_key === "kg")!.id,
  };
}

describe("venue service routing", () => {
  it("reports incomplete active zones and refuses to deactivate their department", async () => {
    const { tenantId } = await seedUnitTenant();
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Venue', array['en-GB'], 'Hospitality') returning id`);
    const locationId = brandLocationId(location.rows[0]!.id);
    const zone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Terrace') returning id`);

    await scoped(tenantId, async (tx) => {
      const department = await createDepartment(
        tx,
        { tenantId, locationId },
        { name: "Restaurant", defaultServiceMode: "table_tab" },
      );
      await expect(listVenueReadiness(tx, { tenantId, locationId })).resolves.toEqual([
        { code: "zone.department_missing", zoneId: zone.rows[0]!.id, zoneName: "Terrace" },
      ]);

      await configureZone(
        tx,
        { tenantId, locationId },
        {
          zoneId: zone.rows[0]!.id,
          departmentId: department.id,
        },
      );
      await expect(listVenueReadiness(tx, { tenantId, locationId })).resolves.toEqual([
        { code: "zone.menu_missing", zoneId: zone.rows[0]!.id, zoneName: "Terrace" },
      ]);

      const menu = await createCatalogue(tx, tenantId, { name: "Terrace menu" });
      await allowMenuInZone(tx, { tenantId, locationId }, zone.rows[0]!.id, menu.id, {
        makeDefault: true,
      });
      await expect(listVenueReadiness(tx, { tenantId, locationId })).resolves.toEqual([
        {
          code: "zone.menu_empty",
          zoneId: zone.rows[0]!.id,
          zoneName: "Terrace",
          menuId: menu.id,
          menuName: "Terrace menu",
        },
      ]);

      const category = await createCategory(tx, tenantId, { name: { en: "Drinks" } });
      const product = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Sparkling water",
        customerName: { en: "Sparkling water", fr: "Eau pétillante" },
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      const section = await createMenuSection(tx, tenantId, {
        menuId: menu.id,
        name: { en: "Drinks", fr: "Boissons" },
      });
      await createMenuItem(tx, tenantId, {
        menuId: menu.id,
        productId: product.id,
        sectionId: section.id,
        grossPrice: "3.00",
      });
      await expect(listVenueReadiness(tx, { tenantId, locationId })).resolves.toEqual([
        {
          code: "zone.route_missing",
          zoneId: zone.rows[0]!.id,
          zoneName: "Terrace",
          productId: product.id,
          productName: "Sparkling water",
        },
      ]);
      await writeContentLanguages(tx, tenantId, {
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
      // The readiness list is staff-facing, so it keeps naming the product by its staff name even
      // though the venue's default language changed and the product has French customer text.
      await expect(listVenueReadiness(tx, { tenantId, locationId })).resolves.toEqual([
        {
          code: "zone.route_missing",
          zoneId: zone.rows[0]!.id,
          zoneName: "Terrace",
          productId: product.id,
          productName: "Sparkling water",
        },
      ]);
      // A blank staff name is storable — `products.name` is only NOT NULL — so the list falls back
      // to the product id rather than rendering an empty name. Written with raw SQL because no
      // write path reachable from here produces a blank one.
      await tx.execute(
        sql`update products set name = '' where tenant_id = ${tenantId} and id = ${product.id}`,
      );
      await expect(listVenueReadiness(tx, { tenantId, locationId })).resolves.toEqual([
        {
          code: "zone.route_missing",
          zoneId: zone.rows[0]!.id,
          zoneName: "Terrace",
          productId: product.id,
          productName: product.id,
        },
      ]);
      await tx.execute(
        sql`update products set name = 'Sparkling water'
            where tenant_id = ${tenantId} and id = ${product.id}`,
      );
      await createPreparationRoute(
        tx,
        { tenantId, locationId },
        {
          productId: product.id,
          target: { kind: "no_preparation" },
        },
      );
      await expect(listVenueReadiness(tx, { tenantId, locationId })).resolves.toEqual([]);
      await expect(
        deactivateDepartment(tx, { tenantId, locationId }, department.id),
      ).rejects.toMatchObject({
        code: "department.has_active_zones",
        params: { departmentId: department.id, zoneId: zone.rows[0]!.id },
      });

      await tx.execute(sql`update floor_zones set active = false where id = ${zone.rows[0]!.id}`);
      await expect(
        deactivateDepartment(tx, { tenantId, locationId }, department.id),
      ).resolves.toBeUndefined();
      await expect(listVenueReadiness(tx, { tenantId, locationId })).resolves.toEqual([
        { code: "venue.department_missing" },
      ]);
    });
  });

  it("routes one cocktail to the bar serving its service zone", async () => {
    const { tenantId } = await seedUnitTenant();
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Venue', array['en-GB'], 'Hospitality') returning id`);
    const locationId = brandLocationId(location.rows[0]!.id);
    const upstairsZone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Upstairs') returning id`);
    const downstairsZone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Downstairs') returning id`);
    const upstairsBar = await db.execute<{ id: string }>(sql`
      insert into kitchen_stations (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Upstairs bar') returning id`);
    const downstairsBar = await db.execute<{ id: string }>(sql`
      insert into kitchen_stations (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Downstairs bar') returning id`);

    await scoped(tenantId, async (tx) => {
      const department = await createDepartment(
        tx,
        { tenantId, locationId },
        {
          name: "Restaurant and bar",
          defaultServiceMode: "table_tab",
        },
      );
      await configureZone(
        tx,
        { tenantId, locationId },
        {
          zoneId: upstairsZone.rows[0]!.id,
          departmentId: department.id,
        },
      );
      await configureZone(
        tx,
        { tenantId, locationId },
        {
          zoneId: downstairsZone.rows[0]!.id,
          departmentId: department.id,
          serviceMode: "prepay",
        },
      );
      await expect(listServiceZones(tx, { tenantId, locationId })).resolves.toEqual([
        {
          id: downstairsZone.rows[0]!.id,
          name: "Downstairs",
          departmentId: department.id,
          departmentName: "Restaurant and bar",
          serviceMode: "prepay",
          serviceModeOverride: "prepay",
        },
        {
          id: upstairsZone.rows[0]!.id,
          name: "Upstairs",
          departmentId: department.id,
          departmentName: "Restaurant and bar",
          serviceMode: "table_tab",
          serviceModeOverride: null,
        },
      ]);
      const menu = await createCatalogue(tx, tenantId, { name: "Drinks" });
      const category = await createCategory(tx, tenantId, { name: { en: "Cocktails" } });
      const negroni = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Negroni",
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
      });
      await createPreparationRoute(
        tx,
        { tenantId, locationId },
        {
          zoneId: upstairsZone.rows[0]!.id,
          categoryId: category.id,
          target: { kind: "station", stationId: upstairsBar.rows[0]!.id },
        },
      );
      await createPreparationRoute(
        tx,
        { tenantId, locationId },
        {
          zoneId: downstairsZone.rows[0]!.id,
          categoryId: category.id,
          target: { kind: "station", stationId: downstairsBar.rows[0]!.id },
        },
      );

      await expect(
        resolvePreparationRoutes(tx, { tenantId, locationId }, upstairsZone.rows[0]!.id, [
          negroni.id,
        ]),
      ).resolves.toEqual(
        new Map([[negroni.id, { kind: "station", stationId: upstairsBar.rows[0]!.id }]]),
      );
      await expect(
        resolvePreparationRoutes(tx, { tenantId, locationId }, downstairsZone.rows[0]!.id, [
          negroni.id,
        ]),
      ).resolves.toEqual(
        new Map([[negroni.id, { kind: "station", stationId: downstairsBar.rows[0]!.id }]]),
      );
    });
  });

  it("inherits service mode, lists zone offers, and freezes the order context", async () => {
    const { tenantId, kgUnitId } = await seedUnitTenant();
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Venue', array['en-GB'], 'Hospitality') returning id`);
    const locationId = brandLocationId(location.rows[0]!.id);
    const zone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Deli counter') returning id`);
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Deli till') returning id`);
    const nodeId = await seedNode(db, tenantId, locationId);

    await scoped(tenantId, async (tx) => {
      const department = await createDepartment(
        tx,
        { tenantId, locationId },
        {
          name: "Deli",
          defaultServiceMode: "prepay",
        },
      );
      await configureZone(
        tx,
        { tenantId, locationId },
        {
          zoneId: zone.rows[0]!.id,
          departmentId: department.id,
        },
      );
      const menu = await createCatalogue(tx, tenantId, { name: "Deli takeaway" });
      const category = await createCategory(tx, tenantId, { name: { en: "Cold cuts" } });
      const ham = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Sliced ham",
        pricingUnit: "weight",
        unitPrice: "0.00",
        vatClass: "reduced",
      });
      const section = await createMenuSection(tx, tenantId, {
        menuId: menu.id,
        name: { en: "Counter" },
      });
      const offer = await createMenuItem(tx, tenantId, {
        menuId: menu.id,
        productId: ham.id,
        sectionId: section.id,
        grossPrice: "24.90",
      });
      const hiddenMenu = await createCatalogue(tx, tenantId, { name: "Staff" });
      const hiddenSection = await createMenuSection(tx, tenantId, {
        menuId: hiddenMenu.id,
        name: { en: "Staff" },
      });
      const hiddenOffer = await createMenuItem(tx, tenantId, {
        menuId: hiddenMenu.id,
        productId: ham.id,
        sectionId: hiddenSection.id,
        grossPrice: "1.00",
      });
      await allowMenuInZone(tx, { tenantId, locationId }, zone.rows[0]!.id, menu.id, {
        makeDefault: true,
      });
      await tx.execute(sql`
        update zone_service_policies set is_counter_default = true
        where tenant_id = ${tenantId} and zone_id = ${zone.rows[0]!.id}`);

      await tx.execute(sql`
        insert into working_orders (id, tenant_id, till_id, node_id, order_number)
        values ('00000000-0000-4000-8000-000000000001', ${tenantId}, ${brandTillId(till.rows[0]!.id)}, ${nodeId}, 1)`);
      await recordOrderServiceContext(
        tx,
        { tenantId, locationId },
        "00000000-0000-4000-8000-000000000001",
        zone.rows[0]!.id,
      );
      const workingLineId = "00000000-0000-4000-8000-000000000002";
      await tx.insert(workingOrderLines).values({
        id: workingLineId,
        tenantId,
        workingOrderId: "00000000-0000-4000-8000-000000000001",
        lineNo: 1,
        productId: ham.id,
        name: "Sliced ham",
        descriptions: { "en-GB": "Sliced ham" },
        quantity: "0.250",
        unitPrice: "22.64",
        unitPriceGross: "24.90",
        vatRate: "10.00",
        lineTotal: "6.23",
        category: "Cold cuts",
      });
      await recordWorkingLineContexts(
        tx,
        { tenantId, locationId },
        "00000000-0000-4000-8000-000000000001",
        [{ workingOrderLineId: workingLineId, menuItemId: offer.id }],
      );
      await configureZone(
        tx,
        { tenantId, locationId },
        {
          zoneId: zone.rows[0]!.id,
          departmentId: department.id,
          serviceMode: "invoice_first",
        },
      );

      await expect(
        resolveZoneContext(tx, { tenantId, locationId }, zone.rows[0]!.id),
      ).resolves.toMatchObject({
        serviceMode: "invoice_first",
      });
      await expect(
        getOrderServiceContext(
          tx,
          { tenantId, locationId },
          "00000000-0000-4000-8000-000000000001",
        ),
      ).resolves.toEqual({
        zoneId: zone.rows[0]!.id,
        departmentId: department.id,
        serviceMode: "prepay",
      });
      const visible = await listZoneOffers(tx, { tenantId, locationId }, zone.rows[0]!.id);
      expect(visible.defaultMenuId).toBe(menu.id);
      expect(visible.menus).toEqual([{ id: menu.id, name: "Deli takeaway", isDefault: true }]);
      await expect(resolveNewOrderZone(tx, { tenantId, locationId }, {})).resolves.toMatchObject({
        zoneId: zone.rows[0]!.id,
        departmentId: department.id,
        serviceMode: "invoice_first",
      });
      expect(visible.offers).toHaveLength(1);
      expect(visible.offers[0]).toMatchObject({
        id: offer.id,
        productId: ham.id,
        grossPrice: "24.90",
      });
      await expect(
        resolveZoneOffer(tx, { tenantId, locationId }, zone.rows[0]!.id, offer.id),
      ).resolves.toMatchObject({ id: offer.id, productId: ham.id, grossPrice: "24.90" });
      await expect(
        resolveZoneOffer(tx, { tenantId, locationId }, zone.rows[0]!.id, hiddenOffer.id),
      ).rejects.toMatchObject({ code: "service_zone.offer_not_allowed" });
      await tx.execute(sql`
        update catalogues set name = 'Renamed menu'
        where tenant_id = ${tenantId} and id = ${menu.id}`);
      await tx.execute(sql`
        update departments set name = 'Renamed department'
        where tenant_id = ${tenantId} and id = ${department.id}`);
      await expect(
        listWorkingLineContexts(
          tx,
          { tenantId, locationId },
          "00000000-0000-4000-8000-000000000001",
        ),
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
        where tenant_id = ${tenantId} and working_order_line_id = ${workingLineId}`);
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
        insert into working_orders (id, tenant_id, till_id, node_id, order_number)
        values (${copiedOrderId}, ${tenantId}, ${brandTillId(till.rows[0]!.id)}, ${nodeId}, 2)`);
      await tx.insert(workingOrderLines).values({
        id: copiedLineId,
        tenantId,
        workingOrderId: copiedOrderId,
        lineNo: 1,
        productId: ham.id,
        name: "Sliced ham",
        descriptions: { "en-GB": "Sliced ham" },
        quantity: "0.100",
        unitPrice: "22.64",
        unitPriceGross: "24.90",
        vatRate: "10.00",
        lineTotal: "2.49",
        category: "Cold cuts",
      });
      await copyOrderServiceContext(
        tx,
        { tenantId, locationId },
        "00000000-0000-4000-8000-000000000001",
        copiedOrderId,
      );
      await copyWorkingLineContext(tx, { tenantId, locationId }, workingLineId, copiedLineId);
      await expect(
        getOrderServiceContext(tx, { tenantId, locationId }, copiedOrderId),
      ).resolves.toEqual({
        zoneId: zone.rows[0]!.id,
        departmentId: department.id,
        serviceMode: "prepay",
      });
      await expect(
        listWorkingLineContexts(tx, { tenantId, locationId }, copiedOrderId),
      ).resolves.toEqual([
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
    const { tenantId } = await seedUnitTenant();
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Venue', array['en-GB'], 'Hospitality') returning id`);
    const locationId = brandLocationId(location.rows[0]!.id);
    const zone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Deli counter') returning id`);
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Deli till') returning id`);
    const nodeId = await seedNode(db, tenantId, locationId);

    await scoped(tenantId, async (tx) => {
      const department = await createDepartment(
        tx,
        { tenantId, locationId },
        { name: "Deli", defaultServiceMode: "prepay" },
      );
      await configureZone(
        tx,
        { tenantId, locationId },
        { zoneId: zone.rows[0]!.id, departmentId: department.id },
      );
      const menu = await createCatalogue(tx, tenantId, { name: "Deli takeaway" });
      // A product with NO stored unit: create it, then delete its product_units row so the offer read
      // resolves it to the synthetic Each unit (the sentinel-id path).
      const sweets = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Loose sweets",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      await tx.execute(
        sql`delete from product_units where tenant_id = ${tenantId} and product_id = ${sweets.id}`,
      );
      const section = await createMenuSection(tx, tenantId, {
        menuId: menu.id,
        name: { en: "Counter" },
      });
      const offer = await createMenuItem(tx, tenantId, {
        menuId: menu.id,
        productId: sweets.id,
        sectionId: section.id,
        grossPrice: "1.20",
      });
      await allowMenuInZone(tx, { tenantId, locationId }, zone.rows[0]!.id, menu.id, {
        makeDefault: true,
      });
      await tx.execute(sql`
        update zone_service_policies set is_counter_default = true
        where tenant_id = ${tenantId} and zone_id = ${zone.rows[0]!.id}`);

      const orderId = "00000000-0000-4000-8000-000000000101";
      const workingLineId = "00000000-0000-4000-8000-000000000102";
      await tx.execute(sql`
        insert into working_orders (id, tenant_id, till_id, node_id, order_number)
        values (${orderId}, ${tenantId}, ${brandTillId(till.rows[0]!.id)}, ${nodeId}, 1)`);
      await recordOrderServiceContext(tx, { tenantId, locationId }, orderId, zone.rows[0]!.id);
      await tx.insert(workingOrderLines).values({
        id: workingLineId,
        tenantId,
        workingOrderId: orderId,
        lineNo: 1,
        productId: sweets.id,
        name: "Loose sweets",
        descriptions: { "en-GB": "Loose sweets" },
        quantity: "1.000",
        unitPrice: "1.09",
        unitPriceGross: "1.20",
        vatRate: "10.00",
        lineTotal: "1.20",
        category: "Uncategorised",
      });

      await expect(
        recordWorkingLineContexts(tx, { tenantId, locationId }, orderId, [
          { workingOrderLineId: workingLineId, menuItemId: offer.id },
        ]),
      ).resolves.not.toThrow();

      const ctx = await tx.execute<{ unit_id: string }>(sql`
        select unit_id from working_line_contexts
        where tenant_id = ${tenantId} and working_order_line_id = ${workingLineId}`);
      // The sentinel, not "" (which the uuid column rejects).
      expect(ctx.rows[0]!.unit_id).toBe("00000000-0000-0000-0000-000000000001");
    });
  });

  it("refuses missing configuration and supports explicit no-preparation", async () => {
    const { tenantId } = await seedUnitTenant();
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Venue', array['en-GB'], 'Hospitality') returning id`);
    const locationId = brandLocationId(location.rows[0]!.id);
    const zone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Terrace') returning id`);

    await scoped(tenantId, async (tx) => {
      const department = await createDepartment(
        tx,
        { tenantId, locationId },
        {
          name: "Restaurant",
          tradingName: "Terrace restaurant",
          defaultServiceMode: "table_tab",
        },
      );
      await expect(
        configureZone(
          tx,
          { tenantId, locationId },
          {
            zoneId: "00000000-0000-4000-8000-000000000099",
            departmentId: department.id,
          },
        ),
      ).rejects.toMatchObject({ code: "service_zone.not_found" });
      await expect(
        configureZone(
          tx,
          { tenantId, locationId },
          {
            zoneId: zone.rows[0]!.id,
            departmentId: "00000000-0000-4000-8000-000000000099",
          },
        ),
      ).rejects.toMatchObject({ code: "department.not_found" });
      await expect(
        allowMenuInZone(
          tx,
          { tenantId, locationId },
          zone.rows[0]!.id,
          "00000000-0000-4000-8000-000000000099",
        ),
      ).rejects.toMatchObject({ code: "catalogue.not_found" });

      const menu = await createCatalogue(tx, tenantId, { name: "Terrace" });
      await expect(
        allowMenuInZone(tx, { tenantId, locationId }, zone.rows[0]!.id, menu.id),
      ).rejects.toMatchObject({ code: "service_zone.not_found" });
      await configureZone(
        tx,
        { tenantId, locationId },
        {
          zoneId: zone.rows[0]!.id,
          departmentId: department.id,
          serviceMode: "ticket_then_pay",
        },
      );
      await allowMenuInZone(tx, { tenantId, locationId }, zone.rows[0]!.id, menu.id);
      await expect(listZoneOffers(tx, { tenantId, locationId }, zone.rows[0]!.id)).resolves.toEqual(
        {
          defaultMenuId: null,
          menus: [{ id: menu.id, name: "Terrace", isDefault: false }],
          offers: [],
        },
      );
      await expect(
        getOrderServiceContext(
          tx,
          { tenantId, locationId },
          "00000000-0000-4000-8000-000000000099",
        ),
      ).rejects.toMatchObject({ code: "order.service_context_missing" });

      const category = await createCategory(tx, tenantId, { name: { en: "Packaged" } });
      const product = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Crisps",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "reduced",
      });
      const routeId = await createPreparationRoute(
        tx,
        { tenantId, locationId },
        {
          productId: product.id,
          target: { kind: "no_preparation" },
        },
      );
      await expect(
        resolvePreparationRoutes(tx, { tenantId, locationId }, zone.rows[0]!.id, [product.id]),
      ).resolves.toEqual(new Map([[product.id, { kind: "no_preparation" }]]));
      await deletePreparationRoute(tx, { tenantId, locationId }, routeId);
      await expect(
        resolvePreparationRoutes(tx, { tenantId, locationId }, zone.rows[0]!.id, [product.id]),
      ).rejects.toMatchObject({
        code: "route.missing",
        params: { zoneId: zone.rows[0]!.id, productId: product.id },
      });
      await expect(
        resolvePreparationRoutes(tx, { tenantId, locationId }, zone.rows[0]!.id, [
          "00000000-0000-4000-8000-000000000099",
        ]),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
        params: { subject: "product", id: "00000000-0000-4000-8000-000000000099" },
      });
    });
  });

  it("refuses a missing route and a route to an inactive station", async () => {
    const { tenantId } = await seedUnitTenant();
    const location = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Venue', array['en-GB'], 'Hospitality') returning id`);
    const locationId = brandLocationId(location.rows[0]!.id);
    const zone = await db.execute<{ id: string }>(sql`
      insert into floor_zones (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Interior') returning id`);
    const station = await db.execute<{ id: string }>(sql`
      insert into kitchen_stations (tenant_id, location_id, name, active)
      values (${tenantId}, ${locationId}, 'Closed bar', false) returning id`);

    await scoped(tenantId, async (tx) => {
      const department = await createDepartment(
        tx,
        { tenantId, locationId },
        {
          name: "Restaurant",
          defaultServiceMode: "table_tab",
        },
      );
      await configureZone(
        tx,
        { tenantId, locationId },
        {
          zoneId: zone.rows[0]!.id,
          departmentId: department.id,
        },
      );
      const menu = await createCatalogue(tx, tenantId, { name: "Drinks" });
      const category = await createCategory(tx, tenantId, { name: { en: "Cocktails" } });
      const product = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Negroni",
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      await expect(
        resolvePreparationRoutes(tx, { tenantId, locationId }, zone.rows[0]!.id, [product.id]),
      ).rejects.toMatchObject({
        code: "route.missing",
        params: { zoneId: zone.rows[0]!.id, productId: product.id },
      });
      await expect(
        createPreparationRoute(
          tx,
          { tenantId, locationId },
          {
            categoryId: category.id,
            target: { kind: "station", stationId: station.rows[0]!.id },
          },
        ),
      ).rejects.toMatchObject({ code: "route.station_inactive" });
    });
  });
});

async function seedRoutingVenue() {
  const { tenantId } = await seedUnitTenant();
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Venue', array['en-GB'], 'Hospitality') returning id`);
  const otherLocation = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Second venue', array['en-GB'], 'Hospitality') returning id`);
  const locationId = brandLocationId(location.rows[0]!.id);
  const zone = await db.execute<{ id: string }>(sql`
    insert into floor_zones (tenant_id, location_id, name)
    values (${tenantId}, ${locationId}, 'Dining room') returning id`);
  const otherZone = await db.execute<{ id: string }>(sql`
    insert into floor_zones (tenant_id, location_id, name)
    values (${tenantId}, ${locationId}, 'Terrace') returning id`);
  const cfg = { tenantId, locationId };
  await scoped(tenantId, async (tx) => {
    const department = await createDepartment(tx, cfg, {
      name: "Restaurant",
      defaultServiceMode: "table_tab",
    });
    await configureZone(tx, cfg, { zoneId: zone.rows[0]!.id, departmentId: department.id });
    await configureZone(tx, cfg, { zoneId: otherZone.rows[0]!.id, departmentId: department.id });
  });
  return {
    tenantId,
    cfg,
    otherLocationId: otherLocation.rows[0]!.id,
    zoneId: zone.rows[0]!.id,
    otherZoneId: otherZone.rows[0]!.id,
  };
}

async function insertStation(
  tx: Transaction,
  tenantId: string,
  locationId: string,
  name: string,
): Promise<string> {
  const row = await tx.execute<{ id: string }>(sql`
    insert into kitchen_stations (tenant_id, location_id, name)
    values (${tenantId}, ${locationId}, ${name}) returning id`);
  return row.rows[0]!.id;
}

async function productWithCategory(
  tx: Transaction,
  tenantId: ReturnType<typeof brandTenantId>,
  menuId: string,
  name: string,
  withCategory = true,
): Promise<{ id: string; categoryId: string }> {
  const category = withCategory
    ? await createCategory(tx, tenantId, { name: { en: `${name} category` } })
    : null;
  const product = await createProduct(tx, tenantId, {
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
    const { tenantId, cfg, zoneId, otherZoneId } = await seedRoutingVenue();
    await scoped(tenantId, async (tx) => {
      const at = (name: string) => insertStation(tx, tenantId, cfg.locationId, name);
      const zoneProduct = await at("Zone product winner");
      const zoneCategory = await at("Zone category winner");
      const venueProduct = await at("Venue product winner");
      const venueCategory = await at("Venue category winner");
      const uncategorised = await at("Uncategorised winner");
      const losingZoneCategory = await at("Losing zone category");
      const losingVenueProduct = await at("Losing venue product");
      const losingVenueCategory = await at("Losing venue category");
      const otherZone = await at("Other zone");
      const menu = await createCatalogue(tx, tenantId, { name: "Precedence" });
      const p4 = await productWithCategory(tx, tenantId, menu.id, "Rank four");
      const p3 = await productWithCategory(tx, tenantId, menu.id, "Rank three");
      const p2 = await productWithCategory(tx, tenantId, menu.id, "Rank two");
      const p1 = await productWithCategory(tx, tenantId, menu.id, "Rank one");
      const bare = await productWithCategory(tx, tenantId, menu.id, "No category", false);
      const skipped = await productWithCategory(tx, tenantId, menu.id, "No preparation");
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

  it("matches a product id however the caller spells it, keyed by the caller's spelling", async () => {
    const { tenantId, cfg, zoneId } = await seedRoutingVenue();
    await scoped(tenantId, async (tx) => {
      const grill = await insertStation(tx, tenantId, cfg.locationId, "Grill");
      const menu = await createCatalogue(tx, tenantId, { name: "Spelling" });
      const routed = await productWithCategory(tx, tenantId, menu.id, "Routed");
      const unrouted = await productWithCategory(tx, tenantId, menu.id, "Unrouted");
      await createPreparationRoute(tx, cfg, { productId: routed.id, target: station(grill) });
      const upper = routed.id.toUpperCase();
      const braced = `{${routed.id.replaceAll("-", "")}}`;

      await expect(resolvePreparationRoutes(tx, cfg, zoneId, [upper])).resolves.toEqual(
        new Map([[upper, station(grill)]]),
      );
      await expect(resolvePreparationRoutes(tx, cfg, zoneId, [upper, braced])).resolves.toEqual(
        new Map([[upper, station(grill)]]),
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
    const { tenantId, cfg, zoneId } = await seedRoutingVenue();
    await scoped(tenantId, async (tx) => {
      const grill = await insertStation(tx, tenantId, cfg.locationId, "Grill");
      const closedBar = await insertStation(tx, tenantId, cfg.locationId, "Closed bar");
      const menu = await createCatalogue(tx, tenantId, { name: "Errors" });
      const ok = await productWithCategory(tx, tenantId, menu.id, "Routed");
      const missing = await productWithCategory(tx, tenantId, menu.id, "Unrouted");
      const inactive = await productWithCategory(tx, tenantId, menu.id, "Closed");
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
    const { tenantId, cfg, zoneId, otherLocationId } = await seedRoutingVenue();
    await scoped(tenantId, async (tx) => {
      const elsewhere = await insertStation(tx, tenantId, otherLocationId, "Elsewhere");
      const menu = await createCatalogue(tx, tenantId, { name: "Scoping" });
      const routedElsewhere = await productWithCategory(tx, tenantId, menu.id, "Routed elsewhere");
      const stationElsewhere = await productWithCategory(
        tx,
        tenantId,
        menu.id,
        "Station elsewhere",
      );
      await createPreparationRoute(
        tx,
        { tenantId, locationId: brandLocationId(otherLocationId) },
        { categoryId: routedElsewhere.categoryId, target: station(elsewhere) },
      );
      // createPreparationRoute refuses a route to another location's station, so it is written directly.
      await tx.execute(sql`
        insert into preparation_routes (tenant_id, location_id, product_id, station_id)
        values (${tenantId}, ${cfg.locationId}, ${stationElsewhere.id}, ${elsewhere})`);

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
    const { tenantId, cfg, zoneId } = await seedRoutingVenue();
    await scoped(tenantId, async (tx) => {
      const menu = await createCatalogue(tx, tenantId, { name: "Counting" });
      const expected = new Map<string, unknown>();
      for (const name of ["One", "Two", "Three", "Four", "Five"]) {
        const stationId = await insertStation(tx, tenantId, cfg.locationId, name);
        const product = await productWithCategory(tx, tenantId, menu.id, name);
        await createPreparationRoute(tx, cfg, {
          productId: product.id,
          target: station(stationId),
        });
        expected.set(product.id, station(stationId));
      }
      const productIds = [...expected.keys()];
      const prepared = vi.spyOn(tx._.session, "prepareQuery");

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
    const { tenantId, cfg } = await seedRoutingVenue();
    await scoped(tenantId, async (tx) => {
      const prepared = vi.spyOn(tx._.session, "prepareQuery");
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
    const { tenantId, cfg, zoneId, otherZoneId } = await seedRoutingVenue();
    await scoped(tenantId, async (tx) => {
      const grill = await insertStation(tx, tenantId, cfg.locationId, "Grill");
      const closedBar = await insertStation(tx, tenantId, cfg.locationId, "Closed bar");
      const menu = await createCatalogue(tx, tenantId, { name: "Dining" });
      const section = await createMenuSection(tx, tenantId, {
        menuId: menu.id,
        name: { en: "Everything" },
      });
      const inactive = await productWithCategory(tx, tenantId, menu.id, "Closed cocktail");
      const ok = await productWithCategory(tx, tenantId, menu.id, "Steak");
      const missing = await productWithCategory(tx, tenantId, menu.id, "Mystery dish");
      for (const [displayOrder, product] of [inactive, ok, missing].entries()) {
        await createMenuItem(tx, tenantId, {
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
