import { saveDepartmentCourseSettings, type DepartmentCourseSetting } from "./release-reminders.js";
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
import {
  addStarterServiceSteps,
  saveServiceSteps,
  type ServiceStepInput,
} from "./service-steps.js";
import { withdrawPendingDepartmentTransfers } from "./department-transfer-lifecycle.js";
import { applyDepartmentDining } from "./dining.js";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import {
  openingHours,
  menus,
  departments,
  departmentCourses,
  floorZones,
  insertInChunks,
  menuPeriods,
  refusalOn,
  routingCellPeriods,
  routingCells,
  saleReceiptHeaders,
  UNIQUE_VIOLATION,
  kitchenStations,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  applyLiveFields,
  assertLiveVersions,
  documentOffers,
  isEachUnit,
  readLiveDocuments,
  readRecordedDocuments,
  readLiveState,
  NO_LIVE_FIELDS,
  units,
  type MenuDocument,
  type MenuOffer,
  type ServedMenu,
} from "@waitron/menu";
import type {
  LateSendMark,
  LineContextColumns,
  LineContextInput,
  PreparedServiceDay,
  ServiceMode,
  ZoneMenuState,
  ZoneOffers,
  ZoneMenuOffer,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { placeOpenPeriod, resolveDepartmentService, servedDefault } from "./menu-timetable.js";
import { readStarterStaffLanguage } from "./starter-language.js";
import { readProfileZones } from "./profile-access.js";
import "./errors.js";
import { readDefaultMenuId } from "@waitron/menu";

export interface Department {
  id: string;
  name: string;
  tradingName: string;
  active: boolean;
}

export async function listDepartments(
  tx: Transaction,
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
    .where(eq(departments.active, true))
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
  options: { withActiveFlag?: boolean } = {},
) {
  const rows = await tx
    .select({
      id: floorZones.id,
      name: floorZones.name,
      departmentId: departments.id,
      departmentName: departments.name,
      zoneOrderStart: floorZones.orderStart,
      departmentOrderStart: departments.orderStart,
      zonePaidWhen: floorZones.paidWhen,
      departmentPaidWhen: departments.paidWhen,
      active: floorZones.active,
    })
    .from(floorZones)
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(and(eq(floorZones.active, true), eq(departments.active, true)))
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

export async function assertDepartment(tx: Transaction, departmentId: string) {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.active, true)));
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
}

async function requireDepartmentName(tx: Transaction, name: string, ownId?: string): Promise<void> {
  const [other] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
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
  input: {
    name: string;
    tradingName?: string;
    orderStart?: OrderStart;
  },
): Promise<Department> {
  await requireDepartmentName(tx, input.name);
  const [row] = await tx
    .insert(departments)
    .values({
      name: input.name,
      tradingName: input.tradingName ?? input.name,
      orderStart: input.orderStart ?? "counter",
    })
    .returning({
      id: departments.id,
      name: departments.name,
      tradingName: departments.tradingName,
      active: departments.active,
    });
  const defaults = await tx
    .select({
      courseId: departmentCourses.courseId,
      heldUntilFired: departmentCourses.heldUntilFired,
      reminderMinutes: departmentCourses.reminderMinutes,
    })
    .from(departmentCourses)
    .innerJoin(departments, eq(departments.id, departmentCourses.departmentId))
    .where(and(eq(departments.isDefault, true), eq(departments.active, true)));
  if (defaults.length > 0)
    await insertInChunks(
      tx,
      departmentCourses,
      defaults.map((setting) => ({ departmentId: row!.id, ...setting })),
    );
  const staffLanguage = await readStarterStaffLanguage(tx);
  await addStarterServiceSteps(tx, row!.id, staffLanguage);
  const menuId = await readDefaultMenuId(tx);
  if (menuId !== null) await placeOpenPeriod(tx, row!.id, menuId, staffLanguage);
  return row!;
}

export async function updateDepartment(
  tx: Transaction,
  departmentId: string,
  input: {
    name?: string;
    tradingName?: string;
    orderStart?: OrderStart;
    needsClearing?: boolean;
    lateSendNeedsManager?: boolean;
  },
): Promise<void> {
  await assertDepartment(tx, departmentId);
  if (input.name !== undefined) await requireDepartmentName(tx, input.name, departmentId);
  if (
    input.name !== undefined ||
    input.tradingName !== undefined ||
    input.orderStart !== undefined ||
    input.needsClearing !== undefined ||
    input.lateSendNeedsManager !== undefined
  )
    await tx
      .update(departments)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.tradingName === undefined ? {} : { tradingName: input.tradingName }),
        ...(input.orderStart === undefined ? {} : { orderStart: input.orderStart }),
        ...(input.needsClearing === undefined ? {} : { needsClearing: input.needsClearing }),
        ...(input.lateSendNeedsManager === undefined
          ? {}
          : { lateSendNeedsManager: input.lateSendNeedsManager }),
      })
      .where(eq(departments.id, departmentId));
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
      code: "special_day.date_shared";
      date: LocalDate;
      specialDayId: string;
      specialDayName: string;
      otherSpecialDayId: string;
      otherSpecialDayName: string;
    };

/** Describe configuration that prevents an active zone from accepting new orders, and, for the
 *  current and next year, each special-day date that falls where another special day applies. */
export async function listVenueReadiness(
  tx: Transaction,
  at: Date = new Date(),
): Promise<VenueReadinessIssue[]> {
  const [defaultStation] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.isDefault, true), eq(kitchenStations.active, true)))
    .limit(1);
  const clashes = await specialDayReadiness(tx, at);
  const issues: VenueReadinessIssue[] = [
    ...(defaultStation === undefined ? [{ code: "venue.default_station_missing" as const }] : []),
    ...clashes.map((clash) => ({
      code: "special_day.date_shared" as const,
      ...clash,
    })),
  ];
  const activeDepartments = await tx
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.active, true))
    .orderBy(asc(departments.name), asc(departments.id));
  if (activeDepartments.length === 0) return [...issues, { code: "venue.department_missing" }];
  const placed = await tx
    .selectDistinct({ departmentId: openingHours.departmentId })
    .from(openingHours)
    .where(
      and(
        inArray(
          openingHours.departmentId,
          activeDepartments.map((department) => department.id),
        ),
        isNotNull(openingHours.seasonId),
        isNotNull(openingHours.periodId),
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
      departmentId: floorZones.departmentId,
      departmentActive: departments.active,
    })
    .from(floorZones)
    .leftJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(eq(floorZones.active, true))
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);

  issues.push(
    ...zones.flatMap((zone): VenueReadinessIssue[] => {
      if (zone.departmentActive !== true) {
        return [{ code: "zone.department_missing", zoneId: zone.id, zoneName: zone.name }];
      }
      return [];
    }),
  );
  const ready = zones.filter((zone) => zone.departmentActive === true);
  if (ready.length === 0) return issues;
  const liveByZone = await liveDocumentsByZone(tx);
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
  input: {
    zoneId: string;
    departmentId: string;
    orderStart?: OrderStart | null;
  },
): Promise<void> {
  const [zone] = await tx
    .select({ id: floorZones.id, active: floorZones.active })
    .from(floorZones)
    .where(and(eq(floorZones.id, input.zoneId), eq(floorZones.active, true)));
  if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId: input.zoneId });
  const [department] = await tx
    .select({ id: departments.id, active: departments.active })
    .from(departments)
    .where(and(eq(departments.id, input.departmentId), eq(departments.active, true)));
  if (department === undefined) {
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  }
  await tx
    .update(floorZones)
    .set({
      departmentId: input.departmentId,
      ...(input.orderStart === undefined ? {} : { orderStart: input.orderStart }),
    })
    .where(and(eq(floorZones.id, input.zoneId), eq(floorZones.active, true)));
  // A zone cell may name only its department's periods.
  await tx
    .delete(routingCellPeriods)
    .where(
      and(
        inArray(
          routingCellPeriods.periodId,
          tx
            .select({ id: menuPeriods.id })
            .from(menuPeriods)
            .where(ne(menuPeriods.departmentId, input.departmentId)),
        ),
        inArray(
          routingCellPeriods.cellId,
          tx
            .select({ id: routingCells.id })
            .from(routingCells)
            .where(eq(routingCells.zoneId, input.zoneId)),
        ),
      ),
    );
}

export async function createServiceZone(
  tx: Transaction,
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
    .where(and(eq(departments.id, input.departmentId), eq(departments.active, true)));
  if (department === undefined)
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  let zoneId: string;
  try {
    const [zone] = await tx
      .insert(floorZones)
      .values({
        name: input.name,
        displayOrder: input.displayOrder ?? 0,
        departmentId: input.departmentId,
        orderStart: input.orderStart ?? null,
      })
      .returning({ id: floorZones.id });
    zoneId = zone!.id;
  } catch (error) {
    if (
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_zones",
        columns: ["name"],
      })
    ) {
      throw new AppError("zone.name_taken", { name: input.name });
    }
    throw error;
  }
  return { id: zoneId };
}

export async function resolveZoneContext(
  tx: Transaction,
  zoneId: string,
): Promise<{
  zoneId: string;
  departmentId: string;
  departmentName: string;
  serviceMode: ServiceMode;
}> {
  const [row] = await tx
    .select({
      zoneId: floorZones.id,
      departmentId: departments.id,
      departmentName: departments.name,
      zoneOrderStart: floorZones.orderStart,
      departmentOrderStart: departments.orderStart,
      zonePaidWhen: floorZones.paidWhen,
      departmentPaidWhen: departments.paidWhen,
    })
    .from(floorZones)
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(
      and(eq(floorZones.id, zoneId), eq(departments.active, true), eq(floorZones.active, true)),
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

type DepartmentSalePolicyRow = typeof departments.$inferSelect;

export interface EffectiveSalePolicy {
  orderStart: "table" | "counter";
  zoneId: string;
  departmentId: string;
  departmentName: string;
  tradingName: string;
  paidWhen: DepartmentSalePolicyRow["paidWhen"];
  collectionNumber: DepartmentSalePolicyRow["collectionNumber"];
  printTradingName: boolean;
  dining: DepartmentSalePolicyRow["dining"];
  diningStartsAs: DepartmentSalePolicyRow["diningStartsAs"];
}

export async function resolveSalePolicy(
  tx: Transaction,
  zoneId: string,
): Promise<EffectiveSalePolicy> {
  const [row] = await tx
    .select({
      zoneId: floorZones.id,
      departmentId: departments.id,
      departmentName: departments.name,
      tradingName: departments.tradingName,
      departmentOrderStart: departments.orderStart,
      departmentPaidWhen: departments.paidWhen,
      departmentCollectionNumber: departments.collectionNumber,
      printTradingName: departments.printTradingName,
      dining: departments.dining,
      diningStartsAs: departments.diningStartsAs,
      zoneOrderStart: floorZones.orderStart,
      zonePaidWhen: floorZones.paidWhen,
      zoneCollectionNumber: floorZones.collectionNumber,
    })
    .from(floorZones)
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(and(eq(floorZones.id, zoneId), eq(departments.active, true)));
  if (row === undefined) throw new AppError("service_zone.not_found", { zoneId });
  return {
    zoneId: row.zoneId,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    tradingName: row.tradingName,
    orderStart: row.zoneOrderStart ?? row.departmentOrderStart,
    paidWhen: row.zonePaidWhen ?? row.departmentPaidWhen,
    collectionNumber: row.zoneCollectionNumber ?? row.departmentCollectionNumber,
    printTradingName: row.printTradingName,
    dining: row.dining,
    diningStartsAs: row.diningStartsAs,
  };
}

export async function recordSaleReceiptHeader(
  tx: Transaction,
  saleId: string,
  zoneId: string | null,
): Promise<void> {
  const policy = zoneId === null ? null : await resolveSalePolicy(tx, zoneId);
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
  "orderStart" | "paidWhen" | "collectionNumber" | "printTradingName" | "dining" | "diningStartsAs"
>;
type ZoneSalePolicyRow = Pick<
  typeof floorZones.$inferSelect,
  "orderStart" | "paidWhen" | "collectionNumber"
> & { zoneId: string };
type ZonePolicyField = Pick<ZoneSalePolicyRow, "orderStart" | "paidWhen" | "collectionNumber">;

export async function listSalePolicies(tx: Transaction) {
  const activeDepartments = await listDepartments(tx);
  const activeZones = await listServiceZones(tx);
  const departmentIds = new Set(activeDepartments.map((department) => department.id));
  const zoneIds = new Set(activeZones.map((zone) => zone.id));
  const departmentRows = await tx
    .select({
      departmentId: departments.id,
      orderStart: departments.orderStart,
      paidWhen: departments.paidWhen,
      collectionNumber: departments.collectionNumber,
      printTradingName: departments.printTradingName,
      dining: departments.dining,
      diningStartsAs: departments.diningStartsAs,
    })
    .from(departments)
    .where(inArray(departments.id, [...departmentIds]));
  const zoneRows = await tx
    .select({
      zoneId: floorZones.id,
      orderStart: floorZones.orderStart,
      paidWhen: floorZones.paidWhen,
      collectionNumber: floorZones.collectionNumber,
    })
    .from(floorZones)
    .where(and(eq(floorZones.active, true), inArray(floorZones.id, [...zoneIds])));
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
      };
      const inherited = departmentsById.get(zone.departmentId);
      return {
        ...raw,
        effective: {
          orderStart: raw.orderStart ?? inherited?.orderStart ?? "counter",
          paidWhen: raw.paidWhen ?? inherited?.paidWhen ?? "prepay",
          collectionNumber: raw.collectionNumber ?? inherited?.collectionNumber ?? "none",
          printTradingName: inherited?.printTradingName ?? false,
        },
      };
    }),
  };
}

export async function setDepartmentSalePolicyField<K extends keyof DepartmentPolicyField>(
  tx: Transaction,
  departmentId: string,
  field: K,
  value: DepartmentPolicyField[K],
): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.active, true)));
  if (department === undefined) throw new AppError("department.not_found", { departmentId });
  await tx
    .update(departments)
    .set({ [field]: value })
    .where(eq(departments.id, departmentId));
}

export async function setZoneSalePolicyOverride<K extends keyof ZonePolicyField>(
  tx: Transaction,
  zoneId: string,
  field: K,
  value: ZonePolicyField[K],
): Promise<void> {
  if (!(await listServiceZones(tx)).some((zone) => zone.id === zoneId)) {
    throw new AppError("service_zone.not_found", { zoneId });
  }
  await tx
    .update(floorZones)
    .set({ [field]: value })
    .where(and(eq(floorZones.id, zoneId), eq(floorZones.active, true)));
}

export interface DepartmentEditInput
  extends
    Pick<DepartmentPolicyField, "orderStart" | "paidWhen" | "collectionNumber">,
    Partial<Pick<DepartmentPolicyField, "dining" | "diningStartsAs">> {
  name: string;
  tradingName: string;
  transfers?: { receivingProfileId: string | null; destinationDepartmentIds: string[] };
  needsClearing?: boolean;
  lateSendNeedsManager?: boolean;
  courseSettings?: readonly DepartmentCourseSetting[];
  serviceSteps?: readonly ServiceStepInput[];
}

export async function saveDepartmentEditSettings(
  tx: Transaction,
  departmentId: string,
  input: DepartmentEditInput,
): Promise<void> {
  await updateDepartment(tx, departmentId, {
    name: input.name,
    tradingName: input.tradingName,
    ...(input.needsClearing === undefined ? {} : { needsClearing: input.needsClearing }),
    ...(input.lateSendNeedsManager === undefined
      ? {}
      : { lateSendNeedsManager: input.lateSendNeedsManager }),
  });
  const settings = {
    orderStart: input.orderStart,
    paidWhen: input.paidWhen,
    collectionNumber: input.collectionNumber,
    ...(input.dining === undefined ? {} : { dining: input.dining }),
    ...(input.diningStartsAs === undefined ? {} : { diningStartsAs: input.diningStartsAs }),
  };
  await tx.update(departments).set(settings).where(eq(departments.id, departmentId));
  if (input.transfers !== undefined)
    await setDepartmentTransferSettings(tx, departmentId, input.transfers);
  if (input.courseSettings !== undefined)
    await saveDepartmentCourseSettings(tx, departmentId, input.courseSettings);
  if (input.serviceSteps !== undefined)
    await saveServiceSteps(tx, departmentId, input.serviceSteps);
}

export type ZoneServiceSettingsInput = ZonePolicyField;

export type ZoneEditInput = ZoneServiceSettingsInput & { name: string };

export async function saveZoneSettings(
  tx: Transaction,
  zoneId: string,
  input: ZoneEditInput,
): Promise<void> {
  if (!(await listServiceZones(tx)).some((zone) => zone.id === zoneId))
    throw new AppError("service_zone.not_found", { zoneId });
  try {
    await tx
      .update(floorZones)
      .set({ name: input.name })
      .where(and(eq(floorZones.id, zoneId), eq(floorZones.active, true)));
  } catch (error) {
    if (
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "floor_zones",
        columns: ["name"],
      })
    )
      throw new AppError("zone.name_taken", { name: input.name });
    throw error;
  }
  await saveZoneServiceSettings(tx, zoneId, input);
}

export async function saveZoneServiceSettings(
  tx: Transaction,
  zoneId: string,
  input: ZoneServiceSettingsInput,
): Promise<void> {
  await setZoneSalePolicyOverride(tx, zoneId, "orderStart", input.orderStart);
  await setZoneSalePolicyOverride(tx, zoneId, "paidWhen", input.paidWhen);
  await setZoneSalePolicyOverride(tx, zoneId, "collectionNumber", input.collectionNumber);
}

async function zoneMenuIdsByZone(tx: Transaction): Promise<Map<string, string[]>> {
  const byZone = new Map<string, string[]>();
  for (const row of await zonePeriodMembership(tx)) {
    const menus = byZone.get(row.zoneId);
    if (menus === undefined) byZone.set(row.zoneId, [row.menuId]);
    else if (!menus.includes(row.menuId)) menus.push(row.menuId);
  }
  return byZone;
}

export async function liveDocumentsByZone(
  tx: Transaction,
): Promise<Map<string, { menuId: string; document: MenuDocument }[]>> {
  const menusOf = await zoneMenuIdsByZone(tx);
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

async function zonePeriodMembership(tx: Transaction, zoneId?: string) {
  const where = and(
    zoneId === undefined ? undefined : eq(floorZones.id, zoneId),
    eq(menus.active, true),
    eq(floorZones.active, true),
  );
  const customer = await tx
    .select({
      zoneId: floorZones.id,
      menuId: menuPeriods.menuId,
      periodId: menuPeriods.id,
    })
    .from(menuPeriods)
    .innerJoin(floorZones, eq(floorZones.departmentId, menuPeriods.departmentId))
    .innerJoin(menus, eq(menus.id, menuPeriods.menuId))
    .where(where)
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id));
  const staff = await tx
    .select({
      zoneId: floorZones.id,
      menuId: sql<string>`staff.value`,
      periodId: menuPeriods.id,
    })
    .from(menuPeriods)
    .innerJoin(sql`json_each(${menuPeriods.staffMenuIds}) as staff`, sql`true`)
    .innerJoin(floorZones, eq(floorZones.departmentId, menuPeriods.departmentId))
    .innerJoin(menus, eq(menus.id, sql`staff.value`))
    .where(where)
    .orderBy(asc(menuPeriods.name), asc(menuPeriods.id), sql`staff.key`);
  return [
    ...customer.map((row) => ({ ...row, audience: "customer" as const })),
    ...staff.map((row) => ({ ...row, audience: "staff" as const })),
  ];
}

async function zoneMenuIds(tx: Transaction, zoneId: string): Promise<string[]> {
  return [...new Set((await zonePeriodMembership(tx, zoneId)).map((row) => row.menuId))];
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
    readonly endedPeriodName: string | null;
  })[];
}

export async function listZoneOffers(
  tx: Transaction,
  zoneId: string,
  options: {
    asserted?: readonly { menuId: string; versionId: string }[];
    menuItemIds?: readonly string[];
    at?: Date;
    withDefault?: false;
  } = {},
): Promise<ServiceZoneOffers> {
  const context = await resolveZoneContext(tx, zoneId);
  const membership = await zonePeriodMembership(tx, zoneId);
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
      : await zoneServiceState(tx, zoneId, context.departmentId, at);
  const service = state?.service ?? null;
  const defaultMenuId = service?.open
    ? servedDefault(
        service.customerMenuId,
        published
          .map((menu) => menu.menuId)
          .filter((menuId) => service.orderableMenuIds.includes(menuId)),
      )
    : null;
  const ended = new Map(service?.endedMenus.map((menu) => [menu.menuId, menu.periodName]));
  const menus: ServiceZoneOffers["menus"] = published.map(({ menuId, versionId, document }) => ({
    id: menuId,
    name: document.menuName,
    isDefault: menuId === defaultMenuId,
    audience: (membership.find(
      (row) => row.menuId === menuId && row.periodId === service?.periodId,
    ) ?? membership.find((row) => row.menuId === menuId))!.audience,
    orderable: service === null || service.orderableMenuIds.includes(menuId),
    endedPeriodName: ended.get(menuId) ?? null,
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

/** The key {@link productsOfferedIn} answers for a product, or one of its variants. */
export const offeredKey = (productId: string, variantId: string | null): string =>
  `${productId}:${variantId ?? ""}`;

/**
 * The {@link offeredKey} of each item that the live version of some listed menu of the zone
 * offers on its own: a product as an offer, a variant as one its product's offer lists. An offer
 * marked not sold separately adds neither, and a listed menu that is not one of the zone's is left
 * out.
 */
export async function productsOfferedIn(
  tx: Transaction,
  zoneId: string,
  menuIds: readonly string[],
  items: readonly { productId: string; variantId: string | null }[],
): Promise<ReadonlySet<string>> {
  if (menuIds.length === 0 || items.length === 0) return new Set();
  const zoneMenus = new Set(await zoneMenuIds(tx, zoneId));
  const live = await zoneLiveDocuments(
    tx,
    zoneId,
    [],
    menuIds.filter((menuId) => zoneMenus.has(menuId)),
  );
  const offered = new Set<string>();
  for (const { document } of live)
    for (const offer of documentOffers(document)) {
      if (offer.ordering === "not_sold_separately") continue;
      offered.add(offeredKey(offer.productId, null));
      for (const variant of offer.variants) offered.add(offeredKey(offer.productId, variant.id));
    }
  return new Set(
    items
      .map((item) => offeredKey(item.productId, item.variantId))
      .filter((key) => offered.has(key)),
  );
}

export async function menuState(
  tx: Transaction,
  zoneId: string,
  at: Date = new Date(),
): Promise<ZoneMenuState> {
  const [zone] = await tx
    .select({ departmentId: floorZones.departmentId })
    .from(floorZones)
    .where(and(eq(floorZones.id, zoneId), eq(floorZones.active, true)));
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
    zoneId,
    zone.departmentId,
    at,
  );
  const published = await zoneLiveDocuments(tx, zoneId);
  const ended = new Map(service.endedMenus.map((menu) => [menu.menuId, menu.periodName]));
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
      endedPeriodName: ended.get(menuId) ?? null,
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
  input: { zoneId?: string | null; profileId?: string | null },
): Promise<{
  zoneId: string;
  departmentId: string;
  departmentName: string;
  serviceMode: ServiceMode;
}> {
  if (input.zoneId !== undefined && input.zoneId !== null) {
    return resolveZoneContext(tx, input.zoneId);
  }
  if (input.profileId !== undefined && input.profileId !== null) {
    const zones = await readProfileZones(tx, input.profileId);
    if (zones.departmentId !== null) {
      if (zones.startingZoneId === null) {
        throw new AppError("device_profile.no_service_zone", { profileId: input.profileId });
      }
      return resolveZoneContext(tx, zones.startingZoneId);
    }
  }
  const [policy] = await tx
    .select({ zoneId: floorZones.id })
    .from(floorZones)
    .where(and(eq(floorZones.isCounterDefault, true), eq(floorZones.active, true)));
  if (policy === undefined) throw new AppError("service_zone.default_missing", {});
  return resolveZoneContext(tx, policy.zoneId);
}

/** Snapshot the zone's current department and payment flow when a new order opens. */
export async function recordOrderServiceContext(
  tx: Transaction,
  workingOrderId: string,
  zoneId: string,
): Promise<void> {
  const {
    zoneId: resolvedZoneId,
    departmentId,
    serviceMode,
  } = await resolveZoneContext(tx, zoneId);
  await tx
    .update(workingOrders)
    .set({ zoneId: resolvedZoneId, departmentId, serviceMode })
    .where(eq(workingOrders.id, workingOrderId));
}

/** Adopt a new zone's current department and service mode while retaining existing line snapshots. */
export async function retargetOrderServiceContext(
  tx: Transaction,
  workingOrderId: string,
  zoneId: string,
): Promise<void> {
  const context = await resolveZoneContext(tx, zoneId);
  const previous = await getOrderServiceContext(tx, workingOrderId);
  if (previous.departmentId !== context.departmentId) {
    await withdrawPendingDepartmentTransfers(tx, [workingOrderId]);
    await applyDepartmentDining(tx, workingOrderId, context);
  }
  const updated = await tx
    .update(workingOrders)
    .set({
      zoneId: context.zoneId,
      departmentId: context.departmentId,
      serviceMode: context.serviceMode,
    })
    .where(eq(workingOrders.id, workingOrderId))
    .returning({ workingOrderId: workingOrders.id });
  if (updated.length === 0) {
    throw new AppError("order.service_context_missing", { workingOrderId });
  }
}

export async function getOrderServiceContext(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ zoneId: string; departmentId: string; serviceMode: ServiceMode }> {
  const row = await findOrderServiceContext(tx, workingOrderId);
  if (row === null) throw new AppError("order.service_context_missing", { workingOrderId });
  return row;
}

export async function findOrderServiceContext(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ zoneId: string; departmentId: string; serviceMode: ServiceMode } | null> {
  const [row] = await tx
    .select({
      zoneId: workingOrders.zoneId,
      departmentId: workingOrders.departmentId,
      serviceMode: workingOrders.serviceMode,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (row?.zoneId == null || row.departmentId === null || row.serviceMode === null) return null;
  return {
    zoneId: row.zoneId,
    departmentId: row.departmentId,
    serviceMode: row.serviceMode as ServiceMode,
  };
}

/** `orderId` must be table-qualified so a base-table query correlates to its outer order. */
export function orderZoneIdSql(orderId: SQL): SQL {
  return sql`(select wz.zone_id from working_orders wz
    where wz.id = ${orderId})`;
}

/**
 * A WHERE condition that holds for an order whose recorded zone is one of `zoneIds`, or that has no
 * recorded zone. `orderId` is the outer query's order id, table-qualified.
 */
export function orderInZones(orderId: SQL, zoneIds: readonly string[]): SQL {
  const outside =
    zoneIds.length === 0
      ? sql``
      : sql` and wz.zone_id not in (${sql.join(
          zoneIds.map((zoneId) => sql`${zoneId}`),
          sql`, `,
        )})`;
  return sql`not exists (select 1 from working_orders wz
    where wz.id = ${orderId} and wz.zone_id is not null${outside})`;
}

/** Each named order's frozen service mode, read at once; an order with no context is absent. */
export async function findOrderServiceModes(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<ReadonlyMap<string, ServiceMode>> {
  if (workingOrderIds.length === 0) return new Map();
  const rows = await tx
    .select({
      workingOrderId: workingOrders.id,
      serviceMode: workingOrders.serviceMode,
    })
    .from(workingOrders)
    .where(inArray(workingOrders.id, [...workingOrderIds]));
  return new Map(
    rows.flatMap(({ workingOrderId, serviceMode }) =>
      serviceMode === null ? [] : [[workingOrderId, serviceMode as ServiceMode]],
    ),
  );
}

/** Each named order's recorded service zone in one read; an order with no context is absent. */
export async function findOrderServiceZones(
  tx: Transaction,
  workingOrderIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (workingOrderIds.length === 0) return new Map();
  const rows = await tx
    .select({
      workingOrderId: workingOrders.id,
      zoneId: workingOrders.zoneId,
    })
    .from(workingOrders)
    .where(inArray(workingOrders.id, [...workingOrderIds]));
  return new Map(
    rows.flatMap(({ workingOrderId, zoneId }) =>
      zoneId === null ? [] : [[workingOrderId, zoneId]],
    ),
  );
}

/** Whether any of the order's lines is a set lunch, as {@link readLunchLineIds} reads it. */
export async function orderHasSetLunch(tx: Transaction, workingOrderId: string): Promise<boolean> {
  const lines = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));
  return (
    (
      await readLunchLineIds(
        tx,
        lines.map((line) => line.id),
      )
    ).size > 0
  );
}

export async function readLunchLineIds(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const contexts = await tx
    .select({
      lineId: workingOrderLines.id,
      menuItemId: workingOrderLines.menuItemId,
      versionId: workingOrderLines.menuVersionId,
    })
    .from(workingOrderLines)
    .where(
      inArray(workingOrderLines.id, sql`(select value from json_each(${JSON.stringify(lineIds)}))`),
    );
  const documents = await readRecordedDocuments(
    tx,
    contexts.flatMap((row) => (row.versionId === null ? [] : [row.versionId])),
  );
  return new Set(
    contexts.flatMap((row) =>
      row.versionId !== null &&
      row.menuItemId !== null &&
      documents.get(row.versionId)?.offers[row.menuItemId]?.setLunch === true
        ? [row.lineId]
        : [],
    ),
  );
}

export async function readLunchOffers(
  tx: Transaction,
  workingOrderId: string,
  lineIds: readonly string[],
  knownContexts?: ReadonlyArray<Awaited<ReturnType<typeof listWorkingLineContexts>>[number]>,
) {
  const selected = new Set(lineIds);
  const contexts =
    knownContexts === undefined
      ? await listWorkingLineContexts(tx, workingOrderId, lineIds)
      : knownContexts.filter((row) => selected.has(row.workingOrderLineId));
  const documents = await readRecordedDocuments(
    tx,
    contexts.flatMap((row) => (row.menuVersionId === null ? [] : [row.menuVersionId])),
  );
  const versions = new Map<string, ZoneMenuOffer[]>();
  for (const [versionId, document] of documents) {
    const menuItemIds = new Set(
      contexts
        .filter(
          (row) => row.menuVersionId === versionId && document.offers[row.menuItemId]?.setLunch,
        )
        .map((row) => row.menuItemId),
    );
    if (menuItemIds.size === 0) continue;
    const { offers } = await applyLiveFields(tx, [document], menuItemIds);
    versions.set(versionId, offers.get(document.menuId) ?? []);
  }
  return new Map(
    contexts.flatMap((row) => {
      const offer = versions.get(row.menuVersionId!)?.find((offer) => offer.id === row.menuItemId);
      return offer?.setLunch
        ? [[row.workingOrderLineId, { offer, versionId: row.menuVersionId! }] as const]
        : [];
    }),
  );
}

export async function listWorkingLineContexts(
  tx: Transaction,
  workingOrderId: string,
  lineIds?: readonly string[],
): Promise<
  {
    workingOrderLineId: string;
    menuItemId: string;
    menuId: string;
    menuVersionId: string | null;
    menuName: string;
    departmentId: string;
    categoryName: string;
    unitId: string;
    unitName: Record<string, string>;
    unitPrecision: number;
    hardwareUnit: "kg" | "g" | "mg" | null;
    vatClass: string;
    allergens: MenuOffer["allergens"];
    diet: unknown;
    dietOverride: unknown;
  }[]
> {
  const rows = await tx
    .select({
      workingOrderLineId: workingOrderLines.id,
      menuItemId: workingOrderLines.menuItemId,
      menuId: workingOrderLines.menuId,
      menuVersionId: workingOrderLines.menuVersionId,
      menuName: workingOrderLines.menuName,
      departmentId: workingOrderLines.offerDepartmentId,
      categoryName: workingOrderLines.offerCategoryName,
      unitId: workingOrderLines.unitId,
      unitName: workingOrderLines.offerUnitName,
      unitPrecision: workingOrderLines.offerUnitPrecision,
      hardwareUnit: workingOrderLines.hardwareUnit,
      vatClass: workingOrderLines.offerVatClass,
      allergens: workingOrderLines.allergens,
      diet: workingOrderLines.diet,
      dietOverride: workingOrderLines.dietOverride,
    })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, workingOrderId),
        isNotNull(workingOrderLines.menuItemId),
        lineIds === undefined ? undefined : inArray(workingOrderLines.id, [...lineIds]),
      ),
    );
  // The context CHECK pairs the required offer fields with menu_item_id.
  return rows.map((row) => ({
    ...row,
    menuItemId: row.menuItemId!,
    menuId: row.menuId!,
    menuName: row.menuName!,
    departmentId: row.departmentId!,
    categoryName: row.categoryName!,
    unitId: row.unitId!,
    unitName: row.unitName!,
    unitPrecision: row.unitPrecision!,
    vatClass: row.vatClass!,
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
      workingOrderLineId: workingOrderLines.id,
      soldInEach: workingOrderLines.soldInEach,
    })
    .from(workingOrderLines)
    .where(
      inArray(workingOrderLines.id, sql`(select value from json_each(${JSON.stringify(lineIds)}))`),
    );
  return new Set(rows.filter((row) => row.soldInEach).map((row) => row.workingOrderLineId));
}

/**
 * The period name of each of `lineIds` whose context records a late send, and whether someone
 * agreed to it (`agreed` is false where the send asked nobody); unmarked lines are absent.
 */
export async function readLateSendMarks(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<ReadonlyMap<string, LateSendMark>> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx
    .select({
      workingOrderLineId: workingOrderLines.id,
      latePeriodName: workingOrderLines.latePeriodName,
      lateConfirmedBy: workingOrderLines.lateConfirmedBy,
    })
    .from(workingOrderLines)
    .where(
      and(inArray(workingOrderLines.id, [...lineIds]), isNotNull(workingOrderLines.latePeriodName)),
    );
  return new Map(
    rows.map((row) => [
      row.workingOrderLineId,
      { periodName: row.latePeriodName!, agreed: row.lateConfirmedBy !== null },
    ]),
  );
}

/**
 * Mark each line as sent after its period: `confirmedBy` is the person who agreed to send it, or
 * null where the send asked nobody.
 */
export async function recordLateSendMarks(
  tx: Transaction,
  marks: readonly { lineId: string; periodName: string; confirmedBy: string | null }[],
): Promise<void> {
  for (const mark of marks) {
    await tx
      .update(workingOrderLines)
      .set({ latePeriodName: mark.periodName, lateConfirmedBy: mark.confirmedBy })
      .where(and(eq(workingOrderLines.id, mark.lineId), isNotNull(workingOrderLines.menuItemId)));
  }
}

export async function readSentLineNutrition(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<
  ReadonlyMap<string, NonNullable<(typeof workingOrderLines.$inferSelect)["sentNutrition"]>>
> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      nutrition: workingOrderLines.sentNutrition,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, [...lineIds]));
  return new Map(rows.flatMap((row) => (row.nutrition === null ? [] : [[row.id, row.nutrition]])));
}

export async function recordSentLineNutrition(
  tx: Transaction,
  rows: readonly {
    lineId: string;
    nutrition: NonNullable<(typeof workingOrderLines.$inferSelect)["sentNutrition"]>;
  }[],
): Promise<void> {
  for (const row of rows) {
    await tx
      .update(workingOrderLines)
      .set({ sentNutrition: row.nutrition })
      .where(and(eq(workingOrderLines.id, row.lineId), isNotNull(workingOrderLines.menuItemId)));
  }
}

export async function lineContextColumns(
  tx: Transaction,
  workingOrderId: string,
  lines: readonly LineContextInput[],
  offers: ZoneOffers,
): Promise<ReadonlyMap<string, LineContextColumns>> {
  if (lines.length === 0) return new Map();
  const context = await getOrderServiceContext(tx, workingOrderId);
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
  return new Map(
    lines.map((line) => {
      const offer = line.recorded?.offer ?? byMenuItem.get(line.menuItemId);
      if (offer === undefined) {
        throw new AppError("service_zone.offer_not_allowed", {
          zoneId: context.zoneId,
          menuItemId: line.menuItemId,
        });
      }
      const unitId = line.unit?.id ?? offer.unit.id;
      const sold = offer.variants.find((variant) => variant.id === line.variantId) ?? offer;
      return [
        line.workingOrderLineId,
        {
          menuItemId: offer.id,
          menuId: offer.menuId,
          menuVersionId: line.recorded?.versionId ?? versionOf(offer.menuId),
          menuName: offer.menuName,
          offerDepartmentId: context.departmentId,
          departmentName: department.name,
          offerCategoryName: sold.category ?? "Uncategorised",
          unitId,
          offerUnitName: line.unit?.name ?? offer.unit.name,
          offerUnitPrecision: line.unit?.precision ?? offer.unit.precision,
          soldInEach: isEachUnit({
            id: unitId,
            seedKey: seedKeyById.get(unitId) ?? null,
          }),
          hardwareUnit: line.unit === undefined ? offer.unit.hardwareUnit : line.unit.hardwareUnit,
          offerVatClass: sold.vatClass,
          allergens: sold.allergens,
          diet: sold.diet,
          dietOverride: sold.dietOverride,
          latePeriodName: line.late?.periodName ?? null,
          lateConfirmedBy: line.late?.confirmedBy ?? null,
        },
      ];
    }),
  );
}

/** Copy an order's frozen service policy to a newly-created split/check order. */
export async function copyOrderServiceContext(
  tx: Transaction,
  fromWorkingOrderId: string,
  toWorkingOrderId: string,
): Promise<void> {
  const context = await findOrderServiceContext(tx, fromWorkingOrderId);
  if (context === null) return;
  await tx.update(workingOrders).set(context).where(eq(workingOrders.id, toWorkingOrderId));
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
  zoneIds: readonly string[],
  at: Date,
  prepared?: PreparedServiceDay,
): Promise<Map<string, { closed: boolean; keepOpen: ZoneKeepOpenState | null }>> {
  if (zoneIds.length === 0) return new Map();
  const days = await zoneClosureDays(tx, zoneIds, at, serviceDayOf(prepared));
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
  zoneId: string,
  at: Date,
): Promise<ZoneKeepOpenState | null> {
  return (await readZoneClosingStates(tx, [zoneId], at)).get(zoneId)!.keepOpen;
}

/** The department's service and the zone's own closure state at `at`, sharing one clock and
 *  one day plan between them. */
async function zoneServiceState(tx: Transaction, zoneId: string, departmentId: string, at: Date) {
  const prepared = await readServiceDayPlan(tx, at);
  const service = await resolveDepartmentService(tx, departmentId, at, prepared);
  const zoneDay = await zoneClosureDays(tx, [zoneId], at, prepared);
  return {
    service,
    zoneOpen: !closedZoneIdsIn(zoneDay).has(zoneId),
    zoneKeepOpen: (await keepOpenStatesIn(tx, zoneDay)).get(zoneId) ?? null,
  };
}
