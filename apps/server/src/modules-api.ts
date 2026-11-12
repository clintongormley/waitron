import type { Hono } from "hono";
import { readSettings, withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { PAYMENTS_SETTINGS, type CardProviderContribution } from "@waitron/payments";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "settings.invalid": 500,
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
      const { doc, revision } = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId, permission: "hardware.manage" });
        return readSettings(tx, PAYMENTS_SETTINGS);
      });
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
          enabled:
            deps.enabled.includes("payments") && doc.providers[provider.providerId] !== false,
          revision,
        })),
      ]);
    }),
  );
}
