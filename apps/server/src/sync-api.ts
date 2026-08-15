import { timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { AppError } from "@waitron/shared";
import { withTenant, type Database } from "@waitron/db";
import { encodeBatch, readSyncLogSince } from "@waitron/sync";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger } from "./logger.js";
// Loads @waitron/sync's error augmentation so this file may throw sync.node_unauthorized.
import "@waitron/sync";

// This surface answers exactly one AppError — a rejected node token — as a uniform 401. Anything else
// a handler throws (a driver error mid-read, say) reaches the boundary as a non-AppError and becomes
// an opaque server.internal 500, leaking nothing (error-boundary.ts's own contract).
const run = createErrorBoundary({ "sync.node_unauthorized": 401 }, "sync-api");

export interface SyncApiDeps {
  db: Database; // a sync_tailer-member pool
  tenantId: string; // the deli tenant the source reads under
  nodeId: string; // this node's origin id (config.till.nodeId), for /hello
  environment: string; // config.environment, for /hello + the peer handshake
  nodeToken: string; // the token peers must present (WAITRON_SYNC_NODE_TOKEN); non-blank
}

/** Constant-time Bearer check. A missing/blank/wrong token throws sync.node_unauthorized (→ 401)
 * BEFORE any DB work — the same fail-closed posture as the empty-connection-string trap (CLAUDE.md §3):
 * a blank secret must never mean "no auth". */
function requireNodeToken(c: Context, nodeToken: string): void {
  const header = c.req.header("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(nodeToken);
  if (presented.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError("sync.node_unauthorized", {});
  }
}

/**
 * Mounts this node's node-token-authenticated sync source group on an existing Hono app (the
 * mountWebhook / mountTillApi / mountCatalogueApi convention). Two GETs, both behind the Bearer token:
 * `/sync-api/hello` returns this node's { nodeId, environment } for the peer's environment handshake,
 * and `/sync-api/log` streams the tenant's captured sync_log rows past `after` as NDJSON with
 * row_image as raw jsonb text (design §4c). The DB connection is a sync_tailer-member pool read under
 * the deli tenant context, so the sync_log_tenant_isolation policy fences the read to this tenant.
 */
export function mountSyncApi(app: Hono, deps: SyncApiDeps, log: Logger): void {
  app.get("/sync-api/hello", (c) =>
    run(c, log, async () => {
      requireNodeToken(c, deps.nodeToken);
      return c.json({ nodeId: deps.nodeId, environment: deps.environment });
    }),
  );
  app.get("/sync-api/log", (c) =>
    run(c, log, async () => {
      requireNodeToken(c, deps.nodeToken);
      const originId = c.req.query("originId");
      const afterSeq = BigInt(c.req.query("after") ?? "0");
      const limit = Number(c.req.query("limit") ?? "500");
      const rows = await withTenant(deps.db, deps.tenantId, (tx) =>
        readSyncLogSince(tx, { afterSeq, limit, ...(originId === undefined ? {} : { originId }) }),
      );
      return c.body(encodeBatch(rows), 200, { "content-type": "application/x-ndjson" });
    }),
  );
}
