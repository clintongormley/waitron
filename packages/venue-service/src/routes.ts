import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorizeManager, roleHasPermission, type PersonRoleValue } from "@waitron/identity";
import type { ModuleRouteContext, ModuleRoutes } from "@waitron/module";
import {
  createErrorBoundary,
  readJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireNullableBodyUuid,
  requireString,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "@waitron/server-kit";
import {
  saveDepartmentSettings,
  saveZoneServiceSettings,
  type DepartmentSettingsInput,
  type ZoneServiceSettingsInput,
  configureZone,
  createServiceZone,
  activateDepartment,
  createDepartment,
  deactivateDepartment,
  departmentRemovalImpact,
  zoneRemovalImpact,
  listDepartments,
  listSalePolicies,
  listServiceZones,
  listVenueReadiness,
  setDepartmentSalePolicyField,
  setZoneSalePolicyOverride,
  updateDepartment,
} from "./operations.js";
import {
  readClearingWorkflow,
  readEditSentLines,
  readKitchenTicketGrouping,
  readPrintHeldWork,
  readReleaseReminderMinutes,
  writeClearingWorkflow,
  writeEditSentLines,
  writeKitchenTicketGrouping,
  writePrintHeldWork,
  writeReleaseReminderMinutes,
} from "./kitchen-notices.js";
import {
  deleteMenuPeriod,
  readOpeningHoursModel,
  replaceMenuWeek,
  saveMenuPeriod,
  saveSpecialDateMenus,
  updateMenuPeriod,
} from "./menu-timetable.js";
import { CALENDAR_COLOURS, type CalendarColour } from "./hours-types.js";
import type { MenuSlot, MenuWeekDay } from "./menu-timetable-types.js";
import { KITCHEN_TICKET_GROUPINGS, type KitchenTicketGrouping } from "./schema/settings.js";
import { MANAGE_VENUE_SERVICE } from "./permissions.js";
import {
  clearRoutingCell,
  routingModel,
  previewRoutingChange,
  setRoutingCell,
} from "./routing-store.js";
import type { RouteTarget } from "./routing.js";
import { VENUE_SERVICE_CALENDAR_PARTICIPANTS } from "./calendar-participants.js";
import { duplicateHolidayNamedSpecialDates, readHolidays, saveHolidayArea } from "./holidays.js";
import { deleteSpecialDate, readHoursModel, replaceWeekHours, saveSpecialDate } from "./hours.js";
import type { HoursSubject, LocalDate, SpecialDateInput, WeekDay } from "./hours-types.js";
import type { CellAddress, RoutingChange } from "./routing-types.js";
import { setStationFallback } from "./station-times.js";
import {
  listDepartmentTransferProfiles,
  readDepartmentTransferSettings,
  setDepartmentTransferSettings,
} from "./department-transfers.js";
import "./errors.js";
import { replaceZoneClosedWeek, saveZoneClosedDate } from "./zone-closed-times.js";
import { parseEndOffsetMinutes } from "./period-end-offset.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "department.name_taken": 409,
  "department.name_disabled": 409,
  "zone.name_disabled": 409,
  "department.not_found": 404,
  "department_transfer.settings_invalid": 400,
  "department.last_active": 409,
  "zone.table_in_use": 409,
  "zone.department_inactive": 409,
  "service_zone.not_found": 404,
  "department_menu.not_found": 404,
  "department_menu.in_use": 409,
  "zone_extension.invalid": 400,
  "zone_extension.not_allowed": 409,
  "period_extension.invalid": 400,
  "period_extension.not_allowed": 409,
  "menu_period.not_found": 404,
  "menu_period.in_use": 409,
  "menu_period.name_taken": 409,
  "menu_timetable.invalid": 400,
  "menu_period.invalid": 400,
  "zone.name_taken": 409,
  "catalogue.not_found": 404,
  "route.subject_not_found": 404,
  "route.station_inactive": 409,
  "station.not_found": 404,
  "station.destination_invalid": 400,
  "station.fallback_loop": 409,
  "time_zone.unreadable": 409,
  "hours.invalid": 400,
  "special_date.not_found": 404,
  "special_date.date_taken": 409,
  "zone_closed_time.invalid": 400,
  "special_date.keeps_week": 409,
  "station.always_open": 409,
  "holiday.invalid": 400,
};
const run = createErrorBoundary(STATUS, "venue_service.failed");
const PAID_WHEN = new Set(["prepay", "ticket_then_pay"]);
const COLLECTION_NUMBER = new Set(["none", "numbered"]);
const RECEIPT_PRINT_MODE = new Set(["auto", "on_request"]);

function requireSalePolicyField(field: string, value: unknown, zone: boolean) {
  if (
    zone &&
    value === null &&
    (field === "orderStart" ||
      field === "paidWhen" ||
      field === "collectionNumber" ||
      field === "receiptPrintMode")
  )
    return null;
  if (field === "orderStart" && (value === "table" || value === "counter")) return value;
  if (field === "paidWhen" && PAID_WHEN.has(value as string))
    return value as "prepay" | "ticket_then_pay";
  if (field === "collectionNumber" && COLLECTION_NUMBER.has(value as string))
    return value as "none" | "numbered";
  if (field === "receiptPrintMode" && typeof value === "string" && RECEIPT_PRINT_MODE.has(value))
    return value as "auto" | "on_request";
  if (!zone && field === "printTradingName" && typeof value === "boolean") return value;
  throw new AppError("management.request_invalid", { field });
}

/** Refuses any body key outside `allowed`, so a client cannot choose what the server derives. */
function onlyKeys(body: object, allowed: readonly string[]): void {
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
}

function requireTransferSettings(value: unknown) {
  if (!isRecord(value)) throw new AppError("management.request_invalid", { field: "transfers" });
  onlyKeys(value, ["receivingProfileId", "destinationDepartmentIds"]);
  const receivingProfileId = requireNullableBodyUuid(
    value.receivingProfileId,
    "receivingProfileId",
  );
  if (!Array.isArray(value.destinationDepartmentIds))
    throw new AppError("management.request_invalid", { field: "destinationDepartmentIds" });
  const destinationDepartmentIds = value.destinationDepartmentIds.map((id) =>
    requireBodyUuid(id, "destinationDepartmentIds"),
  );
  return { receivingProfileId, destinationDepartmentIds };
}

function requireDisplayOrder(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  ) {
    throw new AppError("management.request_invalid", { field: "displayOrder" });
  }
  return value;
}

const MAX_RELEASE_REMINDER_MINUTES = 120;

function requireReleaseReminderMinutes(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_RELEASE_REMINDER_MINUTES
  ) {
    throw new AppError("management.request_invalid", { field: "releaseReminderMinutes" });
  }
  return value;
}

function requirePeriodColour(value: unknown): CalendarColour {
  if (typeof value !== "string" || !CALENDAR_COLOURS.includes(value as CalendarColour))
    throw new AppError("management.request_invalid", { field: "colour" });
  return value as CalendarColour;
}

function requireStaffMenuIds(value: unknown): string[] {
  if (!Array.isArray(value))
    throw new AppError("management.request_invalid", { field: "staffMenuIds" });
  return value.map((menuId) => requireBodyUuid(menuId, "staffMenuIds"));
}

function requireName(value: unknown, field: string): string {
  const name = requireString(value, field);
  if (name.trim() === "") throw new AppError("management.request_invalid", { field });
  return name;
}

const ADDRESS_ROW_KEYS = {
  all: ["kind"],
  category: ["kind", "categoryId"],
  product: ["kind", "productId"],
  no_category: ["kind"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => key in value);
}

function requireCellAddress(value: unknown): CellAddress {
  const invalid = () => new AppError("management.request_invalid", { field: "address" });
  if (!isRecord(value) || !hasExactly(value, ["row", "zoneId"])) throw invalid();
  const { row } = value;
  if (!isRecord(row) || !Object.hasOwn(ADDRESS_ROW_KEYS, row.kind as string)) throw invalid();
  const kind = row.kind as keyof typeof ADDRESS_ROW_KEYS;
  if (!hasExactly(row, ADDRESS_ROW_KEYS[kind])) throw invalid();
  const zoneId = requireNullableBodyUuid(value.zoneId, "address");
  if (kind === "all") {
    if (zoneId === null) throw invalid();
    return { row: { kind }, zoneId };
  }
  if (kind === "no_category") return { row: { kind }, zoneId };
  if (kind === "category")
    return { row: { kind, categoryId: requireBodyUuid(row.categoryId, "address") }, zoneId };
  return { row: { kind, productId: requireBodyUuid(row.productId, "address") }, zoneId };
}

function requireCellTarget(body: Record<string, unknown>): RouteTarget | null {
  const invalid = () => new AppError("management.request_invalid", { field: "target" });
  if (!Object.hasOwn(body, "target")) throw invalid();
  const { target } = body;
  if (target === null) return null;
  if (!isRecord(target)) throw invalid();
  if (target.kind === "no_preparation" && hasExactly(target, ["kind"]))
    return { kind: "no_preparation" };
  if (target.kind === "station" && hasExactly(target, ["kind", "stationId"]))
    return { kind: "station", stationId: requireBodyUuid(target.stationId, "target") };
  throw invalid();
}

function requirePreviewChange(body: Record<string, unknown>): RoutingChange {
  if (body.kind !== "cell") throw new AppError("management.request_invalid", { field: "kind" });
  onlyKeys(body, ["kind", "address", "target"]);
  return {
    kind: "cell",
    address: requireCellAddress(body.address),
    target: requireCellTarget(body),
  };
}

import { readNamedDaysModel } from "./named-days.js";

export const VENUE_SERVICE_ROUTES: ModuleRoutes = {
  mount(app, ctx: ModuleRouteContext, log: Logger): void {
    const gatedAs = <T>(
      sessionId: string,
      fn: (tx: Transaction, role: PersonRoleValue) => Promise<T>,
    ): Promise<T> =>
      withTransaction(ctx.db, async (tx) => {
        const { role } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: MANAGE_VENUE_SERVICE,
        });
        return fn(tx, role);
      });
    const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
      gatedAs(sessionId, fn);

    const viewed = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
      withTransaction(ctx.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId: sessionId, permission: "venue.view" });
        return fn(tx);
      });

    app.get("/management-api/venue-service/hours", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const from = c.req.query("from") ?? "";
        const to = c.req.query("to") ?? "";
        return c.json(
          await viewed(sessionId, async (tx) => {
            const read = await readHolidays(tx, ctx.cfg, from, to);
            const model = await readHoursModel(tx, ctx.cfg, from, to, at, async () => read.facts);
            return { ...model, holidayCoverage: read.coverage, holidaySources: read.sources };
          }),
        );
      }),
    );

    app.get("/management-api/venue-service/named-days", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const from = c.req.query("from") ?? "";
        const to = c.req.query("to") ?? "";
        const at = new Date();
        return c.json(
          await viewed(sessionId, (tx) => readNamedDaysModel(tx, ctx.cfg, from, to, at)),
        );
      }),
    );

    app.get("/management-api/venue-service/holidays", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const from = c.req.query("from") ?? "";
        const to = c.req.query("to") ?? "";
        return c.json(await viewed(sessionId, (tx) => readHolidays(tx, ctx.cfg, from, to)));
      }),
    );

    app.put("/management-api/venue-service/holiday-area", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<{ areaKey: string | null }>(c);
        const geography = await gated(sessionId, (tx) => {
          onlyKeys(body, ["areaKey"]);
          return saveHolidayArea(tx, ctx.cfg, body);
        });
        return geography === null ? c.body(null, 204) : c.json(geography);
      }),
    );

    app.put("/management-api/venue-service/hours/week", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const body = await readJsonBody<Record<string, unknown>>(c);
        await gated(sessionId, (tx) =>
          replaceWeekHours(
            tx,
            ctx.cfg,
            body.subject as HoursSubject,
            body.days as readonly WeekDay[],
            at,
          ),
        );
        return c.body(null, 204);
      }),
    );

    app.post("/management-api/venue-service/special-dates", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const body = await readJsonBody<SpecialDateInput>(c);
        return c.json(
          await gated(sessionId, (tx) =>
            saveSpecialDate(tx, ctx.cfg, null, body, at, VENUE_SERVICE_CALENDAR_PARTICIPANTS),
          ),
          201,
        );
      }),
    );

    app.put("/management-api/venue-service/special-dates/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const id = requireUuidParam(c.req.param("id"), "SpecialDateId");
        const body = await readJsonBody<SpecialDateInput>(c);
        return c.json(
          await gated(sessionId, (tx) =>
            saveSpecialDate(tx, ctx.cfg, id, body, at, VENUE_SERVICE_CALENDAR_PARTICIPANTS),
          ),
        );
      }),
    );

    app.post("/management-api/venue-service/special-dates/:id/duplicate", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const id = requireUuidParam(c.req.param("id"), "SpecialDateId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        const copies = await gated(sessionId, (tx) => {
          onlyKeys(body, ["dates"]);
          return duplicateHolidayNamedSpecialDates(
            tx,
            ctx.cfg,
            id,
            body.dates as readonly LocalDate[],
            at,
            VENUE_SERVICE_CALENDAR_PARTICIPANTS,
          );
        });
        return c.json(copies, 201);
      }),
    );

    app.delete("/management-api/venue-service/special-dates/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const id = requireUuidParam(c.req.param("id"), "SpecialDateId");
        await gated(sessionId, (tx) =>
          deleteSpecialDate(tx, ctx.cfg, id, at, VENUE_SERVICE_CALENDAR_PARTICIPANTS),
        );
        return c.body(null, 204);
      }),
    );

    app.get("/management-api/venue-service/stations/overview", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        return c.json(
          await withTransaction(ctx.db, async (tx) => {
            await authorizeManager(tx, {
              managementSessionId: sessionId,
              permission: "venue.view",
            });
            const { stations, defaultStationId, stationTimes, todayEnds, clockReadable } =
              await routingModel(tx, ctx.cfg, new Date());
            return { stations, defaultStationId, stationTimes, todayEnds, clockReadable };
          }),
        );
      }),
    );

    app.get("/management-api/venue-service/routing", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        return c.json(
          await gatedAs(sessionId, async (tx, role) => ({
            ...(await routingModel(tx, ctx.cfg, new Date())),
            canMakeDefault: roleHasPermission(role, "venue.configure"),
          })),
        );
      }),
    );

    app.post("/management-api/venue-service/routing/preview", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const change = requirePreviewChange(await readJsonBody<Record<string, unknown>>(c));
        return c.json(await gated(sessionId, (tx) => previewRoutingChange(tx, ctx.cfg, change)));
      }),
    );

    app.put("/management-api/venue-service/routing/cell", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["address", "target"]);
        const address = requireCellAddress(body.address);
        const target = requireCellTarget(body);
        await gated(sessionId, (tx) =>
          target === null
            ? clearRoutingCell(tx, ctx.cfg, address)
            : setRoutingCell(tx, ctx.cfg, address, target),
        );
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/stations/:stationId/fallback", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const stationId = requireUuidParam(c.req.param("stationId"), "StationId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        if (body.fallbackStationId === undefined)
          throw new AppError("management.request_invalid", { field: "fallbackStationId" });
        const fallbackStationId =
          body.fallbackStationId === null
            ? null
            : requireBodyUuid(body.fallbackStationId, "fallbackStationId");
        await gated(sessionId, (tx) =>
          setStationFallback(tx, ctx.cfg, stationId, fallbackStationId),
        );
        return c.body(null, 204);
      }),
    );

    // The departments and zones alone, for a screen that needs nothing else of the venue's setup.
    app.get("/management-api/venue-service/departments-and-zones", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const result = await gated(sessionId, async (tx) => ({
          departments: await listDepartments(tx, ctx.cfg),
          zones: await listServiceZones(tx, ctx.cfg, { includeInactive: true }),
        }));
        return c.json(result);
      }),
    );

    app.get("/management-api/venue-service", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const result = await gated(sessionId, async (tx) => ({
          departments: await listDepartments(tx, ctx.cfg),
          zones: await listServiceZones(tx, ctx.cfg, { includeInactive: true }),
          salePolicies: await listSalePolicies(tx, ctx.cfg),
          readiness: await listVenueReadiness(tx, ctx.cfg),
          settings: { editSentLines: await readEditSentLines(tx) },
          kitchenTicketGrouping: await readKitchenTicketGrouping(tx),
          printHeldWork: await readPrintHeldWork(tx),
          releaseReminderMinutes: await readReleaseReminderMinutes(tx),
          clearingWorkflow: await readClearingWorkflow(tx),
        }));
        return c.json(result);
      }),
    );

    app.get("/management-api/venue-service/settings", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const settings = await withTransaction(ctx.db, async (tx) => {
          await authorizeManager(tx, { managementSessionId: sessionId, permission: "venue.view" });
          return {
            settings: { editSentLines: await readEditSentLines(tx) },
            kitchenTicketGrouping: await readKitchenTicketGrouping(tx),
            printHeldWork: await readPrintHeldWork(tx),
            releaseReminderMinutes: await readReleaseReminderMinutes(tx),
            clearingWorkflow: await readClearingWorkflow(tx),
          };
        });
        return c.json(settings);
      }),
    );

    app.put("/management-api/venue-service/settings", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const editSentLines = body.editSentLines;
        if (typeof editSentLines !== "boolean") {
          throw new AppError("management.request_invalid", { field: "editSentLines" });
        }
        await gated(sessionId, (tx) => writeEditSentLines(tx, editSentLines));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/settings/kitchen-ticket-grouping", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const grouping = body.kitchenTicketGrouping;
        if (!KITCHEN_TICKET_GROUPINGS.includes(grouping as KitchenTicketGrouping)) {
          throw new AppError("management.request_invalid", { field: "kitchenTicketGrouping" });
        }
        await gated(sessionId, (tx) =>
          writeKitchenTicketGrouping(tx, grouping as KitchenTicketGrouping),
        );
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/settings/print-held-work", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const printHeldWork = body.printHeldWork;
        if (typeof printHeldWork !== "boolean") {
          throw new AppError("management.request_invalid", { field: "printHeldWork" });
        }
        await gated(sessionId, (tx) => writePrintHeldWork(tx, printHeldWork));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/settings/clearing-workflow", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const clearingWorkflow = body.clearingWorkflow;
        if (typeof clearingWorkflow !== "boolean") {
          throw new AppError("management.request_invalid", { field: "clearingWorkflow" });
        }
        await gated(sessionId, (tx) => writeClearingWorkflow(tx, clearingWorkflow));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/settings/release-reminder-minutes", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const minutes = requireReleaseReminderMinutes(body.releaseReminderMinutes);
        await gated(sessionId, (tx) => writeReleaseReminderMinutes(tx, minutes));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/departments/:departmentId/settings", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, [
          "name",
          "tradingName",
          "printTradingName",
          "orderStart",
          "paidWhen",
          "collectionNumber",
          "receiptPrintMode",
          "transfers",
        ]);
        const input: DepartmentSettingsInput = {
          name: requireName(body.name, "name"),
          tradingName: requireName(body.tradingName, "tradingName"),
          printTradingName: requireSalePolicyField(
            "printTradingName",
            body.printTradingName,
            false,
          ) as boolean,
          orderStart: requireSalePolicyField(
            "orderStart",
            body.orderStart,
            false,
          ) as DepartmentSettingsInput["orderStart"],
          paidWhen: requireSalePolicyField(
            "paidWhen",
            body.paidWhen,
            false,
          ) as DepartmentSettingsInput["paidWhen"],
          collectionNumber: requireSalePolicyField(
            "collectionNumber",
            body.collectionNumber,
            false,
          ) as DepartmentSettingsInput["collectionNumber"],
          receiptPrintMode: requireSalePolicyField(
            "receiptPrintMode",
            body.receiptPrintMode,
            false,
          ) as DepartmentSettingsInput["receiptPrintMode"],
          ...(body.transfers === undefined
            ? {}
            : { transfers: requireTransferSettings(body.transfers) }),
        };
        await gated(sessionId, (tx) => saveDepartmentSettings(tx, ctx.cfg, departmentId, input));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/zones/:zoneId/service-settings", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"]);
        const input: ZoneServiceSettingsInput = {
          orderStart: requireSalePolicyField(
            "orderStart",
            body.orderStart,
            true,
          ) as ZoneServiceSettingsInput["orderStart"],
          paidWhen: requireSalePolicyField(
            "paidWhen",
            body.paidWhen,
            true,
          ) as ZoneServiceSettingsInput["paidWhen"],
          collectionNumber: requireSalePolicyField(
            "collectionNumber",
            body.collectionNumber,
            true,
          ) as ZoneServiceSettingsInput["collectionNumber"],
          receiptPrintMode: requireSalePolicyField(
            "receiptPrintMode",
            body.receiptPrintMode,
            true,
          ) as ZoneServiceSettingsInput["receiptPrintMode"],
        };
        await gated(sessionId, (tx) => saveZoneServiceSettings(tx, ctx.cfg, zoneId, input));
        return c.body(null, 204);
      }),
    );

    app.patch("/management-api/venue-service/departments/:departmentId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["active", "name", "tradingName"]);
        if (body.active !== undefined && typeof body.active !== "boolean") {
          throw new AppError("management.request_invalid", { field: "active" });
        }
        const active = body.active;
        const edit =
          body.name !== undefined || body.tradingName !== undefined || active === undefined
            ? {
                ...(body.name === undefined ? {} : { name: requireName(body.name, "name") }),
                ...(body.tradingName === undefined
                  ? {}
                  : { tradingName: requireName(body.tradingName, "tradingName") }),
              }
            : undefined;
        if (active === undefined && edit !== undefined && Object.keys(edit).length === 0) {
          throw new AppError("management.request_invalid", { field: "name" });
        }
        await gated(sessionId, async (tx) => {
          if (edit !== undefined) await updateDepartment(tx, ctx.cfg, departmentId, edit);
          if (active === true) await activateDepartment(tx, ctx.cfg, departmentId);
          if (active === false) await deactivateDepartment(tx, ctx.cfg, departmentId);
        });
        return c.body(null, 204);
      }),
    );

    app.patch("/management-api/venue-service/departments/:departmentId/sale-policy/:field", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const field = c.req.param("field");
        const body = await readJsonBody<Record<string, unknown>>(c);
        const value = requireSalePolicyField(field, body.value, false);
        await gated(sessionId, async (tx) => {
          if (field === "orderStart")
            await setDepartmentSalePolicyField(
              tx,
              ctx.cfg,
              departmentId,
              "orderStart",
              value as "table" | "counter",
            );
          else if (field === "paidWhen")
            await setDepartmentSalePolicyField(
              tx,
              ctx.cfg,
              departmentId,
              field,
              value as "prepay" | "ticket_then_pay",
            );
          else if (field === "collectionNumber")
            await setDepartmentSalePolicyField(
              tx,
              ctx.cfg,
              departmentId,
              field,
              value as "none" | "numbered",
            );
          else if (field === "receiptPrintMode")
            await setDepartmentSalePolicyField(
              tx,
              ctx.cfg,
              departmentId,
              field,
              value as "auto" | "on_request",
            );
          else
            await setDepartmentSalePolicyField(
              tx,
              ctx.cfg,
              departmentId,
              "printTradingName",
              value as boolean,
            );
        });
        return c.body(null, 204);
      }),
    );

    app.get("/management-api/venue-service/departments/:departmentId/removal-impact", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        return c.json(
          await gated(sessionId, (tx) => departmentRemovalImpact(tx, ctx.cfg, departmentId)),
        );
      }),
    );

    app.get("/management-api/venue-service/zones/:zoneId/removal-impact", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ZoneId");
        return c.json(await gated(sessionId, (tx) => zoneRemovalImpact(tx, ctx.cfg, zoneId)));
      }),
    );

    app.delete("/management-api/venue-service/departments/:departmentId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        await gated(sessionId, (tx) => deactivateDepartment(tx, ctx.cfg, departmentId));
        return c.body(null, 204);
      }),
    );

    app.post("/management-api/venue-service/departments", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["name", "tradingName"]);
        const department = await gated(sessionId, (tx) =>
          createDepartment(tx, ctx.cfg, {
            name: requireString(body.name, "name"),
            tradingName:
              body.tradingName === undefined
                ? undefined
                : requireString(body.tradingName, "tradingName"),
          }),
        );
        return c.json(department, 201);
      }),
    );

    app.post("/management-api/venue-service/zones", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        if (Array.isArray(body))
          throw new AppError("management.request_invalid", { field: "body" });
        const name = requireString(body.name, "name").trim();
        if (name === "") throw new AppError("management.request_invalid", { field: "name" });
        const zone = await gated(sessionId, (tx) =>
          createServiceZone(tx, ctx.cfg, {
            name,
            displayOrder:
              body.displayOrder === undefined ? undefined : requireDisplayOrder(body.displayOrder),
            departmentId: requireBodyUuid(body.departmentId, "departmentId"),
          }),
        );
        return c.json(zone, 201);
      }),
    );

    app.put("/management-api/venue-service/zones/:zoneId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["departmentId"]);
        await gated(sessionId, (tx) =>
          configureZone(tx, ctx.cfg, {
            zoneId,
            departmentId: requireBodyUuid(body.departmentId, "departmentId"),
          }),
        );
        return c.body(null, 204);
      }),
    );

    app.patch("/management-api/venue-service/zones/:zoneId/sale-policy/:field", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
        const field = c.req.param("field");
        const body = await readJsonBody<Record<string, unknown>>(c);
        const value = requireSalePolicyField(field, body.value, true);
        await gated(sessionId, async (tx) => {
          if (field === "orderStart")
            await setZoneSalePolicyOverride(
              tx,
              ctx.cfg,
              zoneId,
              "orderStart",
              value as "table" | "counter" | null,
            );
          else if (field === "paidWhen")
            await setZoneSalePolicyOverride(
              tx,
              ctx.cfg,
              zoneId,
              field,
              value as "prepay" | "ticket_then_pay" | null,
            );
          else if (field === "collectionNumber")
            await setZoneSalePolicyOverride(
              tx,
              ctx.cfg,
              zoneId,
              field,
              value as "none" | "numbered" | null,
            );
          else if (field === "receiptPrintMode")
            await setZoneSalePolicyOverride(
              tx,
              ctx.cfg,
              zoneId,
              "receiptPrintMode",
              value as "auto" | "on_request" | null,
            );
          else throw new AppError("management.request_invalid", { field });
        });
        return c.body(null, 204);
      }),
    );

    const transferSettingsPath =
      "/management-api/venue-service/departments/:departmentId/transfers";
    app.get(transferSettingsPath, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        return c.json(
          await gated(sessionId, (tx) => readDepartmentTransferSettings(tx, ctx.cfg, departmentId)),
        );
      }),
    );
    app.get(`${transferSettingsPath}/profiles`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        return c.json(
          await gated(sessionId, (tx) => listDepartmentTransferProfiles(tx, ctx.cfg, departmentId)),
        );
      }),
    );
    app.put(transferSettingsPath, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        const input = requireTransferSettings(body);
        await gated(sessionId, (tx) =>
          setDepartmentTransferSettings(tx, ctx.cfg, departmentId, input),
        );
        return c.body(null, 204);
      }),
    );

    app.get("/management-api/venue-service/opening-hours", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        return c.json(await viewed(sessionId, (tx) => readOpeningHoursModel(tx, ctx.cfg, at)));
      }),
    );

    app.post("/management-api/venue-service/departments/:departmentId/menu-periods", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["name", "colour", "menuId", "staffMenuIds", "endOffsetMinutes"]);
        const name = requireString(body.name, "name");
        const menuId = requireBodyUuid(body.menuId, "menuId");
        const input = {
          name,
          menuId,
          ...(body.colour === undefined ? {} : { colour: requirePeriodColour(body.colour) }),
          staffMenuIds: requireStaffMenuIds(body.staffMenuIds),
          ...(body.endOffsetMinutes === undefined
            ? {}
            : { endOffsetMinutes: parseEndOffsetMinutes(body.endOffsetMinutes) }),
        };
        const period = await gated(sessionId, (tx) =>
          saveMenuPeriod(tx, ctx.cfg, departmentId, input),
        );
        return c.json(period, 201);
      }),
    );

    app.patch("/management-api/venue-service/menu-periods/:periodId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const periodId = requireUuidParam(c.req.param("periodId"), "MenuPeriodId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["name", "colour", "menuId", "staffMenuIds", "endOffsetMinutes"]);
        if (Object.keys(body).length === 0)
          throw new AppError("management.request_invalid", { field: "body" });
        const period = {
          ...(body.name === undefined ? {} : { name: requireString(body.name, "name") }),
          ...(body.menuId === undefined ? {} : { menuId: requireBodyUuid(body.menuId, "menuId") }),
          ...(body.colour === undefined ? {} : { colour: requirePeriodColour(body.colour) }),
          ...(body.staffMenuIds === undefined
            ? {}
            : { staffMenuIds: requireStaffMenuIds(body.staffMenuIds) }),
          ...(body.endOffsetMinutes === undefined
            ? {}
            : { endOffsetMinutes: parseEndOffsetMinutes(body.endOffsetMinutes) }),
        };
        await gated(sessionId, (tx) => updateMenuPeriod(tx, ctx.cfg, periodId, period));
        return c.body(null, 204);
      }),
    );

    app.delete("/management-api/venue-service/menu-periods/:periodId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const periodId = requireUuidParam(c.req.param("periodId"), "MenuPeriodId");
        await gated(sessionId, (tx) => deleteMenuPeriod(tx, ctx.cfg, periodId));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/departments/:departmentId/menu-week", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["days"]);
        await gated(sessionId, (tx) =>
          replaceMenuWeek(tx, ctx.cfg, departmentId, body.days as readonly MenuWeekDay[], at),
        );
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/zones/:zoneId/closed-week", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ZoneId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["days"]);
        await gated(sessionId, (tx) => replaceZoneClosedWeek(tx, ctx.cfg, zoneId, body.days));
        return c.body(null, 204);
      }),
    );
    app.put("/management-api/venue-service/special-dates/:id/zone-closed-times/:zoneId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "SpecialDateId");
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ZoneId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["ranges"]);
        await gated(sessionId, (tx) => saveZoneClosedDate(tx, ctx.cfg, id, zoneId, body.ranges));
        return c.body(null, 204);
      }),
    );

    const dateTimetable =
      "/management-api/venue-service/special-dates/:id/menu-timetables/:departmentId";
    app.put(dateTimetable, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const id = requireUuidParam(c.req.param("id"), "SpecialDateId");
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["slots"]);
        await gated(sessionId, (tx) =>
          saveSpecialDateMenus(tx, ctx.cfg, id, departmentId, body.slots as MenuSlot[], at),
        );
        return c.body(null, 204);
      }),
    );
  },
};
