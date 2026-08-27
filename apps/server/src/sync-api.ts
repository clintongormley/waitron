import type { Context, Hono } from "hono";
import { AppError } from "@waitron/shared";
import { withTenant, type Database } from "@waitron/db";
import {
  authenticatePeer,
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

// This surface answers exactly one AppError — a rejected peer token — as a uniform 401. Anything else
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
 * behind the peer token, and `readSyncLogSince` applies the `LIMIT` itself. */
function logLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LOG_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LOG_LIMIT;
}

/**
 * The `?after=` cursor as a NON-NEGATIVE bigint, defaulting to `0n` (serve from the start) for anything
 * that is NOT one: a missing/empty param, a non-integer string (`abc`, `1.5` — each makes `BigInt(...)`
 * THROW a SyntaxError), or a negative value. A cursor is a monotonic non-negative `seq`, so the sibling
 * of `logLimit` above: plain `BigInt(c.req.query("after") ?? "0")` let a non-integer input throw
 * straight into the endpoint's boundary as an opaque `server.internal` 500 for a malformed peer
 * request rather than a served page. Same fail-safe posture as `logLimit`'s clamp and for the same
 * reason. This helper now feeds TWO peer-authenticated routes — `/sync-api/log`'s `?after=` cursor and
 * `/sync-api/cursor`'s `lastAppliedSeq` body field — and NEITHER has a 400 param-invalid convention
 * (both boundaries answer only `sync.node_unauthorized` -> 401, everything else -> opaque 500); both
 * are driven by `pull.ts` (the log drain and the cursor report), which always sends a valid
 * non-negative value, so a garbage input SAFELY folds to seq 0 ("from the start"), never a 500.
 * `BigInt("")` is already `0n`, so empty needs no special case; the `try/catch` is for the throwing
 * (`abc`, `1.5`) forms, and `> 0n ? n : 0n` folds a negative value back to the start. */
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
 * The `lane` param as a `SyncLane`, clamping anything that is NOT the literal `fast` — a missing
 * param, `ordered`, or garbage — to `ordered`. Used by BOTH peer-authenticated routes: `/sync-api/log` reads
 * it from the `?lane=` query and maps it to `tablesForLane(lane)` SERVER-SIDE (it never accepts a
 * client-supplied table list — both nodes run the same enrolment registry), while `/sync-api/cursor`
 * reads it from the POST body to key which lane's cursor the subscriber is reporting. Same
 * machine-to-machine fail-safe posture both take for `after`/`limit` (no 400 convention): the ordered
 * lane is never silently lost, and the fast tick always sends `lane=fast` explicitly (spec §4c). The
 * lane is the WIRE dimension, mapped to server-side meaning by each route. */
function laneParam(raw: string | undefined): SyncLane {
  return raw === "fast" ? "fast" : "ordered";
}

export interface SyncApiDeps {
  db: Database; // a sync_tailer-member pool: reads sync_peers/sync_log and writes sync_cursor
  tenantId: string; // the deli tenant the source reads under
  nodeId: string; // this node's origin id (config.till.nodeId), for /hello
  environment: string; // config.environment, for /hello + the peer handshake
}

/** Bearer guard: resolve the caller to its enrolled peer, or 401. A missing/blank Bearer fails closed
 * BEFORE any DB work (the empty-secret posture); every other failure folds into sync.node_unauthorized
 * inside authenticatePeer, so a revoked peer fails instantly with no oracle. */
async function requirePeer(db: Database, c: Context): Promise<{ subscriberId: string }> {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (token.length === 0) throw new AppError("sync.node_unauthorized", {});
  return authenticatePeer(db, token);
}

/**
 * Mounts this node's peer-authenticated sync source group on an existing Hono app (the
 * mountWebhook / mountTillApi / mountCatalogueApi convention). Every route is behind `requirePeer`,
 * which resolves the caller's Bearer token to its enrolled `sync_peers` identity (a missing/blank
 * token fails closed before any DB work). `/sync-api/hello` returns this node's { nodeId, environment }
 * for the peer's environment handshake, `/sync-api/log` streams the tenant's captured sync_log rows
 * past `after` as NDJSON with row_image as raw jsonb text (design §4c), and `/sync-api/cursor` records
 * how far the authenticated peer has applied this node's log. The DB connection is a sync_tailer-member
 * pool: it looks the peer up in `sync_peers`, reads sync_log under the deli tenant context (so the
 * sync_log_tenant_isolation policy fences the read to this tenant), and writes sync_cursor.
 */
export function mountSyncApi(app: Hono, deps: SyncApiDeps, log: Logger): void {
  app.get("/sync-api/hello", (c) =>
    run(c, log, async () => {
      await requirePeer(deps.db, c);
      return c.json({ nodeId: deps.nodeId, environment: deps.environment });
    }),
  );
  app.get("/sync-api/log", (c) =>
    run(c, log, async () => {
      await requirePeer(deps.db, c);
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
  // sync_cursor so retention can hold the log at the min across every subscriber (spec §3.1). BOTH
  // identity axes are the source's, never the peer's: the `subscriberId` is the one `requirePeer`
  // resolved from the Bearer token (the body carries none — spec §2/§8, so a peer can only ever move
  // ITS OWN cursor, closing the forge gap where the body named the subscriber), and the origin is
  // stamped as deps.nodeId (a peer-supplied `originId` in the body is IGNORED, so a peer can never
  // write a cursor for an arbitrary origin). Same machine-to-machine fail-safe posture as
  // /sync-api/log: no 400 param-invalid convention — the lane clamps via laneParam and the seq screens
  // via afterSeq, and the body is parsed defensively (a non-JSON body yields {}).
  app.post("/sync-api/cursor", (c) =>
    run(c, log, async () => {
      const { subscriberId } = await requirePeer(deps.db, c);
      const body = (await c.req.json().catch(() => ({}))) as {
        lane?: unknown;
        lastAppliedSeq?: unknown;
      };
      await recordSubscriberCursor(deps.db, {
        subscriberId, // derived from the authenticated token — NEVER the body (spec §2/§8)
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
