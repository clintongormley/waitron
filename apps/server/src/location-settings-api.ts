import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { asAppUser, locations, withTenant, type Database, type Transaction } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import { AppError, isAppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "management.request_invalid": 400,
  },
  "management.failed",
);

export function mountLocationSettingsApi(
  app: Hono,
  deps: { db: Database; cfg: { tenantId: string; locationId: string }; fiscal: FiscalContribution },
  log: Logger,
): void {
  const scope = and(
    eq(locations.id, deps.cfg.locationId),
    eq(locations.tenantId, deps.cfg.tenantId),
  );
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>) =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const authorization = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: "till.configure",
      });
      if (authorization.tenantId !== deps.cfg.tenantId)
        throw new AppError("authorization.not_permitted", { permission: "till.configure" });
      return fn(tx);
    });
  app.get("/management-api/location-settings", (c) =>
    run(c, log, async () => {
      const result = await gated(requireManagementSession(c), async (tx) => {
        const [location] = await tx
          .select({ name: locations.name, operationDescription: locations.operationDescription })
          .from(locations)
          .where(scope);
        if (location === undefined)
          throw new AppError("management.request_invalid", { field: "locationId" });
        return location;
      });
      return c.json(result);
    }),
  );
  app.put("/management-api/location-settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      await gated(sessionId, async (tx) => {
        const description =
          typeof body === "object" && body !== null && "operationDescription" in body
            ? body.operationDescription
            : undefined;
        if (typeof description !== "string" || description.trim() === "") {
          throw new AppError("management.request_invalid", { field: "operationDescription" });
        }
        try {
          deps.fiscal.venueFields?.validateOperationDescription(description);
        } catch (error) {
          if (!isAppError(error) || error.code !== "setup.request_invalid") throw error;
          throw new AppError("management.request_invalid", { field: "operationDescription" });
        }
        // Future records read this setting; previously recorded invoices keep their own description.
        const updated = await tx
          .update(locations)
          .set({ operationDescription: description })
          .where(scope)
          .returning({ id: locations.id });
        if (updated.length === 0)
          throw new AppError("management.request_invalid", { field: "locationId" });
      });
      return c.body(null, 204);
    }),
  );
}
