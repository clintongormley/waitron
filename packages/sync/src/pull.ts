// The commercial-lane pull client. syncPullOnce does the environment handshake (GET /sync-api/hello),
// reads the local (subscriber, peer) cursor, GETs the peer's /sync-api/log past it, decodes the
// NDJSON, and hands the batch to applyBatch — which runs the env check, the seq-ordered idempotent
// apply, and the cursor advance. runSyncPull is the background loop boot.ts starts: for each peer,
// pull until a batch makes no progress, then sleep; on a transport/HTTP error a peer backs off with
// bounded exponential backoff, and sync.stream_stalled is logged when its backoff saturates (design
// §4a/§6). sync_cursor is whole-DB operational state (no tenant_id, no RLS — 0000_sync_outbox.sql:96),
// so the cursor read runs directly on the pool, never under withTenant.
import { sql } from "drizzle-orm";
import { type Database } from "@waitron/db";
import { applyBatch, type ApplyBatchResult } from "./apply.js";
import { decodeBatch } from "./wire.js";
// Side-effect import: keeps errors.ts's `declare module` augmentation reachable from a file in the
// sync.* domain (the reachability rule), even though this module logs codes rather than throwing them.
import "./errors.js";

export type HttpClient = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface PullPeer {
  nodeId: string;
  url: string;
  token: string;
}

export interface SyncPullDeps {
  /** A LOGIN pool that is a member of both sync_tailer (cursor) and app_user (apply). */
  localDb: Database;
  /** This node's id — the `subscriber_id` half of the cursor key (config.till.nodeId). */
  subscriberId: string;
  /** The deli tenant. Not read by the pull path (the cursor is not tenant-scoped and applyBatch keys
   * off each row's own tenant_id) — carried for parity with the source side and future multi-tenant. */
  tenantId: string;
  /** What environment this node believes it is (config.environment); cross-checked in applyBatch. */
  localEnvironment: string;
  /** Injected HTTP client (default: a global-fetch adapter) so the loop is testable off the network. */
  http: HttpClient;
  /** Max rows per /sync-api/log request. */
  batchLimit: number;
}

const trimSlash = (url: string): string => url.replace(/\/$/, "");

async function readCursor(db: Database, subscriberId: string, originId: string): Promise<bigint> {
  const r = await db.execute<{ seq: string }>(
    sql`select coalesce(last_applied_seq, 0)::text as seq from sync_cursor
        where subscriber_id = ${subscriberId} and origin_id = ${originId}::uuid`,
  );
  return r.rows[0] ? BigInt(r.rows[0].seq) : 0n;
}

/**
 * Pull one batch from a peer and apply it. Fetches the peer's advertised environment (GET /hello) for
 * applyBatch's handshake, reads the local cursor for this (subscriber, peer), GETs the peer's log past
 * it, and applies the decoded batch (which advances the cursor). A non-200 from either endpoint throws
 * a plain transport error carrying only the HTTP status (never row content) — the caller backs off.
 */
export async function syncPullOnce(deps: SyncPullDeps, peer: PullPeer): Promise<ApplyBatchResult> {
  const base = trimSlash(peer.url);
  const auth = { Authorization: `Bearer ${peer.token}` };

  const hello = await deps.http(`${base}/sync-api/hello`, { headers: auth });
  if (hello.status !== 200) {
    throw new Error(`sync pull: peer /sync-api/hello responded ${hello.status}`);
  }
  const sourceEnvironment = (JSON.parse(await hello.text()) as { environment: string }).environment;

  const after = await readCursor(deps.localDb, deps.subscriberId, peer.nodeId);
  const url = `${base}/sync-api/log?originId=${peer.nodeId}&after=${after.toString()}&limit=${deps.batchLimit}`;
  const res = await deps.http(url, { headers: auth });
  if (res.status !== 200) {
    throw new Error(`sync pull: peer /sync-api/log responded ${res.status}`);
  }
  const rows = decodeBatch(await res.text());
  return applyBatch(deps.localDb, rows, {
    subscriberId: deps.subscriberId,
    localEnvironment: deps.localEnvironment,
    sourceEnvironment,
  });
}

export interface RunSyncPullDeps extends SyncPullDeps {
  peers: readonly PullPeer[];
  /** Abort-aware sleep, injected so a suite asserts durations instead of waiting them (loop.ts idiom). */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  /** Sleep between idle rounds (every peer caught up). */
  minIdleMs: number;
  /** Ceiling for a failing peer's exponential backoff; reaching it logs sync.stream_stalled. */
  maxBackoffMs: number;
  /** Structured logger — the levels this loop emits, matching apps/server's Logger so boot passes its
   * own logger unwrapped (a wider `(level: string, …)` sink is still assignable to this field). */
  log: (level: "info" | "warn" | "error", code: string, params?: Record<string, unknown>) => void;
  /** The per-batch pull, injectable so the loop-control test drives it off a real DB/network; defaults
   * to the real syncPullOnce, which boot uses. */
  pullOnce?: (deps: SyncPullDeps, peer: PullPeer) => Promise<ApplyBatchResult>;
}

/** The next backoff for a peer: minIdleMs on the first failure, then doubling, capped at maxBackoffMs. */
function nextBackoff(current: number, minIdleMs: number, maxBackoffMs: number): number {
  const next = current === 0 ? minIdleMs : current * 2;
  return Math.min(next, maxBackoffMs);
}

/**
 * The background pull loop. Each round pulls every peer until its batch makes no progress
 * (applied === 0 — caught up, or nothing but redeliveries/parks that need a later pass), resetting a
 * healthy peer's backoff. A peer that throws grows its backoff; when a peer's backoff first reaches
 * maxBackoffMs, sync.stream_stalled is logged for the operator alarm (no row content, §6). The round
 * then sleeps the longest active backoff, or minIdleMs when every peer is healthy. Abort is checked
 * before every pull and before the sleep, so SIGTERM does not wait out a backoff.
 */
export async function runSyncPull(deps: RunSyncPullDeps): Promise<void> {
  const pullOnce = deps.pullOnce ?? syncPullOnce;
  const backoff = new Map<string, number>(); // per-peer current backoff (ms); 0 = healthy

  while (!deps.signal.aborted) {
    for (const peer of deps.peers) {
      if (deps.signal.aborted) break;
      try {
        // Drain this peer: keep pulling while a batch lands new rows; stop when it makes no progress.
        while (!deps.signal.aborted) {
          const result = await pullOnce(deps, peer);
          if (result.applied === 0) break;
        }
        backoff.set(peer.nodeId, 0); // healthy this round
      } catch {
        const prev = backoff.get(peer.nodeId) ?? 0;
        const next = nextBackoff(prev, deps.minIdleMs, deps.maxBackoffMs);
        backoff.set(peer.nodeId, next);
        deps.log("warn", "sync.pull_failed", { originId: peer.nodeId, backoffMs: next });
        if (prev < deps.maxBackoffMs && next >= deps.maxBackoffMs) {
          deps.log("error", "sync.stream_stalled", {
            subscriberId: deps.subscriberId,
            originId: peer.nodeId,
            backoffMs: next,
          });
        }
      }
    }
    if (deps.signal.aborted) break;
    const sleepMs = Math.max(deps.minIdleMs, ...[...backoff.values(), 0]);
    await deps.sleep(sleepMs, deps.signal);
  }
}
