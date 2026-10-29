import type { Hono } from "hono";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager, beginOwnPasskeyCheck } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

export interface BackupRecoveryPackApiDeps {
  db: Database;
  /** The WebAuthn Relying Party ID passkeys are bound to (`config.ts`'s `managementRpId`). */
  rpId: string;
}

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "passkey.not_registered": 404,
  },
  "backup.failed",
);

export function mountBackupRecoveryPackApi(
  app: Hono,
  deps: BackupRecoveryPackApiDeps,
  log: Logger,
): void {
  app.post("/api/backup/recovery-pack/passkey-options", (c) => {
    c.header("Cache-Control", "no-store");
    return run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const out = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId, permission: "system.manage" });
        return beginOwnPasskeyCheck(tx, { managementSessionId, rpId: deps.rpId });
      });
      return c.json(out);
    });
  });
}
