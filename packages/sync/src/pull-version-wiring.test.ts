import { describe, expect, it, vi } from "vitest";
import { type Database } from "@waitron/db";

// Isolated from pull.test.ts's membership suite (which drives the REAL applyBatch): this file mocks
// applyBatch so it can capture the opts syncPullOnce threads into it. vi.mock is file-scoped, so the
// membership tests' real applyBatch is untouched.
const applyBatchMock = vi.fn(async () => ({ applied: 0, deferred: 0 }));
vi.mock("./apply.js", () => ({ applyBatch: applyBatchMock }));

// Imported AFTER the mock declaration; vi.mock is hoisted so pull.ts binds the mocked applyBatch.
const { syncPullOnce } = await import("./pull.js");
type PullDeps = Parameters<typeof syncPullOnce>[0];
type Peer = Parameters<typeof syncPullOnce>[1];

const peer: Peer = {
  nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  url: "http://a",
  token: "ta",
};

// A fake DB: every execute (the before/after cursor reads) answers seq 0 so syncPullOnce runs through
// applyBatch and back without a real database.
const fakeDb = { execute: async () => ({ rows: [{ seq: "0" }] }) } as unknown as Database;

// hello carries the SOURCE's per-module versions; /log is an empty page.
const http: PullDeps["http"] = async (url) => {
  if (url.endsWith("/sync-api/hello")) {
    return {
      status: 200,
      text: async () => JSON.stringify({ environment: "production", moduleVersions: { core: 5 } }),
    };
  }
  return { status: 200, text: async () => "" };
};

describe("syncPullOnce threads the module versions + table→module map into applyBatch (SP-2b wiring)", () => {
  it("passes sourceModuleVersions (from /hello), subscriberModuleVersions and moduleByTable (from deps)", async () => {
    applyBatchMock.mockClear();
    const subscriberModuleVersions = { core: 3, sync: 1 };
    const moduleByTable: ReadonlyMap<string, string> = new Map([["sales", "core"]]);
    const deps: PullDeps = {
      localDb: fakeDb,
      subscriberId: "node-a",
      tenantId: "tenant",
      localEnvironment: "production",
      http,
      batchLimit: 500,
      enrolments: [],
      moduleVersions: subscriberModuleVersions,
      moduleByTable,
    };

    await syncPullOnce(deps, peer);

    expect(applyBatchMock).toHaveBeenCalledTimes(1);
    const opts = (applyBatchMock.mock.calls[0] as unknown[])[2] as {
      sourceModuleVersions?: Record<string, number>;
      subscriberModuleVersions: Record<string, number>;
      moduleByTable: ReadonlyMap<string, string>;
    };
    // The SOURCE's map, parsed off the /hello body.
    expect(opts.sourceModuleVersions).toEqual({ core: 5 });
    expect(opts.sourceModuleVersions!.core).toBe(5);
    // THIS subscriber's own map + the table→module map, threaded straight from deps (same references).
    expect(opts.subscriberModuleVersions).toBe(subscriberModuleVersions);
    expect(opts.moduleByTable).toBe(moduleByTable);
  });

  it("leaves sourceModuleVersions undefined for a pre-SP-2b peer that omits moduleVersions", async () => {
    applyBatchMock.mockClear();
    const deps: PullDeps = {
      localDb: fakeDb,
      subscriberId: "node-a",
      tenantId: "tenant",
      localEnvironment: "production",
      http: async (url) =>
        url.endsWith("/sync-api/hello")
          ? { status: 200, text: async () => JSON.stringify({ environment: "production" }) }
          : { status: 200, text: async () => "" },
      batchLimit: 500,
      enrolments: [],
      moduleVersions: {},
      moduleByTable: new Map(),
    };

    await syncPullOnce(deps, peer);

    const opts = (applyBatchMock.mock.calls[0] as unknown[])[2] as {
      sourceModuleVersions?: Record<string, number>;
    };
    expect(opts.sourceModuleVersions).toBeUndefined();
  });
});
