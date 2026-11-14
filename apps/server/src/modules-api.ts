import type { Hono } from "hono";
import { readSettings, saveSettings, withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { PAYMENTS_SETTINGS, type CardProviderContribution } from "@waitron/payments";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { imageMigrationHashes, journalHashes } from "@waitron/migrations";
import { MODULES_SETTINGS } from "./modules.js";
import "./errors.js";
import type { Logger } from "./logger.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "settings.invalid": 500,
    "settings.out_of_date": 409,
    "module.not_prepared": 409,
    "module.providers_enabled": 409,
    "node.read_only": 403,
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
    isPrimary: () => boolean;
    migrationsRoot: string | null;
  },
  log: Logger,
): void {
  app.get("/management-api/modules", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const { payments, modules } = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId, permission: "hardware.manage" });
        return {
          payments: await readSettings(tx, PAYMENTS_SETTINGS),
          modules: await readSettings(tx, MODULES_SETTINGS),
        };
      });
      return c.json([
        ...deps.modules
          .filter((module) => module.tier === "toggleable")
          .map((module) => ({
            id: module.name,
            category: "module",
            enabled: modules.doc.modules[module.name] !== false,
            applied: deps.enabled.includes(module.name),
            revision: modules.revision,
          })),
        ...deps.providers.map((provider) => ({
          id: provider.providerId,
          category: "card-provider",
          enabled:
            deps.enabled.includes("payments") &&
            payments.doc.providers[provider.providerId] !== false,
          revision: payments.revision,
        })),
      ]);
    }),
  );
  app.put("/management-api/modules/:id/state", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (
        typeof body.enabled !== "boolean" ||
        !Number.isInteger(body.revision) ||
        (body.revision as number) < 0
      )
        throw new AppError("management.request_invalid", {
          field: typeof body.enabled === "boolean" ? "revision" : "enabled",
        });
      const saved = await withTransaction(deps.db, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId,
          permission: "person.admin",
        });
        if (!deps.isPrimary()) throw new AppError("node.read_only", {});
        const id = c.req.param("id");
        const module = deps.modules.find(
          (entry) => entry.name === id && entry.tier === "toggleable",
        );
        if (!module) throw new AppError("module.not_prepared", { module: id });
        if (id === "payments" && !body.enabled) {
          const { doc } = await readSettings(tx, PAYMENTS_SETTINGS);
          if (deps.providers.some((provider) => doc.providers[provider.providerId] !== false))
            throw new AppError("module.providers_enabled", {});
        }
        if (body.enabled) {
          const set = module.migrations;
          if (!set) throw new AppError("module.not_prepared", { module: id });
          const installed = await journalHashes({ venue: tx, node: tx }, set);
          const shipped = imageMigrationHashes(set, deps.migrationsRoot);
          if (
            installed === null ||
            installed.length !== shipped.length ||
            !shipped.every((hash) => installed.includes(hash))
          )
            throw new AppError("module.not_prepared", { module: id });
        }
        const { doc } = await readSettings(tx, MODULES_SETTINGS);
        return saveSettings(tx, MODULES_SETTINGS, {
          doc: { modules: { ...doc.modules, [id]: body.enabled as boolean } },
          expectedRevision: body.revision as number,
          personId: authorizedBy,
        });
      });
      return c.json({
        enabled: saved.doc.modules[c.req.param("id")] !== false,
        applied: deps.enabled.includes(c.req.param("id")),
        revision: saved.revision,
      });
    }),
  );
}
