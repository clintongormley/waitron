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
import type { SyncLane } from "./registry.js";
import { decodeBatch } from "./wire.js";
// Side-effect import: keeps errors.ts's `declare module` augmentation reachable from a file in the
// sync.* domain (the reachability rule), even though this module logs codes rather than throwing them.
import "./errors.js";

export type HttpClient = (
  url: string,
  init: { headers: Record<string, string>; method?: string; body?: string },
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
  /** Which replication lane this worker drives — 'fast' (payments/payment_refunds) or 'ordered'.
   * Threaded into the `?lane=` request, the `(subscriber, origin, lane)` cursor read/advance, and the
   * applyBatch opts. Optional, defaulting to 'ordered' (the wire + 0002 default), so an ordered worker
   * need not name it; boot passes both lanes explicitly (spec §4d). */
  lane?: SyncLane;
}

/** {@link syncPullOnce}'s result: the applied/deferred counts of {@link ApplyBatchResult} plus
 * `fetched` (rows the peer returned for this page) and `advanced` (whether this pull moved the
 * (subscriber, origin, lane) cursor forward). The drain loop reads BOTH, never `applied`: it continues
 * only while the page was FULL (`fetched === batchLimit`, the source still has rows past the cursor)
 * AND it `advanced` the cursor (real progress this iteration). A short/empty page means caught up; a
 * full page with `advanced === false` is all-parked — every row `23503`-parked on an FK parent that is
 * absent because it originates on a DIFFERENT peer (cross-origin) OR rides the OTHER lane (cross-lane:
 * a fast `payments` row whose `working_orders` parent is on the ordered lane, never in a fast batch),
 * so applyBatch applied 0 and held the cursor below them (apply.ts:206-215) — and also breaks, so the
 * loop yields to the per-peer round-robin instead of busy-looping the identical page. See the drain in
 * {@link runSyncPull} for why `applied` is the wrong signal. */
export interface SyncPullResult extends ApplyBatchResult {
  fetched: number;
  /** Did this pull advance the (subscriber, origin, lane) cursor? Derived by reading that cursor before
   * and after applyBatch. The drain's progress guard against a full-but-all-parked page (Fix A). */
  advanced: boolean;
}

const trimSlash = (url: string): string => url.replace(/\/$/, "");

async function readCursor(
  db: Database,
  subscriberId: string,
  originId: string,
  lane: SyncLane,
): Promise<bigint> {
  // `and lane = ${lane}` is load-bearing: with the 0002 lane column the PK is
  // (subscriber_id, origin_id, lane), so a (subscriber, origin) pair can hold TWO cursor rows. Without
  // the lane filter this would read an arbitrary one of them, so `advanced` (this pull moved MY lane's
  // cursor) would be computed against the wrong lane's seq — breaking the drain/backoff guard (spec §4e).
  const r = await db.execute<{ seq: string }>(
    sql`select coalesce(last_applied_seq, 0)::text as seq from sync_cursor
        where subscriber_id = ${subscriberId} and origin_id = ${originId}::uuid and lane = ${lane}`,
  );
  return r.rows[0] ? BigInt(r.rows[0].seq) : 0n;
}

/**
 * Pull one batch from a peer and apply it. Fetches the peer's advertised environment (GET /hello) for
 * applyBatch's handshake, reads the local cursor for this (subscriber, peer), GETs the peer's log past
 * it, and applies the decoded batch (which advances the cursor). A non-200 from either endpoint throws
 * a plain transport error carrying only the HTTP status (never row content) — the caller backs off.
 *
 * Returns `fetched` (the page size the peer returned) and `advanced` (whether the cursor moved)
 * alongside applyBatch's counts, because the drain loop keys off BOTH, not `applied` — see
 * {@link runSyncPull}.
 */
export async function syncPullOnce(deps: SyncPullDeps, peer: PullPeer): Promise<SyncPullResult> {
  const base = trimSlash(peer.url);
  const auth = { Authorization: `Bearer ${peer.token}` };
  const lane: SyncLane = deps.lane ?? "ordered";

  const hello = await deps.http(`${base}/sync-api/hello`, { headers: auth });
  if (hello.status !== 200) {
    throw new Error(`sync pull: peer /sync-api/hello responded ${hello.status}`);
  }
  const sourceEnvironment = (JSON.parse(await hello.text()) as { environment: string }).environment;

  const before = await readCursor(deps.localDb, deps.subscriberId, peer.nodeId, lane);
  const url = `${base}/sync-api/log?originId=${peer.nodeId}&after=${before.toString()}&limit=${deps.batchLimit}&lane=${lane}`;
  const res = await deps.http(url, { headers: auth });
  if (res.status !== 200) {
    throw new Error(`sync pull: peer /sync-api/log responded ${res.status}`);
  }
  const rows = decodeBatch(await res.text());
  const result = await applyBatch(deps.localDb, rows, {
    subscriberId: deps.subscriberId,
    localEnvironment: deps.localEnvironment,
    sourceEnvironment,
    lane,
  });
  // Re-read the (subscriber, origin, lane) cursor: `advanced` is whether applyBatch moved THIS lane's
  // cursor this iteration. A full page that did NOT advance is all-parked — every row 23503-parked on
  // an FK parent that rides another peer (cross-origin) or the other lane (cross-lane) — and the drain
  // must break on it rather than re-pull the identical page forever (see the progress guard in
  // runSyncPull).
  const after = await readCursor(deps.localDb, deps.subscriberId, peer.nodeId, lane);
  return { ...result, fetched: rows.length, advanced: after > before };
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
  pullOnce?: (deps: SyncPullDeps, peer: PullPeer) => Promise<SyncPullResult>;
  /** Reports this subscriber's cursor for a drained peer back to that peer (POST /sync-api/cursor),
   * so the SOURCE gains cross-node visibility for retention (spec §3.1). Injectable for the loop test;
   * defaults to a real POST via `http`. Best-effort — a failure is logged and swallowed, never
   * affecting the pull's own success/backoff. */
  reportCursor?: (
    peer: PullPeer,
    report: { subscriberId: string; lane: SyncLane; lastAppliedSeq: string },
  ) => Promise<void>;
}

/** The next backoff for a peer: minIdleMs on the first failure, then doubling, capped at maxBackoffMs. */
function nextBackoff(current: number, minIdleMs: number, maxBackoffMs: number): number {
  const next = current === 0 ? minIdleMs : current * 2;
  return Math.min(next, maxBackoffMs);
}

/**
 * The background pull loop. Each round pulls every peer until it returns a SHORT page (fewer than
 * `batchLimit` rows — the source has no more past the cursor), resetting a healthy peer's backoff. A
 * peer that throws grows its backoff; when a peer's backoff first reaches maxBackoffMs,
 * sync.stream_stalled is logged for the operator alarm (no row content, §6). The round then sleeps the
 * longest active backoff, or minIdleMs when every peer is healthy. Abort is checked before every pull
 * and before the sleep, so SIGTERM does not wait out a backoff.
 *
 * The drain keys off `fetched` AND `advanced`, NOT `applied`. `applyBatch` can advance the cursor
 * across a WHOLE batch of pure no-op redeliveries (rows committed above the cursor by a prior partial
 * batch, now re-applied as `ON CONFLICT DO NOTHING`) while returning `applied: 0` — so breaking on
 * `applied === 0` throttled recovery of a large backlog to one batch per idle round. `fetched ===
 * batchLimit` means the source still had a full page past the cursor, so there is more to drain
 * regardless of how many rows actually changed the mirror.
 *
 * The drain continues only while the page was FULL **and** the cursor advanced this iteration, and
 * breaks on a short/empty page OR a full page that made no cursor progress. Each pull is single-origin
 * (`?originId=<peer>`) and single-lane (`?lane=`); within one origin a row's FK parent commits before
 * it and so carries a strictly lower seq, so ascending-seq apply is a topological order (apply.ts's own
 * §3.6 property) in which a row parks ONLY when its FK parent is ABSENT from the page it applies
 * against. That absence has two causes, both with the IDENTICAL signature — every row `23503`-parked,
 * applyBatch applies 0 and holds the cursor below every parked seq (apply.ts:206-215), `advanced ===
 * false`:
 * (1) CROSS-ORIGIN — in active-active multi-peer the FK parent originates on a DIFFERENT peer, so it is
 *     never in this peer's single-origin page.
 * (2) CROSS-LANE — the FK parent rides the OTHER lane: a fast `payments` row's `working_orders`/`sales`
 *     parent is an ordered-lane table, never in a fast batch, so the fast page stays parked until the
 *     ordered lane has applied it (spec §4e; `payment_refunds → payments` is intra-fast-lane, so
 *     seq-order within the fast batch already lands it — no cross-lane park). No ordered table
 *     references a fast one (spec §4b/§4e), so an ORDERED page never parks CROSS-LANE (it can still
 *     cross-origin-park — case (1)); only the fast lane adds case (2).
 * Either way, without the progress guard the drain would re-pull that identical full page forever
 * (busy-loop, hammering the peer) and never yield — to the round-robin that lets another peer deliver a
 * cross-origin parent, or to the later fast tick that lands the row once the ordered lane has delivered
 * the cross-lane parent. The guard breaks it so the loop yields to the per-peer round-robin (and the
 * idle sleep) and progress resumes.
 */
export async function runSyncPull(deps: RunSyncPullDeps): Promise<void> {
  const pullOnce = deps.pullOnce ?? syncPullOnce;
  const lane: SyncLane = deps.lane ?? "ordered";
  // The cursor-report POST (spec §3.1): default to a real POST via `http` to the peer's
  // /sync-api/cursor, carrying the peer's Bearer token and a JSON `{subscriberId, lane, lastAppliedSeq}`
  // body — the shape the source's POST /sync-api/cursor route consumes. Injectable so the loop test
  // captures it without the network.
  const report =
    deps.reportCursor ??
    (async (
      peer: PullPeer,
      r: { subscriberId: string; lane: SyncLane; lastAppliedSeq: string },
    ) => {
      // Observe the POST's status: /sync-api/cursor answers 200 on success (a blank subscriberId is a
      // 200 no-op too), so a non-200 is a real failure — a 401 after a token rotation dropped this
      // reporter's token, or a 500. The `http` adapter RESOLVES such a response rather than throwing,
      // so ignoring `status` would treat a 401/500 as success and silently break cross-node retention
      // visibility. Throw on non-200 so the SURROUNDING try/catch logs sync.cursor_report_failed and
      // the failure is OBSERVABLE. Still best-effort: that catch swallows the throw, never blocking the
      // drain or growing backoff.
      const res = await deps.http(`${trimSlash(peer.url)}/sync-api/cursor`, {
        method: "POST",
        headers: { Authorization: `Bearer ${peer.token}`, "content-type": "application/json" },
        body: JSON.stringify(r),
      });
      if (res.status !== 200) {
        throw new Error(`cursor report to ${peer.nodeId} failed: HTTP ${res.status}`);
      }
    });
  const backoff = new Map<string, number>(); // per-peer current backoff (ms); 0 = healthy

  while (!deps.signal.aborted) {
    for (const peer of deps.peers) {
      if (deps.signal.aborted) break;
      try {
        // Drain this peer while it returns a FULL page AND that page advanced the cursor (real
        // progress). Stop on a short/empty page (caught up), OR on a full page that made NO cursor
        // progress — every row cross-origin-parked, so re-pulling it would busy-loop; breaking yields
        // to the round-robin so another peer delivers the parents. Keyed on `fetched` + `advanced`,
        // never `applied` — see the drain note above.
        while (!deps.signal.aborted) {
          const result = await pullOnce(deps, peer);
          if (result.fetched < deps.batchLimit || !result.advanced) break;
        }
        // Best-effort cursor report (spec §3.1): read the (subscriber, origin=peer, lane) cursor and
        // report it to the peer so the SOURCE gains cross-node visibility for retention. Wrapped in its
        // OWN try/catch — a report failure (or a cursor-read failure) is operational metadata only, so
        // it is logged and swallowed here and must NEVER fail the peer or grow its backoff. Runs before
        // backoff.set(peer.nodeId, 0) so a healthy drain still resets backoff even when the report throws.
        try {
          const seq = await readCursor(deps.localDb, deps.subscriberId, peer.nodeId, lane);
          await report(peer, {
            subscriberId: deps.subscriberId,
            lane,
            lastAppliedSeq: seq.toString(),
          });
        } catch {
          deps.log("warn", "sync.cursor_report_failed", { originId: peer.nodeId, lane });
        }
        backoff.set(peer.nodeId, 0); // healthy this round
      } catch {
        const prev = backoff.get(peer.nodeId) ?? 0;
        const next = nextBackoff(prev, deps.minIdleMs, deps.maxBackoffMs);
        backoff.set(peer.nodeId, next);
        deps.log("warn", "sync.pull_failed", { originId: peer.nodeId, backoffMs: next, lane });
        if (prev < deps.maxBackoffMs && next >= deps.maxBackoffMs) {
          deps.log("error", "sync.stream_stalled", {
            subscriberId: deps.subscriberId,
            originId: peer.nodeId,
            backoffMs: next,
            lane,
          });
        }
      }
    }
    if (deps.signal.aborted) break;
    const sleepMs = Math.max(deps.minIdleMs, ...[...backoff.values(), 0]);
    await deps.sleep(sleepMs, deps.signal);
  }
}
