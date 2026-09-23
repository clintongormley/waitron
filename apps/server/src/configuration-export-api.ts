import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { buildConfigurationBundle, encodeConfigurationBundle } from "./configuration-transfer.js";
import "./errors.js";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
};
const run = createErrorBoundary(STATUS, "configuration_export.failed");

export interface ConfigurationExportDeps {
  db: Database;
  cfg: { locationId: string; tillId: string; nodeId: string };
  modules: readonly WaitronModule[];
  moduleVersions: Record<string, number>;
  now?: () => Date;
}

/** Authenticated preparation export. The allowlist engine has no route to transactional history. */
export function mountConfigurationExportApi(
  app: Hono,
  deps: ConfigurationExportDeps,
  log: Logger,
): void {
  app.post("/management-api/configuration-export", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const passphrase = body.passphrase;
      if (typeof passphrase !== "string" || passphrase.length < 12) {
        throw new AppError("management.request_invalid", { field: "passphrase" });
      }
      // The export reads many tables and has to see ONE state of the database across all of them.
      // On PostgreSQL that was asked for here, with `set transaction isolation level repeatable
      // read`. This engine has no such statement and does not need one: `withTransaction` opens
      // `begin immediate`, and `packages/store/src/write-queue.ts` admits one write transaction at
      // a time, so nothing can commit underneath this read.
      const bundle = await withTransaction(deps.db, async (tx) => {
        const authorization = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "system.manage",
        });
        return buildConfigurationBundle(
          tx,
          { ...deps.cfg, sourceOperatorId: authorization.authorizedBy },
          deps.modules,
          (deps.now ?? (() => new Date()))(),
          deps.moduleVersions,
        );
      });
      const artifact = encodeConfigurationBundle(bundle, passphrase);
      c.header("content-type", "application/octet-stream");
      c.header("content-disposition", 'attachment; filename="waitron-configuration.enc"');
      c.header("cache-control", "no-store");
      return c.body(Uint8Array.from(artifact).buffer);
    }),
  );
}
