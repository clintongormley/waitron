import "./errors.js";
import type { Hono } from "hono";
import { withTransaction, type Database } from "@waitron/db";
import {
  createAccessRole,
  renameAccessRole,
  setAccessRolePermissions,
  deleteAccessRole,
} from "@waitron/identity";
import {
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
  requireUuidParam,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Logger } from "./logger.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "role.not_permitted": 403,
    "role.not_found": 404,
    "role.built_in": 409,
    "role.name_taken": 409,
    "role.changed": 409,
    "person.last_admin": 409,
  },
  "management.failed",
);

function text(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string") throw new AppError("management.request_invalid", { field });
  return value;
}
function permissions(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.some((permission) => typeof permission !== "string"))
    throw new AppError("management.request_invalid", { field });
  return value as string[];
}

export function mountAccessRolesApi(app: Hono, deps: { db: Database }, log: Logger): void {
  app.post("/management-api/access-roles", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const name = text(body, "name");
      const grants = permissions(body, "permissions");
      const copiedFrom = body.copiedFrom === undefined ? undefined : text(body, "copiedFrom");
      const created = await withTransaction(deps.db, (tx) =>
        createAccessRole(tx, {
          managementSessionId,
          name,
          permissions: grants,
          ...(copiedFrom === undefined ? {} : { copiedFrom }),
        }),
      );
      return c.json(created, 201);
    }),
  );
  app.put("/management-api/access-roles/:id/name", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const roleId = requireUuidParam(c.req.param("id"), "roleId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const name = text(body, "name");
      const expectedName = text(body, "expectedName");
      await withTransaction(deps.db, (tx) =>
        renameAccessRole(tx, { managementSessionId, roleId, name, expectedName }),
      );
      return c.json({});
    }),
  );
  app.put("/management-api/access-roles/:id/permissions", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const roleId = requireUuidParam(c.req.param("id"), "roleId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const grants = permissions(body, "permissions");
      const expectedPermissions = permissions(body, "expectedPermissions");
      await withTransaction(deps.db, (tx) =>
        setAccessRolePermissions(tx, {
          managementSessionId,
          roleId,
          permissions: grants,
          expectedPermissions,
        }),
      );
      return c.json({});
    }),
  );
  app.delete("/management-api/access-roles/:id", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const roleId = requireUuidParam(c.req.param("id"), "roleId");
      return c.json(
        await withTransaction(deps.db, (tx) =>
          deleteAccessRole(tx, { managementSessionId, roleId }),
        ),
      );
    }),
  );
}
