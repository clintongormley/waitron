import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createCategory,
  createMenuItem,
  createMenuSection,
  createProduct,
} from "@waitron/catalogue";
import { asAppUser, CORE_MIGRATIONS, withTenant, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
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
  resolvePreparationRoute,
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
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

describe("venue service routing", () => {
  it("reports incomplete active zones and refuses to deactivate their department", async () => {
    const rawTenantId = await seedTenant(db);
    const tenantId = brandTenantId(rawTenantId);
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

      const category = await createCategory(tx, tenantId, { name: "Drinks" });
      const product = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        descriptions: { en: "Sparkling water" },
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      const section = await createMenuSection(tx, tenantId, {
        menuId: menu.id,
        name: { en: "Drinks" },
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
    const rawTenantId = await seedTenant(db);
    const tenantId = brandTenantId(rawTenantId);
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
      const category = await createCategory(tx, tenantId, { name: "Cocktails" });
      const negroni = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        descriptions: { en: "Negroni" },
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
        resolvePreparationRoute(tx, { tenantId, locationId }, upstairsZone.rows[0]!.id, negroni.id),
      ).resolves.toEqual({ kind: "station", stationId: upstairsBar.rows[0]!.id });
      await expect(
        resolvePreparationRoute(
          tx,
          { tenantId, locationId },
          downstairsZone.rows[0]!.id,
          negroni.id,
        ),
      ).resolves.toEqual({ kind: "station", stationId: downstairsBar.rows[0]!.id });
    });
  });

  it("inherits service mode, lists zone offers, and freezes the order context", async () => {
    const rawTenantId = await seedTenant(db);
    const tenantId = brandTenantId(rawTenantId);
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
      const category = await createCategory(tx, tenantId, { name: "Cold cuts" });
      const ham = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        descriptions: { en: "Sliced ham" },
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
          pricingUnit: "weight",
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

  it("refuses missing configuration and supports explicit no-preparation", async () => {
    const rawTenantId = await seedTenant(db);
    const tenantId = brandTenantId(rawTenantId);
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

      const category = await createCategory(tx, tenantId, { name: "Packaged" });
      const product = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        descriptions: { en: "Crisps" },
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
        resolvePreparationRoute(tx, { tenantId, locationId }, zone.rows[0]!.id, product.id),
      ).resolves.toEqual({ kind: "no_preparation" });
      await deletePreparationRoute(tx, { tenantId, locationId }, routeId);
      await expect(
        resolvePreparationRoute(tx, { tenantId, locationId }, zone.rows[0]!.id, product.id),
      ).rejects.toMatchObject({ code: "route.missing" });
      await expect(
        resolvePreparationRoute(
          tx,
          { tenantId, locationId },
          zone.rows[0]!.id,
          "00000000-0000-4000-8000-000000000099",
        ),
      ).rejects.toMatchObject({
        code: "route.subject_not_found",
        params: { subject: "product" },
      });
    });
  });

  it("refuses a missing route and a route to an inactive station", async () => {
    const rawTenantId = await seedTenant(db);
    const tenantId = brandTenantId(rawTenantId);
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
      const category = await createCategory(tx, tenantId, { name: "Cocktails" });
      const product = await createProduct(tx, tenantId, {
        catalogueId: menu.id,
        categoryId: category.id,
        descriptions: { en: "Negroni" },
        pricingUnit: "each",
        unitPrice: "0.00",
        vatClass: "general",
      });
      await expect(
        resolvePreparationRoute(tx, { tenantId, locationId }, zone.rows[0]!.id, product.id),
      ).rejects.toMatchObject({ code: "route.missing" });
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
