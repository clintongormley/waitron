import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { KeyRing } from "@waitron/credentials";
import { retireSelf } from "./retire.js";
import { requireManagementSession } from "@waitron/server-kit";
import { createErrorBoundary } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
// No `./errors.js` side-effect import: this file throws no code of its own — the auth helpers and
// `retireSelf` each carry their own registry import for the codes they raise (matching box-status.ts).

export type BoxRetireDeps = {
  /** The app pool retireSelf reads/writes `node_membership` and the identity key through. */
  appDb: Database;
  /** The box key ring — unseals this node's identity key so the minted eviction can be signed. */
  ring: KeyRing;
  /** THIS (departing) node — the node that becomes `evicted`, the eviction document's signer, and
   * what the identity-key read the mint performs is keyed on. */
  nodeId: string;
};

/**
 * The AppError codes this route can surface, and their HTTP status. `requireManagementSession` throws
 * `management_session.required` (401); `authorizeManager` re-resolves the session
 * (`management_session.required`/`.expired` → 401, `person.suspended` → 403) and refuses a role without
 * `system.manage` with `authorization.not_permitted` (403). `retireSelf`'s ordered refusals are
 * client-visible conflicts with the node's current membership standing, so each maps to 409 — an
 * UNMAPPED AppError would fall through to the boundary's 400 default, which is the wrong shape for a
 * "your node is not in a retirable state" answer. Any other thrown value is a server fault the boundary
 * answers with an opaque 500.
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
 * Registers `POST /api/box/retire` on the shared trading app — the management action a fenced node
 * self-evicts with (retire/evict R3). Gated exactly like `GET /api/box/status`:
 * `requireManagementSession` → 401 before any DB work, then `withTransaction` +
 * `authorizeManager("system.manage")` for the manager check (a `manager`-role person holds it).
 * `retireSelf` owns all retire SEMANTICS — the ordered refusals, idempotency, the
 * abort-before-write mint; this route is only the auth + status-mapping glue.
 *
 * `"box-retire.failed"` is a LOG TAG only (the boundary's `tag`), NOT a registered error code — matching
 * box-status's `"box-status.failed"`. On a FENCED node this write verb is let through the read-only gate
 * by a single-route exemption in boot.ts (a fenced node legitimately serves this one management write).
 */
export function mountBoxRetireApi(app: Hono, deps: BoxRetireDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "box-retire.failed");
  app.post("/api/box/retire", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c); // throws 401 if absent
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
