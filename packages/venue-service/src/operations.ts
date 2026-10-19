import { rangeSpanInDay } from "./service-day.js";
import { readServiceDayPlan, serviceDayOf } from "./day-resolver.js";
import { specialDayReadiness } from "./special-days.js";
import type { LocalDate } from "./hours-types.js";
import {
  closedZoneIdsIn,
  zoneClosureDays,
  withoutZoneExtension,
  zoneExtensionForRange,
  type ZoneClosureDays,
} from "./zone-closed-times.js";
import { setDepartmentTransferSettings } from "./department-transfers.js";
import { withdrawPendingDepartmentTransfers } from "./department-transfer-lifecycle.js";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import {
  catalogues,
  floorZones,
  refusalOn,
  UNIQUE_VIOLATION,
  kitchenStations,
  locations,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  applyLiveFields,
  assertLiveVersions,
  documentOffers,
  isEachUnit,
  readLiveDocuments,
  readLiveState,
  NO_LIVE_FIELDS,
  units,
  type MenuDocument,
  type MenuOffer,
  type ServedMenu,
} from "@waitron/catalogue";
import type { PreparedServiceDay, ServiceMode, ZoneMenuState, ZoneOffers } from "@waitron/module";
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
import { menuPeriods, menuPeriodStaffMenus } from "./schema/menus.js";
import { departmentDayRanges, departmentDays } from "./schema/seasons.js";
import { placeOpenPeriod, resolveDepartmentService, servedDefault } from "./menu-timetable.js";
import { routingCellPeriods, routingCells } from "./schema/routing.js";
import { readProfileZones } from "./profile-access.js";
import "./errors.js";

export interface VenueScope {
  locationId: LocationId;
}

export interface Department {
  id: string;
  name: string;
  tradingName: string;
  active: boolean;
}

export async function listDepartments(
  tx: Transaction,
  cfg: VenueScope,
): Promise<(Department & { isDefault: boolean })[]> {
  const rows = await tx
    .select({
      id: departments.id,
      isDefault: departments.isDefault,
      name: departments.name,
      tradingName: departments.tradingName,
      active: departments.active,
    })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(desc(departments.isDefault), asc(departments.name), asc(departments.id));
  return rows;
}

/** Pads an `HH:MM` wall-clock time to the one stored spelling, `HH:MM:SS`; it checks length alone. */
export function storedTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

/** A stored `HH:MM:SS` time as the `HH:MM` the wire carries. */
export function wireTime(value: string): string {
  return value.slice(0, 5);
}

export async function listServiceZones(
  tx: Transaction,
  cfg: VenueScope,
  options: { withActiveFlag?: boolean } = {},
) {
  const rows = await tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: departments.id,
      departmentName: departments.name,
      zoneOrderStart: zoneSalePolicies.orderStart,
      departmentOrderStart: departmentSalePolicies.orderStart,
      zonePaidWhen: zoneSalePolicies.paidWhen,
      departmentPaidWhen: departmentSalePolicies.paidWhen,
      active: floorZones.active,
    })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .leftJoin(departmentSalePolicies, eq(departmentSalePolicies.departmentId, departments.id))
    .leftJoin(zoneSalePolicies, eq(zoneSalePolicies.zoneId, zoneServicePolicies.zoneId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(floorZones.active, true),
        eq(departments.active, true),
      ),
    )
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);
  return rows.map(
    ({
      zoneOrderStart,
      departmentOrderStart,
      zonePaidWhen,
      departmentPaidWhen,
      active,
      ...row
    }) => {
      const paidWhen = zonePaidWhen ?? departmentPaidWhen ?? "prepay";
      const serviceMode: ServiceMode =
        (zoneOrderStart ?? departmentOrderStart ?? "counter") === "table" ? "table_tab" : paidWhen;
      return {
        ...row,
        ...(options.withActiveFlag ? { active } : {}),
        serviceMode,
      };
    },
  );
}

export async function assertDepartment(tx: Transaction, cfg: VenueScope, departmentId: string) {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
}

async function requireDepartmentName(
  tx: Transaction,
  cfg: VenueScope,
  name: string,
  ownId?: string,
): Promise<void> {
  const [other] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        eq(departments.name, name),
        eq(departments.active, true),
        ownId === undefined ? undefined : ne(departments.id, ownId),
      ),
    );
  if (other === undefined) return;
  throw new AppError("department.name_taken", { name });
}

type OrderStart = "table" | "counter";

export async function createDepartment(
  tx: Transaction,
  cfg: VenueScope,
  input: {
    name: string;
    tradingName?: string;
    orderStart?: OrderStart;
  },
): Promise<Department> {
  await requireDepartmentName(tx, cfg, input.name);
  const [row] = await tx
    .insert(departments)
    .values({
      locationId: cfg.locationId,
      name: input.name,
      tradingName: input.tradingName ?? input.name,
    })
    .returning({
      id: departments.id,
      name: departments.name,
      tradingName: departments.tradingName,
      active: departments.active,
    });
  await tx
    .insert(departmentSalePolicies)
    .values({ departmentId: row!.id, orderStart: input.orderStart ?? "counter" });
  const [location] = await tx
    .select({ menuId: locations.catalogueId })
    .from(locations)
    .where(eq(locations.id, cfg.locationId));
  if (location?.menuId !== null && location?.menuId !== undefined)
    await placeOpenPeriod(tx, cfg, row!.id, location.menuId);
  return row!;
}

export async function updateDepartment(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  input: {
    name?: string;
    tradingName?: string;
    orderStart?: OrderStart;
    needsClearing?: boolean;
  },
): Promise<void> {
  await assertDepartment(tx, cfg, departmentId);
  if (input.name !== undefined) await requireDepartmentName(tx, cfg, input.name, departmentId);
  if (
    input.name !== undefined ||
    input.tradingName !== undefined ||
    input.needsClearing !== undefined
  )
    await tx
      .update(departments)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.tradingName === undefined ? {} : { tradingName: input.tradingName }),
        ...(input.needsClearing === undefined ? {} : { needsClearing: input.needsClearing }),
      })
      .where(eq(departments.id, departmentId));
  if (input.orderStart === undefined) return;
  await tx
    .update(departmentSalePolicies)
    .set({ orderStart: input.orderStart })
    .where(eq(departmentSalePolicies.departmentId, departmentId));
}

export type VenueReadinessIssue =
  | { code: "venue.default_station_missing" }
  | { code: "venue.department_missing" }
  | { code: "zone.department_missing"; zoneId: string; zoneName: string }
  | { code: "department.no_periods"; departmentId: string; departmentName: string }
  | { code: "zone.menu_unpublished"; zoneId: string; zoneName: string }
  | {
      code: "zone.menu_empty";
      zoneId: string;
      zoneName: string;
      menuId: string;
      menuName: string;
    }
  | {
      code: "special_day.holiday_missing";
      specialDayId: string;
      holidayName: string;
      year: number;
    }
  | {
      code: "special_day.date_shared";
      date: LocalDate;
      specialDayId: string;
      specialDayName: string;
      otherSpecialDayId: string;
      otherSpecialDayName: string;
    };

/** Describe configuration that prevents an active zone from accepting new orders, and, for the
 *  current and next year, each repeating holiday date that will not apply and each special-day date
 *  that falls where another special day applies. */
export async function listVenueReadiness(
  tx: Transaction,
  cfg: VenueScope,
  at: Date = new Date(),
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
  const specialDayIssues = await specialDayReadiness(tx, cfg, at);
  const issues: VenueReadinessIssue[] = [
    ...(defaultStation === undefined ? [{ code: "venue.default_station_missing" as const }] : []),
    ...specialDayIssues.missing.map((missing) => ({
      code: "special_day.holiday_missing" as const,
      ...missing,
    })),
    ...specialDayIssues.clashes.map((clash) => ({
      code: "special_day.date_shared" as const,
      ...clash,
    })),
  ];
  const activeDepartments = await tx
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(asc(departments.name), asc(departments.id));
  if (activeDepartments.length === 0) return [...issues, { code: "venue.department_missing" }];
  const placed = await tx
    .selectDistinct({ departmentId: departmentDays.departmentId })
    .from(departmentDays)
    .innerJoin(departmentDayRanges, eq(departmentDayRanges.dayId, departmentDays.id))
    .where(
      and(
        inArray(
          departmentDays.departmentId,
          activeDepartments.map((department) => department.id),
        ),
        isNotNull(departmentDays.seasonId),
        isNotNull(departmentDayRanges.periodId),
      ),
    );
  const placedDepartments = new Set(placed.map((row) => row.departmentId));
  for (const department of activeDepartments) {
    if (!placedDepartments.has(department.id))
      issues.push({
        code: "department.no_periods",
        departmentId: department.id,
        departmentName: department.name,
      });
  }

  const zones = await tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: zoneServicePolicies.departmentId,
      departmentActive: departments.active,
    })
    .from(floorZones)
    .leftJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, floorZones.id))
    .leftJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(and(eq(floorZones.locationId, cfg.locationId), eq(floorZones.active, true)))
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);

  issues.push(
    ...zones.flatMap((zone): VenueReadinessIssue[] => {
      if (zone.departmentId === null || zone.departmentActive !== true) {
        return [{ code: "zone.department_missing", zoneId: zone.id, zoneName: zone.name }];
      }
      return [];
    }),
  );
  const ready = zones.filter(
    (zone) => zone.departmentId !== null && zone.departmentActive === true,
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
  input: {
    zoneId: string;
    departmentId: string;
    orderStart?: OrderStart | null;
  },
): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id, active: floorZones.active })
    .from(floorZones)
    .where(
      and(
        eq(floorZones.id, input.zoneId),
        eq(floorZones.locationId, cfg.locationId),
        eq(floorZones.active, true),
      ),
    );
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId: input.zoneId });
  const [department] = await tx
    .select({ id: departments.id, active: departments.active })
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (department === undefined) {
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  }
  const [existing] = await tx
    .select({ zoneId: zoneServicePolicies.zoneId })
    .from(zoneServicePolicies)
    .where(eq(zoneServicePolicies.zoneId, input.zoneId));
  await tx
    .insert(zoneServicePolicies)
    .values({
      locationId: cfg.locationId,
      zoneId: input.zoneId,
      departmentId: input.departmentId,
    })
    .onConflictDoUpdate({
      target: [zoneServicePolicies.zoneId],
      set: { departmentId: input.departmentId },
    });
  // A zone cell may name only its department's periods.
  await tx
    .delete(routingCellPeriods)
    .where(
      and(
        ne(routingCellPeriods.departmentId, input.departmentId),
        inArray(
          routingCellPeriods.cellId,
          tx
            .select({ id: routingCells.id })
            .from(routingCells)
            .where(eq(routingCells.zoneId, input.zoneId)),
        ),
      ),
    );
  if (input.orderStart === undefined && existing !== undefined) {
    await tx
      .insert(zoneSalePolicies)
      .values({ zoneId: input.zoneId })
      .onConflictDoNothing({ target: zoneSalePolicies.zoneId });
    return;
  }
  await tx
    .insert(zoneSalePolicies)
    .values({ zoneId: input.zoneId, orderStart: input.orderStart ?? null })
    .onConflictDoUpdate({
      target: zoneSalePolicies.zoneId,
      set: { orderStart: input.orderStart ?? null },
    });
}

/** Create the floor zone and its service assignment in the caller's one write transaction. */
export async function createServiceZone(
  tx: Transaction,
  cfg: VenueScope,
  input: {
    name: string;
    departmentId: string;
    displayOrder?: number;
    orderStart?: OrderStart | null;
  },
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
      throw new AppError("zone.name_taken", { name: input.name });
    }
    throw error;
  }
  await configureZone(tx, cfg, {
    zoneId,
    departmentId: input.departmentId,
    orderStart: input.orderStart,
  });
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
      zoneOrderStart: zoneSalePolicies.orderStart,
      departmentOrderStart: departmentSalePolicies.orderStart,
      zonePaidWhen: zoneSalePolicies.paidWhen,
      departmentPaidWhen: departmentSalePolicies.paidWhen,
    })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .leftJoin(departmentSalePolicies, eq(departmentSalePolicies.departmentId, departments.id))
    .leftJoin(zoneSalePolicies, eq(zoneSalePolicies.zoneId, zoneServicePolicies.zoneId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(zoneServicePolicies.zoneId, zoneId),
        eq(departments.active, true),
        eq(floorZones.active, true),
        eq(floorZones.locationId, cfg.locationId),
      ),
    );
  if (row === undefined) throw new AppError("service_zone.not_found", { zoneId });
  return {
    zoneId: row.zoneId,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    serviceMode:
      (row.zoneOrderStart ?? row.departmentOrderStart ?? "counter") === "table"
        ? "table_tab"
        : (row.zonePaidWhen ?? row.departmentPaidWhen ?? "prepay"),
  };
}

type DepartmentSalePolicyRow = typeof departmentSalePolicies.$inferSelect;

export interface EffectiveSalePolicy {
  orderStart: "table" | "counter";
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
      departmentOrderStart: departmentSalePolicies.orderStart,
      departmentPaidWhen: departmentSalePolicies.paidWhen,
      departmentCollectionNumber: departmentSalePolicies.collectionNumber,
      departmentReceiptMode: departmentSalePolicies.receiptPrintMode,
      printTradingName: departmentSalePolicies.printTradingName,
      zoneOrderStart: zoneSalePolicies.orderStart,
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
    orderStart: row.zoneOrderStart ?? row.departmentOrderStart,
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
  "orderStart" | "paidWhen" | "collectionNumber" | "receiptPrintMode" | "printTradingName"
>;
type ZoneSalePolicyRow = typeof zoneSalePolicies.$inferSelect;
type ZonePolicyField = Pick<
  ZoneSalePolicyRow,
  "orderStart" | "paidWhen" | "collectionNumber" | "receiptPrintMode"
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
      const raw = zonesById.get(zone.id) ?? {
        zoneId: zone.id,
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
      };
      const inherited = departmentsById.get(zone.departmentId);
      return {
        ...raw,
        effective: {
          orderStart: raw.orderStart ?? inherited?.orderStart ?? "counter",
          paidWhen: raw.paidWhen ?? inherited?.paidWhen ?? "prepay",
          collectionNumber: raw.collectionNumber ?? inherited?.collectionNumber ?? "none",
          receiptPrintMode: raw.receiptPrintMode ?? inherited?.receiptPrintMode ?? "auto",
          printTradingName: inherited?.printTradingName ?? false,
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
    .insert(departmentSalePolicies)
    .values({ departmentId, [field]: value })
    .onConflictDoUpdate({
      target: departmentSalePolicies.departmentId,
      set: { [field]: value },
    });
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
    .insert(zoneSalePolicies)
    .values({ zoneId, [field]: value })
    .onConflictDoUpdate({
      target: zoneSalePolicies.zoneId,
      set: { [field]: value },
    });
}

export interface DepartmentEditInput extends Pick<
  DepartmentPolicyField,
  "orderStart" | "paidWhen" | "collectionNumber"
> {
  name: string;
  tradingName: string;
  transfers?: { receivingProfileId: string | null; destinationDepartmentIds: string[] };
  needsClearing?: boolean;
}

export async function saveDepartmentEditSettings(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  input: DepartmentEditInput,
): Promise<void> {
  await updateDepartment(tx, cfg, departmentId, {
    name: input.name,
    tradingName: input.tradingName,
    ...(input.needsClearing === undefined ? {} : { needsClearing: input.needsClearing }),
  });
  const settings = {
    orderStart: input.orderStart,
    paidWhen: input.paidWhen,
    collectionNumber: input.collectionNumber,
  };
  await tx
    .insert(departmentSalePolicies)
    .values({
      departmentId,
      ...settings,
      receiptPrintMode: "auto",
      printTradingName: false,
    })
    .onConflictDoUpdate({ target: departmentSalePolicies.departmentId, set: settings });
  if (input.transfers !== undefined)
    await setDepartmentTransferSettings(tx, cfg, departmentId, input.transfers);
}

export type ZoneServiceSettingsInput = ZonePolicyField;

export type ZoneEditInput = ZoneServiceSettingsInput & { name: string };

export async function saveZoneSettings(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  input: ZoneEditInput,
): Promise<void> {
  if (!(await listServiceZones(tx, cfg)).some((zone) => zone.id === zoneId))
    throw new AppError("service_zone.not_found", { zoneId });
  try {
    await tx.update(floorZones).set({ name: input.name }).where(eq(floorZones.id, zoneId));
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
  await saveZoneServiceSettings(tx, cfg, zoneId, input);
}

export async function saveZoneServiceSettings(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  input: ZoneServiceSettingsInput,
): Promise<void> {
  await setZoneSalePolicyOverride(tx, cfg, zoneId, "orderStart", input.orderStart);
  await setZoneSalePolicyOverride(tx, cfg, zoneId, "paidWhen", input.paidWhen);
  await setZoneSalePolicyOverride(tx, cfg, zoneId, "collectionNumber", input.collectionNumber);
  await setZoneSalePolicyOverride(tx, cfg, zoneId, "receiptPrintMode", input.receiptPrintMode);
}

async function zoneMenuIdsByZone(tx: Transaction, cfg: VenueScope): Promise<Map<string, string[]>> {
  const byZone = new Map<string, string[]>();
  for (const row of await zonePeriodMembership(tx, { locationId: cfg.locationId })) {
    const menus = byZone.get(row.zoneId);
    if (menus === undefined) byZone.set(row.zoneId, [row.menuId]);
    else if (!menus.includes(row.menuId)) menus.push(row.menuId);
  }
  return byZone;
}

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

async function zonePeriodMembership(tx: Transaction, scope: { zoneId: string } | VenueScope) {
  const where = and(
    "zoneId" in scope
      ? eq(zoneServicePolicies.zoneId, scope.zoneId)
      : eq(zoneServicePolicies.locationId, scope.locationId),
    eq(catalogues.active, true),
  );
  const customer = await tx
    .select({
      zoneId: zoneServicePolicies.zoneId,
      menuId: menuPeriods.menuId,
      periodId: menuPeriods.id,
    })
    .from(menuPeriods)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.departmentId, menuPeriods.departmentId))
    .innerJoin(catalogues, eq(catalogues.id, menuPeriods.menuId))
    .where(where)
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const staff = await tx
    .select({
      zoneId: zoneServicePolicies.zoneId,
      menuId: menuPeriodStaffMenus.menuId,
      periodId: menuPeriods.id,
    })
    .from(menuPeriodStaffMenus)
    .innerJoin(menuPeriods, eq(menuPeriods.id, menuPeriodStaffMenus.periodId))
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.departmentId, menuPeriods.departmentId))
    .innerJoin(catalogues, eq(catalogues.id, menuPeriodStaffMenus.menuId))
    .where(where)
    .orderBy(
      asc(menuPeriods.name),
      asc(menuPeriods.id),
      asc(menuPeriodStaffMenus.displayOrder),
      asc(menuPeriodStaffMenus.menuId),
    );
  return [
    ...customer.map((row) => ({ ...row, audience: "customer" as const })),
    ...staff.map((row) => ({ ...row, audience: "staff" as const })),
  ];
}

async function zoneMenuIds(tx: Transaction, zoneId: string): Promise<string[]> {
  return [...new Set((await zonePeriodMembership(tx, { zoneId })).map((row) => row.menuId))];
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
  menuIds?: readonly string[],
): Promise<{ menuId: string; versionId: string; document: MenuDocument }[]> {
  const ids = menuIds ?? (await zoneMenuIds(tx, zoneId));
  const live = await assertLiveVersions(tx, ids, asserted);
  return ids.flatMap((menuId) => {
    const version = live.get(menuId);
    return version === undefined ? [] : [{ menuId, ...version }];
  });
}

export interface ServiceZoneOffers extends ZoneOffers {
  readonly menus: readonly (ServedMenu & {
    readonly audience: "customer" | "staff";
    readonly orderable: boolean;
    readonly sendable: boolean;
  })[];
}

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
): Promise<ServiceZoneOffers> {
  const context = await resolveZoneContext(tx, cfg, zoneId);
  const membership = await zonePeriodMembership(tx, { zoneId });
  const published = await zoneLiveDocuments(tx, zoneId, options.asserted, [
    ...new Set(membership.map((row) => row.menuId)),
  ]);
  const { offers: served, liveFields } = await applyLiveFields(
    tx,
    published.map((menu) => menu.document),
    options.menuItemIds === undefined ? undefined : new Set(options.menuItemIds),
  );
  const at = options.at ?? new Date();
  const state =
    options.withDefault === false
      ? null
      : await zoneServiceState(tx, cfg, zoneId, context.departmentId, at);
  const service = state?.service ?? null;
  const defaultMenuId = service?.open
    ? servedDefault(
        service.customerMenuId,
        published
          .map((menu) => menu.menuId)
          .filter((menuId) => service.orderableMenuIds.includes(menuId)),
      )
    : null;
  const menus: ServiceZoneOffers["menus"] = published.map(({ menuId, versionId, document }) => ({
    id: menuId,
    name: document.menuName,
    isDefault: menuId === defaultMenuId,
    audience: (membership.find(
      (row) => row.menuId === menuId && row.periodId === service?.periodId,
    ) ?? membership.find((row) => row.menuId === menuId))!.audience,
    orderable: service === null || service.orderableMenuIds.includes(menuId),
    sendable: service === null || service.sendableMenuIds.includes(menuId),
    versionId,
    structure: document.root,
    home: document.home,
  }));
  return {
    defaultMenuId,
    service: {
      open: service?.open ?? true,
      zoneOpen: state?.zoneOpen ?? true,
      periodName: service?.periodName ?? null,
      periodOccurrenceKey: service?.periodOccurrenceKey ?? null,
      keepOpen: service?.keepOpen ?? null,
      zoneKeepOpen: state?.zoneKeepOpen ?? null,
    },
    menus,
    offers: published.flatMap((menu) => served.get(menu.menuId)!),
    liveFields,
  };
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
      service: {
        open: false,
        zoneOpen: true,
        periodName: null,
        periodOccurrenceKey: null,
        keepOpen: null,
        zoneKeepOpen: null,
      },
      menus: [],
      unavailable: { products: [], optionLabels: [] },
      liveFields: NO_LIVE_FIELDS,
    };
  const { service, zoneOpen, zoneKeepOpen } = await zoneServiceState(
    tx,
    cfg,
    zoneId,
    zone.departmentId,
    at,
  );
  const published = await zoneLiveDocuments(tx, zoneId);
  const live = await readLiveState(
    tx,
    published.map((menu) => menu.document),
  );
  return {
    service: {
      open: service.open,
      zoneOpen,
      periodName: service.periodName,
      periodOccurrenceKey: service.periodOccurrenceKey,
      keepOpen: service.keepOpen,
      zoneKeepOpen,
    },
    menus: published.map(({ menuId, versionId }) => ({
      menuId,
      versionId,
      orderable: service.orderableMenuIds.includes(menuId),
      sendable: service.sendableMenuIds.includes(menuId),
    })),
    ...live,
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
  await tx.insert(orderServiceContexts).values({
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
  const previous = await getOrderServiceContext(tx, cfg, workingOrderId);
  if (previous.departmentId !== context.departmentId)
    await withdrawPendingDepartmentTransfers(tx, [workingOrderId]);
  const updated = await tx
    .update(orderServiceContexts)
    .set({
      zoneId: context.zoneId,
      departmentId: context.departmentId,
      serviceMode: context.serviceMode,
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

/** `orderId` must be table-qualified so a base-table query correlates to its outer order. */
export function orderZoneIdSql(cfg: VenueScope, orderId: SQL): SQL {
  return sql`(select osc.zone_id from order_service_contexts osc
    where osc.working_order_id = ${orderId} and osc.location_id = ${cfg.locationId})`;
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

type ZoneKeepOpenState = NonNullable<ZoneMenuState["service"]["zoneKeepOpen"]>;

/** The floor closing summary of each zone with a closure still to come today. */
async function keepOpenStatesIn(
  tx: Transaction,
  days: ZoneClosureDays,
): Promise<Map<string, ZoneKeepOpenState>> {
  const states = new Map<string, ZoneKeepOpenState>();
  const { moment, dayContext } = days;
  if (moment === null || dayContext === null) return states;
  const closing = [...days.zones].flatMap(([zoneId, zone]) => {
    const closure = zone.ranges.find(
      (range) => rangeSpanInDay(range, dayContext).end > moment.minute,
    );
    return closure === undefined ? [] : [{ zoneId, zone, closure }];
  });
  if (closing.length === 0) return states;
  const names = new Map(
    (
      await tx
        .select({ id: floorZones.id, name: floorZones.name })
        .from(floorZones)
        .where(
          inArray(
            floorZones.id,
            closing.map((entry) => entry.zoneId),
          ),
        )
    ).map((row) => [row.id, row.name]),
  );
  for (const { zoneId, zone, closure } of closing) {
    const extended = zoneExtensionForRange(zone.extension, closure, days.cutover);
    states.set(zoneId, {
      zoneId,
      zoneName: names.get(zoneId)!,
      closesAt: extended?.endsAt ?? closure.startsAt,
      running: !withoutZoneExtension(zone.ranges, zone.extension, days.cutover).some((range) => {
        const span = rangeSpanInDay(range, dayContext);
        return span.start <= moment.minute && moment.minute < span.end;
      }),
      extendedUntil: extended?.endsAt ?? null,
    });
  }
  return states;
}

export async function readZoneClosingStates(
  tx: Transaction,
  cfg: VenueScope,
  zoneIds: readonly string[],
  at: Date,
  prepared?: PreparedServiceDay,
): Promise<Map<string, { closed: boolean; keepOpen: ZoneKeepOpenState | null }>> {
  if (zoneIds.length === 0) return new Map();
  const days = await zoneClosureDays(tx, cfg, zoneIds, at, serviceDayOf(prepared));
  const closed = closedZoneIdsIn(days);
  const keepOpen = await keepOpenStatesIn(tx, days);
  return new Map(
    zoneIds.map((zoneId) => [
      zoneId,
      { closed: closed.has(zoneId), keepOpen: keepOpen.get(zoneId) ?? null },
    ]),
  );
}

export async function readZoneKeepOpenState(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  at: Date,
): Promise<ZoneKeepOpenState | null> {
  return (await readZoneClosingStates(tx, cfg, [zoneId], at)).get(zoneId)!.keepOpen;
}

/** The department's service and the zone's own closure state at `at`, sharing one clock and
 *  one day plan between them. */
async function zoneServiceState(
  tx: Transaction,
  cfg: VenueScope,
  zoneId: string,
  departmentId: string,
  at: Date,
) {
  const prepared = await readServiceDayPlan(tx, cfg, at);
  const service = await resolveDepartmentService(tx, cfg, departmentId, at, prepared);
  const zoneDay = await zoneClosureDays(tx, cfg, [zoneId], at, prepared);
  return {
    service,
    zoneOpen: !closedZoneIdsIn(zoneDay).has(zoneId),
    zoneKeepOpen: (await keepOpenStatesIn(tx, zoneDay)).get(zoneId) ?? null,
  };
}
