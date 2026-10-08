import { withdrawPendingDepartmentTransfers } from "./department-transfer-lifecycle.js";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import {
  catalogues,
  diningTables,
  floorZones,
  refusalOn,
  UNIQUE_VIOLATION,
  kitchenStations,
  locations,
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
  type ServedMenu,
} from "@waitron/catalogue";
import type { ServiceMode, ZoneMenuState, ZoneOffers } from "@waitron/module";
import { AppError, type LocationId } from "@waitron/shared";
import {
  departmentSalePolicies,
  departments,
  orderServiceContexts,
  saleReceiptHeaders,
  workingLineContexts,
  zoneSalePolicies,
  zoneServicePolicies,
} from "./schema/service.js";
import {
  departmentAllDayMenus,
  departmentMenus,
  zoneAllDayMenus,
  zonePeriodMenus,
} from "./schema/menus.js";
import {
  placeOpenPeriod,
  resolveDepartmentService,
  resolveZoneMenus,
  servedDefault,
} from "./menu-timetable.js";
import { routingCells } from "./schema/routing.js";
import { readProfileZones } from "./profile-access.js";
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

/** Pads an `HH:MM` wall-clock time to the one stored spelling, `HH:MM:SS`; it checks length alone. */
export function storedTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

/** A zone's own all-day menu, else its department's; joined beside `zone_service_policies`. */
const allDayMenuId = sql<
  string | null
>`coalesce(${zoneAllDayMenus.menuId}, ${departmentAllDayMenus.menuId})`;
const zoneAllDayJoin = eq(zoneAllDayMenus.zoneId, zoneServicePolicies.zoneId);
const departmentAllDayJoin = eq(
  departmentAllDayMenus.departmentId,
  zoneServicePolicies.departmentId,
);

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

async function requireDepartmentName(
  tx: Transaction,
  cfg: VenueScope,
  name: string,
  ownId?: string,
): Promise<void> {
  const [other] = await tx
    .select({ id: departments.id, active: departments.active })
    .from(departments)
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        eq(departments.name, name),
        ownId === undefined ? undefined : ne(departments.id, ownId),
      ),
    );
  if (other === undefined) return;
  if (!other.active)
    throw new AppError("department.name_disabled", { name, departmentId: other.id });
  throw new AppError("department.name_taken", { name });
}

export async function createDepartment(
  tx: Transaction,
  cfg: VenueScope,
  input: { name: string; tradingName?: string; defaultServiceMode: ServiceMode },
): Promise<Department> {
  await requireDepartmentName(tx, cfg, input.name);
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
  const [location] = await tx
    .select({ menuId: locations.catalogueId })
    .from(locations)
    .where(eq(locations.id, cfg.locationId));
  if (location?.menuId !== null && location?.menuId !== undefined)
    await placeOpenPeriod(tx, cfg, row!.id, location.menuId);
  return { ...row!, defaultServiceMode: row!.defaultServiceMode as ServiceMode };
}

export async function updateDepartment(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  input: { name: string; tradingName: string; defaultServiceMode: ServiceMode },
): Promise<void> {
  await requireDepartmentName(tx, cfg, input.name, departmentId);
  const [row] = await tx
    .update(departments)
    .set(input)
    .where(and(eq(departments.id, departmentId), eq(departments.locationId, cfg.locationId)))
    .returning({ id: departments.id });
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
}

/** Leaves its zones disabled: disabling the department switched them off. */
export async function activateDepartment(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
): Promise<void> {
  const [row] = await tx
    .update(departments)
    .set({ active: true })
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

  await tx.delete(routingCells).where(eq(routingCells.zoneId, zoneId));
  await tx.delete(watcherZones).where(eq(watcherZones.zoneId, zoneId));
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
      defaultMenuId: allDayMenuId,
    })
    .from(floorZones)
    .leftJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, floorZones.id))
    .leftJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .leftJoin(zoneAllDayMenus, zoneAllDayJoin)
    .leftJoin(departmentAllDayMenus, departmentAllDayJoin)
    .where(and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.active, true)))
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);

  issues.push(
    ...zones.flatMap((zone): VenueReadinessIssue[] => {
      if (zone.departmentId === null || zone.departmentActive !== true) {
        return [{ code: "zone.department_missing", zoneId: zone.id, zoneName: zone.name }];
      }
      if (zone.defaultMenuId === null) {
        return [{ code: "zone.menu_missing", zoneId: zone.id, zoneName: zone.name }];
      }
      return [];
    }),
  );
  const ready = zones.filter(
    (zone) =>
      zone.departmentId !== null && zone.departmentActive === true && zone.defaultMenuId !== null,
  );
  if (ready.length === 0) return issues;
  const liveByZone = await liveDocumentsByZone(tx, cfg);
  for (const zone of ready) {
    const published = liveByZone.get(zone.id) ?? [];
    if (published.length === 0) {
      issues.push({ code: "zone.menu_unpublished", zoneId: zone.id, zoneName: zone.name });
      continue;
    }
    for (const { menuId, document } of published) {
      if (documentOffers(document).length === 0) {
        issues.push({
          code: "zone.menu_empty",
          zoneId: zone.id,
          zoneName: zone.name,
          menuId,
          menuName: document.menuName,
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
    .select({ id: floorZones.id, active: floorZones.active })
    .from(floorZones)
    .where(and(eq(floorZones.id, input.zoneId), eq(floorZones.locationId, cfg.locationId)));
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId: input.zoneId });
  const [department] = await tx
    .select({ id: departments.id, active: departments.active })
    .from(departments)
    .where(and(eq(departments.id, input.departmentId), eq(departments.locationId, cfg.locationId)));
  if (department === undefined) {
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  }
  if (zone.active && !department.active) {
    throw new AppError("zone.department_inactive", { zoneId: input.zoneId });
  }
  // A zone moving department drops its own menus, which named the old department's list and periods.
  await tx
    .delete(zoneAllDayMenus)
    .where(
      and(
        eq(zoneAllDayMenus.zoneId, input.zoneId),
        ne(zoneAllDayMenus.departmentId, input.departmentId),
      ),
    );
  await tx
    .delete(zonePeriodMenus)
    .where(
      and(
        eq(zonePeriodMenus.zoneId, input.zoneId),
        ne(zonePeriodMenus.departmentId, input.departmentId),
      ),
    );
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
  input: { name: string; departmentId: string; displayOrder?: number },
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
      .values({
        locationId: cfg.locationId,
        name: input.name,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning({ id: floorZones.id });
    zoneId = zone!.id;
  } catch (error) {
    if (
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_zones",
        columns: ["location_id", "name"],
      })
    ) {
      const [other] = await tx
        .select({ id: floorZones.id, active: floorZones.active })
        .from(floorZones)
        .where(and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.name, input.name)));
      if (other?.active === false)
        throw new AppError("zone.name_disabled", { name: input.name, zoneId: other.id });
      throw new AppError("zone.name_taken", { name: input.name });
    }
    throw error;
  }
  await configureZone(tx, cfg, { zoneId, departmentId: input.departmentId });
  return { id: zoneId };
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
}> {
  const [row] = await tx
    .select({
      zoneId: zoneServicePolicies.zoneId,
      departmentId: departments.id,
      departmentName: departments.name,
      zoneMode: zoneServicePolicies.serviceMode,
      departmentMode: departments.defaultServiceMode,
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

/** The active menus each of the venue's zones may sell from, in its department's order. */
async function zoneMenuIdsByZone(tx: Transaction, cfg: VenueScope): Promise<Map<string, string[]>> {
  const byZone = new Map<string, string[]>();
  for (const row of await tx
    .select({ zoneId: zoneServicePolicies.zoneId, menuId: departmentMenus.menuId })
    .from(departmentMenus)
    .innerJoin(
      zoneServicePolicies,
      eq(zoneServicePolicies.departmentId, departmentMenus.departmentId),
    )
    .innerJoin(catalogues, eq(catalogues.id, departmentMenus.menuId))
    .where(and(eq(zoneServicePolicies.locationId, cfg.locationId), eq(catalogues.active, true)))
    .orderBy(departmentMenus.displayOrder, departmentMenus.menuId)) {
    const menus = byZone.get(row.zoneId);
    if (menus === undefined) byZone.set(row.zoneId, [row.menuId]);
    else menus.push(row.menuId);
  }
  return byZone;
}

/**
 * Each zone's active menus that have a live version, in its department's order, with that
 * version's document: what `listZoneOffers` serves the zone from, without the live fields put back.
 */
export async function liveDocumentsByZone(
  tx: Transaction,
  cfg: VenueScope,
): Promise<Map<string, { menuId: string; document: MenuDocument }[]>> {
  const menusOf = await zoneMenuIdsByZone(tx, cfg);
  const live = await readLiveDocuments(tx, [...new Set([...menusOf.values()].flat())]);
  return new Map(
    [...menusOf].map(([zoneId, menuIds]) => [
      zoneId,
      menuIds.flatMap((menuId) => {
        const version = live.get(menuId);
        return version === undefined ? [] : [{ menuId, document: version.document }];
      }),
    ]),
  );
}

/** The active menus a zone may sell from: its department's, in the department's order. */
async function zoneMenuIds(tx: Transaction, zoneId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: departmentMenus.menuId })
    .from(departmentMenus)
    .innerJoin(
      zoneServicePolicies,
      eq(zoneServicePolicies.departmentId, departmentMenus.departmentId),
    )
    .innerJoin(catalogues, eq(catalogues.id, departmentMenus.menuId))
    .where(and(eq(zoneServicePolicies.zoneId, zoneId), eq(catalogues.active, true)))
    .orderBy(departmentMenus.displayOrder, departmentMenus.menuId);
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
 * (an unavailable offer is served marked, in its place), and that version's structure and Device
 * Home Page. An inactive menu, or one with no live version, is left out. The default is the menu
 * timetable's at `at` (now when absent), and one that is inactive or unpublished gives way to the
 * zone's first menu that is served; with `withDefault: false` the timetable is not read and no
 * menu is the default. Refused `menu.version_changed` unless every `asserted` version is the live
 * version of one of the zone's active menus. With `menuItemIds`, only the offers it names are
 * served; the menus are all listed.
 */
export async function listZoneOffers(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  options: {
    asserted?: readonly { menuId: string; versionId: string }[];
    menuItemIds?: readonly string[];
    at?: Date;
    withDefault?: false;
  } = {},
): Promise<ZoneOffers> {
  await resolveZoneContext(tx, cfg, zoneId);
  const published = await zoneLiveDocuments(tx, zoneId, options.asserted);
  const served = await applyLiveFields(
    tx,
    published.map((menu) => menu.document),
    options.menuItemIds === undefined ? undefined : new Set(options.menuItemIds),
  );
  const defaultMenuId =
    options.withDefault === false
      ? null
      : servedDefault(
          (await resolveZoneMenus(tx, cfg, zoneId, options.at ?? new Date())).defaultMenuId,
          published.map((menu) => menu.menuId),
        );
  // Catalogue's `ServedMenu` is the type the till reads each menu as.
  const menus: ServedMenu[] = published.map(({ menuId, versionId, document }) => ({
    id: menuId,
    name: document.menuName,
    isDefault: menuId === defaultMenuId,
    versionId,
    structure: document.root,
    home: document.home,
  }));
  return { defaultMenuId, menus, offers: published.flatMap((menu) => served.get(menu.menuId)!) };
}

export async function menuState(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date = new Date(),
): Promise<ZoneMenuState> {
  const [zone] = await tx
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(
      and(
        eq(zoneServicePolicies.zoneId, zoneId),
        eq(zoneServicePolicies.locationId, cfg.locationId),
      ),
    );
  if (zone?.departmentId == null)
    return {
      service: { open: false, periodName: null },
      menus: [],
      unavailable: { products: [], optionLabels: [] },
    };
  const service = await resolveDepartmentService(tx, cfg, zone.departmentId, at);
  const published = await zoneLiveDocuments(tx, zoneId);
  return {
    service: { open: service.open, periodName: service.periodName },
    menus: published.map(({ menuId, versionId }) => ({ menuId, versionId })),
    unavailable: await readUnavailable(
      tx,
      published.map((menu) => menu.document),
    ),
  };
}

/**
 * A new order's zone: the one named, else the profile's starting zone when the profile has a
 * department, else the venue's counter default. A named zone is not checked against the profile
 * here.
 */
export async function resolveNewOrderZone(
  tx: Transaction,
  cfg: VenueScope,
  input: { zoneId?: string | null; profileId?: string | null },
): Promise<{
  zoneId: string;
  departmentId: string;
  departmentName: string;
  serviceMode: ServiceMode;
}> {
  if (input.zoneId !== undefined && input.zoneId !== null) {
    return resolveZoneContext(tx, cfg, input.zoneId);
  }
  if (input.profileId !== undefined && input.profileId !== null) {
    const zones = await readProfileZones(tx, cfg, input.profileId);
    if (zones.departmentId !== null) {
      if (zones.startingZoneId === null) {
        throw new AppError("device_profile.no_service_zone", { profileId: input.profileId });
      }
      return resolveZoneContext(tx, cfg, zones.startingZoneId);
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
  const previous = await getOrderServiceContext(tx, cfg, workingOrderId);
  if (previous.departmentId !== context.departmentId)
    await withdrawPendingDepartmentTransfers(tx, [workingOrderId]);
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

/**
 * A WHERE condition that holds for an order whose recorded zone is one of `zoneIds`, or that has no
 * recorded zone at this location. `orderId` is the outer query's order id, table-qualified.
 */
export function orderInZones(cfg: VenueScope, orderId: SQL, zoneIds: readonly string[]): SQL {
  const outside =
    zoneIds.length === 0
      ? sql``
      : sql` and osc.zone_id not in (${sql.join(
          zoneIds.map((zoneId) => sql`${zoneId}`),
          sql`, `,
        )})`;
  return sql`not exists (select 1 from order_service_contexts osc
    where osc.working_order_id = ${orderId} and osc.location_id = ${cfg.locationId}${outside})`;
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
