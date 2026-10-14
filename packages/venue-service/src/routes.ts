import { listDepartmentReceiptReadiness } from "./department-receipts.js";
import { and, eq } from "drizzle-orm";
import { departments } from "./schema/service.js";
import { readDepartmentDeleteImpact, deleteDepartment } from "./service-delete.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { floorZones, withTransaction, type Transaction } from "@waitron/db";
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
  saveDepartmentEditSettings,
  saveZoneServiceSettings,
  saveZoneSettings,
  type DepartmentEditInput,
  type ZoneServiceSettingsInput,
  configureZone,
  createServiceZone,
  createDepartment,
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
  readPrintMovedSlips,
  readReleaseReminderMinutes,
  writeClearingWorkflow,
  writeEditSentLines,
  writeKitchenTicketGrouping,
  writePrintHeldWork,
  writePrintMovedSlips,
  writeReleaseReminderMinutes,
} from "./kitchen-notices.js";
import {
  readOpeningHoursModel,
  replaceMenuWeek,
  saveMenuPeriod,
  updateMenuPeriod,
} from "./menu-timetable.js";
import { isLocalDate, parseCalendarMonth, parseCalendarYear } from "./hours-rules.js";
import {
  CALENDAR_COLOURS,
  SEASON_DAYS_MAX_DATES,
  type CalendarColour,
  type LocalDate,
} from "./hours-types.js";
import type { MenuWeekDay } from "./menu-timetable-types.js";
import { KITCHEN_TICKET_GROUPINGS, type KitchenTicketGrouping } from "./schema/settings.js";
import { MANAGE_VENUE_SERVICE } from "./permissions.js";
import {
  clearRoutingCell,
  routingModel,
  previewRoutingChange,
  setRoutingCell,
} from "./routing-store.js";
import type { RouteTarget } from "./routing.js";
import { readHolidays, saveHolidayArea } from "./holidays.js";
import type { CellAddress, PeriodLine, RoutingChange } from "./routing-types.js";
import {
  listDepartmentTransferProfiles,
  readDepartmentTransferSettings,
  setDepartmentTransferSettings,
} from "./department-transfers.js";
import "./errors.js";
import { replaceZoneClosedWeek } from "./zone-closed-times.js";
import { parseEndOffsetMinutes } from "./period-end-offset.js";
import {
  deleteSpecialDay,
  listSpecialDays,
  readSpecialDay,
  saveSpecialDay,
} from "./special-days.js";
import { deletePeriod, periodDeleteImpact, readPaintedIn } from "./period-delete.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "department.name_taken": 409,
  "department.not_found": 404,
  "department_transfer.settings_invalid": 400,
  "department.last_active": 409,
  "zone.table_in_use": 409,
  "table.booked": 409,
  "table.delivery_in_progress": 409,
  "zone.order_in_progress": 409,
  "zone.transfer_pending": 409,
  "zone.profile_in_use": 409,
  "department.order_in_progress": 409,
  "department.transfer_pending": 409,
  "department.profile_in_use": 409,
  "service_zone.not_found": 404,
  "department_menu.not_found": 404,
  "department_menu.in_use": 409,
  "zone_extension.invalid": 400,
  "zone_extension.not_allowed": 409,
  "period_extension.invalid": 400,
  "period_extension.not_allowed": 409,
  "menu_period.not_found": 404,
  "menu_period.name_taken": 409,
  "menu_timetable.invalid": 400,
  "menu_period.invalid": 400,
  "zone.name_taken": 409,
  "catalogue.not_found": 404,
  "route.subject_not_found": 404,
  "route.station_inactive": 409,
  "route.period_invalid": 409,
  "station.not_found": 404,
  "station.destination_invalid": 400,
  "time_zone.unreadable": 409,
  "hours.invalid": 400,
  "hours.clock_change_pending": 409,
  "hours.clock_changed": 409,
  "venue.business_day_hours_conflict": 409,
  "season.not_found": 404,
  "season.invalid": 400,
  "zone_closed_time.invalid": 400,
  "station.always_open": 409,
  "holiday.invalid": 400,
  "special_day.invalid": 400,
  "special_day.not_found": 404,
  "special_day.date_taken": 409,
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

function zoneSettingsBody(body: Record<string, unknown>): ZoneServiceSettingsInput {
  return {
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

function requireRouteTarget(target: unknown, field: string): RouteTarget {
  if (isRecord(target)) {
    if (target.kind === "no_preparation" && hasExactly(target, ["kind"]))
      return { kind: "no_preparation" };
    if (target.kind === "station" && hasExactly(target, ["kind", "stationId"]))
      return { kind: "station", stationId: requireBodyUuid(target.stationId, field) };
  }
  throw new AppError("management.request_invalid", { field });
}

function requireCellTarget(body: Record<string, unknown>): RouteTarget | null {
  if (!Object.hasOwn(body, "target"))
    throw new AppError("management.request_invalid", { field: "target" });
  return body.target === null ? null : requireRouteTarget(body.target, "target");
}

/** A cell being cleared takes no period lines, not even an empty list. */
function requireCellPeriods(
  body: Record<string, unknown>,
  target: RouteTarget | null,
): PeriodLine[] | undefined {
  if (!Object.hasOwn(body, "periods")) return undefined;
  const invalid = () => new AppError("management.request_invalid", { field: "periods" });
  const { periods } = body;
  if (target === null || !Array.isArray(periods)) throw invalid();
  return periods.map((line: unknown) => {
    if (!isRecord(line) || !hasExactly(line, ["periodId", "target"])) throw invalid();
    return {
      periodId: requireBodyUuid(line.periodId, "periods"),
      target: requireRouteTarget(line.target, "periods"),
    };
  });
}

function requireCellChange(body: Record<string, unknown>): Omit<RoutingChange, "kind"> {
  const address = requireCellAddress(body.address);
  const target = requireCellTarget(body);
  const periods = requireCellPeriods(body, target);
  return { address, target, ...(periods === undefined ? {} : { periods }) };
}

function requirePreviewChange(body: Record<string, unknown>): RoutingChange {
  if (body.kind !== "cell") throw new AppError("management.request_invalid", { field: "kind" });
  onlyKeys(body, ["kind", "address", "target", "periods"]);
  return { kind: "cell", ...requireCellChange(body) };
}

import { stationServiceTimes } from "./station-service-times.js";
import { readSpecialDaysModel } from "./named-days.js";
import {
  readOpeningHoursMonth,
  readOpeningHoursYear,
  readSeasonDays,
} from "./opening-hours-calendar.js";
import { addSeason, deleteSeason, saveSeason, seasonDeleteImpact } from "./seasons.js";
import { saveSeasonWeeks } from "./season-weeks.js";
import type { ClosedRange } from "./service-day.js";

/** A comma list of one to `SEASON_DAYS_MAX_DATES` dates whose years `parseCalendarYear` accepts,
 *  or null. */
function parseSeasonDates(value: string | undefined): LocalDate[] | null {
  const dates = (value ?? "").split(",");
  if (dates.length > SEASON_DAYS_MAX_DATES) return null;
  return dates.every((date) => isLocalDate(date) && parseCalendarYear(date.slice(0, 4)) !== null)
    ? dates
    : null;
}

/** Refused as a stale clock, as a missing revision is on every other time-affecting write; a
 *  season rename changes no times, so its writer never checks the revision itself. */
function requireClockRevision(body: { expectedClockRevision?: unknown }): number {
  const revision = body.expectedClockRevision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
    throw new AppError("hours.clock_changed", {});
  return revision;
}

/** A season-weeks list: absent, or entries each naming a distinct uuid under `idKey`, with days
 *  the week's writer checks. */
function requireWeekList(
  value: unknown,
  field: string,
  idKey: string,
): { id: string; days: unknown }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AppError("management.request_invalid", { field });
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    const at = `${field}.${index}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new AppError("management.request_invalid", { field: at });
    const extra = Object.keys(entry).find((key) => key !== idKey && key !== "days");
    if (extra !== undefined)
      throw new AppError("management.request_invalid", { field: `${at}.${extra}` });
    const record = entry as Record<string, unknown>;
    const id = requireBodyUuid(record[idKey], `${at}.${idKey}`);
    if (seen.has(id)) throw new AppError("management.request_invalid", { field: `${at}.${idKey}` });
    seen.add(id);
    return { id, days: record.days };
  });
}

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

    app.get("/management-api/venue-service/stations/:stationId/service-times", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const stationId = requireUuidParam(c.req.param("stationId"), "stationId");
        const from = c.req.query("from") ?? "";
        const to = c.req.query("to") ?? "";
        if (c.req.query("week") !== undefined)
          throw new AppError("management.request_invalid", { field: "week" });
        return c.json(
          await viewed(sessionId, (tx) => stationServiceTimes(tx, ctx.cfg, stationId, from, to)),
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
          await viewed(sessionId, (tx) => readSpecialDaysModel(tx, ctx.cfg, from, to, at)),
        );
      }),
    );

    app.get("/management-api/venue-service/opening-hours/year", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const year = parseCalendarYear(c.req.query("year"));
        if (year === null) throw new AppError("management.request_invalid", { field: "year" });
        const at = new Date();
        return c.json(await viewed(sessionId, (tx) => readOpeningHoursYear(tx, ctx.cfg, year, at)));
      }),
    );

    app.get("/management-api/venue-service/opening-hours/month", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const month = parseCalendarMonth(c.req.query("month"));
        if (month === null) throw new AppError("management.request_invalid", { field: "month" });
        const at = new Date();
        return c.json(
          await viewed(sessionId, (tx) => readOpeningHoursMonth(tx, ctx.cfg, month, at)),
        );
      }),
    );

    app.get("/management-api/venue-service/opening-hours/season-days", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const dates = parseSeasonDates(c.req.query("dates"));
        if (dates === null) throw new AppError("management.request_invalid", { field: "dates" });
        return c.json(await viewed(sessionId, (tx) => readSeasonDays(tx, ctx.cfg, dates)));
      }),
    );

    const SEASON_KEYS = ["name", "startsOn", "expectedClockRevision"] as const;
    const seasonInput = (body: Record<string, unknown>) => {
      onlyKeys(body, SEASON_KEYS);
      return {
        input: { name: body.name as string, startsOn: body.startsOn as string },
        revision: requireClockRevision(body),
      };
    };

    app.post("/management-api/venue-service/seasons", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const added = await gated(sessionId, (tx) => {
          const { input, revision } = seasonInput(body);
          return addSeason(tx, ctx.cfg, input, new Date(), revision);
        });
        return c.json(added, 201);
      }),
    );

    app.put("/management-api/venue-service/seasons/:seasonId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("seasonId"), "SeasonId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        return c.json(
          await gated(sessionId, (tx) => {
            const { input, revision } = seasonInput(body);
            return saveSeason(tx, ctx.cfg, id, input, new Date(), revision);
          }),
        );
      }),
    );

    app.delete("/management-api/venue-service/seasons/:seasonId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("seasonId"), "SeasonId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        await gated(sessionId, (tx) => {
          onlyKeys(body, ["expectedClockRevision"]);
          return deleteSeason(tx, ctx.cfg, id, new Date(), requireClockRevision(body));
        });
        return c.body(null, 204);
      }),
    );

    app.get("/management-api/venue-service/seasons/:seasonId/delete-impact", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("seasonId"), "SeasonId");
        return c.json(await viewed(sessionId, (tx) => seasonDeleteImpact(tx, ctx.cfg, id)));
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

    const SPECIAL_DAY_KEYS = [
      "name",
      "repeatsYearly",
      "dates",
      "paint",
      "zonePaint",
      "expectedClockRevision",
    ] as const;

    app.get("/management-api/venue-service/special-days", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        return c.json(await viewed(sessionId, (tx) => listSpecialDays(tx, ctx.cfg)));
      }),
    );

    app.get("/management-api/venue-service/special-days/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "SpecialDayId");
        return c.json(await viewed(sessionId, (tx) => readSpecialDay(tx, ctx.cfg, id)));
      }),
    );

    app.post("/management-api/venue-service/special-days", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const saved = await gated(sessionId, (tx) => {
          onlyKeys(body, SPECIAL_DAY_KEYS);
          const { expectedClockRevision, ...input } = body;
          return saveSpecialDay(
            tx,
            ctx.cfg,
            null,
            input,
            new Date(),
            expectedClockRevision as number,
          );
        });
        return c.json(saved, 201);
      }),
    );

    app.put("/management-api/venue-service/special-days/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "SpecialDayId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        return c.json(
          await gated(sessionId, (tx) => {
            onlyKeys(body, SPECIAL_DAY_KEYS);
            const { expectedClockRevision, ...input } = body;
            return saveSpecialDay(
              tx,
              ctx.cfg,
              id,
              input,
              new Date(),
              expectedClockRevision as number,
            );
          }),
        );
      }),
    );

    app.delete("/management-api/venue-service/special-days/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "SpecialDayId");
        const body = await readJsonBody<{ expectedClockRevision: number }>(c);
        await gated(sessionId, (tx) =>
          deleteSpecialDay(tx, ctx.cfg, id, new Date(), body.expectedClockRevision as number),
        );
        return c.body(null, 204);
      }),
    );

    app.get("/management-api/venue-service/routing", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        return c.json(
          await gatedAs(sessionId, async (tx, role) => ({
            ...(await routingModel(tx, ctx.cfg, new Date())),
            canMakeDefault: roleHasPermission(role, "venue.configure"),
            printMovedSlips: await readPrintMovedSlips(tx),
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
        onlyKeys(body, ["address", "target", "periods"]);
        const { address, target, periods } = requireCellChange(body);
        await gated(sessionId, (tx) =>
          target === null
            ? clearRoutingCell(tx, ctx.cfg, address)
            : setRoutingCell(tx, ctx.cfg, address, target, periods),
        );
        return c.body(null, 204);
      }),
    );

    // The departments and zones alone, for a screen that needs nothing else of the venue's setup.
    app.get("/management-api/venue-service/departments-and-zones", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const result = await gated(sessionId, async (tx) => ({
          departments: (await listDepartments(tx, ctx.cfg)).filter(
            (department) => department.active,
          ),
          zones: await listServiceZones(tx, ctx.cfg),
        }));
        return c.json(result);
      }),
    );

    app.get("/management-api/venue-service", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const result = await gated(sessionId, async (tx) => ({
          departments: (await listDepartments(tx, ctx.cfg)).filter(
            (department) => department.active,
          ),
          zones: await listServiceZones(tx, ctx.cfg),
          salePolicies: await listSalePolicies(tx, ctx.cfg),
          readiness: [
            ...(await listVenueReadiness(tx, ctx.cfg)),
            ...(ctx.cfg.operationDescriptionRequired === true
              ? await listDepartmentReceiptReadiness(tx, ctx.cfg)
              : []),
          ],
          settings: { editSentLines: await readEditSentLines(tx) },
          kitchenTicketGrouping: await readKitchenTicketGrouping(tx),
          printHeldWork: await readPrintHeldWork(tx),
          printMovedSlips: await readPrintMovedSlips(tx),
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
            printMovedSlips: await readPrintMovedSlips(tx),
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

    app.put("/management-api/venue-service/settings/print-moved-slips", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const printMovedSlips = body.printMovedSlips;
        if (typeof printMovedSlips !== "boolean") {
          throw new AppError("management.request_invalid", { field: "printMovedSlips" });
        }
        await gated(sessionId, (tx) => writePrintMovedSlips(tx, printMovedSlips));
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
          "orderStart",
          "paidWhen",
          "collectionNumber",
          "transfers",
        ]);
        const input: DepartmentEditInput = {
          name: requireName(body.name, "name"),
          tradingName: requireName(body.tradingName, "tradingName"),
          orderStart: requireSalePolicyField(
            "orderStart",
            body.orderStart,
            false,
          ) as DepartmentEditInput["orderStart"],
          paidWhen: requireSalePolicyField(
            "paidWhen",
            body.paidWhen,
            false,
          ) as DepartmentEditInput["paidWhen"],
          collectionNumber: requireSalePolicyField(
            "collectionNumber",
            body.collectionNumber,
            false,
          ) as DepartmentEditInput["collectionNumber"],
          ...(body.transfers === undefined
            ? {}
            : { transfers: requireTransferSettings(body.transfers) }),
        };
        await gated(sessionId, (tx) =>
          saveDepartmentEditSettings(tx, ctx.cfg, departmentId, input),
        );
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/zones/:zoneId/settings", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["name", "orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"]);
        const name = requireName(body.name, "name");
        const policy = zoneSettingsBody(body);
        await gated(sessionId, async (tx) => {
          const zone = (await listServiceZones(tx, ctx.cfg)).find((zone) => zone.id === zoneId);
          if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId });
          if (zone.name !== name)
            await authorizeManager(tx, {
              managementSessionId: sessionId,
              permission: "venue.configure",
            });
          await saveZoneSettings(tx, ctx.cfg, zoneId, { name, ...policy });
        });
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/zones/:zoneId/service-settings", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"]);
        const input = zoneSettingsBody(body);
        await gated(sessionId, (tx) => saveZoneServiceSettings(tx, ctx.cfg, zoneId, input));
        return c.body(null, 204);
      }),
    );

    app.patch("/management-api/venue-service/departments/:departmentId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        if (Object.hasOwn(body, "active"))
          throw new AppError("management.request_invalid", { field: "active" });
        onlyKeys(body, ["name", "tradingName"]);
        const edit = {
          ...(body.name === undefined ? {} : { name: requireName(body.name, "name") }),
          ...(body.tradingName === undefined
            ? {}
            : { tradingName: requireName(body.tradingName, "tradingName") }),
        };
        if (Object.keys(edit).length === 0)
          throw new AppError("management.request_invalid", { field: "name" });
        await gated(sessionId, async (tx) => {
          const [department] = await tx
            .select({ id: departments.id })
            .from(departments)
            .where(
              and(
                eq(departments.id, departmentId),
                eq(departments.locationId, ctx.cfg.locationId),
                eq(departments.active, true),
              ),
            );
          if (department === undefined)
            throw new AppError("department.not_found", { departmentId });
          await updateDepartment(tx, ctx.cfg, departmentId, edit);
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

    app.get("/management-api/venue-service/departments/:departmentId/delete-impact", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        return c.json(
          await gated(sessionId, (tx) =>
            readDepartmentDeleteImpact(
              tx,
              ctx.cfg,
              ctx.core.floorDeletion,
              departmentId,
              new Date(),
            ),
          ),
        );
      }),
    );

    app.delete("/management-api/venue-service/departments/:departmentId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        if ((await c.req.text()) !== "")
          throw new AppError("management.request_invalid", { field: "body" });
        return c.json(
          await gated(sessionId, (tx) =>
            deleteDepartment(tx, ctx.cfg, ctx.core.floorDeletion, departmentId, new Date()),
          ),
        );
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
        await gated(sessionId, async (tx) => {
          const departmentId = requireBodyUuid(body.departmentId, "departmentId");
          const [zone] = await tx
            .select({ id: floorZones.id })
            .from(floorZones)
            .where(
              and(
                eq(floorZones.id, zoneId),
                eq(floorZones.locationId, ctx.cfg.locationId),
                eq(floorZones.active, true),
              ),
            );
          if (zone === undefined) throw new AppError("service_zone.not_found", { zoneId });
          await configureZone(tx, ctx.cfg, { zoneId, departmentId });
        });
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
        onlyKeys(body, [
          "name",
          "colour",
          "menuId",
          "staffMenuIds",
          "endOffsetMinutes",
          "expectedClockRevision",
        ]);
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
          saveMenuPeriod(tx, ctx.cfg, departmentId, input, body.expectedClockRevision as number),
        );
        return c.json(period, 201);
      }),
    );

    app.get("/management-api/venue-service/menu-periods/painted-in", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const asked = c.req.query("periodId");
        const periodId = asked === undefined ? undefined : requireUuidParam(asked, "MenuPeriodId");
        const painted = await viewed(sessionId, (tx) =>
          readPaintedIn(tx, ctx.cfg, new Date(), periodId),
        );
        return c.json([...painted].map(([periodId, where]) => ({ periodId, ...where })));
      }),
    );

    app.get("/management-api/venue-service/menu-periods/:periodId/delete-impact", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const periodId = requireUuidParam(c.req.param("periodId"), "MenuPeriodId");
        return c.json(
          await viewed(sessionId, (tx) => periodDeleteImpact(tx, ctx.cfg, periodId, new Date())),
        );
      }),
    );

    app.post("/management-api/venue-service/menu-periods/:periodId/delete", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const periodId = requireUuidParam(c.req.param("periodId"), "MenuPeriodId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        await gated(sessionId, (tx) => {
          onlyKeys(body, ["replacementPeriodId", "expectedClockRevision"]);
          const replacementId = requireNullableBodyUuid(
            body.replacementPeriodId,
            "replacementPeriodId",
          );
          return deletePeriod(
            tx,
            ctx.cfg,
            periodId,
            replacementId,
            new Date(),
            body.expectedClockRevision as number,
          );
        });
        return c.body(null, 204);
      }),
    );

    app.patch("/management-api/venue-service/menu-periods/:periodId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const periodId = requireUuidParam(c.req.param("periodId"), "MenuPeriodId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, [
          "name",
          "colour",
          "menuId",
          "staffMenuIds",
          "endOffsetMinutes",
          "expectedClockRevision",
        ]);
        if (Object.keys(body).every((key) => key === "expectedClockRevision"))
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
        await gated(sessionId, (tx) =>
          updateMenuPeriod(tx, ctx.cfg, periodId, period, body.expectedClockRevision as number),
        );
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/departments/:departmentId/menu-week", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["days", "seasonId", "expectedClockRevision"]);
        await gated(sessionId, (tx) =>
          replaceMenuWeek(
            tx,
            ctx.cfg,
            departmentId,
            body.days as readonly MenuWeekDay[],
            new Date(),
            body.expectedClockRevision as number,
            { seasonId: requireBodyUuid(body.seasonId, "seasonId") },
          ),
        );
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/seasons/:seasonId/weeks", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const seasonId = requireUuidParam(c.req.param("seasonId"), "SeasonId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        await gated(sessionId, (tx) => {
          onlyKeys(body, ["departments", "zones", "expectedClockRevision"]);
          const departments = requireWeekList(body.departments, "departments", "departmentId");
          const zones = requireWeekList(body.zones, "zones", "zoneId");
          const revision = requireClockRevision(body);
          return saveSeasonWeeks(
            tx,
            ctx.cfg,
            seasonId,
            {
              departments: departments?.map(({ id, days }) => ({
                departmentId: id,
                days: days as readonly MenuWeekDay[],
              })),
              zones: zones?.map(({ id, days }) => ({
                zoneId: id,
                days: days as readonly { weekday: number; ranges: readonly ClosedRange[] }[],
              })),
            },
            new Date(),
            revision,
          );
        });
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/zones/:zoneId/closed-week", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ZoneId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["days", "seasonId", "expectedClockRevision"]);
        await gated(sessionId, (tx) =>
          replaceZoneClosedWeek(
            tx,
            ctx.cfg,
            zoneId,
            body.days,
            body.expectedClockRevision as number,
            new Date(),
            { seasonId: requireBodyUuid(body.seasonId, "seasonId") },
          ),
        );
        return c.body(null, 204);
      }),
    );
  },
};
