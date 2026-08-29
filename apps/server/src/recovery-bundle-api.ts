import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { collectStateSecrets } from "./state-secrets.js";
import { encryptBundle } from "./recovery-bundle.js";
import { requireManagementSession } from "./management-session.js";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export type RecoveryBundleDeps = {
  db: Database;
  cfg: { tenantId: string };
  /** The box's persisted state dir — the secret files the bundle packs live here (`config.stateDir`). */
  stateDir: string;
  now: () => Date;
};

/**
 * Code→HTTP status for this route. The management gate's codes match `box-status.ts` exactly (401/403).
 * `recovery.passphrase_required` and `recovery.passphrase_too_short` are client errors (400).
 * `recovery.state_incomplete` maps to a STRUCTURED 500: a provisioned box that has lost its own secret
 * files is a box-side fault, not something the authorized operator did wrong, and it still carries a
 * `{ code, missing }` body naming the absent file. It must be listed here — an AppError absent from
 * this map gets the boundary's `?? 400` fallback (a client error), not a 500. The boundary's OPAQUE
 * `server.internal` 500 (no body detail) is reached only by NON-AppError throws, so an AppError is
 * never opaque.
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
 * `POST /api/box/recovery-bundle` — download the box's passphrase-encrypted recovery bundle. Gated
 * exactly like `GET /api/box/status`: `requireManagementSession` → 401, then `withTenant` + `asAppUser`
 * + `authorizeManager("till.configure")`. The passphrase rides the JSON body (never the URL/query — it
 * is a secret). The bundle carries the box's UNRECOVERABLE state (vault master key + fiscal identity +
 * CA/leaf), so it is returned as an attachment and logged (session id only, never the passphrase or
 * any secret). POST, not GET: it carries a secret and produces a sensitive artifact.
 */
export function mountRecoveryBundleApi(app: Hono, deps: RecoveryBundleDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "recovery-bundle.failed");
  app.post("/api/box/recovery-bundle", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c); // throws 401 if absent
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "till.configure",
        });
      });
      const body = await readJsonBody<{ passphrase?: unknown }>(c);
      if (typeof body.passphrase !== "string" || body.passphrase === "") {
        throw new AppError("recovery.passphrase_required", {});
      }
      // encryptBundle enforces MIN_PASSPHRASE_LENGTH (→ recovery.passphrase_too_short, 400).
      const envelope = encryptBundle(await collectStateSecrets(deps.stateDir), body.passphrase);
      const date = deps.now().toISOString().slice(0, 10);
      log("info", "recovery.bundle_downloaded", { sessionId });
      return c.body(envelope, 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="waitron-recovery-${date}.wrb"`,
      });
    }),
  );
}
