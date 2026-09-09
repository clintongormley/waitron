import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { catalogues, floorZones, kitchenStations, products } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { listMenuOffers, type MenuOffer } from "@waitron/catalogue";
import type { PreparationRoute, ServiceMode } from "@waitron/module";
import { AppError, type LocationId, type TenantId } from "@waitron/shared";
import {
  departments,
  orderServiceContexts,
  preparationRoutes,
  zoneMenus,
  zoneServicePolicies,
} from "./schema/service.js";
import "./errors.js";

export interface VenueScope {
  tenantId: TenantId;
  locationId: LocationId;
}

export interface Department {
  id: string;
  name: string;
  tradingName: string;
  defaultServiceMode: ServiceMode;
  active: boolean;
}

export async function createDepartment(
  tx: Transaction,
  cfg: VenueScope,
  input: { name: string; tradingName?: string; defaultServiceMode: ServiceMode },
): Promise<Department> {
  const [row] = await tx
    .insert(departments)
    .values({
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      name: input.name,
      tradingName: input.tradingName ?? input.name,
      defaultServiceMode: input.defaultServiceMode,
    })
    .returning({
      id: departments.id,
      name: departments.name,
      tradingName: departments.tradingName,
      defaultServiceMode: departments.defaultServiceMode,
      active: departments.active,
    });
  return { ...row!, defaultServiceMode: row!.defaultServiceMode as ServiceMode };
}

export async function configureZone(
  tx: Transaction,
  cfg: VenueScope,
  input: { zoneId: string; departmentId: string; serviceMode?: ServiceMode | null },
): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(
      and(
        eq(floorZones.id, input.zoneId),
        eq(floorZones.tenantId, cfg.tenantId),
        eq(floorZones.locationId, cfg.locationId),
      ),
    );
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId: input.zoneId });
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.tenantId, cfg.tenantId),
        eq(departments.locationId, cfg.locationId),
      ),
    );
  if (department === undefined) {
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  }
  await tx
    .insert(zoneServicePolicies)
    .values({
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      zoneId: input.zoneId,
      departmentId: input.departmentId,
      serviceMode: input.serviceMode ?? null,
    })
    .onConflictDoUpdate({
      target: [zoneServicePolicies.tenantId, zoneServicePolicies.zoneId],
      set: { departmentId: input.departmentId, serviceMode: input.serviceMode ?? null },
    });
}

export async function allowMenuInZone(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  menuId: string,
  options: { displayOrder?: number; makeDefault?: boolean } = {},
): Promise<void> {
  const [menu] = await tx
    .select({ id: catalogues.id })
    .from(catalogues)
    .where(and(eq(catalogues.id, menuId), eq(catalogues.tenantId, cfg.tenantId)));
  if (menu === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  const [policy] = await tx
    .select({ zoneId: zoneServicePolicies.zoneId })
    .from(zoneServicePolicies)
    .where(
      and(
        eq(zoneServicePolicies.tenantId, cfg.tenantId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.zoneId, zoneId),
      ),
    )
    .for("update");
  if (policy === undefined) throw new AppError("service_zone.not_found", { zoneId });
  await tx
    .insert(zoneMenus)
    .values({ tenantId: cfg.tenantId, zoneId, menuId, displayOrder: options.displayOrder ?? 0 })
    .onConflictDoUpdate({
      target: [zoneMenus.tenantId, zoneMenus.zoneId, zoneMenus.menuId],
      set: { displayOrder: options.displayOrder ?? 0 },
    });
  if (options.makeDefault === true) {
    await tx
      .update(zoneServicePolicies)
      .set({ defaultMenuId: menuId })
      .where(
        and(eq(zoneServicePolicies.tenantId, cfg.tenantId), eq(zoneServicePolicies.zoneId, zoneId)),
      );
  }
}

export async function resolveZoneContext(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
): Promise<{
  zoneId: string;
  departmentId: string;
  departmentName: string;
  serviceMode: ServiceMode;
  defaultMenuId: string | null;
}> {
  const [row] = await tx
    .select({
      zoneId: zoneServicePolicies.zoneId,
      departmentId: departments.id,
      departmentName: departments.name,
      zoneMode: zoneServicePolicies.serviceMode,
      departmentMode: departments.defaultServiceMode,
      defaultMenuId: zoneServicePolicies.defaultMenuId,
    })
    .from(zoneServicePolicies)
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(
      and(
        eq(zoneServicePolicies.tenantId, cfg.tenantId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.zoneId, zoneId),
        eq(departments.active, true),
      ),
    );
  if (row === undefined) throw new AppError("service_zone.not_found", { zoneId });
  return {
    zoneId: row.zoneId,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    serviceMode: (row.zoneMode ?? row.departmentMode) as ServiceMode,
    defaultMenuId: row.defaultMenuId,
  };
}

export async function listZoneOffers(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
): Promise<{ defaultMenuId: string | null; offers: MenuOffer[] }> {
  const context = await resolveZoneContext(tx, cfg, zoneId);
  const menus = await tx
    .select({ id: zoneMenus.menuId })
    .from(zoneMenus)
    .where(and(eq(zoneMenus.tenantId, cfg.tenantId), eq(zoneMenus.zoneId, zoneId)))
    .orderBy(zoneMenus.displayOrder, zoneMenus.menuId);
  return {
    defaultMenuId: context.defaultMenuId,
    offers: await listMenuOffers(
      tx,
      cfg.tenantId,
      menus.map((menu) => menu.id),
    ),
  };
}

/** Snapshot the zone's current department and payment flow when a new order opens. */
export async function recordOrderServiceContext(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
  zoneId: string,
): Promise<void> {
  const context = await resolveZoneContext(tx, cfg, zoneId);
  await tx.insert(orderServiceContexts).values({
    tenantId: cfg.tenantId,
    workingOrderId,
    locationId: cfg.locationId,
    zoneId: context.zoneId,
    departmentId: context.departmentId,
    serviceMode: context.serviceMode,
  });
}

export async function getOrderServiceContext(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
): Promise<{ zoneId: string; departmentId: string; serviceMode: ServiceMode }> {
  const [row] = await tx
    .select({
      zoneId: orderServiceContexts.zoneId,
      departmentId: orderServiceContexts.departmentId,
      serviceMode: orderServiceContexts.serviceMode,
    })
    .from(orderServiceContexts)
    .where(
      and(
        eq(orderServiceContexts.tenantId, cfg.tenantId),
        eq(orderServiceContexts.locationId, cfg.locationId),
        eq(orderServiceContexts.workingOrderId, workingOrderId),
      ),
    );
  if (row === undefined) throw new AppError("order.service_context_missing", { workingOrderId });
  return { ...row, serviceMode: row.serviceMode as ServiceMode };
}

export async function createPreparationRoute(
  tx: Transaction,
  cfg: VenueScope,
  input: {
    zoneId?: string | null;
    categoryId?: string | null;
    productId?: string | null;
    target: PreparationRoute;
  },
): Promise<string> {
  const [row] = await tx
    .insert(preparationRoutes)
    .values({
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      zoneId: input.zoneId ?? null,
      categoryId: input.categoryId ?? null,
      productId: input.productId ?? null,
      stationId: input.target.kind === "station" ? input.target.stationId : null,
      noPreparation: input.target.kind === "no_preparation",
    })
    .returning({ id: preparationRoutes.id });
  return row!.id;
}

/** Resolve zone/product, zone/category, venue/product, then venue/category. */
export async function resolvePreparationRoute(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  productId: string,
): Promise<PreparationRoute> {
  await resolveZoneContext(tx, cfg, zoneId);
  const [product] = await tx
    .select({ categoryId: products.categoryId })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, cfg.tenantId)));
  if (product === undefined) throw new AppError("route.missing", { zoneId, productId });
  const [route] = await tx
    .select({
      stationId: preparationRoutes.stationId,
      noPreparation: preparationRoutes.noPreparation,
    })
    .from(preparationRoutes)
    .where(
      and(
        eq(preparationRoutes.tenantId, cfg.tenantId),
        eq(preparationRoutes.locationId, cfg.locationId),
        or(eq(preparationRoutes.zoneId, zoneId), isNull(preparationRoutes.zoneId)),
        or(
          eq(preparationRoutes.productId, productId),
          product.categoryId === null
            ? sql`false`
            : eq(preparationRoutes.categoryId, product.categoryId),
        ),
      ),
    )
    .orderBy(
      desc(sql<number>`case
        when ${preparationRoutes.zoneId} is not null and ${preparationRoutes.productId} is not null then 4
        when ${preparationRoutes.zoneId} is not null and ${preparationRoutes.categoryId} is not null then 3
        when ${preparationRoutes.productId} is not null then 2
        else 1 end`),
    )
    .limit(1);
  if (route === undefined) throw new AppError("route.missing", { zoneId, productId });
  if (route.noPreparation) return { kind: "no_preparation" };
  const stationId = route.stationId!;
  const [station] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, stationId),
        eq(kitchenStations.tenantId, cfg.tenantId),
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.active, true),
      ),
    );
  if (station === undefined) throw new AppError("route.station_inactive", { stationId });
  return { kind: "station", stationId };
}
