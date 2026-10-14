import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import type { ModuleRouteContext, ModuleRoutes } from "@waitron/module";
import {
  createErrorBoundary,
  readJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireString,
} from "@waitron/server-kit";
import type { Logger } from "@waitron/server-kit";
import { readLocationClock } from "@waitron/reporting";
import { AppError, normaliseUuid } from "@waitron/shared";
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
  listStaffRoles,
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

/** Refuses any body key outside `allowed`, so a client cannot choose what the server derives. */
function onlyKeys(body: object, allowed: readonly string[]): void {
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
}

/** The colour is checked against the palette by the domain, which refuses it as `staffing.invalid`. */
function staffRoleInput(body: Record<string, unknown>): StaffRoleInput {
  onlyKeys(body, ["name", "colour"]);
  return {
    name: requireString(body.name, "name"),
    colour: requireString(body.colour, "colour") as StaffRoleInput["colour"],
  };
}

function uuidList(body: Record<string, unknown>, field: string): string[] {
  onlyKeys(body, [field]);
  const value = body[field];
  if (!Array.isArray(value)) throw new AppError("management.request_invalid", { field });
  return value.map((item) => normaliseUuid(requireBodyUuid(item, field), field));
}

const invalid = (field: string) => new AppError("staffing.invalid", { field });

/** The body's `edits` list, each edit checked to hold only `keys`. */
function editList(
  body: Record<string, unknown>,
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

function seasonEdits(body: Record<string, unknown>, cutover: string): SeasonStaffingEdit[] {
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
function specialDayEdits(body: Record<string, unknown>, cutover: string): SpecialDayStaffingEdit[] {
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

    app.get(`${ROOT}/areas`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const areas = await gatedBy(VIEW_VENUE, sessionId, (tx) => listStaffingAreas(tx, ctx.cfg));
        return c.json({ areas });
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
        const body = await readJsonBody<Record<string, unknown>>(c);
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
        const body = await readJsonBody<Record<string, unknown>>(c);
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
          listStaffRoles(tx, ctx.cfg),
        );
        return c.json({ staffRoles });
      }),
    );

    app.post(BASE, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
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
        const body = await readJsonBody<Record<string, unknown>>(c);
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
        const body = await readJsonBody<Record<string, unknown>>(c);
        return c.json(
          await gated(sessionId, (tx) => updateStaffRole(tx, ctx.cfg, id, staffRoleInput(body))),
        );
      }),
    );

    app.put(`${BASE}/:staffRoleId/holders`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = staffRoleIdParam(c.req.param("staffRoleId"));
        const body = await readJsonBody<Record<string, unknown>>(c);
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
