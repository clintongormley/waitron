import { describe, expect, it } from "vitest";
import { type Database } from "@waitron/db";
import { runSyncPull, type HttpClient, type PullPeer, type SyncPullDeps } from "./pull.js";
import type { ApplyBatchResult } from "./apply.js";

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
const applied = (n: number): ApplyBatchResult => ({ applied: n, deferred: 0 });

describe("runSyncPull loop control", () => {
  it("drains a peer until a batch makes no progress, then sleeps the idle interval", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const results = [applied(2), applied(1), applied(0)];
    let calls = 0;
    const pullOnce = async (): Promise<ApplyBatchResult> => results[calls++] ?? applied(0);
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
    expect(calls).toBe(3); // applied 2, 1, then 0 -> stop draining
    expect(sleeps).toEqual([100]); // healthy peer -> idle interval
  });

  it("backs off exponentially on a transport error and logs sync.stream_stalled once at saturation", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const logs: { level: string; code: string; params?: Record<string, unknown> }[] = [];
    const log = (level: string, code: string, params?: Record<string, unknown>): void => {
      logs.push({ level, code, params });
    };
    const pullOnce = async (): Promise<ApplyBatchResult> => {
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
    const pullOnce = async (_deps: SyncPullDeps, peer: PullPeer): Promise<ApplyBatchResult> => {
      seen.push(peer.nodeId);
      controller.abort(); // abort during peer A's first pull
      return applied(1); // progress, so the drain would continue but the abort exits the inner loop
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
});
