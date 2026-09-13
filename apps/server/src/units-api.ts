import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import {
  createUnit,
  deleteUnit,
  getUnit,
  listUnits,
  productsUsingUnit,
  updateUnit,
  type UpdateUnitInput,
} from "@waitron/catalogue";
import { authorizeManager } from "@waitron/identity";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { isUuid } from "./till-session.js";

export interface UnitsApiDeps {
  db: Database;
  cfg: { tenantId: string };
  venueLocale: string;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "content.translation_invalid": 400,
  "content.translation_required": 400,
  "unit.precision_invalid": 400,
  "unit.not_found": 404,
  "unit.in_use": 409,
};
const run = createErrorBoundary(STATUS, "units.failed");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unitId(c: Context): string {
  const id = c.req.param("id");
  if (id === undefined || !isUuid(id)) {
    throw new AppError("shared.invalid_id", { kind: "UnitId", value: id ?? "" });
  }
  return id;
}

function screenName(value: unknown): asserts value is Record<string, string> {
  if (!isPlainObject(value)) throw new AppError("management.request_invalid", { field: "name" });
}

export function mountUnitsApi(app: Hono, deps: UnitsApiDeps, log: Logger): void {
  const gated = <T>(sessionId: string, action: (tx: Transaction) => Promise<T>) =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const auth = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: "person.manage",
      });
      if (auth.tenantId !== deps.cfg.tenantId) {
        throw new AppError("authorization.not_permitted", { permission: "person.manage" });
      }
      return action(tx);
    });

  app.get("/management-api/units", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(await gated(sessionId, (tx) => listUnits(tx, deps.cfg.tenantId)));
    }),
  );

  app.get("/management-api/units/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      return c.json(await gated(sessionId, (tx) => getUnit(tx, deps.cfg.tenantId, unitId(c))));
    }),
  );

  app.get("/management-api/units/:id/products", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = unitId(c);
      return c.json(
        await gated(sessionId, async (tx) => {
          await getUnit(tx, deps.cfg.tenantId, id); // 404 for an unknown or foreign unit
          return productsUsingUnit(tx, deps.cfg.tenantId, id);
        }),
      );
    }),
  );

  app.post("/management-api/units", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ name?: unknown; precision?: unknown }>(c);
      screenName(body.name);
      if (typeof body.precision !== "number") {
        throw new AppError("management.request_invalid", { field: "precision" });
      }
      const created = await gated(sessionId, (tx) =>
        createUnit(
          tx,
          deps.cfg.tenantId,
          { name: body.name as Record<string, string>, precision: body.precision as number },
          deps.venueLocale,
        ),
      );
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/units/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = unitId(c);
      const body = await readJsonBody<{ name?: unknown; precision?: unknown }>(c);
      const patch: UpdateUnitInput = {};
      if (body.name !== undefined) {
        screenName(body.name);
        patch.name = body.name as Record<string, string>;
      }
      if (body.precision !== undefined) {
        if (typeof body.precision !== "number") {
          throw new AppError("management.request_invalid", { field: "precision" });
        }
        patch.precision = body.precision;
      }
      return c.json(
        await gated(sessionId, (tx) =>
          updateUnit(tx, deps.cfg.tenantId, id, patch, deps.venueLocale),
        ),
      );
    }),
  );

  app.delete("/management-api/units/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, (tx) => deleteUnit(tx, deps.cfg.tenantId, unitId(c)));
      return c.body(null, 204);
    }),
  );
}
