import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { KeyRing } from "@waitron/credentials";
import { retireSelf } from "./retire.js";
import { requireManagementSession } from "@waitron/server-kit";
import { createErrorBoundary } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
// No `./errors.js` side-effect import: this file throws no code of its own.

export type BoxRetireDeps = {
  appDb: Database;
  /** The box key ring — unseals this node's identity key so the minted eviction can be signed. */
  ring: KeyRing;
  /** THIS (departing) node — the node that becomes `evicted`, the eviction document's signer, and
   * what the identity-key read the mint performs is keyed on. */
  nodeId: string;
};

/**
 * `retireSelf`'s refusals conflict with the node's current membership standing, so each maps to 409;
 * an unmapped AppError would take the boundary's 400 default.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "node.retire_not_fenced": 409,
  "node.retire_no_carrier": 409,
  "node.retire_superseded": 409,
};

/**
 * The management action a fenced node self-evicts with. `retireSelf` owns all retire semantics; this
 * route is only the auth and status-mapping glue.
 *
 * `"box-retire.failed"` is a LOG TAG only (the boundary's `tag`), NOT a registered error code.
 */
export function mountBoxRetireApi(app: Hono, deps: BoxRetireDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "box-retire.failed");
  app.post("/api/box/retire", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await withTransaction(deps.appDb, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "system.manage",
        });
      });
      const result = await retireSelf({
        appDb: deps.appDb,
        ring: deps.ring,
        nodeId: deps.nodeId,
        log,
      });
      return c.json(result, 200);
    }),
  );
}
