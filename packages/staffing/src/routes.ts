import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import type { ModuleRouteContext, ModuleRoutes } from "@waitron/module";
import {
  createErrorBoundary,
  readJsonBody,
  readRawJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireString,
} from "@waitron/server-kit";
import type { Logger } from "@waitron/server-kit";
import { readLocationClock } from "@waitron/reporting";
import { AppError, normaliseUuid } from "@waitron/shared";
import { parseCalendarMonth } from "@waitron/venue-service";
import {
  addRotaShift,
  changeRotaWeek,
  isRotaWeek,
  readRotaWeek,
  removeRotaShift,
  updateRotaShift,
} from "./rota.js";
import type { RotaShiftInput, RotaShiftPatch } from "./staffing-types.js";
import { readStaffingMonth } from "./month.js";
import { parseArea, parseBlocks, record, uuid } from "./paint-rules.js";
import {
  listStaffingAreas,
  readSeasonStaffing,
  readSpecialDayStaffing,
  saveSeasonStaffing,
  saveSpecialDayStaffing,
  type SeasonStaffingEdit,
  type SpecialDayStaffingEdit,
} from "./paint.js";
import { STAFFING_PERMISSIONS } from "./permissions.js";
import {
  createStaffRole,
  deleteStaffRole,
  listStaffRolesWithHolderNames,
  readStaffRoleDeleteImpact,
  reorderStaffRoles,
  setStaffRoleHolders,
  updateStaffRole,
  type StaffRoleInput,
} from "./staff-roles.js";
import "./errors.js";

const [{ permission: MANAGE_STAFFING }] = STAFFING_PERMISSIONS;
const VIEW_VENUE: Permission = "venue.view";
const ROOT = "/management-api/staffing";
const BASE = `${ROOT}/staff-roles`;
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "staffing.invalid": 400,
  "staff_role.not_found": 404,
  "staff_role.name_taken": 409,
  "staff_role.in_use": 409,
  "season.not_found": 404,
  "shift.not_found": 404,
  "shift.invalid": 400,
  "roster.not_draft": 409,
  "roster.not_found": 404,
  "roster.draft_exists": 409,
  "special_day.not_found": 404,
};
const run = createErrorBoundary(STATUS, "staffing.failed");
// An id in a request body that is not one of the venue's is a bad request, not a missing page.
const runReorder = createErrorBoundary(
  { ...STATUS, "staff_role.not_found": 400 },
  "staffing.failed",
);
const runPaintSave = createErrorBoundary(
  { ...STATUS, "staff_role.not_found": 400, "staffing_area.not_found": 400 },
  "staffing.failed",
);

function onlyKeys(
  body: unknown,
  allowed: readonly string[],
): asserts body is Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new AppError("management.request_invalid", { field: "body" });
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
}

/** The colour is checked against the palette by the domain, which refuses it as `staffing.invalid`. */
function staffRoleInput(body: unknown): StaffRoleInput {
  onlyKeys(body, ["name", "colour"]);
  return {
    name: requireString(body.name, "name"),
    colour: requireString(body.colour, "colour") as StaffRoleInput["colour"],
  };
}

function uuidList(body: unknown, field: string): string[] {
  onlyKeys(body, [field]);
  const value = body[field];
  if (!Array.isArray(value)) throw new AppError("management.request_invalid", { field });
  return value.map((item) => normaliseUuid(requireBodyUuid(item, field), field));
}

const invalid = (field: string) => new AppError("staffing.invalid", { field });

/** The body's `edits` list, each edit checked to hold only `keys`. */
function editList(
  body: unknown,
  keys: ReadonlySet<string>,
): { edit: Record<string, unknown>; field: string }[] {
  onlyKeys(body, ["edits"]);
  const { edits } = body;
  if (!Array.isArray(edits)) throw invalid("edits");
  return edits.map((edit: unknown, index) => {
    const field = `edits.${index}`;
    return { edit: record(edit, field, keys), field };
  });
}

const SEASON_EDIT_KEYS = new Set(["area", "weekday", "blocks"]);
const SPECIAL_DAY_EDIT_KEYS = new Set(["area", "dateId", "blocks"]);

function seasonEdits(body: unknown, cutover: string): SeasonStaffingEdit[] {
  return editList(body, SEASON_EDIT_KEYS).map(({ edit, field }) => {
    const area = parseArea(edit.area, `${field}.area`);
    const { weekday } = edit;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
      throw invalid(`${field}.weekday`);
    return { area, weekday, blocks: parseBlocks(edit.blocks, `${field}.blocks`, cutover) };
  });
}

/** `blocks: null` is a value (the date follows the season); a missing `blocks` is refused by
 *  `parseBlocks` as `undefined`. */
function specialDayEdits(body: unknown, cutover: string): SpecialDayStaffingEdit[] {
  return editList(body, SPECIAL_DAY_EDIT_KEYS).map(({ edit, field }) => {
    const area = parseArea(edit.area, `${field}.area`);
    const dateId = uuid(edit.dateId, `${field}.dateId`);
    const blocks =
      edit.blocks === null ? null : parseBlocks(edit.blocks, `${field}.blocks`, cutover);
    return { area, dateId, blocks };
  });
}

export const STAFFING_ROUTES: ModuleRoutes = {
  mount(app, ctx: ModuleRouteContext, log: Logger): void {
    const gatedBy = <T>(
      permission: string,
      sessionId: string,
      fn: (tx: Transaction) => Promise<T>,
    ): Promise<T> =>
      withTransaction(ctx.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId: sessionId, permission });
        return fn(tx);
      });
    const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
      gatedBy(MANAGE_STAFFING, sessionId, fn);
    const staffRoleIdParam = (raw: string) => normaliseUuid(raw, "StaffRoleId");
    const cutoverOf = async (tx: Transaction) =>
      (await readLocationClock(tx, ctx.cfg.locationId)).dayCutover;

    const rotaBody = (body: unknown, patch: boolean) => {
      const fields = patch
        ? ["personId", "startsAt", "endsAt", "area", "staffRoleId"]
        : ["week", "businessDay", "personId", "startsAt", "endsAt", "area", "staffRoleId"];
      if (body === null || typeof body !== "object" || Array.isArray(body))
        throw new AppError("management.request_invalid", { field: "body" });
      onlyKeys(body, fields);
      const input = body as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const field of fields) {
        if (patch && !(field in input)) continue;
        result[field] =
          field === "area"
            ? parseArea(input[field], field)
            : field === "personId" || field === "staffRoleId"
              ? uuid(input[field], field)
              : requireString(input[field], field);
      }
      return result;
    };
    app.get(`${ROOT}/rota`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const week = c.req.query("week");
        if (!isRotaWeek(week)) throw new AppError("management.request_invalid", { field: "week" });
        return c.json(
          await gatedBy("schedule.manage", sessionId, (tx) => readRotaWeek(tx, ctx.cfg, week)),
        );
      }),
    );
    app.post(`${ROOT}/rota/change-week`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readRawJsonBody<unknown>(c);
        onlyKeys(body, ["week"]);
        if (!isRotaWeek(body.week))
          throw new AppError("management.request_invalid", { field: "week" });
        const week = body.week;
        return c.json(
          await gatedBy("schedule.manage", sessionId, (tx) => changeRotaWeek(tx, ctx.cfg, week)),
        );
      }),
    );
    app.post(`${ROOT}/rota/shifts`, (c) =>
      runPaintSave(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<unknown>(c);
        const shiftId = await gatedBy("schedule.manage", sessionId, (tx) =>
          addRotaShift(tx, ctx.cfg, rotaBody(body, false) as unknown as RotaShiftInput),
        );
        return c.json({ shiftId }, 201);
      }),
    );
    app.patch(`${ROOT}/rota/shifts/:shiftId`, (c) =>
      runPaintSave(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const shiftId = normaliseUuid(c.req.param("shiftId"), "shiftId");
        const body = await readJsonBody<unknown>(c);
        await gatedBy("schedule.manage", sessionId, (tx) =>
          updateRotaShift(tx, ctx.cfg, shiftId, rotaBody(body, true) as RotaShiftPatch),
        );
        return c.body(null, 204);
      }),
    );
    app.delete(`${ROOT}/rota/shifts/:shiftId`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const shiftId = normaliseUuid(c.req.param("shiftId"), "shiftId");
        await gatedBy("schedule.manage", sessionId, (tx) => removeRotaShift(tx, ctx.cfg, shiftId));
        return c.body(null, 204);
      }),
    );

    app.get(`${ROOT}/areas`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const areas = await gatedBy(VIEW_VENUE, sessionId, (tx) => listStaffingAreas(tx, ctx.cfg));
        return c.json({ areas });
      }),
    );

    app.get(`${ROOT}/month`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const month = parseCalendarMonth(c.req.query("month"));
        if (month === null) throw new AppError("management.request_invalid", { field: "month" });
        const at = new Date();
        return c.json(
          await gatedBy(VIEW_VENUE, sessionId, (tx) => readStaffingMonth(tx, ctx.cfg, month, at)),
        );
      }),
    );

    app.get(`${ROOT}/seasons/:seasonId`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = normaliseUuid(c.req.param("seasonId"), "SeasonId");
        return c.json(
          await gatedBy(VIEW_VENUE, sessionId, (tx) => readSeasonStaffing(tx, ctx.cfg, id)),
        );
      }),
    );

    app.put(`${ROOT}/seasons/:seasonId`, (c) =>
      runPaintSave(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = normaliseUuid(c.req.param("seasonId"), "SeasonId");
        const body = await readRawJsonBody<unknown>(c);
        await gated(sessionId, async (tx) =>
          saveSeasonStaffing(tx, ctx.cfg, id, seasonEdits(body, await cutoverOf(tx))),
        );
        return c.body(null, 204);
      }),
    );

    app.get(`${ROOT}/special-days/:specialDayId`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = normaliseUuid(c.req.param("specialDayId"), "SpecialDayId");
        return c.json(
          await gatedBy(VIEW_VENUE, sessionId, (tx) => readSpecialDayStaffing(tx, ctx.cfg, id)),
        );
      }),
    );

    app.put(`${ROOT}/special-days/:specialDayId`, (c) =>
      runPaintSave(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = normaliseUuid(c.req.param("specialDayId"), "SpecialDayId");
        const body = await readRawJsonBody<unknown>(c);
        await gated(sessionId, async (tx) =>
          saveSpecialDayStaffing(tx, ctx.cfg, id, specialDayEdits(body, await cutoverOf(tx))),
        );
        return c.body(null, 204);
      }),
    );

    app.get(BASE, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const staffRoles = await gatedBy(VIEW_VENUE, sessionId, (tx) =>
          listStaffRolesWithHolderNames(tx, ctx.cfg),
        );
        return c.json({ staffRoles });
      }),
    );

    app.post(BASE, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readRawJsonBody<unknown>(c);
        const staffRole = await gated(sessionId, (tx) =>
          createStaffRole(tx, ctx.cfg, staffRoleInput(body)),
        );
        return c.json(staffRole, 201);
      }),
    );

    // Mounted before `/:staffRoleId` so that `order` never reaches the update handler.
    app.put(`${BASE}/order`, (c) =>
      runReorder(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readRawJsonBody<unknown>(c);
        await gated(sessionId, (tx) =>
          reorderStaffRoles(tx, ctx.cfg, uuidList(body, "staffRoleIds")),
        );
        return c.body(null, 204);
      }),
    );

    app.put(`${BASE}/:staffRoleId`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = staffRoleIdParam(c.req.param("staffRoleId"));
        const body = await readRawJsonBody<unknown>(c);
        return c.json(
          await gated(sessionId, (tx) => updateStaffRole(tx, ctx.cfg, id, staffRoleInput(body))),
        );
      }),
    );

    app.put(`${BASE}/:staffRoleId/holders`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = staffRoleIdParam(c.req.param("staffRoleId"));
        const body = await readRawJsonBody<unknown>(c);
        return c.json(
          await gated(sessionId, (tx) =>
            setStaffRoleHolders(tx, ctx.cfg, id, uuidList(body, "personIds")),
          ),
        );
      }),
    );

    // Gated like the delete, as the zone, station, course, department and printer impact reads are.
    app.get(`${BASE}/:staffRoleId/delete-impact`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = staffRoleIdParam(c.req.param("staffRoleId"));
        return c.json(await gated(sessionId, (tx) => readStaffRoleDeleteImpact(tx, ctx.cfg, id)));
      }),
    );

    app.delete(`${BASE}/:staffRoleId`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = staffRoleIdParam(c.req.param("staffRoleId"));
        return c.json(await gated(sessionId, (tx) => deleteStaffRole(tx, ctx.cfg, id)));
      }),
    );
  },
};
