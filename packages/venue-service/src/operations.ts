import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  catalogues,
  categories,
  devices,
  floorZones,
  isUniqueViolation,
  kitchenStations,
  products,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { listMenuOffers, type MenuOffer } from "@waitron/catalogue";
import type { PreparationRoute, ServiceMode } from "@waitron/module";
import { AppError, type LocationId, type TenantId } from "@waitron/shared";
import {
  departments,
  departmentHours,
  deviceZoneDefaults,
  orderServiceContexts,
  preparationRoutes,
  workingLineContexts,
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

export async function listDepartments(tx: Transaction, cfg: VenueScope): Promise<Department[]> {
  const rows = await tx
    .select({
      id: departments.id,
      name: departments.name,
      tradingName: departments.tradingName,
      defaultServiceMode: departments.defaultServiceMode,
      active: departments.active,
    })
    .from(departments)
    .where(and(eq(departments.tenantId, cfg.tenantId), eq(departments.locationId, cfg.locationId)))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  return rows.map((row) => ({ ...row, defaultServiceMode: row.defaultServiceMode as ServiceMode }));
}

export interface DepartmentHoursInterval {
  departmentId: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export async function listDepartmentHours(
  tx: Transaction,
  cfg: VenueScope,
): Promise<DepartmentHoursInterval[]> {
  return tx
    .select({
      departmentId: departmentHours.departmentId,
      weekday: departmentHours.weekday,
      opensAt: departmentHours.opensAt,
      closesAt: departmentHours.closesAt,
    })
    .from(departmentHours)
    .innerJoin(
      departments,
      and(
        eq(departments.tenantId, departmentHours.tenantId),
        eq(departments.id, departmentHours.departmentId),
      ),
    )
    .where(and(eq(departments.tenantId, cfg.tenantId), eq(departments.locationId, cfg.locationId)))
    .orderBy(departmentHours.weekday, departmentHours.opensAt, departmentHours.id);
}

export async function replaceDepartmentHours(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  hours: Omit<DepartmentHoursInterval, "departmentId">[],
): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, departmentId),
        eq(departments.tenantId, cfg.tenantId),
        eq(departments.locationId, cfg.locationId),
      ),
    )
    .for("update");
  if (department === undefined) throw new AppError("department.not_found", { departmentId });
  await tx
    .delete(departmentHours)
    .where(
      and(
        eq(departmentHours.tenantId, cfg.tenantId),
        eq(departmentHours.departmentId, departmentId),
      ),
    );
  if (hours.length > 0) {
    await tx.insert(departmentHours).values(
      hours.map((interval) => ({
        tenantId: cfg.tenantId,
        departmentId,
        weekday: interval.weekday,
        opensAt: interval.opensAt,
        closesAt: interval.closesAt,
      })),
    );
  }
}

export async function listZoneMenuAssignments(tx: Transaction, cfg: VenueScope) {
  return tx
    .select({
      zoneId: zoneMenus.zoneId,
      menuId: zoneMenus.menuId,
      displayOrder: zoneMenus.displayOrder,
      defaultMenuId: zoneServicePolicies.defaultMenuId,
    })
    .from(zoneMenus)
    .innerJoin(
      zoneServicePolicies,
      and(
        eq(zoneServicePolicies.tenantId, zoneMenus.tenantId),
        eq(zoneServicePolicies.zoneId, zoneMenus.zoneId),
      ),
    )
    .where(
      and(
        eq(zoneServicePolicies.tenantId, cfg.tenantId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
      ),
    )
    .orderBy(zoneMenus.zoneId, zoneMenus.displayOrder, zoneMenus.menuId)
    .then((rows) =>
      rows.map(({ defaultMenuId, ...row }) => ({
        ...row,
        isDefault: row.menuId === defaultMenuId,
      })),
    );
}

/** List the active, configured zones that can start a new order at this venue. */
export async function listServiceZones(tx: Transaction, cfg: VenueScope) {
  const rows = await tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: departments.id,
      departmentName: departments.name,
      zoneMode: zoneServicePolicies.serviceMode,
      departmentMode: departments.defaultServiceMode,
    })
    .from(zoneServicePolicies)
    .innerJoin(
      floorZones,
      and(
        eq(floorZones.tenantId, zoneServicePolicies.tenantId),
        eq(floorZones.id, zoneServicePolicies.zoneId),
      ),
    )
    .innerJoin(
      departments,
      and(
        eq(departments.tenantId, zoneServicePolicies.tenantId),
        eq(departments.id, zoneServicePolicies.departmentId),
      ),
    )
    .where(
      and(
        eq(zoneServicePolicies.tenantId, cfg.tenantId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(floorZones.active, true),
        eq(departments.active, true),
      ),
    )
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);
  return rows.map(({ zoneMode, departmentMode, ...row }) => ({
    ...row,
    serviceMode: (zoneMode ?? departmentMode) as ServiceMode,
    serviceModeOverride: zoneMode as ServiceMode | null,
  }));
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

export async function updateDepartment(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  input: { name: string; tradingName: string; defaultServiceMode: ServiceMode },
): Promise<void> {
  const [row] = await tx
    .update(departments)
    .set(input)
    .where(
      and(
        eq(departments.id, departmentId),
        eq(departments.tenantId, cfg.tenantId),
        eq(departments.locationId, cfg.locationId),
      ),
    )
    .returning({ id: departments.id });
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
}

export async function deactivateDepartment(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, departmentId),
        eq(departments.tenantId, cfg.tenantId),
        eq(departments.locationId, cfg.locationId),
      ),
    )
    .for("update");
  if (department === undefined) throw new AppError("department.not_found", { departmentId });

  const [activeZone] = await tx
    .select({ id: floorZones.id })
    .from(zoneServicePolicies)
    .innerJoin(
      floorZones,
      and(
        eq(floorZones.tenantId, zoneServicePolicies.tenantId),
        eq(floorZones.id, zoneServicePolicies.zoneId),
      ),
    )
    .where(
      and(
        eq(zoneServicePolicies.tenantId, cfg.tenantId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.departmentId, departmentId),
        eq(floorZones.active, true),
      ),
    )
    .limit(1);
  if (activeZone !== undefined) {
    throw new AppError("department.has_active_zones", { departmentId, zoneId: activeZone.id });
  }
  await tx
    .update(departments)
    .set({ active: false })
    .where(and(eq(departments.tenantId, cfg.tenantId), eq(departments.id, departmentId)));
}

export type VenueReadinessIssue =
  | { code: "venue.department_missing" }
  | { code: "zone.department_missing"; zoneId: string; zoneName: string }
  | { code: "zone.menu_missing"; zoneId: string; zoneName: string }
  | {
      code: "zone.menu_empty";
      zoneId: string;
      zoneName: string;
      menuId: string;
      menuName: string;
    }
  | {
      code: "zone.route_missing";
      zoneId: string;
      zoneName: string;
      productId: string;
      productName: string;
    };

/** Describe configuration that prevents an active zone from accepting new orders. */
export async function listVenueReadiness(
  tx: Transaction,
  cfg: VenueScope,
): Promise<VenueReadinessIssue[]> {
  const activeDepartments = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.tenantId, cfg.tenantId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (activeDepartments.length === 0) return [{ code: "venue.department_missing" }];

  const zones = await tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: zoneServicePolicies.departmentId,
      departmentActive: departments.active,
      defaultMenuId: zoneServicePolicies.defaultMenuId,
      assignedMenuId: zoneMenus.menuId,
    })
    .from(floorZones)
    .leftJoin(
      zoneServicePolicies,
      and(
        eq(zoneServicePolicies.tenantId, floorZones.tenantId),
        eq(zoneServicePolicies.zoneId, floorZones.id),
      ),
    )
    .leftJoin(
      departments,
      and(
        eq(departments.tenantId, zoneServicePolicies.tenantId),
        eq(departments.id, zoneServicePolicies.departmentId),
      ),
    )
    .leftJoin(
      zoneMenus,
      and(
        eq(zoneMenus.tenantId, zoneServicePolicies.tenantId),
        eq(zoneMenus.zoneId, zoneServicePolicies.zoneId),
        eq(zoneMenus.menuId, zoneServicePolicies.defaultMenuId),
      ),
    )
    .where(
      and(
        eq(floorZones.tenantId, cfg.tenantId),
        eq(floorZones.locationId, cfg.locationId),
        eq(floorZones.active, true),
      ),
    )
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);

  const issues = zones.flatMap((zone): VenueReadinessIssue[] => {
    if (zone.departmentId === null || zone.departmentActive !== true) {
      return [{ code: "zone.department_missing", zoneId: zone.id, zoneName: zone.name }];
    }
    if (zone.defaultMenuId === null || zone.assignedMenuId === null) {
      return [{ code: "zone.menu_missing", zoneId: zone.id, zoneName: zone.name }];
    }
    return [];
  });
  for (const zone of zones) {
    if (
      zone.departmentId === null ||
      zone.departmentActive !== true ||
      zone.defaultMenuId === null ||
      zone.assignedMenuId === null
    ) {
      continue;
    }
    const available = await listZoneOffers(tx, cfg, zone.id);
    for (const menu of available.menus) {
      if (!available.offers.some((offer) => offer.menuId === menu.id)) {
        issues.push({
          code: "zone.menu_empty",
          zoneId: zone.id,
          zoneName: zone.name,
          menuId: menu.id,
          menuName: menu.name,
        });
      }
    }
    const productsById = new Map(
      available.offers.map((offer) => [
        offer.productId,
        Object.values(offer.descriptions)[0] ?? offer.productId,
      ]),
    );
    for (const [productId, productName] of productsById) {
      try {
        await resolvePreparationRoute(tx, cfg, zone.id, productId);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === "route.missing" || error.code === "route.station_inactive")
        ) {
          issues.push({
            code: "zone.route_missing",
            zoneId: zone.id,
            zoneName: zone.name,
            productId,
            productName,
          });
          continue;
        }
        throw error;
      }
    }
  }
  return issues;
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
    .innerJoin(
      departments,
      and(
        eq(departments.tenantId, zoneServicePolicies.tenantId),
        eq(departments.id, zoneServicePolicies.departmentId),
      ),
    )
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
): Promise<{
  defaultMenuId: string | null;
  menus: { id: string; name: string; isDefault: boolean }[];
  offers: MenuOffer[];
}> {
  const context = await resolveZoneContext(tx, cfg, zoneId);
  const menus = await tx
    .select({ id: zoneMenus.menuId, name: catalogues.name })
    .from(zoneMenus)
    .innerJoin(
      catalogues,
      and(eq(catalogues.tenantId, zoneMenus.tenantId), eq(catalogues.id, zoneMenus.menuId)),
    )
    .where(and(eq(zoneMenus.tenantId, cfg.tenantId), eq(zoneMenus.zoneId, zoneId)))
    .orderBy(zoneMenus.displayOrder, zoneMenus.menuId);
  const menuOrder = new Map(menus.map((menu, index) => [menu.id, index]));
  const offers = await listMenuOffers(
    tx,
    cfg.tenantId,
    menus.map((menu) => menu.id),
  );
  offers.sort(
    (left, right) =>
      (menuOrder.get(left.menuId) ?? Number.MAX_SAFE_INTEGER) -
      (menuOrder.get(right.menuId) ?? Number.MAX_SAFE_INTEGER),
  );
  return {
    defaultMenuId: context.defaultMenuId,
    menus: menus.map((menu) => ({
      ...menu,
      isDefault: menu.id === context.defaultMenuId,
    })),
    offers,
  };
}

/** Resolve an explicit service zone, or the venue's configured counter default for a new order. */
export async function resolveNewOrderZone(
  tx: Transaction,
  cfg: VenueScope,
  input: { zoneId?: string | null; deviceId?: string | null },
): Promise<{
  zoneId: string;
  departmentId: string;
  departmentName: string;
  serviceMode: ServiceMode;
  defaultMenuId: string | null;
}> {
  if (input.zoneId !== undefined && input.zoneId !== null) {
    return resolveZoneContext(tx, cfg, input.zoneId);
  }
  if (input.deviceId !== undefined && input.deviceId !== null) {
    const [deviceDefault] = await tx
      .select({ zoneId: deviceZoneDefaults.zoneId })
      .from(deviceZoneDefaults)
      .innerJoin(
        zoneServicePolicies,
        and(
          eq(zoneServicePolicies.tenantId, deviceZoneDefaults.tenantId),
          eq(zoneServicePolicies.zoneId, deviceZoneDefaults.zoneId),
        ),
      )
      .where(
        and(
          eq(deviceZoneDefaults.tenantId, cfg.tenantId),
          eq(deviceZoneDefaults.deviceId, input.deviceId),
          eq(zoneServicePolicies.locationId, cfg.locationId),
        ),
      );
    if (deviceDefault !== undefined) {
      return resolveZoneContext(tx, cfg, deviceDefault.zoneId);
    }
  }
  const [policy] = await tx
    .select({ zoneId: zoneServicePolicies.zoneId })
    .from(zoneServicePolicies)
    .where(
      and(
        eq(zoneServicePolicies.tenantId, cfg.tenantId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.isCounterDefault, true),
      ),
    );
  if (policy === undefined) throw new AppError("service_zone.default_missing", {});
  return resolveZoneContext(tx, cfg, policy.zoneId);
}

/** Set the initial counter zone for one enrolled device at this venue. */
export async function setDeviceDefaultZone(
  tx: Transaction,
  cfg: VenueScope,
  deviceId: string,
  zoneId: string,
): Promise<void> {
  const [device] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.tenantId, cfg.tenantId),
        eq(devices.locationId, cfg.locationId),
        eq(devices.id, deviceId),
        eq(devices.active, true),
      ),
    );
  if (device === undefined)
    throw new AppError("route.subject_not_found", { subject: "device", id: deviceId });
  await resolveZoneContext(tx, cfg, zoneId);
  await tx
    .insert(deviceZoneDefaults)
    .values({ tenantId: cfg.tenantId, deviceId, zoneId })
    .onConflictDoUpdate({
      target: [deviceZoneDefaults.tenantId, deviceZoneDefaults.deviceId],
      set: { zoneId },
    });
}

/** Resolve a selling identity only when its menu is assigned to the service zone. */
export async function resolveZoneOffer(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  menuItemId: string,
): Promise<MenuOffer> {
  const { offers } = await listZoneOffers(tx, cfg, zoneId);
  const offer = offers.find((candidate) => candidate.id === menuItemId);
  if (offer === undefined) {
    throw new AppError("service_zone.offer_not_allowed", { zoneId, menuItemId });
  }
  return offer;
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

/** Adopt a new zone's current department and service mode while retaining existing line snapshots. */
export async function retargetOrderServiceContext(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
  zoneId: string,
): Promise<void> {
  const context = await resolveZoneContext(tx, cfg, zoneId);
  const updated = await tx
    .update(orderServiceContexts)
    .set({
      zoneId: context.zoneId,
      departmentId: context.departmentId,
      serviceMode: context.serviceMode,
    })
    .where(
      and(
        eq(orderServiceContexts.tenantId, cfg.tenantId),
        eq(orderServiceContexts.locationId, cfg.locationId),
        eq(orderServiceContexts.workingOrderId, workingOrderId),
      ),
    )
    .returning({ workingOrderId: orderServiceContexts.workingOrderId });
  if (updated.length === 0) {
    throw new AppError("order.service_context_missing", { workingOrderId });
  }
}

export async function getOrderServiceContext(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
): Promise<{ zoneId: string; departmentId: string; serviceMode: ServiceMode }> {
  const row = await findOrderServiceContext(tx, cfg, workingOrderId);
  if (row === null) throw new AppError("order.service_context_missing", { workingOrderId });
  return row;
}

export async function findOrderServiceContext(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
): Promise<{ zoneId: string; departmentId: string; serviceMode: ServiceMode } | null> {
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
  return row === undefined ? null : { ...row, serviceMode: row.serviceMode as ServiceMode };
}

export async function listWorkingLineContexts(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
): Promise<
  {
    workingOrderLineId: string;
    menuItemId: string;
    menuId: string;
    menuName: string;
    categoryName: string;
    pricingUnit: "each" | "weight";
    vatClass: string;
    allergens: MenuOffer["allergens"];
    diet: unknown;
    dietDerivation: unknown;
    dietOverride: unknown;
  }[]
> {
  const rows = await tx
    .select({
      workingOrderLineId: workingLineContexts.workingOrderLineId,
      menuItemId: workingLineContexts.menuItemId,
      menuId: workingLineContexts.menuId,
      menuName: workingLineContexts.menuName,
      categoryName: workingLineContexts.categoryName,
      pricingUnit: workingLineContexts.pricingUnit,
      vatClass: workingLineContexts.vatClass,
      allergens: workingLineContexts.allergens,
      diet: workingLineContexts.diet,
      dietDerivation: workingLineContexts.dietDerivation,
      dietOverride: workingLineContexts.dietOverride,
    })
    .from(workingLineContexts)
    .innerJoin(
      workingOrderLines,
      and(
        eq(workingOrderLines.tenantId, workingLineContexts.tenantId),
        eq(workingOrderLines.id, workingLineContexts.workingOrderLineId),
      ),
    )
    .where(
      and(
        eq(workingLineContexts.tenantId, cfg.tenantId),
        eq(workingOrderLines.workingOrderId, workingOrderId),
      ),
    );
  return rows.map((row) => ({ ...row, pricingUnit: row.pricingUnit as "each" | "weight" }));
}

/** Snapshot the commercial attribution of newly priced working-order lines. */
export async function recordWorkingLineContexts(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
  lines: readonly { workingOrderLineId: string; menuItemId: string }[],
): Promise<void> {
  if (lines.length === 0) return;
  const context = await getOrderServiceContext(tx, cfg, workingOrderId);
  const [department] = await tx
    .select({ name: departments.name })
    .from(departments)
    .where(and(eq(departments.tenantId, cfg.tenantId), eq(departments.id, context.departmentId)));
  if (department === undefined) {
    throw new AppError("department.not_found", { departmentId: context.departmentId });
  }
  const byMenuItem = new Map<string, MenuOffer>();
  for (const line of lines) {
    if (!byMenuItem.has(line.menuItemId)) {
      byMenuItem.set(
        line.menuItemId,
        await resolveZoneOffer(tx, cfg, context.zoneId, line.menuItemId),
      );
    }
  }
  await tx.insert(workingLineContexts).values(
    lines.map((line) => {
      const offer = byMenuItem.get(line.menuItemId)!;
      return {
        tenantId: cfg.tenantId,
        workingOrderLineId: line.workingOrderLineId,
        menuItemId: offer.id,
        menuId: offer.menuId,
        menuName: offer.menuName,
        departmentId: context.departmentId,
        departmentName: department.name,
        categoryName: offer.category ?? "Uncategorised",
        pricingUnit: offer.pricingUnit,
        vatClass: offer.vatClass,
        allergens: offer.allergens,
        diet: offer.diet,
        dietDerivation: offer.dietDerivation,
        dietOverride: offer.dietOverride,
      };
    }),
  );
}

/** Copy an order's frozen service policy to a newly-created split/check order. */
export async function copyOrderServiceContext(
  tx: Transaction,
  cfg: VenueScope,
  fromWorkingOrderId: string,
  toWorkingOrderId: string,
): Promise<void> {
  const context = await findOrderServiceContext(tx, cfg, fromWorkingOrderId);
  if (context === null) return;
  await tx.insert(orderServiceContexts).values({
    tenantId: cfg.tenantId,
    workingOrderId: toWorkingOrderId,
    locationId: cfg.locationId,
    zoneId: context.zoneId,
    departmentId: context.departmentId,
    serviceMode: context.serviceMode,
  });
}

/** Copy a line's immutable selling snapshot when a quantity is split onto a new line id. */
export async function copyWorkingLineContext(
  tx: Transaction,
  cfg: VenueScope,
  fromWorkingOrderLineId: string,
  toWorkingOrderLineId: string,
): Promise<void> {
  const [context] = await tx
    .select()
    .from(workingLineContexts)
    .where(
      and(
        eq(workingLineContexts.tenantId, cfg.tenantId),
        eq(workingLineContexts.workingOrderLineId, fromWorkingOrderLineId),
      ),
    );
  if (context === undefined) return;
  await tx.insert(workingLineContexts).values({
    ...context,
    workingOrderLineId: toWorkingOrderLineId,
  });
}

export interface PreparationRouteInput {
  zoneId?: string | null;
  categoryId?: string | null;
  productId?: string | null;
  target: PreparationRoute;
}

async function validatePreparationRoute(
  tx: Transaction,
  cfg: VenueScope,
  input: PreparationRouteInput,
): Promise<void> {
  if (input.zoneId !== undefined && input.zoneId !== null) {
    await resolveZoneContext(tx, cfg, input.zoneId);
  }
  if (input.categoryId !== undefined && input.categoryId !== null) {
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tenantId, cfg.tenantId), eq(categories.id, input.categoryId)));
    if (category === undefined) {
      throw new AppError("route.subject_not_found", {
        subject: "category",
        id: input.categoryId,
      });
    }
  }
  if (input.productId !== undefined && input.productId !== null) {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, cfg.tenantId), eq(products.id, input.productId)));
    if (product === undefined) {
      throw new AppError("route.subject_not_found", { subject: "product", id: input.productId });
    }
  }
  if (input.target.kind === "station") {
    const [station] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(
        and(
          eq(kitchenStations.tenantId, cfg.tenantId),
          eq(kitchenStations.locationId, cfg.locationId),
          eq(kitchenStations.id, input.target.stationId),
          eq(kitchenStations.active, true),
        ),
      );
    if (station === undefined) {
      throw new AppError("route.station_inactive", { stationId: input.target.stationId });
    }
  }
}

export async function createPreparationRoute(
  tx: Transaction,
  cfg: VenueScope,
  input: PreparationRouteInput,
): Promise<string> {
  await validatePreparationRoute(tx, cfg, input);
  try {
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
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("route.duplicate", {});
    throw error;
  }
}

export async function updatePreparationRoute(
  tx: Transaction,
  cfg: VenueScope,
  routeId: string,
  input: PreparationRouteInput,
): Promise<void> {
  await validatePreparationRoute(tx, cfg, input);
  try {
    const [row] = await tx
      .update(preparationRoutes)
      .set({
        zoneId: input.zoneId ?? null,
        categoryId: input.categoryId ?? null,
        productId: input.productId ?? null,
        stationId: input.target.kind === "station" ? input.target.stationId : null,
        noPreparation: input.target.kind === "no_preparation",
      })
      .where(
        and(
          eq(preparationRoutes.id, routeId),
          eq(preparationRoutes.tenantId, cfg.tenantId),
          eq(preparationRoutes.locationId, cfg.locationId),
        ),
      )
      .returning({ id: preparationRoutes.id });
    if (row === undefined) throw new AppError("route.not_found", { routeId });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("route.duplicate", {});
    throw error;
  }
}

export async function listPreparationRoutes(tx: Transaction, cfg: VenueScope) {
  return tx
    .select({
      id: preparationRoutes.id,
      zoneId: preparationRoutes.zoneId,
      categoryId: preparationRoutes.categoryId,
      productId: preparationRoutes.productId,
      stationId: preparationRoutes.stationId,
      noPreparation: preparationRoutes.noPreparation,
    })
    .from(preparationRoutes)
    .where(
      and(
        eq(preparationRoutes.tenantId, cfg.tenantId),
        eq(preparationRoutes.locationId, cfg.locationId),
      ),
    )
    .orderBy(
      desc(preparationRoutes.zoneId),
      desc(preparationRoutes.productId),
      asc(preparationRoutes.id),
    );
}

export async function deletePreparationRoute(
  tx: Transaction,
  cfg: VenueScope,
  routeId: string,
): Promise<void> {
  const [row] = await tx
    .delete(preparationRoutes)
    .where(
      and(
        eq(preparationRoutes.id, routeId),
        eq(preparationRoutes.tenantId, cfg.tenantId),
        eq(preparationRoutes.locationId, cfg.locationId),
      ),
    )
    .returning({ id: preparationRoutes.id });
  if (row === undefined) throw new AppError("route.not_found", { routeId });
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
  if (product === undefined) {
    throw new AppError("route.subject_not_found", { subject: "product", id: productId });
  }
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
