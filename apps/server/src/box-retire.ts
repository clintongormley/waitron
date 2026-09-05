import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { DrainProgress } from "@waitron/sync";
import type { KeyRing } from "@waitron/credentials";
import { retireSelf } from "./retire.js";
import { requireManagementSession } from "./management-session.js";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger } from "./logger.js";
// No `./errors.js` side-effect import: this file throws no code of its own — the auth helpers and
// `retireSelf` each carry their own registry import for the codes they raise (matching box-status.ts).

export type BoxRetireDeps = {
  /** The app pool retireSelf reads/writes `node_membership` and the identity key through (app-role). */
  appDb: Database;
  /** The box key ring — unseals this node's identity key so the minted eviction can be signed. */
  ring: KeyRing;
  /** This node's tenant — scopes the identity-key read the mint performs. */
  tenantId: string;
  /** THIS (departing) node — the node that becomes `evicted`, and the eviction document's signer. */
  nodeId: string;
  /** The drain-progress reader (the same one box-status's `disposal` surface uses), or `undefined`
   * when the held document names no carrier — which retireSelf refuses as `node.retire_no_carrier`. */
  readDrainProgress: (() => Promise<DrainProgress>) | undefined;
  /** The carrier node id captured at BOOT that `readDrainProgress` keys on — retireSelf refuses
   * (`node.retire_carrier_changed`) if the fresh held chart names a different serving-primary, because a
   * fenced node does not restart on a carrier change. `undefined` exactly when `readDrainProgress` is. */
  carrierNodeId: string | undefined;
};

/**
 * The AppError codes this route can surface, and their HTTP status. `requireManagementSession` throws
 * `management_session.required` (401); `authorizeManager` re-resolves the session
 * (`management_session.required`/`.expired` → 401, `person.suspended` → 403) and refuses a role without
 * `till.configure` with `authorization.not_permitted` (403). `retireSelf`'s ordered refusals are
 * client-visible conflicts with the node's current membership standing, so each maps to 409 — an
 * UNMAPPED AppError would fall through to the boundary's 400 default, which is the wrong shape for a
 * "your node is not in a retirable state" answer. `node.retire_carrier_changed` is likewise a 409: the
 * carrier moved since boot, so the box must be restarted before it can retire. Any other thrown value is
 * a server fault the boundary answers with an opaque 500.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "node.retire_not_fenced": 409,
  "node.retire_no_carrier": 409,
  "node.retire_carrier_changed": 409,
  "node.retire_not_drained": 409,
  "node.retire_superseded": 409,
};

/**
 * Registers `POST /api/box/retire` on the shared trading app — the management action a fully-drained
 * fenced node self-evicts with (retire/evict R3). Gated exactly like `GET /api/box/status`:
 * `requireManagementSession` → 401 before any DB work, then `withTenant` + `asAppUser` +
 * `authorizeManager("till.configure")` for the manager check (a `manager`-role person holds it), then
 * `retireSelf` runs on the app pool. `retireSelf` owns all retire SEMANTICS — the four ordered refusals,
 * idempotency, the abort-before-write mint; this route is only the auth + status-mapping glue.
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
      await withTenant(deps.appDb, deps.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "till.configure",
        });
      });
      const result = await retireSelf({
        appDb: deps.appDb,
        ring: deps.ring,
        tenantId: deps.tenantId,
        nodeId: deps.nodeId,
        readDrainProgress: deps.readDrainProgress,
        carrierNodeId: deps.carrierNodeId,
        log,
      });
      return c.json(result, 200);
    }),
  );
}
