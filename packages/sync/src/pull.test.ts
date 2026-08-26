import { describe, expect, it } from "vitest";
import { type Database } from "@waitron/db";
import {
  runSyncPull,
  type HttpClient,
  type PullPeer,
  type SyncPullDeps,
  type SyncPullResult,
} from "./pull.js";

// The loop-control tests inject a fake `pullOnce` and a fake `sleep`, so runSyncPull's control flow —
// drain-until-empty, per-peer exponential backoff, sync.stream_stalled on saturation, abort handling —
// is exercised off the network and off a database. The REAL syncPullOnce (cursor read, /hello + /log
// fetch, applyBatch) is proven against a container in pull.gate.test.ts.
const peerA: PullPeer = {
  nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  url: "http://a",
  token: "ta",
};
const peerB: PullPeer = {
  nodeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  url: "http://b",
  token: "tb",
};

// pullOnce is injected in every test here, so these are never touched — cast to the shapes the type
// demands so a test cannot silently depend on the real DB/network.
const throwingHttp = (() => {
  throw new Error("http must not be used when pullOnce is injected");
}) as unknown as HttpClient;
const dummyDeps: SyncPullDeps = {
  localDb: {} as unknown as Database,
  subscriberId: "node-a",
  tenantId: "tenant",
  localEnvironment: "production",
  http: throwingHttp,
  batchLimit: 500,
};
const noopLog = (): void => {};
// dummyDeps.batchLimit is 500, so a FULL page is `fetched: 500` (the drain keeps going) and a SHORT
// page is anything less (the drain stops). `applied` and `fetched` are independent: a no-op full page
// applies 0 rows yet still advances the cursor, which is the regression the fetched-keyed drain fixes.
// The drain also reads `advanced` (Fix A): it continues only while a page is FULL *and* advanced the
// cursor, so a full-but-all-parked page (advanced:false) breaks instead of busy-looping.
const BATCH = 500;
const full = (applied: number): SyncPullResult => ({
  applied,
  deferred: 0,
  fetched: BATCH,
  advanced: true,
});
// A FULL page of pure no-op redeliveries: applied 0, yet the cursor ADVANCED across the whole page
// (rows committed above the cursor by a prior partial batch, re-applied as ON CONFLICT DO NOTHING).
// The throttle fix keeps draining this — `advanced:true`.
const noopFull = (): SyncPullResult => ({
  applied: 0,
  deferred: 0,
  fetched: BATCH,
  advanced: true,
});
// A FULL page whose rows are ALL cross-origin-parked: applyBatch applied 0 and held the cursor below
// every parked seq, so the cursor did NOT advance. The progress guard must break on this (no busy-loop).
const parkedFull = (): SyncPullResult => ({
  applied: 0,
  deferred: BATCH,
  fetched: BATCH,
  advanced: false,
});
const short = (applied: number, fetched = 0): SyncPullResult => ({
  applied,
  deferred: 0,
  fetched,
  advanced: true,
});

describe("runSyncPull loop control", () => {
  it("drains a peer while it returns FULL pages, stops on a short page, then sleeps the idle interval", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const results = [full(2), full(1), short(0)];
    let calls = 0;
    const pullOnce = async (): Promise<SyncPullResult> => results[calls++] ?? short(0);
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      controller.abort(); // one round, then stop
    };
    await runSyncPull({
      ...dummyDeps,
      peers: [peerA],
      pullOnce,
      sleep,
      signal: controller.signal,
      minIdleMs: 100,
      maxBackoffMs: 800,
      log: noopLog,
    });
    expect(calls).toBe(3); // two full pages drained, third (short) page stops the drain
    expect(sleeps).toEqual([100]); // healthy peer -> idle interval
  });

  it("keeps draining a FULL page of pure no-op redeliveries (applied 0), not throttled to one batch", async () => {
    // The regression fix (drain on `fetched`, not `applied`): applyBatch can advance the cursor across a
    // whole page of no-op redeliveries while returning applied 0. Breaking on applied===0 (the old
    // behaviour) would have stopped after the FIRST page — one batch per idle round for a large backlog.
    // Draining on `fetched === batchLimit` keeps going through the no-op full pages until a short page.
    const controller = new AbortController();
    const sleeps: number[] = [];
    const results = [noopFull(), noopFull(), noopFull(), short(0)];
    let calls = 0;
    const pullOnce = async (): Promise<SyncPullResult> => results[calls++] ?? short(0);
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      controller.abort();
    };
    await runSyncPull({
      ...dummyDeps,
      peers: [peerA],
      pullOnce,
      sleep,
      signal: controller.signal,
      minIdleMs: 100,
      maxBackoffMs: 800,
      log: noopLog,
    });
    expect(calls).toBe(4); // 3 no-op full pages drained + 1 short -> NOT throttled to a single batch
    expect(sleeps).toEqual([100]);
  });

  it("breaks a FULL but ALL-PARKED page (cursor did not advance) instead of busy-looping it forever", async () => {
    // Fix A — the progress guard. In active-active multi-peer, a full page can be entirely CROSS-ORIGIN-
    // parked: every row 23503-parked on an FK parent that originates on a DIFFERENT peer, so applyBatch
    // applies 0 AND does NOT advance the cursor (it holds it below every parked seq). With only a
    // `fetched === batchLimit` guard the drain re-pulls the identical page forever — hammering the peer,
    // never round-robining to the peer that would deliver the parents. The guard breaks the drain when a
    // FULL page made no cursor progress, yielding to the round-robin (and the idle sleep).
    const controller = new AbortController();
    const sleeps: number[] = [];
    let calls = 0;
    const pullOnce = async (): Promise<SyncPullResult> => {
      calls += 1;
      // Cap the busy-loop so a REGRESSION fails fast (calls climbs) instead of hanging the suite; the
      // fixed loop breaks after the first pull and never reaches this abort.
      if (calls >= 5) controller.abort();
      return parkedFull(); // ALWAYS a full, all-parked page — a busy-loop would never stop pulling it
    };
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      controller.abort();
    };
    await runSyncPull({
      ...dummyDeps,
      peers: [peerA],
      pullOnce,
      sleep,
      signal: controller.signal,
      minIdleMs: 100,
      maxBackoffMs: 800,
      log: noopLog,
    });
    expect(calls).toBe(1); // pulled ONCE, then broke to the sleep — did NOT re-pull the stuck page
    expect(sleeps).toEqual([100]); // yielded to the idle round-robin sleep, not a busy-loop
  });

  it("backs off exponentially on a transport error and logs sync.stream_stalled once at saturation", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const logs: { level: string; code: string; params?: Record<string, unknown> }[] = [];
    const log = (level: string, code: string, params?: Record<string, unknown>): void => {
      logs.push({ level, code, params });
    };
    const pullOnce = async (): Promise<SyncPullResult> => {
      throw new Error("boom");
    };
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      if (sleeps.length >= 4) controller.abort();
    };
    await runSyncPull({
      ...dummyDeps,
      peers: [peerA],
      pullOnce,
      sleep,
      signal: controller.signal,
      minIdleMs: 100,
      maxBackoffMs: 400,
      log,
    });
    // 100 (first failure = minIdleMs), 200, 400 (=max, capped), 400 (still capped).
    expect(sleeps).toEqual([100, 200, 400, 400]);
    const stalled = logs.filter((l) => l.code === "sync.stream_stalled");
    expect(stalled).toHaveLength(1); // logged once, at the first saturation
    expect(stalled[0]!.params).toMatchObject({
      subscriberId: "node-a",
      originId: peerA.nodeId,
      backoffMs: 400,
      lane: "ordered", // dummyDeps omits `lane`, so it defaults to 'ordered' (spec §4d)
    });
    expect(logs.filter((l) => l.code === "sync.pull_failed")).toHaveLength(4); // one per failed round
  });

  it("defaults pullOnce to the real syncPullOnce when none is injected (no peers → never invoked)", async () => {
    // With no `pullOnce` in deps, runSyncPull falls back to the real syncPullOnce (the production
    // default boot relies on). Empty peers means it is assigned but never called, so this exercises
    // the fallback without needing a database or the network.
    const controller = new AbortController();
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      controller.abort();
    };
    await runSyncPull({
      ...dummyDeps,
      peers: [],
      sleep,
      signal: controller.signal,
      minIdleMs: 100,
      maxBackoffMs: 800,
      log: noopLog,
    });
    expect(sleeps).toEqual([100]); // one idle round with nothing to pull, then abort
  });

  it("stops promptly on abort — mid-drain, at the next peer, and before sleeping", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const seen: string[] = [];
    const pullOnce = async (_deps: SyncPullDeps, peer: PullPeer): Promise<SyncPullResult> => {
      seen.push(peer.nodeId);
      controller.abort(); // abort during peer A's first pull
      return full(1); // a full page, so the drain would continue but the abort exits the inner loop
    };
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    await runSyncPull({
      ...dummyDeps,
      peers: [peerA, peerB],
      pullOnce,
      sleep,
      signal: controller.signal,
      minIdleMs: 100,
      maxBackoffMs: 800,
      log: noopLog,
    });
    expect(seen).toEqual([peerA.nodeId]); // peer B never pulled — abort broke the peer loop
    expect(sleeps).toEqual([]); // aborted before sleeping
  });

  it("reports the cursor to a peer after draining it, and a report failure does not break the loop", async () => {
    // Best-effort operational metadata: after draining a peer, the puller reports its
    // (subscriber, origin=peer, lane) cursor back to that peer. A THROWING reportCursor must be
    // swallowed by the report's OWN try/catch — the peer still counts HEALTHY and the loop keeps
    // making rounds. The injected reportCursor throws before any real DB read matters; localDb is
    // stubbed so the readCursor that precedes the report resolves (plan note), otherwise readCursor —
    // not the report — would throw.
    //
    // The health assertions below prove the isolation by BOTH directions (CLAUDE.md §1/§4 — a guard a
    // test still passes without is not tested): with the guard, the throw is logged as
    // `sync.cursor_report_failed` and NEVER reaches the per-peer backoff catch, so no `sync.pull_failed`
    // is logged and backoff is not grown. Delete the report's try/catch and the throw escapes to that
    // catch instead: `sync.pull_failed` appears and `sync.cursor_report_failed` does not — flipping both.
    const reports: Array<{ peer: string; lane: string }> = [];
    const logs: { level: string; code: string }[] = [];
    const controller = new AbortController();
    let rounds = 0;
    await runSyncPull({
      ...dummyDeps,
      localDb: { execute: async () => ({ rows: [{ seq: "0" }] }) } as unknown as Database,
      peers: [peerA],
      lane: "ordered",
      signal: controller.signal,
      minIdleMs: 10,
      maxBackoffMs: 100,
      log: (level, code) => {
        logs.push({ level, code });
      },
      sleep: async () => {
        rounds += 1;
        if (rounds >= 2) controller.abort();
      },
      pullOnce: async () => short(0), // caught up immediately
      reportCursor: async (peer, report) => {
        reports.push({ peer: peer.nodeId, lane: report.lane });
        throw new Error("report boom"); // must be swallowed
      },
    });
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(reports[0]).toEqual({ peer: peerA.nodeId, lane: "ordered" });
    // The throw was caught by the report's own try/catch (best-effort), logged, and NEVER reached the
    // per-peer backoff catch — so the peer stayed healthy.
    expect(logs.some((l) => l.code === "sync.cursor_report_failed")).toBe(true);
    expect(logs.some((l) => l.code === "sync.pull_failed")).toBe(false);
  });

  it("defaults reportCursor to a POST /sync-api/cursor via http (Bearer + JSON body) when none is injected", async () => {
    // The DEFAULT report (no reportCursor injected) POSTs the cursor to `${peer.url}/sync-api/cursor`
    // with `Authorization: Bearer <peer.token>` + a JSON `{subscriberId, lane, lastAppliedSeq}` body —
    // the shape B4's `POST /sync-api/cursor` route consumes. localDb is stubbed so readCursor resolves
    // the seq the report stringifies; http is a spy capturing the request.
    const controller = new AbortController();
    const calls: Array<{
      url: string;
      init: { headers: Record<string, string>; method?: string; body?: string };
    }> = [];
    const http = (async (url, init) => {
      calls.push({ url, init });
      return { status: 200, text: async () => "" };
    }) as HttpClient;
    await runSyncPull({
      ...dummyDeps,
      localDb: { execute: async () => ({ rows: [{ seq: "7" }] }) } as unknown as Database,
      http,
      peers: [peerA],
      lane: "ordered",
      pullOnce: async () => short(0),
      sleep: async () => {
        controller.abort();
      },
      signal: controller.signal,
      minIdleMs: 100,
      maxBackoffMs: 800,
      log: noopLog,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${peerA.url}/sync-api/cursor`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toMatchObject({
      Authorization: `Bearer ${peerA.token}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({
      subscriberId: "node-a",
      lane: "ordered",
      lastAppliedSeq: "7",
    });
  });
});
