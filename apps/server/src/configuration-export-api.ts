import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import {
  buildConfigurationBundle,
  collectConfigurationMedia,
  encodeConfigurationBundle,
} from "./configuration-transfer.js";
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
  cfg: { tenantId: string; locationId: string; tillId: string; nodeId: string };
  modules: readonly WaitronModule[];
  moduleVersions: Record<string, number>;
  mediaDir: string;
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
      const bundle = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read`);
        await asAppUser(tx);
        const authorization = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "till.configure",
        });
        const tenantMember = await tx.execute(sql`
          select 1 from persons
          where tenant_id = ${deps.cfg.tenantId} and id = ${authorization.authorizedBy}
        `);
        if (tenantMember.rows.length === 0) {
          throw new AppError("authorization.not_permitted", { permission: "till.configure" });
        }
        return buildConfigurationBundle(
          tx,
          deps.cfg,
          deps.modules,
          (deps.now ?? (() => new Date()))(),
          deps.moduleVersions,
        );
      });
      const media = await collectConfigurationMedia(bundle, deps.mediaDir);
      const artifact = encodeConfigurationBundle(bundle, passphrase, media);
      c.header("content-type", "application/octet-stream");
      c.header("content-disposition", 'attachment; filename="waitron-configuration.enc"');
      c.header("cache-control", "no-store");
      return c.body(Uint8Array.from(artifact).buffer);
    }),
  );
}
