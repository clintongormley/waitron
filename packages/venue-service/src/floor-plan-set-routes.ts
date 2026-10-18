import type { Context, Hono } from "hono";
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
  readPeriodFloorPlans,
  renameFloorPlanSet,
} from "./floor-plan-set-store.js";
import { onlyKeys } from "./request-keys.js";

const BASE = "/management-api/venue-service/floor-plan-sets";

type Run = (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response>;
type Body = Record<string, unknown>;

const setParam = (c: Context) => requireUuidParam(c.req.param("setId")!, "setId");

function nameOf(body: Body): string {
  onlyKeys(body, ["name"]);
  return requireString(body.name, "name");
}

/**
 * The Floor plans page's routes: reads need `venue.view`, writes `venue.configure`. The session
 * and permission are judged before the request's path and body, so a refused caller learns
 * nothing about what it sent.
 */
export function mountFloorPlanSetRoutes(
  app: Hono,
  ctx: ModuleRouteContext,
  log: Logger,
  run: Run,
): void {
  const as =
    (permission: "venue.view" | "venue.configure") =>
    async <T>(c: Context, fn: (tx: Transaction, body: Body) => Promise<T>): Promise<T> => {
      const sessionId = requireManagementSession(c);
      const body = permission === "venue.configure" ? await readJsonBody<Body>(c) : {};
      return withTransaction(ctx.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId: sessionId, permission });
        return fn(tx, body);
      });
    };
  const viewed = as("venue.view");
  const configured = as("venue.configure");

  app.get(BASE, (c) =>
    run(c, log, async () =>
      c.json(await viewed(c, (tx) => readFloorPlanSetsModel(tx, ctx.cfg, ctx.core.floorPlanSets))),
    ),
  );

  app.get(`${BASE}/period-choices`, (c) =>
    run(c, log, async () =>
      c.json(await viewed(c, (tx) => readPeriodFloorPlans(tx, ctx.cfg, ctx.core.floorPlanSets))),
    ),
  );

  app.post(BASE, (c) =>
    run(c, log, async () => {
      const setId = await configured(c, (tx, body) => {
        onlyKeys(body, ["departmentId", "name", "fromSetId"]);
        return createFloorPlanSet(tx, ctx.cfg, ctx.core.floorPlanSets, {
          departmentId: requireBodyUuid(body.departmentId, "departmentId"),
          name: requireString(body.name, "name"),
          ...(body.fromSetId === undefined
            ? {}
            : { fromSetId: requireBodyUuid(body.fromSetId, "fromSetId") }),
        });
      });
      return c.json({ setId }, 201);
    }),
  );

  app.patch(`${BASE}/:setId`, (c) =>
    run(c, log, async () => {
      await configured(c, (tx, body) => renameFloorPlanSet(tx, ctx.cfg, setParam(c), nameOf(body)));
      return c.body(null, 204);
    }),
  );

  app.post(`${BASE}/:setId/copy`, (c) =>
    run(c, log, async () => {
      const setId = await configured(c, (tx, body) =>
        copyFloorPlanSet(tx, ctx.cfg, ctx.core.floorPlanSets, setParam(c), nameOf(body)),
      );
      return c.json({ setId }, 201);
    }),
  );

  app.post(`${BASE}/:setId/make-default`, (c) =>
    run(c, log, async () => {
      await configured(c, (tx) => makeDefaultFloorPlanSet(tx, ctx.cfg, setParam(c)));
      return c.body(null, 204);
    }),
  );

  app.get(`${BASE}/:setId/delete-impact`, (c) =>
    run(c, log, async () =>
      c.json(
        await viewed(c, (tx) =>
          readFloorPlanSetDeleteImpact(tx, ctx.cfg, ctx.core.floorPlanSets, setParam(c)),
        ),
      ),
    ),
  );

  app.post(`${BASE}/:setId/delete`, (c) =>
    run(c, log, async () => {
      await configured(c, (tx, body) => {
        onlyKeys(body, ["replaceWith"]);
        return deleteFloorPlanSet(
          tx,
          ctx.cfg,
          ctx.core.floorDeletion,
          setParam(c),
          requireNullableBodyUuid(body.replaceWith, "replaceWith"),
        );
      });
      return c.body(null, 204);
    }),
  );
}
