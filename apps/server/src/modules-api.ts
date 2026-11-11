import type { Hono } from "hono";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import type { CardProviderContribution } from "@waitron/payments";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
  },
  "modules.failed",
);

export function mountModulesApi(
  app: Hono,
  deps: {
    db: Database;
    modules: readonly WaitronModule[];
    enabled: readonly string[];
    providers: readonly CardProviderContribution[];
  },
  log: Logger,
): void {
  app.get("/management-api/modules", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      await withTransaction(deps.db, (tx) =>
        authorizeManager(tx, { managementSessionId, permission: "hardware.manage" }),
      );
      return c.json([
        ...deps.modules
          .filter((module) => module.tier === "toggleable")
          .map((module) => ({
            id: module.name,
            category: "module",
            enabled: deps.enabled.includes(module.name),
          })),
        ...deps.providers.map((provider) => ({
          id: provider.providerId,
          category: "card-provider",
          enabled: true,
        })),
      ]);
    }),
  );
}
