import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRouteContext, ModuleRoutes, ServiceMode } from "@waitron/module";
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
  setDepartmentAllDayMenu,
  setDepartmentMenus,
  setZoneAllDayMenu,
} from "./department-menus.js";
import {
  clearSpecialDateMenus,
  deleteMenuPeriod,
  readMenuTimetableModel,
  replaceMenuWeek,
  saveMenuPeriod,
  saveSpecialDateMenus,
  setZonePeriodMenu,
  updateMenuPeriod,
} from "./menu-timetable.js";
import type { MenuSlot, MenuWeekDay } from "./menu-timetable-types.js";
import { KITCHEN_TICKET_GROUPINGS, type KitchenTicketGrouping } from "./schema/settings.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import {
  assignUnfiledProduct,
  createException,
  deleteException,
  explainRoute,
  type ExplainWhen,
  removeClaim,
  reorderExceptions,
  routingModel,
  previewRoutingChange,
  setClaim,
  updateException,
} from "./routing-store.js";
import type { ExceptionInput, RouteTarget } from "./routing.js";
import { isLocalDate, weekdayOf } from "./hours-rules.js";
import { VENUE_SERVICE_CALENDAR_PARTICIPANTS } from "./calendar-participants.js";
import {
  deleteLocalHoliday,
  deleteRetainedHolidayGeography,
  duplicateHolidayNamedSpecialDates,
  readHolidays,
  readLocalHolidayModel,
  saveHolidayArea,
  saveLocalHoliday,
} from "./holidays.js";
import type { LocalHolidayInput } from "./holiday-types.js";
import { deleteSpecialDate, readHoursModel, replaceWeekHours, saveSpecialDate } from "./hours.js";
import type { HoursSubject, LocalDate, SpecialDateInput, WeekDay } from "./hours-types.js";
import type { RoutingChange } from "./routing-types.js";
import { setStationFallback, setStationToday } from "./station-times.js";
import "./errors.js";

const [{ permission: MANAGE_VENUE_SERVICE }] = VENUE_SERVICE_PERMISSIONS;
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
  "department.last_active": 409,
  "zone.table_in_use": 409,
  "zone.department_inactive": 409,
  "service_zone.not_found": 404,
  "department_menu.not_found": 404,
  "department_menu.in_use": 409,
  "menu_period.not_found": 404,
  "menu_period.in_use": 409,
  "menu_period.name_taken": 409,
  "menu_timetable.invalid": 400,
  "zone.name_taken": 409,
  "catalogue.not_found": 404,
  "route.subject_not_found": 404,
  "route.not_found": 404,
  "route.station_inactive": 409,
  "station.not_found": 404,
  "station.fallback_loop": 409,
  "time_zone.unreadable": 409,
  "hours.invalid": 400,
  "special_date.not_found": 404,
  "special_date.date_taken": 409,
  "station.always_open": 409,
  "holiday.invalid": 400,
  "holiday.not_found": 404,
  "holiday_geography.not_found": 404,
  "holiday.date_taken": 409,
  "holiday.local_limit": 409,
  "holiday.geography_current": 409,
};
const run = createErrorBoundary(STATUS, "venue_service.failed");
const MODES = new Set<ServiceMode>(["table_tab", "prepay", "ticket_then_pay"]);
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const PAID_WHEN = new Set(["prepay", "ticket_then_pay"]);
const COLLECTION_NUMBER = new Set(["none", "numbered"]);
const RECEIPT_PRINT_MODE = new Set(["auto", "on_request", "never"]);

function requireSalePolicyField(field: string, value: unknown, zone: boolean) {
  if (
    zone &&
    value === null &&
    (field === "paidWhen" || field === "collectionNumber" || field === "receiptPrintMode")
  )
    return null;
  if (field === "paidWhen" && PAID_WHEN.has(value as string))
    return value as "prepay" | "ticket_then_pay";
  if (field === "collectionNumber" && COLLECTION_NUMBER.has(value as string))
    return value as "none" | "numbered";
  if (field === "receiptPrintMode" && RECEIPT_PRINT_MODE.has(value as string))
    return value as "auto" | "on_request" | "never";
  if (!zone && field === "printTradingName" && typeof value === "boolean") return value;
  throw new AppError("management.request_invalid", { field });
}

/** Refuses any body key outside `allowed`, so a client cannot choose what the server derives. */
function onlyKeys(body: object, allowed: readonly string[]): void {
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
}

function requireMode(value: unknown, field: string): ServiceMode {
  if (typeof value !== "string" || !MODES.has(value as ServiceMode)) {
    throw new AppError("management.request_invalid", { field });
  }
  return value as ServiceMode;
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

function requireMenuIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new AppError("management.request_invalid", { field: "menuIds" });
  return value.map((menuId) => requireBodyUuid(menuId, "menuIds"));
}

function requireName(value: unknown, field: string): string {
  const name = requireString(value, field);
  if (name.trim() === "") throw new AppError("management.request_invalid", { field });
  return name;
}

function requireRoutingTarget(body: Record<string, unknown>): RouteTarget {
  const stationId =
    body.stationId === undefined || body.stationId === null
      ? null
      : requireBodyUuid(body.stationId, "stationId");
  if ((stationId === null) === (body.noPreparation !== true))
    throw new AppError("management.request_invalid", { field: "target" });
  return stationId === null ? { kind: "no_preparation" } : { kind: "station", stationId };
}

function requireExceptionInput(body: Record<string, unknown>): ExceptionInput {
  const zoneId =
    body.zoneId === undefined || body.zoneId === null
      ? null
      : requireBodyUuid(body.zoneId, "zoneId");
  const categoryId =
    body.categoryId === undefined || body.categoryId === null
      ? null
      : requireBodyUuid(body.categoryId, "categoryId");
  const productId =
    body.productId === undefined || body.productId === null
      ? null
      : requireBodyUuid(body.productId, "productId");
  if (categoryId !== null && productId !== null)
    throw new AppError("management.request_invalid", { field: "subject" });
  if (zoneId === null && categoryId === null && productId === null)
    throw new AppError("management.request_invalid", { field: "condition" });
  return { zoneId, categoryId, productId, target: requireRoutingTarget(body) };
}

function requirePreviewChange(body: Record<string, unknown>): RoutingChange {
  const target = (value: unknown): RouteTarget => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new AppError("management.request_invalid", { field: "target" });
    const candidate = value as Record<string, unknown>;
    if (candidate.kind === "station")
      return requireRoutingTarget({ stationId: candidate.stationId });
    if (candidate.kind === "no_preparation") return requireRoutingTarget({ noPreparation: true });
    throw new AppError("management.request_invalid", { field: "target" });
  };
  if (body.kind === "claim")
    return {
      kind: "claim",
      categoryId: requireBodyUuid(body.categoryId, "categoryId"),
      target: body.target === null ? null : target(body.target),
    };
  if (body.kind === "assignment")
    return {
      kind: "assignment",
      productId: requireBodyUuid(body.productId, "productId"),
      target: target(body.target),
    };
  if (body.kind === "exception") {
    if (typeof body.input !== "object" || body.input === null || Array.isArray(body.input))
      throw new AppError("management.request_invalid", { field: "input" });
    const input = body.input as Record<string, unknown>;
    if (body.id !== null)
      for (const field of ["zoneId", "categoryId", "productId"])
        if (input[field] === undefined) throw new AppError("management.request_invalid", { field });
    const parsed = requireExceptionInput({
      ...input,
      ...(target(input.target).kind === "station"
        ? { stationId: (input.target as { stationId: string }).stationId }
        : { noPreparation: true }),
    });
    return {
      kind: "exception",
      id: body.id === null ? null : requireBodyUuid(body.id, "id"),
      input: parsed,
    };
  }
  if (body.kind === "exception_delete")
    return { kind: "exception_delete", id: requireBodyUuid(body.id, "id") };
  if (body.kind === "exception_order") {
    if (!Array.isArray(body.ids))
      throw new AppError("management.request_invalid", { field: "ids" });
    return { kind: "exception_order", ids: body.ids.map((id) => requireBodyUuid(id, "ids")) };
  }
  throw new AppError("management.request_invalid", { field: "kind" });
}

export const VENUE_SERVICE_ROUTES: ModuleRoutes = {
  mount(app, ctx: ModuleRouteContext, log: Logger): void {
    const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
      withTransaction(ctx.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: MANAGE_VENUE_SERVICE,
        });
        return fn(tx);
      });

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

    app.get("/management-api/venue-service/holidays", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const from = c.req.query("from") ?? "";
        const to = c.req.query("to") ?? "";
        return c.json(await viewed(sessionId, (tx) => readHolidays(tx, ctx.cfg, from, to)));
      }),
    );

    app.get("/management-api/venue-service/local-holidays", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        return c.json(await viewed(sessionId, (tx) => readLocalHolidayModel(tx, ctx.cfg)));
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

    app.post("/management-api/venue-service/local-holidays", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<LocalHolidayInput>(c);
        const saved = await gated(sessionId, (tx) => {
          onlyKeys(body, ["date", "name"]);
          return saveLocalHoliday(tx, ctx.cfg, null, body);
        });
        return c.json(saved, 201);
      }),
    );

    app.put("/management-api/venue-service/local-holidays/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "LocalHolidayId");
        const body = await readJsonBody<LocalHolidayInput>(c);
        return c.json(
          await gated(sessionId, (tx) => {
            onlyKeys(body, ["date", "name"]);
            return saveLocalHoliday(tx, ctx.cfg, id, body);
          }),
        );
      }),
    );

    app.delete("/management-api/venue-service/local-holidays/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "LocalHolidayId");
        await gated(sessionId, (tx) => deleteLocalHoliday(tx, ctx.cfg, id));
        return c.body(null, 204);
      }),
    );

    app.delete("/management-api/venue-service/holiday-geographies/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "HolidayGeographyId");
        await gated(sessionId, (tx) => deleteRetainedHolidayGeography(tx, ctx.cfg, id));
        return c.body(null, 204);
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
          await gated(sessionId, (tx) => saveSpecialDate(tx, ctx.cfg, null, body, at)),
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
        return c.json(await gated(sessionId, (tx) => routingModel(tx, ctx.cfg, new Date())));
      }),
    );

    app.get("/management-api/venue-service/routing/explain", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const productId = requireUuidParam(c.req.query("productId") ?? "", "ProductId");
        const extraProductIds = (c.req.queries("extraId") ?? []).map((id) =>
          requireUuidParam(id, "ProductId"),
        );
        const zone = c.req.query("zoneId");
        const zoneId = zone ? requireUuidParam(zone, "ServiceZoneId") : null;
        // A weekday previews the standard week; a date previews that date's own hours.
        const weekday = c.req.query("weekday");
        const date = c.req.query("date");
        const time = c.req.query("time");
        if (
          (weekday !== undefined && date !== undefined) ||
          (weekday === undefined && date === undefined) !== (time === undefined) ||
          (weekday !== undefined && !/^[0-6]$/.test(weekday)) ||
          (date !== undefined && !isLocalDate(date)) ||
          (time !== undefined && !CLOCK_TIME.test(time))
        )
          throw new AppError("management.request_invalid", { field: "when" });
        const when: ExplainWhen =
          time === undefined
            ? { kind: "now", at: new Date() }
            : date === undefined
              ? { kind: "at", moment: { weekday: Number(weekday), timeOfDay: time } }
              : {
                  kind: "at",
                  moment: { civilDate: date, weekday: weekdayOf(date), timeOfDay: time },
                };
        return c.json(
          await gated(sessionId, (tx) =>
            explainRoute(tx, ctx.cfg, productId, zoneId, when, extraProductIds),
          ),
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

    app.put("/management-api/venue-service/routing/claims/:categoryId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const categoryId = requireUuidParam(c.req.param("categoryId"), "CategoryId");
        const target = requireRoutingTarget(await readJsonBody<Record<string, unknown>>(c));
        await gated(sessionId, (tx) => setClaim(tx, ctx.cfg, categoryId, target));
        return c.body(null, 204);
      }),
    );

    app.delete("/management-api/venue-service/routing/claims/:categoryId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const categoryId = requireUuidParam(c.req.param("categoryId"), "CategoryId");
        await gated(sessionId, (tx) => removeClaim(tx, ctx.cfg, categoryId));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/routing/products/:productId/assignment", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const productId = requireUuidParam(c.req.param("productId"), "ProductId");
        const target = requireRoutingTarget(await readJsonBody<Record<string, unknown>>(c));
        await gated(sessionId, (tx) => assignUnfiledProduct(tx, ctx.cfg, productId, target));
        return c.body(null, 204);
      }),
    );

    app.post("/management-api/venue-service/routing/exceptions", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const input = requireExceptionInput(await readJsonBody<Record<string, unknown>>(c));
        const id = await gated(sessionId, (tx) => createException(tx, ctx.cfg, input));
        return c.json({ id }, 201);
      }),
    );

    app.put("/management-api/venue-service/routing/exceptions/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "PreparationRouteId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        for (const field of ["zoneId", "categoryId", "productId"])
          if (body[field] === undefined)
            throw new AppError("management.request_invalid", { field });
        const input = requireExceptionInput(body);
        await gated(sessionId, (tx) => updateException(tx, ctx.cfg, id, input));
        return c.body(null, 204);
      }),
    );

    app.delete("/management-api/venue-service/routing/exceptions/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "PreparationRouteId");
        await gated(sessionId, (tx) => deleteException(tx, ctx.cfg, id));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/routing/exception-order", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        if (!Array.isArray(body.ids))
          throw new AppError("management.request_invalid", { field: "ids" });
        const ids = body.ids.map((id) => requireBodyUuid(id, "ids"));
        await gated(sessionId, (tx) => reorderExceptions(tx, ctx.cfg, ids));
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

    app.put("/management-api/venue-service/stations/:stationId/today", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const stationId = requireUuidParam(c.req.param("stationId"), "StationId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        if (body.state !== "open" && body.state !== "closed" && body.state !== null)
          throw new AppError("management.request_invalid", { field: "state" });
        await gated(sessionId, (tx) =>
          setStationToday(
            tx,
            ctx.cfg,
            stationId,
            body.state as "open" | "closed" | null,
            new Date(),
          ),
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

    app.patch("/management-api/venue-service/departments/:departmentId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        if (body.active !== undefined && typeof body.active !== "boolean") {
          throw new AppError("management.request_invalid", { field: "active" });
        }
        const active = body.active;
        const edit =
          active === undefined ||
          body.name !== undefined ||
          body.tradingName !== undefined ||
          body.defaultServiceMode !== undefined
            ? {
                name: requireName(body.name, "name"),
                tradingName: requireName(body.tradingName, "tradingName"),
                defaultServiceMode: requireMode(body.defaultServiceMode, "defaultServiceMode"),
              }
            : undefined;
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
          if (field === "paidWhen")
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
              value as "auto" | "on_request" | "never",
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
        const department = await gated(sessionId, (tx) =>
          createDepartment(tx, ctx.cfg, {
            name: requireString(body.name, "name"),
            tradingName:
              body.tradingName === undefined
                ? undefined
                : requireString(body.tradingName, "tradingName"),
            defaultServiceMode: requireMode(body.defaultServiceMode, "defaultServiceMode"),
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
        await gated(sessionId, (tx) =>
          configureZone(tx, ctx.cfg, {
            zoneId,
            departmentId: requireBodyUuid(body.departmentId, "departmentId"),
            serviceMode:
              body.serviceMode === null || body.serviceMode === undefined
                ? null
                : requireMode(body.serviceMode, "serviceMode"),
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
          if (field === "paidWhen")
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
              value as "auto" | "on_request" | "never" | null,
            );
          else throw new AppError("management.request_invalid", { field });
        });
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/departments/:departmentId/menus", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["menuIds"]);
        const menuIds = requireMenuIds(body.menuIds);
        await gated(sessionId, (tx) => setDepartmentMenus(tx, ctx.cfg, departmentId, menuIds));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/departments/:departmentId/all-day-menu", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["menuId"]);
        const menuId = requireNullableBodyUuid(body.menuId, "menuId");
        await gated(sessionId, (tx) => setDepartmentAllDayMenu(tx, ctx.cfg, departmentId, menuId));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/zones/:zoneId/all-day-menu", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["menuId"]);
        const menuId = requireNullableBodyUuid(body.menuId, "menuId");
        await gated(sessionId, (tx) => setZoneAllDayMenu(tx, ctx.cfg, zoneId, menuId));
        return c.body(null, 204);
      }),
    );

    app.get("/management-api/venue-service/menu-timetable", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        return c.json(await viewed(sessionId, (tx) => readMenuTimetableModel(tx, ctx.cfg, at)));
      }),
    );

    app.post("/management-api/venue-service/departments/:departmentId/menu-periods", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["name", "menuId"]);
        const name = requireString(body.name, "name");
        const menuId = requireBodyUuid(body.menuId, "menuId");
        const period = await gated(sessionId, (tx) =>
          saveMenuPeriod(tx, ctx.cfg, departmentId, { id: null, name, menuId }),
        );
        return c.json(period, 201);
      }),
    );

    app.patch("/management-api/venue-service/menu-periods/:periodId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const periodId = requireUuidParam(c.req.param("periodId"), "MenuPeriodId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["name", "menuId"]);
        if (body.name === undefined && body.menuId === undefined)
          throw new AppError("management.request_invalid", { field: "body" });
        const period = {
          ...(body.name === undefined ? {} : { name: requireString(body.name, "name") }),
          ...(body.menuId === undefined ? {} : { menuId: requireBodyUuid(body.menuId, "menuId") }),
        };
        return c.json(
          await gated(sessionId, (tx) => updateMenuPeriod(tx, ctx.cfg, periodId, period)),
        );
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

    app.delete(dateTimetable, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const at = new Date();
        const id = requireUuidParam(c.req.param("id"), "SpecialDateId");
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        await gated(sessionId, (tx) => clearSpecialDateMenus(tx, ctx.cfg, id, departmentId, at));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/zones/:zoneId/period-menus/:periodId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
        const periodId = requireUuidParam(c.req.param("periodId"), "MenuPeriodId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        onlyKeys(body, ["menuId"]);
        const menuId = requireNullableBodyUuid(body.menuId, "menuId");
        await gated(sessionId, (tx) => setZonePeriodMenu(tx, ctx.cfg, zoneId, periodId, menuId));
        return c.body(null, 204);
      }),
    );
  },
};
