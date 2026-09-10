import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRouteContext, ModuleRoutes, ServiceMode } from "@waitron/module";
import {
  createErrorBoundary,
  readJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireString,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "@waitron/server-kit";
import {
  allowMenuInZone,
  configureZone,
  createDepartment,
  createPreparationRoute,
  deactivateDepartment,
  deletePreparationRoute,
  listDepartments,
  listDepartmentHours,
  listPreparationRoutes,
  listServiceZones,
  listVenueReadiness,
  listZoneMenuAssignments,
  replaceDepartmentHours,
  setDeviceDefaultZone,
} from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import "./errors.js";

const [{ permission: MANAGE_VENUE_SERVICE }] = VENUE_SERVICE_PERMISSIONS;
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "department.not_found": 404,
  "department.has_active_zones": 409,
  "service_zone.not_found": 404,
  "catalogue.not_found": 404,
  "route.subject_not_found": 404,
  "route.not_found": 404,
  "route.missing": 409,
  "route.station_inactive": 409,
  "route.duplicate": 409,
};
const run = createErrorBoundary(STATUS, "venue_service.failed");
const MODES = new Set<ServiceMode>(["table_tab", "prepay", "invoice_first", "ticket_then_pay"]);
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function requireMode(value: unknown, field: string): ServiceMode {
  if (typeof value !== "string" || !MODES.has(value as ServiceMode)) {
    throw new AppError("management.request_invalid", { field });
  }
  return value as ServiceMode;
}

function requireDisplayOrder(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError("management.request_invalid", { field: "displayOrder" });
  }
  return value;
}

export const VENUE_SERVICE_ROUTES: ModuleRoutes = {
  mount(app, ctx: ModuleRouteContext, log: Logger): void {
    const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
      withTenant(ctx.db, ctx.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: MANAGE_VENUE_SERVICE,
        });
        return fn(tx);
      });

    app.get("/management-api/venue-service", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const result = await gated(sessionId, async (tx) => ({
          departments: await listDepartments(tx, ctx.cfg),
          zones: await listServiceZones(tx, ctx.cfg),
          routes: await listPreparationRoutes(tx, ctx.cfg),
          hours: await listDepartmentHours(tx, ctx.cfg),
          zoneMenus: await listZoneMenuAssignments(tx, ctx.cfg),
          readiness: await listVenueReadiness(tx, ctx.cfg),
        }));
        return c.json(result);
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

    app.put("/management-api/venue-service/departments/:departmentId/hours", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const departmentId = requireUuidParam(c.req.param("departmentId"), "DepartmentId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        if (!Array.isArray(body.hours)) {
          throw new AppError("management.request_invalid", { field: "hours" });
        }
        const hours = body.hours.map((value, index) => {
          if (typeof value !== "object" || value === null) {
            throw new AppError("management.request_invalid", { field: `hours.${index}` });
          }
          const interval = value as Record<string, unknown>;
          const weekday = interval.weekday;
          const opensAt = interval.opensAt;
          const closesAt = interval.closesAt;
          if (
            typeof weekday !== "number" ||
            !Number.isInteger(weekday) ||
            weekday < 0 ||
            weekday > 6 ||
            typeof opensAt !== "string" ||
            !CLOCK_TIME.test(opensAt) ||
            typeof closesAt !== "string" ||
            !CLOCK_TIME.test(closesAt) ||
            opensAt === closesAt
          ) {
            throw new AppError("management.request_invalid", { field: `hours.${index}` });
          }
          return { weekday, opensAt, closesAt };
        });
        await gated(sessionId, (tx) => replaceDepartmentHours(tx, ctx.cfg, departmentId, hours));
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

    app.put("/management-api/venue-service/zones/:zoneId/menus/:menuId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
        const menuId = requireUuidParam(c.req.param("menuId"), "MenuId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        await gated(sessionId, (tx) =>
          allowMenuInZone(tx, ctx.cfg, zoneId, menuId, {
            displayOrder:
              body.displayOrder === undefined ? undefined : requireDisplayOrder(body.displayOrder),
            makeDefault: body.makeDefault === true,
          }),
        );
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/venue-service/devices/:deviceId/default-zone", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const deviceId = requireUuidParam(c.req.param("deviceId"), "DeviceId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        const zoneId = requireBodyUuid(body.zoneId, "zoneId");
        await gated(sessionId, (tx) => setDeviceDefaultZone(tx, ctx.cfg, deviceId, zoneId));
        return c.body(null, 204);
      }),
    );

    app.post("/management-api/venue-service/routes", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const categoryId =
          body.categoryId === undefined || body.categoryId === null
            ? null
            : requireBodyUuid(body.categoryId, "categoryId");
        const productId =
          body.productId === undefined || body.productId === null
            ? null
            : requireBodyUuid(body.productId, "productId");
        if ((categoryId === null) === (productId === null)) {
          throw new AppError("management.request_invalid", { field: "subject" });
        }
        const stationId =
          body.stationId === undefined || body.stationId === null
            ? null
            : requireBodyUuid(body.stationId, "stationId");
        if ((stationId === null) === (body.noPreparation !== true)) {
          throw new AppError("management.request_invalid", { field: "target" });
        }
        const id = await gated(sessionId, (tx) =>
          createPreparationRoute(tx, ctx.cfg, {
            zoneId:
              body.zoneId === undefined || body.zoneId === null
                ? null
                : requireBodyUuid(body.zoneId, "zoneId"),
            categoryId,
            productId,
            target:
              stationId === null ? { kind: "no_preparation" } : { kind: "station", stationId },
          }),
        );
        return c.json({ id }, 201);
      }),
    );

    app.delete("/management-api/venue-service/routes/:routeId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const routeId = requireUuidParam(c.req.param("routeId"), "PreparationRouteId");
        await gated(sessionId, (tx) => deletePreparationRoute(tx, ctx.cfg, routeId));
        return c.body(null, 204);
      }),
    );
  },
};
