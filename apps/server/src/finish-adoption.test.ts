import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { SubscriptionStatus } from "@waitron/sync";
import {
  PENDING_ADOPTION_FILE,
  readPendingAdoption,
  runFinishAdoption,
  writePendingAdoption,
  type PendingAdoption,
} from "./finish-adoption.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-adopt-"));
  dirs.push(dir);
  return dir;
}

const STANDBY_NODE_ID = "33333333-3333-4333-8333-333333333333";
const PENDING: PendingAdoption = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  locationId: "55555555-5555-4555-8555-555555555555",
  standby: { nodeId: STANDBY_NODE_ID, publicKey: "pub", privateKey: "priv" },
  nodeName: "standby",
  filingModule: "fiscal-verifactu",
  taxModule: null,
  reserved: { modules: {}, series: [], endorsement: {} as never },
  originNodeId: "77777777-7777-4777-8777-777777777777",
};

function status(tablesTotal: number, tablesReady: number): SubscriptionStatus {
  return {
    name: "sub",
    exists: true,
    enabled: true,
    publications: [],
    workerUp: true,
    receivedLsn: null,
    latestEndLsn: null,
    applyErrorCount: 0,
    syncErrorCount: 0,
    tablesTotal,
    tablesReady,
  };
}

const dummyDb = {} as Database;
const dummyRing = {} as KeyRing;
const noop = (): void => {};
const immediateSleep = (): Promise<void> => Promise.resolve();

describe("writePendingAdoption / readPendingAdoption", () => {
  it("round-trips the pending record and writes it 0600", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    expect(await readPendingAdoption(dir)).toEqual(PENDING);
    const mode = (await stat(join(dir, PENDING_ADOPTION_FILE))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null when no pending file exists", async () => {
    const dir = await tempDir();
    expect(await readPendingAdoption(dir)).toBeNull();
  });
});

describe("runFinishAdoption", () => {
  it("polls until every table is ready, then establishes, ensures the viewer, and unlinks the file", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    // Not-ready twice (initial copy still running), then ready.
    const statuses = [status(3, 1), status(3, 2), status(3, 3)];
    let read = 0;
    let established: unknown;
    let viewerTenant: string | undefined;
    await runFinishAdoption({
      replicationDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      environment: "preproduction",
      modules: [],
      readStatus: () => Promise.resolve(statuses[read++]!),
      establish: (args) => {
        established = args;
        return Promise.resolve();
      },
      ensureViewer: (tenantId) => {
        viewerTenant = tenantId;
        return Promise.resolve();
      },
      sleep: immediateSleep,
      log: noop as never,
      signal: new AbortController().signal,
    });
    expect(read).toBe(3); // two not-ready polls + the ready one
    expect(established).toMatchObject({ tenantId: PENDING.tenantId, standby: PENDING.standby });
    expect(viewerTenant).toBe(PENDING.tenantId);
    expect(await readPendingAdoption(dir)).toBeNull(); // file unlinked
  });

  it("subscribes to the standby's own subscription name (C1)", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    let subName: string | undefined;
    await runFinishAdoption({
      replicationDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      environment: "preproduction",
      modules: [],
      readStatus: (name) => {
        subName = name;
        return Promise.resolve(status(1, 1));
      },
      establish: () => Promise.resolve(),
      ensureViewer: () => Promise.resolve(),
      sleep: immediateSleep,
      log: noop as never,
      signal: new AbortController().signal,
    });
    expect(subName).toBe(`waitron_preproduction_sub_${STANDBY_NODE_ID.replace(/-/g, "")}`);
  });

  it("returns immediately when there is no pending file (nothing to finish)", async () => {
    const dir = await tempDir();
    let establishCalls = 0;
    await runFinishAdoption({
      replicationDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      environment: "preproduction",
      modules: [],
      readStatus: () => Promise.resolve(status(1, 1)),
      establish: () => {
        establishCalls += 1;
        return Promise.resolve();
      },
      ensureViewer: () => Promise.resolve(),
      sleep: immediateSleep,
      log: noop as never,
      signal: new AbortController().signal,
    });
    expect(establishCalls).toBe(0);
  });

  it("logs establish_failed and keeps the file when establish throws, then retries and succeeds", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    let establishCalls = 0;
    let viewerCalls = 0;
    const events: string[] = [];
    await runFinishAdoption({
      replicationDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      environment: "preproduction",
      modules: [],
      readStatus: () => Promise.resolve(status(1, 1)),
      establish: () => {
        establishCalls += 1;
        if (establishCalls === 1) return Promise.reject(new Error("copy still settling"));
        return Promise.resolve();
      },
      ensureViewer: () => {
        viewerCalls += 1;
        return Promise.resolve();
      },
      sleep: immediateSleep,
      log: ((_l: string, event: string) => events.push(event)) as never,
      signal: new AbortController().signal,
    });
    expect(establishCalls).toBe(2); // failed once, retried, succeeded
    expect(viewerCalls).toBe(1);
    expect(events).toContain("adoption.establish_failed");
    expect(await readPendingAdoption(dir)).toBeNull(); // eventually unlinked
  });

  it("returns without establishing when aborted mid-poll (the copy has not finished)", async () => {
    const dir = await tempDir();
    await writePendingAdoption(dir, PENDING);
    const controller = new AbortController();
    let establishCalls = 0;
    await runFinishAdoption({
      replicationDb: dummyDb,
      ring: dummyRing,
      stateDir: dir,
      environment: "preproduction",
      modules: [],
      readStatus: () => Promise.resolve(status(3, 1)), // never ready
      establish: () => {
        establishCalls += 1;
        return Promise.resolve();
      },
      ensureViewer: () => Promise.resolve(),
      // Abort during the first inter-poll sleep; the loop's top-of-tick check then returns.
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
      log: noop as never,
      signal: controller.signal,
    });
    expect(establishCalls).toBe(0);
    // The file is deliberately KEPT — a later boot re-enters the adoption-pending mode and retries.
    expect(await readFile(join(dir, PENDING_ADOPTION_FILE), "utf8")).not.toBe("");
  });
});
