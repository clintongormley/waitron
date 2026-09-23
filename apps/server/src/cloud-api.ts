import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager, withPassiveManagementRead } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { CloudChoice, CloudConnection } from "./cloud-client.js";
import "./errors.js";
export interface CloudApiDeps {
  db: Database;
  connection?: CloudConnection;
  managementOrigin: string;
  isPrimary: () => boolean;
}
export function mountCloudApi(app: Hono, deps: CloudApiDeps, log: Logger): void {
  const run = createErrorBoundary(
    {
      "management_session.required": 401,
      "management_session.expired": 401,
      "person.suspended": 403,
      "authorization.not_permitted": 403,
      "cloud.unavailable": 503,
      "cloud.request_unavailable": 409,
      "cloud.state_invalid": 409,
      "cloud.binding_conflict": 409,
      "cloud.busy": 409,
      "cloud.not_primary": 409,
      "cloud.not_configured": 409,
      "cloud.request_invalid": 400,
    },
    "cloud.failed",
  );
  const authorize = async (c: Context, passive = false) => {
    const sessionId = requireManagementSession(c);
    const check = () =>
      withTransaction(deps.db, (tx) =>
        authorizeManager(tx, { managementSessionId: sessionId, permission: "system.manage" }),
      );
    if (passive) await withPassiveManagementRead(check);
    else await check();
  };
  const primary = () => {
    if (!deps.isPrimary()) throw new AppError("cloud.not_primary", {});
  };
  const connection = () => {
    if (!deps.connection) throw new AppError("cloud.not_configured", {});
    return deps.connection;
  };
  app.use(
    "/management-api/cloud/*",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json({ error: { code: "cloud.request_invalid", params: {} } }, 413),
    }),
  );
  app.get("/management-api/cloud/status", (c) =>
    run(c, log, async () => {
      await authorize(c, true);
      const status = deps.connection
        ? await deps.connection.status()
        : { state: "not_connected", code: "" };
      await authorize(c, true);
      return c.json({ ...status, configured: !!deps.connection, isPrimary: deps.isPrimary() });
    }),
  );
  for (const action of ["start", "check", "complete"] as const)
    app.post(`/management-api/cloud/${action}`, (c) =>
      run(c, log, async () => {
        await authorize(c, action === "check");
        if (c.req.header("origin") !== deps.managementOrigin)
          return c.json({ error: { code: "authorization.not_permitted", params: {} } }, 403);
        const body = await readRawJsonBody<unknown>(c);
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new AppError("cloud.request_invalid", {});
        const data = body as Record<string, unknown>;
        if (
          action === "start" &&
          Object.hasOwn(data, "restart") &&
          typeof data.restart !== "boolean"
        )
          throw new AppError("cloud.request_invalid", {});
        const keys =
          action === "complete"
            ? ["requestId", "organisationId", "legalBusinessId"]
            : action === "start" && Object.hasOwn(data, "restart")
              ? ["restart"]
              : [];
        if (
          Object.keys(data).length !== keys.length ||
          keys
            .filter((key) => key !== "restart")
            .some(
              (key) =>
                typeof data[key] !== "string" ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
                  data[key] as string,
                ),
            )
        )
          throw new AppError("cloud.request_invalid", {});
        const client = connection();
        if (action !== "check") primary();
        const result =
          action === "start"
            ? await client.start(data.restart === true)
            : action === "check"
              ? await client.check()
              : await client.complete(data as unknown as CloudChoice, async () => {
                  await authorize(c, true);
                  primary();
                });
        await authorize(c, true);
        return c.json({ ...result, configured: true, isPrimary: deps.isPrimary() });
      }),
    );
}
