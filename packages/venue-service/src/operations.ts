import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  catalogues,
  devices,
  diningTables,
  floorZones,
  refusalOn,
  UNIQUE_VIOLATION,
  kitchenStations,
  parties,
  partyTables,
  watcherZones,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  applyLiveFields,
  assertLiveVersions,
  documentOffers,
  isEachUnit,
  readLiveDocuments,
  readUnavailable,
  units,
  type MenuDocument,
  type MenuOffer,
  type MenuState,
  type ServedMenu,
} from "@waitron/catalogue";
import type { ServiceMode, ZoneMenuState, ZoneOffers } from "@waitron/module";
import { AppError, type LocationId } from "@waitron/shared";
import {
  departmentSalePolicies,
  departments,
  departmentHours,
  deviceZoneDefaults,
  orderServiceContexts,
  saleReceiptHeaders,
  workingLineContexts,
  zoneMenus,
  zoneSalePolicies,
  zoneServicePolicies,
} from "./schema/service.js";
import { routeExceptions } from "./schema/routing.js";
import "./errors.js";

export interface VenueScope {
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
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  return rows.map((row) => ({ ...row, defaultServiceMode: row.defaultServiceMode as ServiceMode }));
}

export interface DepartmentHoursInterval {
  departmentId: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
}

/**
 * The form {@link replaceDepartmentHours} writes a venue-local wall-clock time in: `HH:MM:SS`. The
 * columns are text, so two spellings of one interval would be two entries in
 * `department_hours_interval_key`, and the dashboard slices a stored value to five characters. This
 * checks length alone: the one caller outside tests, the hours route, admits only `HH:MM`
 * (`CLOCK_TIME` in `./routes.ts`).
 */
export function storedTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
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
    .innerJoin(departments, eq(departments.id, departmentHours.departmentId))
    .where(eq(departments.locationId, cfg.locationId))
    .orderBy(departmentHours.weekday, departmentHours.opensAt, departmentHours.id);
}

/**
 * Replaces one department's whole opening-hours set by deleting it and inserting the new one, not
 * by rewriting rows one at a time, which can break `department_hours_interval_key` midway (CLAUDE.md
 * §3). No foreign key points at `department_hours`. One write transaction runs on the venue file at
 * a time, so two saves cannot interleave; the pattern is stated on `assertExtraListForWrite`
 * (`packages/catalogue/src/extras.ts`).
 */
export async function replaceDepartmentHours(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  hours: Omit<DepartmentHoursInterval, "departmentId">[],
): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.locationId, cfg.locationId)));
  if (department === undefined) throw new AppError("department.not_found", { departmentId });
  await tx.delete(departmentHours).where(eq(departmentHours.departmentId, departmentId));
  if (hours.length > 0) {
    await tx.insert(departmentHours).values(
      hours.map((interval) => ({
        departmentId,
        weekday: interval.weekday,
        opensAt: storedTime(interval.opensAt),
        closesAt: storedTime(interval.closesAt),
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
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneMenus.zoneId))
    .where(eq(zoneServicePolicies.locationId, cfg.locationId))
    .orderBy(zoneMenus.zoneId, zoneMenus.displayOrder, zoneMenus.menuId)
    .then((rows) =>
      rows.map(({ defaultMenuId, ...row }) => ({
        ...row,
        isDefault: row.menuId === defaultMenuId,
      })),
    );
}

/** The default list is restricted to zones that can start a new order. */
export async function listServiceZones(
  tx: Transaction,
  cfg: VenueScope,
  options: { includeInactive?: boolean } = {},
) {
  const rows = await tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: departments.id,
      departmentName: departments.name,
      zoneMode: zoneServicePolicies.serviceMode,
      departmentMode: departments.defaultServiceMode,
      active: floorZones.active,
    })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(
      options.includeInactive
        ? eq(zoneServicePolicies.locationId, cfg.locationId)
        : and(
            eq(zoneServicePolicies.locationId, cfg.locationId),
            eq(floorZones.active, true),
            eq(departments.active, true),
          ),
    )
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);
  return rows.map(({ zoneMode, departmentMode, active, ...row }) => ({
    ...row,
    ...(options.includeInactive ? { active } : {}),
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
  await tx.insert(departmentSalePolicies).values({ departmentId: row!.id });
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
    .where(and(eq(departments.id, departmentId), eq(departments.locationId, cfg.locationId)))
    .returning({ id: departments.id });
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
}

export async function departmentRemovalImpact(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
): Promise<{ zones: { id: string; name: string; activeTableCount: number }[] }> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.locationId, cfg.locationId)));
  if (department === undefined) throw new AppError("department.not_found", { departmentId });

  const zones = await tx
    .select({ id: floorZones.id, name: floorZones.name })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .where(and(eq(zoneServicePolicies.departmentId, departmentId), eq(floorZones.active, true)))
    .orderBy(floorZones.name, floorZones.id);
  if (zones.length === 0) return { zones: [] };
  const tables = await tx
    .select({ zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(
      and(
        inArray(
          diningTables.zoneId,
          zones.map((zone) => zone.id),
        ),
        eq(diningTables.active, true),
      ),
    );
  const counts = new Map<string, number>();
  for (const table of tables) counts.set(table.zoneId!, (counts.get(table.zoneId!) ?? 0) + 1);
  return { zones: zones.map((zone) => ({ ...zone, activeTableCount: counts.get(zone.id) ?? 0 })) };
}

export async function zoneRemovalImpact(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
): Promise<{ zones: { id: string; name: string; activeTableCount: number }[] }> {
  const [zone] = await tx
    .select({ id: floorZones.id, name: floorZones.name })
    .from(floorZones)
    .where(and(eq(floorZones.id, zoneId), eq(floorZones.locationId, cfg.locationId)));
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId });
  const tables = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(and(eq(diningTables.zoneId, zoneId), eq(diningTables.active, true)));
  return { zones: [{ ...zone, activeTableCount: tables.length }] };
}

export async function deactivateDepartment(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.locationId, cfg.locationId)));
  if (department === undefined) throw new AppError("department.not_found", { departmentId });

  const activeDepartments = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)));
  if (activeDepartments.length === 1 && activeDepartments[0]!.id === departmentId) {
    throw new AppError("department.last_active", { departmentId });
  }

  const activeZones = await tx
    .select({ id: floorZones.id })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.departmentId, departmentId),
        eq(floorZones.active, true),
      ),
    );
  if (activeZones.length > 0) {
    for (const zone of activeZones) await deactivateServiceZone(tx, cfg, zone.id);
  }
  await tx.update(departments).set({ active: false }).where(eq(departments.id, departmentId));
}

export async function deactivateServiceZone(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(and(eq(floorZones.id, zoneId), eq(floorZones.locationId, cfg.locationId)));
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId });

  const [occupied] = await tx
    .select({ tableId: diningTables.id, tableName: diningTables.label })
    .from(diningTables)
    .innerJoin(partyTables, eq(partyTables.tableId, diningTables.id))
    .innerJoin(parties, eq(parties.id, partyTables.partyId))
    .where(
      and(eq(diningTables.zoneId, zoneId), isNull(partyTables.leftAt), eq(parties.state, "open")),
    )
    .orderBy(diningTables.label, diningTables.id)
    .limit(1);
  if (occupied !== undefined) {
    throw new AppError("zone.table_in_use", { zoneId, ...occupied });
  }

  await tx.delete(routeExceptions).where(eq(routeExceptions.zoneId, zoneId));
  await tx.delete(watcherZones).where(eq(watcherZones.zoneId, zoneId));
  await tx.delete(deviceZoneDefaults).where(eq(deviceZoneDefaults.zoneId, zoneId));
  await tx.update(diningTables).set({ active: false }).where(eq(diningTables.zoneId, zoneId));
  await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, zoneId));
}

export type VenueReadinessIssue =
  | { code: "venue.default_station_missing" }
  | { code: "venue.department_missing" }
  | { code: "zone.department_missing"; zoneId: string; zoneName: string }
  | { code: "zone.menu_missing"; zoneId: string; zoneName: string }
  | { code: "zone.menu_unpublished"; zoneId: string; zoneName: string }
  | {
      code: "zone.menu_empty";
      zoneId: string;
      zoneName: string;
      menuId: string;
      menuName: string;
    };

/** Describe configuration that prevents an active zone from accepting new orders. */
export async function listVenueReadiness(
  tx: Transaction,
  cfg: VenueScope,
): Promise<VenueReadinessIssue[]> {
  const [defaultStation] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.isDefault, true),
        eq(kitchenStations.active, true),
      ),
    )
    .limit(1);
  const issues: VenueReadinessIssue[] =
    defaultStation === undefined ? [{ code: "venue.default_station_missing" }] : [];
  const activeDepartments = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)));
  if (activeDepartments.length === 0) return [...issues, { code: "venue.department_missing" }];

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
    .leftJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, floorZones.id))
    .leftJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .leftJoin(
      zoneMenus,
      and(
        eq(zoneMenus.zoneId, zoneServicePolicies.zoneId),
        eq(zoneMenus.menuId, zoneServicePolicies.defaultMenuId),
      ),
    )
    .where(and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.active, true)))
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);

  issues.push(
    ...zones.flatMap((zone): VenueReadinessIssue[] => {
      if (zone.departmentId === null || zone.departmentActive !== true) {
        return [{ code: "zone.department_missing", zoneId: zone.id, zoneName: zone.name }];
      }
      if (zone.defaultMenuId === null || zone.assignedMenuId === null) {
        return [{ code: "zone.menu_missing", zoneId: zone.id, zoneName: zone.name }];
      }
      return [];
    }),
  );
  const ready = zones.filter(
    (zone) =>
      zone.departmentId !== null &&
      zone.departmentActive === true &&
      zone.defaultMenuId !== null &&
      zone.assignedMenuId !== null,
  );
  if (ready.length === 0) return issues;
  const menusOf = await zoneMenuIdsByZone(tx, cfg);
  const live = await readLiveDocuments(tx, [...new Set([...menusOf.values()].flat())]);
  for (const zone of ready) {
    const published = (menusOf.get(zone.id) ?? []).flatMap((menuId) => {
      const version = live.get(menuId);
      return version === undefined ? [] : [{ menuId, offers: documentOffers(version.document) }];
    });
    if (published.length === 0) {
      issues.push({ code: "zone.menu_unpublished", zoneId: zone.id, zoneName: zone.name });
      continue;
    }
    for (const { menuId, offers } of published) {
      if (offers.length === 0) {
        issues.push({
          code: "zone.menu_empty",
          zoneId: zone.id,
          zoneName: zone.name,
          menuId,
          menuName: live.get(menuId)!.document.menuName,
        });
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
    .where(and(eq(floorZones.id, input.zoneId), eq(floorZones.locationId, cfg.locationId)));
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId: input.zoneId });
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, input.departmentId), eq(departments.locationId, cfg.locationId)));
  if (department === undefined) {
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  }
  await tx
    .insert(zoneServicePolicies)
    .values({
      locationId: cfg.locationId,
      zoneId: input.zoneId,
      departmentId: input.departmentId,
      serviceMode: input.serviceMode ?? null,
    })
    .onConflictDoUpdate({
      target: [zoneServicePolicies.zoneId],
      set: { departmentId: input.departmentId, serviceMode: input.serviceMode ?? null },
    });
  await tx
    .insert(zoneSalePolicies)
    .values({ zoneId: input.zoneId })
    .onConflictDoNothing({ target: zoneSalePolicies.zoneId });
}

/** Create the floor zone and its service assignment in the caller's one write transaction. */
export async function createServiceZone(
  tx: Transaction,
  cfg: VenueScope,
  input: { name: string; departmentId: string },
): Promise<{ id: string }> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (department === undefined)
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  let zoneId: string;
  try {
    const [zone] = await tx
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: input.name })
      .returning({ id: floorZones.id });
    zoneId = zone!.id;
  } catch (error) {
    if (
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_zones",
        columns: ["location_id", "name"],
      })
    )
      throw new AppError("zone.name_taken", { name: input.name });
    throw error;
  }
  await configureZone(tx, cfg, { zoneId, departmentId: input.departmentId });
  return { id: zoneId };
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
    .where(eq(catalogues.id, menuId));
  if (menu === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  const [policy] = await tx
    .select({ zoneId: zoneServicePolicies.zoneId })
    .from(zoneServicePolicies)
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.zoneId, zoneId),
      ),
    );
  if (policy === undefined) throw new AppError("service_zone.not_found", { zoneId });
  await tx
    .insert(zoneMenus)
    .values({ zoneId, menuId, displayOrder: options.displayOrder ?? 0 })
    .onConflictDoUpdate({
      target: [zoneMenus.zoneId, zoneMenus.menuId],
      set: { displayOrder: options.displayOrder ?? 0 },
    });
  if (options.makeDefault === true) {
    await tx
      .update(zoneServicePolicies)
      .set({ defaultMenuId: menuId })
      .where(eq(zoneServicePolicies.zoneId, zoneId));
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

type DepartmentSalePolicyRow = typeof departmentSalePolicies.$inferSelect;

export interface EffectiveSalePolicy {
  zoneId: string;
  departmentId: string;
  departmentName: string;
  tradingName: string;
  paidWhen: DepartmentSalePolicyRow["paidWhen"];
  collectionNumber: DepartmentSalePolicyRow["collectionNumber"];
  receiptPrintMode: DepartmentSalePolicyRow["receiptPrintMode"];
  printTradingName: boolean;
}

export async function resolveSalePolicy(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
): Promise<EffectiveSalePolicy> {
  const [row] = await tx
    .select({
      zoneId: zoneServicePolicies.zoneId,
      departmentId: departments.id,
      departmentName: departments.name,
      tradingName: departments.tradingName,
      departmentPaidWhen: departmentSalePolicies.paidWhen,
      departmentCollectionNumber: departmentSalePolicies.collectionNumber,
      departmentReceiptMode: departmentSalePolicies.receiptPrintMode,
      printTradingName: departmentSalePolicies.printTradingName,
      zonePaidWhen: zoneSalePolicies.paidWhen,
      zoneCollectionNumber: zoneSalePolicies.collectionNumber,
      zoneReceiptMode: zoneSalePolicies.receiptPrintMode,
    })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .innerJoin(departmentSalePolicies, eq(departmentSalePolicies.departmentId, departments.id))
    .innerJoin(zoneSalePolicies, eq(zoneSalePolicies.zoneId, zoneServicePolicies.zoneId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.zoneId, zoneId),
      ),
    );
  if (row === undefined) throw new AppError("service_zone.not_found", { zoneId });
  return {
    zoneId: row.zoneId,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    tradingName: row.tradingName,
    paidWhen: row.zonePaidWhen ?? row.departmentPaidWhen,
    collectionNumber: row.zoneCollectionNumber ?? row.departmentCollectionNumber,
    receiptPrintMode: row.zoneReceiptMode ?? row.departmentReceiptMode,
    printTradingName: row.printTradingName,
  };
}

export async function recordSaleReceiptHeader(
  tx: Transaction,
  cfg: VenueScope,
  saleId: string,
  zoneId: string | null,
): Promise<void> {
  const policy = zoneId === null ? null : await resolveSalePolicy(tx, cfg, zoneId);
  await tx.insert(saleReceiptHeaders).values({
    saleId,
    departmentId: policy?.departmentId ?? null,
    tradingName: policy?.tradingName ?? "",
    printTradingName: policy?.printTradingName ?? false,
  });
}

export async function readSaleReceiptHeader(tx: Transaction, saleId: string) {
  const [row] = await tx
    .select({
      departmentId: saleReceiptHeaders.departmentId,
      tradingName: saleReceiptHeaders.tradingName,
      printTradingName: saleReceiptHeaders.printTradingName,
    })
    .from(saleReceiptHeaders)
    .where(eq(saleReceiptHeaders.saleId, saleId));
  return row ?? null;
}

type DepartmentPolicyField = Pick<
  DepartmentSalePolicyRow,
  "paidWhen" | "collectionNumber" | "receiptPrintMode" | "printTradingName"
>;
type ZoneSalePolicyRow = typeof zoneSalePolicies.$inferSelect;
type ZonePolicyField = Pick<
  ZoneSalePolicyRow,
  "paidWhen" | "collectionNumber" | "receiptPrintMode"
>;

export async function listSalePolicies(tx: Transaction, cfg: VenueScope) {
  const activeDepartments = await listDepartments(tx, cfg);
  const activeZones = await listServiceZones(tx, cfg);
  const departmentIds = new Set(activeDepartments.map((department) => department.id));
  const zoneIds = new Set(activeZones.map((zone) => zone.id));
  const departmentRows = (await tx.select().from(departmentSalePolicies)).filter((row) =>
    departmentIds.has(row.departmentId),
  );
  const zoneRows = (await tx.select().from(zoneSalePolicies)).filter((row) =>
    zoneIds.has(row.zoneId),
  );
  const departmentsById = new Map(departmentRows.map((row) => [row.departmentId, row]));
  const zonesById = new Map(zoneRows.map((row) => [row.zoneId, row]));
  return {
    departments: departmentRows,
    zones: activeZones.map((zone) => {
      const raw = zonesById.get(zone.id)!;
      const inherited = departmentsById.get(zone.departmentId)!;
      return {
        ...raw,
        effective: {
          paidWhen: raw.paidWhen ?? inherited.paidWhen,
          collectionNumber: raw.collectionNumber ?? inherited.collectionNumber,
          receiptPrintMode: raw.receiptPrintMode ?? inherited.receiptPrintMode,
          printTradingName: inherited.printTradingName,
        },
      };
    }),
  };
}

export async function setDepartmentSalePolicyField<K extends keyof DepartmentPolicyField>(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  field: K,
  value: DepartmentPolicyField[K],
): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (department === undefined) throw new AppError("department.not_found", { departmentId });
  await tx
    .update(departmentSalePolicies)
    .set({ [field]: value })
    .where(eq(departmentSalePolicies.departmentId, departmentId));
}

export async function setZoneSalePolicyOverride<K extends keyof ZonePolicyField>(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  field: K,
  value: ZonePolicyField[K],
): Promise<void> {
  if (!(await listServiceZones(tx, cfg)).some((zone) => zone.id === zoneId)) {
    throw new AppError("service_zone.not_found", { zoneId });
  }
  await tx
    .update(zoneSalePolicies)
    .set({ [field]: value })
    .where(eq(zoneSalePolicies.zoneId, zoneId));
}

/** The active menus each of the venue's zones may sell from, in each zone's order. */
async function zoneMenuIdsByZone(tx: Transaction, cfg: VenueScope): Promise<Map<string, string[]>> {
  const byZone = new Map<string, string[]>();
  for (const row of await tx
    .select({ zoneId: zoneMenus.zoneId, menuId: zoneMenus.menuId })
    .from(zoneMenus)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, zoneMenus.zoneId))
    .innerJoin(catalogues, eq(catalogues.id, zoneMenus.menuId))
    .where(and(eq(zoneServicePolicies.locationId, cfg.locationId), eq(catalogues.active, true)))
    .orderBy(zoneMenus.displayOrder, zoneMenus.menuId)) {
    const menus = byZone.get(row.zoneId);
    if (menus === undefined) byZone.set(row.zoneId, [row.menuId]);
    else menus.push(row.menuId);
  }
  return byZone;
}

/** The active menus a zone may sell from, in the zone's order. */
async function zoneMenuIds(tx: Transaction, zoneId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: zoneMenus.menuId })
    .from(zoneMenus)
    .innerJoin(catalogues, eq(catalogues.id, zoneMenus.menuId))
    .where(and(eq(zoneMenus.zoneId, zoneId), eq(catalogues.active, true)))
    .orderBy(zoneMenus.displayOrder, zoneMenus.menuId);
  return rows.map((row) => row.id);
}

/**
 * The zone's active, published menus, in the zone's order, each with its live version and
 * document, once every `asserted` version is the live version of one of the zone's active menus
 * (`menu.version_changed`).
 */
async function zoneLiveDocuments(
  tx: Transaction,
  zoneId: string,
  asserted: readonly { menuId: string; versionId: string }[] = [],
): Promise<{ menuId: string; versionId: string; document: MenuDocument }[]> {
  const menuIds = await zoneMenuIds(tx, zoneId);
  const live = await assertLiveVersions(tx, menuIds, asserted);
  return menuIds.flatMap((menuId) => {
    const version = live.get(menuId);
    return version === undefined ? [] : [{ menuId, ...version }];
  });
}

/**
 * What the zone sells: each published menu's live version, with the current availability put back
 * (an unavailable offer is served marked, in its place), and that version's structure and home
 * layouts. An inactive menu, or one with no live version, is left out, and a default that is
 * inactive or unpublished gives way to the zone's first menu that is served. Refused
 * `menu.version_changed` unless every `asserted` version is the live version of one of the zone's
 * active menus. With `menuItemIds`, only the offers it names are served; the menus are all listed.
 */
export async function listZoneOffers(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  options: {
    asserted?: readonly { menuId: string; versionId: string }[];
    menuItemIds?: readonly string[];
  } = {},
): Promise<ZoneOffers> {
  const context = await resolveZoneContext(tx, cfg, zoneId);
  const published = await zoneLiveDocuments(tx, zoneId, options.asserted);
  const served = await applyLiveFields(
    tx,
    published.map((menu) => menu.document),
    options.menuItemIds === undefined ? undefined : new Set(options.menuItemIds),
  );
  const defaultMenuId =
    context.defaultMenuId === null ||
    published.some((menu) => menu.menuId === context.defaultMenuId)
      ? context.defaultMenuId
      : (published[0]?.menuId ?? null);
  // Catalogue's `ServedMenu` is the type the till reads each menu as.
  const menus: ServedMenu[] = published.map(({ menuId, versionId, document }) => ({
    id: menuId,
    name: document.menuName,
    isDefault: menuId === defaultMenuId,
    versionId,
    structure: document.root,
    homeLayouts: document.homeLayouts,
    defaultHomeLayoutId: document.defaultHomeLayoutId,
    homeLayoutId: document.defaultHomeLayoutId,
    layoutFallback: null,
  }));
  return { defaultMenuId, menus, offers: published.flatMap((menu) => served.get(menu.menuId)!) };
}

/**
 * Each of the zone's live menus with its version, and what those versions hold that cannot be sold
 * now (`readUnavailable`). Does not check the zone: an unknown one holds nothing.
 */
export async function menuState(tx: Transaction, zoneId: string): Promise<ZoneMenuState> {
  const published = await zoneLiveDocuments(tx, zoneId);
  const documents = published.map((menu) => menu.document);
  // Catalogue's `MenuState` is the type the till reads this answer as.
  const state: MenuState = {
    menus: published.map(({ menuId, versionId, document }) => ({
      menuId,
      versionId,
      homeLayoutId: document.defaultHomeLayoutId,
      layoutFallback: null,
    })),
    unavailable: await readUnavailable(tx, documents),
  };
  return state;
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
      .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, deviceZoneDefaults.zoneId))
      .where(
        and(
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
    .values({ deviceId, zoneId })
    .onConflictDoUpdate({
      target: [deviceZoneDefaults.deviceId],
      set: { zoneId },
    });
}

export async function listDeviceDefaultZones(
  tx: Transaction,
  cfg: VenueScope,
): Promise<{ deviceId: string; zoneId: string }[]> {
  return tx
    .select({ deviceId: deviceZoneDefaults.deviceId, zoneId: deviceZoneDefaults.zoneId })
    .from(deviceZoneDefaults)
    .innerJoin(devices, eq(devices.id, deviceZoneDefaults.deviceId))
    .where(eq(devices.locationId, cfg.locationId));
}

export async function clearDeviceDefaultZone(
  tx: Transaction,
  cfg: VenueScope,
  deviceId: string,
): Promise<void> {
  const [device] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.locationId, cfg.locationId)));
  if (device !== undefined) {
    await tx.delete(deviceZoneDefaults).where(eq(deviceZoneDefaults.deviceId, deviceId));
  }
}

/** Snapshot the zone's current department and payment flow when a new order opens. */
export async function recordOrderServiceContext(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
  zoneId: string,
): Promise<void> {
  const context = await resolveZoneContext(tx, cfg, zoneId);
  const serviceMode =
    context.serviceMode === "table_tab"
      ? context.serviceMode
      : (await resolveSalePolicy(tx, cfg, zoneId)).paidWhen;
  await tx.insert(orderServiceContexts).values({
    workingOrderId,
    locationId: cfg.locationId,
    zoneId: context.zoneId,
    departmentId: context.departmentId,
    serviceMode,
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
  const serviceMode =
    context.serviceMode === "table_tab"
      ? context.serviceMode
      : (await resolveSalePolicy(tx, cfg, zoneId)).paidWhen;
  const updated = await tx
    .update(orderServiceContexts)
    .set({
      zoneId: context.zoneId,
      departmentId: context.departmentId,
      serviceMode,
    })
    .where(
      and(
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
        eq(orderServiceContexts.locationId, cfg.locationId),
        eq(orderServiceContexts.workingOrderId, workingOrderId),
      ),
    );
  return row === undefined ? null : { ...row, serviceMode: row.serviceMode as ServiceMode };
}

/** Each named order's frozen service mode, read at once; an order with no context is absent. */
export async function findOrderServiceModes(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderIds: readonly string[],
): Promise<ReadonlyMap<string, ServiceMode>> {
  if (workingOrderIds.length === 0) return new Map();
  const rows = await tx
    .select({
      workingOrderId: orderServiceContexts.workingOrderId,
      serviceMode: orderServiceContexts.serviceMode,
    })
    .from(orderServiceContexts)
    .where(
      and(
        eq(orderServiceContexts.locationId, cfg.locationId),
        inArray(orderServiceContexts.workingOrderId, [...workingOrderIds]),
      ),
    );
  return new Map(rows.map((row) => [row.workingOrderId, row.serviceMode as ServiceMode]));
}

/** Each named order's recorded service zone in one read; an order with no context is absent. */
export async function findOrderServiceZones(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (workingOrderIds.length === 0) return new Map();
  const rows = await tx
    .select({
      workingOrderId: orderServiceContexts.workingOrderId,
      zoneId: orderServiceContexts.zoneId,
    })
    .from(orderServiceContexts)
    .where(
      and(
        eq(orderServiceContexts.locationId, cfg.locationId),
        inArray(orderServiceContexts.workingOrderId, [...workingOrderIds]),
      ),
    );
  return new Map(rows.map((row) => [row.workingOrderId, row.zoneId]));
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
    menuVersionId: string | null;
    menuName: string;
    categoryName: string;
    unitId: string;
    unitName: Record<string, string>;
    unitPrecision: number;
    hardwareUnit: "kg" | "g" | "mg" | null;
    vatClass: string;
    allergens: MenuOffer["allergens"];
    diet: unknown;
    dietDerivation: unknown;
    dietOverride: unknown;
  }[]
> {
  void cfg;
  const rows = await tx
    .select({
      workingOrderLineId: workingLineContexts.workingOrderLineId,
      menuItemId: workingLineContexts.menuItemId,
      menuId: workingLineContexts.menuId,
      menuVersionId: workingLineContexts.menuVersionId,
      menuName: workingLineContexts.menuName,
      categoryName: workingLineContexts.categoryName,
      unitId: workingLineContexts.unitId,
      unitName: workingLineContexts.unitName,
      unitPrecision: workingLineContexts.unitPrecision,
      hardwareUnit: workingLineContexts.hardwareUnit,
      vatClass: workingLineContexts.vatClass,
      allergens: workingLineContexts.allergens,
      diet: workingLineContexts.diet,
      dietDerivation: workingLineContexts.dietDerivation,
      dietOverride: workingLineContexts.dietOverride,
    })
    .from(workingLineContexts)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, workingLineContexts.workingOrderLineId))
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));
  return rows.map((row) => ({
    ...row,
    hardwareUnit: row.hardwareUnit as "kg" | "g" | "mg" | null,
  }));
}

/** Which of `lineIds` were sold in Each when their context was recorded. */
export async function readLinesSoldInEach(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const rows = await tx
    .select({
      workingOrderLineId: workingLineContexts.workingOrderLineId,
      soldInEach: workingLineContexts.soldInEach,
    })
    .from(workingLineContexts)
    .where(inArray(workingLineContexts.workingOrderLineId, [...lineIds]));
  return new Set(rows.filter((row) => row.soldInEach).map((row) => row.workingOrderLineId));
}

/**
 * Snapshot the commercial attribution of newly priced working-order lines, and the menu version
 * each was priced from, from `offers`: the zone's offers the lines were priced from.
 */
export async function recordWorkingLineContexts(
  tx: Transaction,
  cfg: VenueScope,
  workingOrderId: string,
  lines: readonly {
    workingOrderLineId: string;
    menuItemId: string;
    unit?: {
      id: string;
      name: Record<string, string>;
      precision: number;
      hardwareUnit: "kg" | "g" | "mg" | null;
    };
  }[],
  offers: ZoneOffers,
): Promise<void> {
  if (lines.length === 0) return;
  const context = await getOrderServiceContext(tx, cfg, workingOrderId);
  const [department] = await tx
    .select({ name: departments.name })
    .from(departments)
    .where(eq(departments.id, context.departmentId));
  if (department === undefined) {
    throw new AppError("department.not_found", { departmentId: context.departmentId });
  }
  const byMenuItem = new Map(offers.offers.map((offer) => [offer.id, offer]));
  const unitIds = [
    ...new Set(
      lines
        .map((line) => line.unit?.id ?? byMenuItem.get(line.menuItemId)?.unit.id)
        .filter((id): id is string => id !== undefined),
    ),
  ];
  const unitRows =
    unitIds.length === 0
      ? []
      : await tx
          .select({ id: units.id, seedKey: units.seedKey })
          .from(units)
          .where(inArray(units.id, unitIds));
  const seedKeyById = new Map(unitRows.map((unit) => [unit.id, unit.seedKey]));
  const versions = new Map(offers.menus.map((menu) => [menu.id, menu.versionId]));
  const versionOf = (menuId: string): string => {
    const versionId = versions.get(menuId);
    if (versionId === undefined)
      throw new Error(`the offers name no live version of menu ${menuId}`);
    return versionId;
  };
  await tx.insert(workingLineContexts).values(
    lines.map((line) => {
      const offer = byMenuItem.get(line.menuItemId);
      if (offer === undefined) {
        throw new AppError("service_zone.offer_not_allowed", {
          zoneId: context.zoneId,
          menuItemId: line.menuItemId,
        });
      }
      const unitId = line.unit?.id ?? offer.unit.id;
      return {
        workingOrderLineId: line.workingOrderLineId,
        menuItemId: offer.id,
        menuId: offer.menuId,
        menuVersionId: versionOf(offer.menuId),
        menuName: offer.menuName,
        departmentId: context.departmentId,
        departmentName: department.name,
        categoryName: offer.category ?? "Uncategorised",
        unitId,
        unitName: line.unit?.name ?? offer.unit.name,
        unitPrecision: line.unit?.precision ?? offer.unit.precision,
        soldInEach: isEachUnit({
          id: unitId,
          seedKey: seedKeyById.get(unitId) ?? null,
        }),
        hardwareUnit: line.unit === undefined ? offer.unit.hardwareUnit : line.unit.hardwareUnit,
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
  void cfg;
  const [context] = await tx
    .select()
    .from(workingLineContexts)
    .where(eq(workingLineContexts.workingOrderLineId, fromWorkingOrderLineId));
  if (context === undefined) return;
  await tx.insert(workingLineContexts).values({
    ...context,
    workingOrderLineId: toWorkingOrderLineId,
  });
}
