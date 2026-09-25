// `POST /management-api/promote`, the operator's failover trigger. This module decides only WHO may
// promote; which promote path runs, and the restart, belong to the boot-wired `run` closure.
//
// A `breakGlass` secret in the body takes the offline path (`verifyBreakGlass`), for when the node
// that held the admin's credentials is the one that died; otherwise the admin logs in by person id
// and needs the admin-only `node.promote`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager, endManagementSession, loginManagerById } from "@waitron/identity";
import type { FenceAttestation } from "./promote.js";
import { verifyBreakGlass } from "./break-glass.js";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

/**
 * `restarting` is true only for a real mirror-to-primary promote, which reboots the node; the
 * operator UI polls for it to come back on that flag.
 */
export interface PromoteRunResult {
  alreadyPrimary: boolean;
  restarting: boolean;
}

export interface PromoteApiDeps {
  appDb: Database;
  /** This node's id — whose break-glass verifier is checked. */
  nodeId: string;
  run: (attestation: FenceAttestation) => Promise<PromoteRunResult>;
}

// `person.not_found` is a 404: this server-to-server path has no enumeration surface to hide.
const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "totp.invalid": 401,
  "promotion.break_glass_invalid": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "person.not_found": 404,
  "promotion.fence_not_attested": 400,
  "promotion.node_fenced": 409,
  "promotion.membership_superseded": 409,
};

export function mountPromoteApi(app: Hono, deps: PromoteApiDeps, log: Logger = () => {}): void {
  const run = createErrorBoundary(STATUS, "promotion.failed");

  app.post("/management-api/promote", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{
        oldNodeNeutralised?: unknown;
        personId?: string;
        password?: string;
        totp?: string;
        breakGlass?: string;
      }>(c);

      // A present break-glass secret is authoritative: a wrong one is refused here, never downgraded
      // to the login path.
      if (typeof body.breakGlass === "string") {
        if (!(await verifyBreakGlass(deps.appDb, deps.nodeId, body.breakGlass))) {
          throw new AppError("promotion.break_glass_invalid", {});
        }
      } else if (
        typeof body.personId === "string" &&
        isUuid(body.personId) &&
        typeof body.password === "string" &&
        (body.totp === undefined || typeof body.totp === "string")
      ) {
        const { personId, password, totp } = body;
        await withTransaction(deps.appDb, async (tx) => {
          const session = await loginManagerById(tx, {
            personId,
            password,
            totp,
          });
          await authorizeManager(tx, {
            managementSessionId: session.token,
            permission: "node.promote",
          });
          await endManagementSession(tx, session.token);
        });
      } else {
        // The same code a wrong password gets, so the response never says which field failed.
        throw new AppError("password.invalid", {});
      }

      const result = await deps.run({ oldNodeNeutralised: body.oldNodeNeutralised === true });
      return c.json(result);
    }),
  );
}
