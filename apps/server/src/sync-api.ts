import { timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { AppError } from "@waitron/shared";
import { withTenant, type Database } from "@waitron/db";
import {
  encodeBatch,
  readSyncLogSince,
  recordSubscriberCursor,
  tablesForLane,
  type SyncLane,
} from "@waitron/sync";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger } from "./logger.js";
// Loads @waitron/sync's error augmentation so this file may throw sync.node_unauthorized.
import "@waitron/sync";

// This surface answers exactly one AppError — a rejected node token — as a uniform 401. Anything else
// a handler throws (a driver error mid-read, say) reaches the boundary as a non-AppError and becomes
// an opaque server.internal 500, leaking nothing (error-boundary.ts's own contract).
const run = createErrorBoundary({ "sync.node_unauthorized": 401 }, "sync-api");

/** The `/sync-api/log` page size when the peer names none — mirrors the pull client's own batchLimit
 * default (boot.ts). */
const DEFAULT_LOG_LIMIT = 500;

/**
 * The `?limit=` query param as a positive integer, clamped to `DEFAULT_LOG_LIMIT` for anything that is
 * NOT one: a missing param, a non-numeric string (`Number("abc")` is `NaN`), zero/negative, or a
 * fraction. Plain `Number(...)` let a non-numeric `limit` flow through as `LIMIT NaN`, which Postgres
 * rejects — an opaque 500 for a malformed peer request rather than a served page. This endpoint has no
 * 400 param-invalid convention (its boundary answers only `sync.node_unauthorized` -> 401, everything
 * else -> opaque 500) and its sole caller (`pull.ts`) always sends a valid `batchLimit`, so a
 * machine-to-machine surface CLAMPS to its default rather than minting a client-error code for a case
 * only a misbehaving peer produces. No upper cap is imposed here — the caller's batchLimit is trusted
 * behind the node token, and `readSyncLogSince` applies the `LIMIT` itself. */
function logLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LOG_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LOG_LIMIT;
}

/**
 * The `?after=` cursor as a NON-NEGATIVE bigint, defaulting to `0n` (serve from the start) for anything
 * that is NOT one: a missing/empty param, a non-integer string (`abc`, `1.5` — each makes `BigInt(...)`
 * THROW a SyntaxError), or a negative value. A cursor is a monotonic non-negative `seq`, so the sibling
 * of `logLimit` above: plain `BigInt(c.req.query("after") ?? "0")` let a non-integer `after` throw
 * straight into this endpoint's boundary as an opaque `server.internal` 500 for a malformed peer
 * request rather than a served page. Same fail-safe posture as `logLimit`'s clamp and for the same
 * reason — this machine-to-machine surface has no 400 param-invalid convention (its boundary answers
 * only `sync.node_unauthorized` -> 401, everything else -> opaque 500) and its sole caller (`pull.ts`)
 * always sends a valid non-negative `after`, so a garbage cursor SAFELY means "from the start", never a
 * 500. `BigInt("")` is already `0n`, so empty needs no special case; the `try/catch` is for the throwing
 * (`abc`, `1.5`) forms, and `> 0n ? n : 0n` folds a negative cursor back to the start. */
function afterSeq(raw: string | undefined): bigint {
  if (raw === undefined) return 0n;
  try {
    const n = BigInt(raw);
    return n > 0n ? n : 0n;
  } catch {
    return 0n;
  }
}

/**
 * The `?lane=` query param as a `SyncLane`, clamping anything that is NOT the literal `fast` — a
 * missing param, `ordered`, or garbage — to `ordered`. Same machine-to-machine fail-safe posture this
 * endpoint takes for `after`/`limit` (no 400 convention): the ordered tables never silently disappear,
 * and the fast tick always sends `lane=fast` explicitly (spec §4c). The lane is the WIRE dimension —
 * the route maps it to `tablesForLane(lane)` SERVER-SIDE and never accepts a client-supplied table
 * list (both nodes run the same enrolment registry). */
function laneParam(raw: string | undefined): SyncLane {
  return raw === "fast" ? "fast" : "ordered";
}

export interface SyncApiDeps {
  db: Database; // a sync_tailer-member pool
  tenantId: string; // the deli tenant the source reads under
  nodeId: string; // this node's origin id (config.till.nodeId), for /hello
  environment: string; // config.environment, for /hello + the peer handshake
  nodeTokens: string[]; // the accepted inbound token SET (rotation overlap window, spec §2)
}

/** Constant-time Bearer check against the accepted SET. Iterates EVERY member without an
 * early return, so request timing leaks neither which token matched nor the set size; a blank
 * presented token or an empty set fails closed BEFORE any match can be recorded (the empty-secret
 * trap, CLAUDE.md §3). */
function requireNodeTokens(c: Context, nodeTokens: readonly string[]): void {
  const header = c.req.header("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(presented);
  let matched = false;
  for (const token of nodeTokens) {
    const b = Buffer.from(token);
    matched = (presented.length !== 0 && a.length === b.length && timingSafeEqual(a, b)) || matched;
  }
  if (!matched) throw new AppError("sync.node_unauthorized", {});
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
      requireNodeTokens(c, deps.nodeTokens);
      return c.json({ nodeId: deps.nodeId, environment: deps.environment });
    }),
  );
  app.get("/sync-api/log", (c) =>
    run(c, log, async () => {
      requireNodeTokens(c, deps.nodeTokens);
      const originId = c.req.query("originId");
      const after = afterSeq(c.req.query("after"));
      const limit = logLimit(c.req.query("limit"));
      const tables = tablesForLane(laneParam(c.req.query("lane")));
      const rows = await withTenant(deps.db, deps.tenantId, (tx) =>
        readSyncLogSince(tx, {
          afterSeq: after,
          limit,
          tables,
          ...(originId === undefined ? {} : { originId }),
        }),
      );
      return c.body(encodeBatch(rows), 200, { "content-type": "application/x-ndjson" });
    }),
  );
  // A subscriber POSTs how far it has applied THIS node's log; the source records it into its own
  // sync_cursor so retention can hold the log at the min across every subscriber (spec §3.1). The
  // origin is stamped as deps.nodeId — a peer-supplied `originId` in the body is IGNORED, so a peer
  // can never write a cursor for an arbitrary origin. Same machine-to-machine fail-safe posture as
  // /sync-api/log: no 400 param-invalid convention — a blank/missing subscriberId is a 200 no-op,
  // the lane clamps via laneParam, and the seq screens via afterSeq. The body is parsed defensively
  // (a non-JSON body yields {}), so only the node token gates the write.
  app.post("/sync-api/cursor", (c) =>
    run(c, log, async () => {
      requireNodeTokens(c, deps.nodeTokens);
      const body = (await c.req.json().catch(() => ({}))) as {
        subscriberId?: unknown;
        lane?: unknown;
        lastAppliedSeq?: unknown;
      };
      const subscriberId = typeof body.subscriberId === "string" ? body.subscriberId : "";
      if (subscriberId.length === 0) return c.body(null, 200); // machine surface: no-op, never a 400
      await recordSubscriberCursor(deps.db, {
        subscriberId,
        originId: deps.nodeId, // stamp OUR origin; never trust a peer-supplied one (spec §3.1)
        lane: laneParam(typeof body.lane === "string" ? body.lane : undefined),
        lastAppliedSeq: afterSeq(
          typeof body.lastAppliedSeq === "string" ? body.lastAppliedSeq : undefined,
        ),
      });
      return c.body(null, 200);
    }),
  );
}
