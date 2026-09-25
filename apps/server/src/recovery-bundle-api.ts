import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { collectStateSecrets } from "./state-secrets.js";
import { encryptBundle } from "./recovery-bundle.js";
import { requireManagementSession } from "@waitron/server-kit";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import "./errors.js";

export type RecoveryBundleDeps = {
  db: Database;
  stateDir: string;
  now: () => Date;
};

/**
 * `recovery.state_incomplete` must be listed: an AppError absent from this map gets the boundary's
 * `?? 400` fallback, and a box that has lost its own secret files is a box-side fault.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "recovery.passphrase_required": 400,
  "recovery.passphrase_too_short": 400,
  "recovery.state_incomplete": 500,
};

/**
 * `POST /api/box/recovery-bundle` — the passphrase-encrypted bundle of the box's unrecoverable
 * state. POST so the passphrase rides the body, never the URL; logged with the person's id only.
 */
export function mountRecoveryBundleApi(app: Hono, deps: RecoveryBundleDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "recovery-bundle.failed");
  app.post("/api/box/recovery-bundle", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      const { authorizedBy: personId } = await withTransaction(deps.db, (tx) =>
        authorizeManager(tx, { managementSessionId: token, permission: "system.manage" }),
      );
      const body = await readJsonBody<{ passphrase?: unknown }>(c);
      if (typeof body.passphrase !== "string" || body.passphrase === "") {
        throw new AppError("recovery.passphrase_required", {});
      }
      const envelope = encryptBundle(await collectStateSecrets(deps.stateDir), body.passphrase);
      const date = deps.now().toISOString().slice(0, 10);
      log("info", "recovery.bundle_downloaded", { personId });
      return c.body(envelope, 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="waitron-recovery-${date}.wrb"`,
        "Cache-Control": "no-store",
      });
    }),
  );
}
