import { isRemoteStaffRequest, managementOriginFor } from "./request-from-box.js";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { withTransaction, type Database } from "@waitron/db";
import {
  authorizeManager,
  requireFreshManagementSignIn,
  withPassiveManagementRead,
} from "@waitron/identity";
import { AppError } from "@waitron/shared";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireManagementSession,
} from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { CloudChoice, CloudConnection } from "./cloud-client.js";
import type { CloudReplacement } from "./cloud-replacement.js";
import "./errors.js";
import { readEmergencyPeople } from "./cloud-emergency-people.js";
export interface CloudApiDeps {
  db: Database;
  connection?: CloudConnection;
  replacement?: Pick<
    CloudReplacement,
    | "status"
    | "hasProposal"
    | "approval"
    | "eligible"
    | "prepare"
    | "check"
    | "reissue"
    | "recordStop"
  >;
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
      "cloud.owner_recovery_not_available": 409,
      "cloud.owner_recovery_admin_required": 403,
      "cloud.emergency_hosting_closed": 403,
      "cloud.emergency_code_rate_limited": 429,
      "cloud.tunnel_unavailable": 422,
      "cloud.tunnel_conflict": 409,
      "cloud.tunnel_plan_required": 403,
      "cloud.tunnel_refused": 403,
      "cloud.request_unavailable": 409,
      "cloud.state_invalid": 409,
      "cloud.binding_conflict": 409,
      "cloud.busy": 409,
      "cloud.not_primary": 409,
      "cloud.not_configured": 409,
      "cloud.request_invalid": 400,
      "cloud.replacement_not_restored": 409,
      "cloud.replacement_state_invalid": 409,
      "cloud.replacement_refused": 409,
    },
    "cloud.failed",
  );
  const authorize = async (
    c: Context,
    passive = false,
    permission: "system.manage" | "node.manage" = "system.manage",
  ) => {
    const sessionId = requireManagementSession(c);
    const check = () =>
      withTransaction(deps.db, (tx) =>
        authorizeManager(tx, { managementSessionId: sessionId, permission }),
      );
    if (passive) await withPassiveManagementRead(check);
    else await check();
  };
  const requireConfirmation = (c: Context) =>
    withTransaction(deps.db, (tx) => requireFreshManagementSignIn(tx, requireManagementSession(c)));
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
      onError: (c) => c.json({ error: { code: "cloud.request_invalid", params: {} } }, 400),
    }),
  );
  for (const action of ["read", "approve", "refuse"] as const)
    app.post(`/management-api/cloud/owner-recovery/${action}`, (c) =>
      run(c, log, async () => {
        c.header("Cache-Control", "no-store");
        if (
          isRemoteStaffRequest(c) ||
          c.req.header("origin") !== managementOriginFor(c, deps.managementOrigin)
        )
          return c.json({ error: { code: "authorization.not_permitted", params: {} } }, 403);
        // Cloud waits stay outside the venue transaction; each check reads current authority.
        const authorizeRecovery = async (touch = false) => {
          const actor = await withTransaction(deps.db, async (tx) => {
            const sessionId = requireManagementSession(c);
            const result = await authorizeManager(tx, {
              managementSessionId: sessionId,
              permission: "system.manage",
              touch,
            }).catch((error: unknown) => {
              if (error instanceof AppError && error.code === "authorization.not_permitted")
                throw new AppError("cloud.owner_recovery_admin_required", {});
              throw error;
            });
            if (!result.authority.admin)
              throw new AppError("cloud.owner_recovery_admin_required", {});
            await requireFreshManagementSignIn(tx, sessionId);
            return result.authorizedBy;
          });
          primary();
          return actor;
        };
        await authorizeRecovery(true);
        const body = await readRawJsonBody<unknown>(c);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          (action === "read"
            ? Object.keys(body).length !== 0
            : Object.keys(body).length !== 1 || !("request" in body))
        )
          throw new AppError("cloud.request_invalid", {});
        const client = connection();
        const result =
          action === "read"
            ? await client.ownerRecoveryRead(authorizeRecovery, c.req.raw.signal)
            : await client.ownerRecoveryDecide(
                action,
                (body as { request: unknown }).request,
                authorizeRecovery,
                c.req.raw.signal,
              );
        return c.json(result);
      }),
    );
  app.get("/management-api/cloud/status", (c) =>
    run(c, log, async () => {
      await authorize(c, true);
      const status = deps.connection
        ? await deps.connection.status()
        : { state: "not_connected", code: "" };
      let replacement = null;
      let replacementPending = false;
      let replacementError: string | null = null;
      try {
        replacement = (await deps.replacement?.status()) ?? null;
        replacementPending = (await deps.replacement?.hasProposal()) ?? false;
      } catch (error) {
        replacementError = error instanceof AppError ? error.code : "cloud.failed";
      }
      const replacementApproval = (await deps.replacement?.approval()) ?? null;
      const replacementEligible = (await deps.replacement?.eligible()) ?? false;
      await authorize(c, true);
      return c.json({
        ...status,
        replacement,
        replacementPending,
        replacementApproval,
        replacementError,
        replacementEligible,
        configured: !!deps.connection,
        isPrimary: deps.isPrimary(),
        isRemote: isRemoteStaffRequest(c),
      });
    }),
  );
  // Display only: nothing on the box reads these values to switch a service on or off.
  app.get("/management-api/cloud/billing", (c) =>
    run(c, log, async () => {
      await authorize(c, true);
      primary();
      const { asOf, calendarTimeZone, billing, prices, accountUrl } = await connection().billing(
        c.req.raw.signal,
      );
      await authorize(c, true);
      primary();
      return c.json({ asOf, calendarTimeZone, billing, prices, accountUrl });
    }),
  );
  app.get("/management-api/cloud/emergency", (c) =>
    run(c, log, async () => {
      await authorize(c, true);
      primary();
      const { asOf, emergency, prices, stale } = await connection().emergency(
        deps.managementOrigin,
        c.req.raw.signal,
      );
      await authorize(c, true);
      primary();
      c.header("Cache-Control", "no-store");
      return c.json({ asOf, emergency, prices, stale });
    }),
  );
  app.use("/management-api/cloud/emergency/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/management-api/cloud/emergency/people", (c) =>
    run(c, log, async () => {
      primary();
      const people = await withPassiveManagementRead(() =>
        withTransaction(deps.db, async (tx) => {
          await authorizeManager(tx, {
            managementSessionId: requireManagementSession(c),
            permission: "node.manage",
          });
          return readEmergencyPeople(tx);
        }),
      );
      primary();
      return c.json(people);
    }),
  );
  app.post("/management-api/cloud/emergency/code", (c) =>
    run(c, log, async () => {
      if (c.req.header("origin") !== managementOriginFor(c, deps.managementOrigin))
        throw new AppError("authorization.not_permitted", { permission: "node.manage" });
      await authorize(c, false, "node.manage");
      primary();
      const body = await readRawJsonBody<unknown>(c);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
        throw new AppError("cloud.request_invalid", {});
      const { asOf, code, codeIssuedAt, address } = await connection().emergencyCode(
        deps.managementOrigin,
        c.req.raw.signal,
      );
      await authorize(c, true, "node.manage");
      primary();
      return c.json({ asOf, code, codeIssuedAt, address });
    }),
  );
  for (const action of ["prepare", "check", "reissue"] as const)
    app.post(`/management-api/cloud/replacement/${action}`, (c) =>
      run(c, log, async () => {
        if (c.req.header("origin") !== managementOriginFor(c, deps.managementOrigin))
          return c.json({ error: { code: "authorization.not_permitted", params: {} } }, 403);
        await authorize(c);
        const body = await readRawJsonBody<unknown>(c);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
          throw new AppError("cloud.request_invalid", {});
        primary();
        if (!deps.replacement) throw new AppError("cloud.not_configured", {});
        await requireConfirmation(c);
        const recheck = async () => {
          await authorize(c, true);
          primary();
        };
        const authorizeChange = async () => {
          await recheck();
          await requireConfirmation(c);
        };
        const replacement = await deps.replacement[action](authorizeChange);
        await recheck();
        const status = deps.connection
          ? await deps.connection.status()
          : { state: "not_connected", code: "" };
        const replacementApproval = (await deps.replacement.approval()) ?? null;
        return c.json({
          ...status,
          replacement,
          replacementPending: true,
          replacementApproval,
          replacementError: null,
          replacementEligible: await deps.replacement.eligible(),
          configured: !!deps.connection,
          isPrimary: deps.isPrimary(),
        });
      }),
    );
  app.post("/management-api/cloud/remote-access", (c) =>
    run(c, log, async () => {
      if (c.req.header("origin") !== managementOriginFor(c, deps.managementOrigin))
        return c.json({ error: { code: "authorization.not_permitted", params: {} } }, 403);
      await authorize(c);
      primary();
      const body = await readRawJsonBody<unknown>(c);
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !("enabled" in body) ||
        typeof body.enabled !== "boolean"
      )
        throw new AppError("cloud.request_invalid", {});
      const client = connection();
      if (body.enabled) await requireConfirmation(c);
      const status = await client.setRemoteAccess(body.enabled, async () => {
        await authorize(c, true);
        primary();
        if (body.enabled) await requireConfirmation(c);
      });
      return c.json({
        ...status,
        configured: true,
        isPrimary: deps.isPrimary(),
        isRemote: isRemoteStaffRequest(c),
      });
    }),
  );
  for (const action of ["start", "check", "complete", "refresh", "revoke"] as const)
    app.post(`/management-api/cloud/${action}`, (c) =>
      run(c, log, async () => {
        if (c.req.header("origin") !== managementOriginFor(c, deps.managementOrigin))
          return c.json({ error: { code: "authorization.not_permitted", params: {} } }, 403);
        await authorize(c);
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
        if (action !== "check" && action !== "revoke") primary();
        if (action === "start" || action === "complete" || action === "revoke")
          await requireConfirmation(c);
        const result =
          action === "refresh"
            ? await client.refresh()
            : action === "revoke"
              ? await client.revoke(async () => {
                  await authorize(c, true);
                  await requireConfirmation(c);
                  await deps.replacement?.recordStop();
                })
              : action === "start"
                ? await client.start(data.restart === true)
                : action === "check"
                  ? await client.check()
                  : await client.complete(data as unknown as CloudChoice, async () => {
                      await authorize(c, true);
                      primary();
                      await requireConfirmation(c);
                    });
        await authorize(c, true);
        return c.json({
          ...result,
          configured: true,
          isPrimary: deps.isPrimary(),
          isRemote: isRemoteStaffRequest(c),
        });
      }),
    );
}
