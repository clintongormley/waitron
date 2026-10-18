import type { Context, Hono } from "hono";
import { AppError } from "@waitron/shared";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import {
  readJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireNullableBodyUuid,
  requireString,
  requireUuidParam,
  type Logger,
} from "@waitron/server-kit";
import "./errors.js";
import {
  copyFloorPlanSet,
  createFloorPlanSet,
  deleteFloorPlanSet,
  makeDefaultFloorPlanSet,
  readFloorPlanSetDeleteImpact,
  readFloorPlanSetsModel,
  renameFloorPlanSet,
} from "./floor-plan-set-store.js";

const BASE = "/management-api/venue-service/floor-plan-sets";

type Run = (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response>;

function onlyKeys(body: object, allowed: readonly string[]): void {
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new AppError("management.request_invalid", { field: extra });
}

/** The Floor plans page's routes: reads need `venue.view`, writes `venue.configure`. */
export function mountFloorPlanSetRoutes(
  app: Hono,
  ctx: ModuleRouteContext,
  log: Logger,
  run: Run,
): void {
  const as =
    (permission: "venue.view" | "venue.configure") =>
    <T>(c: Context, fn: (tx: Transaction) => Promise<T>): Promise<T> => {
      const sessionId = requireManagementSession(c);
      return withTransaction(ctx.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId: sessionId, permission });
        return fn(tx);
      });
    };
  const viewed = as("venue.view");
  const configured = as("venue.configure");
  const nameBody = async (c: Context) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    onlyKeys(body, ["name"]);
    return requireString(body.name, "name");
  };

  app.get(BASE, (c) =>
    run(c, log, async () =>
      c.json(await viewed(c, (tx) => readFloorPlanSetsModel(tx, ctx.cfg, ctx.core.floorPlanSets))),
    ),
  );

  app.post(BASE, (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<Record<string, unknown>>(c);
      onlyKeys(body, ["departmentId", "name", "fromSetId"]);
      const input = {
        departmentId: requireBodyUuid(body.departmentId, "departmentId"),
        name: requireString(body.name, "name"),
        ...(body.fromSetId === undefined
          ? {}
          : { fromSetId: requireBodyUuid(body.fromSetId, "fromSetId") }),
      };
      const setId = await configured(c, (tx) =>
        createFloorPlanSet(tx, ctx.cfg, ctx.core.floorPlanSets, input),
      );
      return c.json({ setId }, 201);
    }),
  );

  app.patch(`${BASE}/:setId`, (c) =>
    run(c, log, async () => {
      const setId = requireUuidParam(c.req.param("setId"), "setId");
      const name = await nameBody(c);
      await configured(c, (tx) => renameFloorPlanSet(tx, ctx.cfg, setId, name));
      return c.body(null, 204);
    }),
  );

  app.post(`${BASE}/:setId/copy`, (c) =>
    run(c, log, async () => {
      const fromSetId = requireUuidParam(c.req.param("setId"), "setId");
      const name = await nameBody(c);
      const setId = await configured(c, (tx) =>
        copyFloorPlanSet(tx, ctx.cfg, ctx.core.floorPlanSets, fromSetId, name),
      );
      return c.json({ setId }, 201);
    }),
  );

  app.post(`${BASE}/:setId/make-default`, (c) =>
    run(c, log, async () => {
      const setId = requireUuidParam(c.req.param("setId"), "setId");
      await configured(c, (tx) => makeDefaultFloorPlanSet(tx, ctx.cfg, setId));
      return c.body(null, 204);
    }),
  );

  app.get(`${BASE}/:setId/delete-impact`, (c) =>
    run(c, log, async () => {
      const setId = requireUuidParam(c.req.param("setId"), "setId");
      return c.json(
        await viewed(c, (tx) =>
          readFloorPlanSetDeleteImpact(tx, ctx.cfg, ctx.core.floorPlanSets, setId),
        ),
      );
    }),
  );

  app.post(`${BASE}/:setId/delete`, (c) =>
    run(c, log, async () => {
      const setId = requireUuidParam(c.req.param("setId"), "setId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      onlyKeys(body, ["replaceWith"]);
      const replaceWith = requireNullableBodyUuid(body.replaceWith, "replaceWith");
      await configured(c, (tx) =>
        deleteFloorPlanSet(tx, ctx.cfg, ctx.core.floorDeletion, setId, replaceWith),
      );
      return c.body(null, 204);
    }),
  );
}
