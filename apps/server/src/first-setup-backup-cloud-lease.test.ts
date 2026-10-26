import { clock } from "../test/hour-recovery-host.js";

import "node:crypto";

import "node:fs/promises";

import * as filesystem from "node:fs/promises";

import "node:path";

import "node:net";

import { TLSSocket } from "node:tls";

import "hono";

import { afterEach, expect, it, vi } from "vitest";

import "@waitron/provisioning";

import "@waitron/shared";

import "./restore.js";

import "./state-secrets.js";

import * as sources from "./first-setup-backup-source.js";

import { recovery, barrier, fixture } from "../test/first-setup-backup-recovery-fixture.js";

import {
  fixture as cloudFixture,
  selectedRepair as cloudSelectedRepair,
} from "../test/first-setup-backup-cloud-fixture.js";

import "../test/first-fiscal.js";

import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";

import "./setup-first-backup-api.js";

import "./setup-first-fiscal-api.js";

vi.mock("./backup-verification-target.js", { spy: true });

vi.mock("./state-secrets.js", { spy: true });

vi.mock("node:fs/promises", { spy: true });

vi.mock("./restore.js", { spy: true });

vi.mock("./first-setup-backup-source.js", { spy: true });

const LEASE = 5 * 60_000;

const client = { onBox: false };

async function preparedSession() {
  const f = await fixture(true);
  const service = recovery(f.options);
  const session = await service.open(f.request, client);
  await service.prepare(session.sessionId, { action: "clock-challenge" }, client);
  const records = await f.workspace.read();
  expect(records.at(-1)!.phase).toBe("prepared");
  return { ...f, service, session, records };
}

// The selected name's second clock is stale once it is more than 30 s older than the box's reading
// (packages/fiscal-verifactu/src/hour-clock.ts:81), which refuses the placement
// (second_clock_missing); the point here is the lease, so the hold's minutes are taken back before
// the commit goes on.
function advanceMonotonic(ms: number) {
  const now = performance.now.bind(performance);
  const spy = vi.spyOn(performance, "now").mockImplementation(() => now() + ms);
  return () => spy.mockRestore();
}

async function heldCloudCommit(selectedCloud: typeof cloudSelectedRepair = cloudSelectedRepair) {
  const f = await selectedCloud();
  const copy = (await vi.mocked(sources.openFirstSetupBackupSource).mock.results.at(-1)!.value) as {
    copy: { databasePath: string };
  };
  const gate = barrier();
  const reached = barrier();
  const outcome = { fail: false };
  const downloads = f.control.downloaded;
  f.control.beforeDownload = async () => {
    reached.resolve();
    await gate.promise;
    if (outcome.fail) throw new Error("download interrupted");
  };
  const commit = f.service.commit(f.session.sessionId, f.selected.input, client);
  commit.catch(() => {});
  await reached.promise;
  expect(f.control.downloaded).toBe(downloads + 1);
  return { ...f, commit, gate, outcome, databasePath: copy.copy.databasePath };
}

it("fails a held commit that throws after placement-started, and releases its step", async () => {
  const f = await heldCloudCommit();
  advanceMonotonic(6 * 60_000);
  f.outcome.fail = true;
  f.gate.resolve();
  await f.commit.then(
    () => expect.unreachable(),
    () => {},
  );
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toMatchObject({
    state: "stopped",
    phase: "placement-started",
    failed: true,
    cloud: true,
  });
});

it("leaves a fresh lease when a step ends after a long hold", async () => {
  const f = await preparedSession();
  const resolution = f.host.resolution;
  const real = resolution.inspectFirstSetupResolution.bind(resolution);
  const gate = barrier();
  const reached = barrier();
  vi.spyOn(resolution, "inspectFirstSetupResolution").mockImplementationOnce(async () => {
    reached.resolve();
    await gate.promise;
    return real();
  });
  const step = f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client);
  await reached.promise;
  clock.advance(6 * 60_000);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  gate.resolve();
  await step;
  clock.advance(4 * 60_000);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  clock.advance(60_000 + 1);
  expect(await f.service.liveness()).toMatchObject({ state: "stopped" });
});

const refused = expect.objectContaining({ code: "setup.owner_required" });

// The Cloud fixture's own start and Check name no holder, so they renew nothing.
async function heldCloudWait(holder = "A") {
  const f = await cloudFixture();
  expect((await f.service.cloudStatus(holder)).state).toBe("approved");
  return f;
}

it("keeps a Cloud wait renewed every 30 s running for 6 minutes, and its release stops it at once", async () => {
  const f = await heldCloudWait();
  for (let elapsed = 0; elapsed < 6 * 60_000; elapsed += 30_000) {
    clock.advance(30_000);
    f.service.cloudRenew("A");
    expect(f.service.runningInMemory()).toBe(true);
  }
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  f.service.cloudRelease("A");
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toBeNull();
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

it("renews nothing for Cloud calls that name no holder", async () => {
  const f = await cloudFixture();
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toBeNull();
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

it("keeps A's Cloud wait running when B's tab releases its own hold", async () => {
  const f = await heldCloudWait("A");
  expect((await f.service.cloudStatus("B")).state).toBe("approved");
  f.service.cloudRelease("B");
  expect(f.service.runningInMemory()).toBe(true);
  clock.advance(4 * 60_000);
  f.service.cloudRenew("A");
  expect(() => f.service.cloudRenew("B")).toThrow(refused);
  clock.advance(4 * 60_000);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
});

it("reads a new Cloud start after a release as running", async () => {
  const f = await heldCloudWait();
  f.service.cloudRelease("A");
  expect(f.service.runningInMemory()).toBe(false);
  expect((await f.service.cloudStart("A")).state).toBe("awaiting_owner");
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  clock.advance(4 * 60_000);
  f.service.cloudRenew("A");
  clock.advance(4 * 60_000);
  expect(f.service.runningInMemory()).toBe(true);
});

it("starts no Cloud lease when Cloud refuses the start", async () => {
  const f = await cloudFixture();
  f.control.refuse = "start";
  await expect(f.service.cloudStart("A")).rejects.toBeDefined();
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

it("refuses to renew a Cloud wait that lapsed and was then sealed", async () => {
  const f = await heldCloudWait();
  clock.advance(LEASE + 1);
  f.service.sealLapsed();
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
  expect(f.service.runningInMemory()).toBe(false);
});

it("revives a lapsed Cloud wait when its holder presses Check before anyone seals it, and never after a seal", async () => {
  const f = await heldCloudWait();
  clock.advance(LEASE + 1);
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  expect(f.service.runningInMemory()).toBe(true);
  f.service.cloudRenew("A");
  clock.advance(LEASE + 1);
  f.service.sealLapsed();
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

it("hands the Cloud wait's lease to the session it opens, so the wait renews no more", async () => {
  const f = await heldCloudWait();
  const session = await f.service.open(f.request, client);
  for (let elapsed = 0; elapsed <= LEASE; elapsed += 30_000) {
    clock.advance(30_000);
    expect(() => f.service.cloudRenew("A")).toThrow(refused);
  }
  f.service.sealLapsed();
  expect(() => f.service.renew(session.sessionId)).toThrow(refused);
  expect(f.service.runningInMemory()).toBe(false);
});

it("reads a Cloud Start again after a long session as running", async () => {
  const f = await heldCloudWait();
  const session = await f.service.open(f.request, client);
  await f.service.prepare(session.sessionId, { action: "clock-challenge" }, client);
  for (let elapsed = 0; elapsed < 6 * 60_000; elapsed += 30_000) {
    clock.advance(30_000);
    f.service.renew(session.sessionId);
  }
  await f.service.close(session.sessionId);
  f.control.expired = true;
  expect((await f.service.cloudStartAgain("A")).state).toBe("awaiting_owner");
  expect(f.service.runningInMemory()).toBe(true);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
});

async function closedCloudSession() {
  const f = await heldCloudWait();
  const session = await f.service.open(f.request, client);
  await f.service.prepare(session.sessionId, { action: "clock-challenge" }, client);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("prepared");
  await f.service.close(session.sessionId);
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toMatchObject({ state: "stopped" });
  return { ...f, session };
}

it("seals a closed Cloud session's recovery at once, so its holder's Check and Start again renew nothing", async () => {
  const f = await closedCloudSession();
  f.service.sealLapsed();
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  expect(f.service.runningInMemory()).toBe(false);
  f.control.expired = true;
  expect((await f.service.cloudStartAgain("A")).state).toBe("awaiting_owner");
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toMatchObject({ state: "stopped", cloud: true });
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

it("renews nothing when Check names no holder after a Cloud session closed", async () => {
  const f = await closedCloudSession();
  clock.advance(LEASE + 1);
  expect((await f.service.cloudStatus()).state).toBe("approved");
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toMatchObject({ state: "stopped" });
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

it("starts no Cloud lease after a restart for a journal that already exists", async () => {
  const f = await closedCloudSession();
  await f.service.dispose();
  const restarted = recovery(f.options);
  expect((await restarted.cloudStatus("A")).state).toBe("approved");
  expect(restarted.runningInMemory()).toBe(false);
  expect(await restarted.liveness()).toMatchObject({
    state: "stopped",
    lastActiveSource: "saved-step",
  });
  expect(() => restarted.cloudRenew("A")).toThrow(refused);
});

async function cloudSelectedWithHolder() {
  const f = await heldCloudWait();
  const session = await f.service.open(f.request, client);
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, at) => f.service.prepare(session.sessionId, proposal, at) },
    client,
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  return { ...f, session, selected, record: (await f.workspace.read()).at(-1)! };
}

it("reads a failed Cloud session as stopped at once, and no Cloud call leases while it stays", async () => {
  const f = await heldCloudCommit(cloudSelectedWithHolder);
  f.outcome.fail = true;
  f.gate.resolve();
  await f.commit.then(
    () => expect.unreachable(),
    () => {},
  );
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toMatchObject({ state: "stopped", failed: true });
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
  await expect(f.service.cloudStatus("A")).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(f.service.runningInMemory()).toBe(false);
});

it("keeps a failed Cloud recovery stopped after its session closes, whatever its holder checks", async () => {
  const f = await heldCloudCommit(cloudSelectedWithHolder);
  f.outcome.fail = true;
  f.gate.resolve();
  await f.commit.then(
    () => expect.unreachable(),
    () => {},
  );
  await f.service.close(f.session.sessionId);
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toMatchObject({ state: "stopped", failed: true });
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

it("leaves a lapsed Cloud wait unsealed while an open runs, so its holder's Check revives it after", async () => {
  const f = await heldCloudWait();
  const gate = barrier();
  const real = vi.mocked(sources.openFirstSetupBackupSource).getMockImplementation()!;
  vi.mocked(sources.openFirstSetupBackupSource).mockImplementationOnce(async (...args) => {
    await gate.promise;
    return real(...args);
  });
  const opening = f.service.open(f.request, client);
  opening.catch(() => {});
  clock.advance(LEASE + 1);
  f.service.sealLapsed();
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  gate.resolve();
  const session = await opening;
  f.service.renew(session.sessionId);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
  await f.service.close(session.sessionId);
  expect(f.service.runningInMemory()).toBe(false);
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  expect(f.service.runningInMemory()).toBe(true);
});

it("reads a Cloud call in flight as running, so a seal during it leaves the wait to lease", async () => {
  const f = await cloudFixture();
  const gate = barrier();
  const reached = barrier();
  const service = recovery({
    ...f.options,
    cloud: {
      ...f.options.cloud,
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        reached.resolve();
        await gate.promise;
        return f.options.cloud.fetch(url, init);
      },
    },
  });
  const starting = service.cloudStart("A");
  starting.catch(() => {});
  try {
    await reached.promise;
    expect(service.runningInMemory()).toBe(true);
    expect(await service.liveness()).toMatchObject({ state: "running" });
    service.sealLapsed();
  } finally {
    gate.resolve();
  }
  expect((await starting).state).toBe("awaiting_owner");
  expect(service.runningInMemory()).toBe(true);
  service.cloudRenew("A");
});

it("keeps A's Cloud wait held when B opens an upload session beside it", async () => {
  const f = await heldCloudWait();
  const session = await f.service.open(
    {
      ...f.request,
      source: {
        kind: "archive",
        artifact: f.artifact,
        recoveryKey: f.restore.recoveryKey,
        environment: "preproduction",
      },
    },
    client,
  );
  f.service.cloudRenew("A");
  await f.service.close(session.sessionId);
  expect(f.service.runningInMemory()).toBe(true);
});

it("answers a stale tab's Check after a finished Cloud recovery, and leases nothing", async () => {
  const f = await heldCloudCommit(cloudSelectedWithHolder);
  f.gate.resolve();
  await f.commit;
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

// The Cloud fixture leaves its pending id waiting with no holder, so a fence with nothing running
// seals it; a Start after that leases a new wait, which carries the sealed one's Cloud request.
async function leasesNewWait(
  f: Awaited<ReturnType<typeof cloudFixture>>,
  started: Promise<unknown>,
) {
  const answer = (await started) as { state: string; requestId: string };
  expect(answer.state).toBe("awaiting_owner");
  expect(f.service.runningInMemory()).toBe(true);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  f.service.cloudRenew("A");
  return answer;
}

it("keeps the waiting Cloud request when Start is pressed after a fence sealed its wait, under a new wait", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
  const answer = await leasesNewWait(f, f.service.cloudStart("A"));
  expect(answer.requestId).toBe(f.approved.requestId);
});

it("keeps the waiting Cloud request under a new wait when a fence seals the old one while Start waits its turn", async () => {
  const f = await cloudFixture();
  const gate = barrier();
  const holding = f.options.host.coordinator.run(() => gate.promise);
  const starting = f.service.cloudStart("A");
  starting.catch(() => {});
  try {
    f.service.sealLapsed();
  } finally {
    gate.resolve();
  }
  await holding;
  const answer = await leasesNewWait(f, starting);
  expect(answer.requestId).toBe(f.approved.requestId);
});

it("keeps the waiting Cloud recovery's own request when nothing seals it while Start waits its turn", async () => {
  const f = await cloudFixture();
  const gate = barrier();
  const holding = f.options.host.coordinator.run(() => gate.promise);
  const starting = f.service.cloudStart("A");
  gate.resolve();
  await holding;
  const answer = await starting;
  expect(answer.state).toBe("awaiting_owner");
  expect(answer.requestId).toBe(f.approved.requestId);
  expect(f.service.runningInMemory()).toBe(true);
  f.service.cloudRenew("A");
});

it("keeps A's hold on the waiting Cloud recovery when B presses Start with nothing sealed", async () => {
  const f = await heldCloudWait("A");
  expect((await f.service.cloudStart("B")).requestId).toBe(f.approved.requestId);
  f.service.cloudRenew("A");
  f.service.cloudRenew("B");
});

it("asks Cloud about the old request when Start again is pressed after a fence sealed its wait, as with no seal", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  f.control.expired = true;
  const before = f.calls.length;
  const answer = await leasesNewWait(f, f.service.cloudStartAgain("A"));
  expect(f.calls.slice(before)).toEqual(["status", "start"]);
  expect(answer.requestId).not.toBe(f.approved.requestId);
});

it("keeps an approved Cloud request through a seal: Start returns it, and Start again is refused while it is live", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  await expect(f.service.cloudStartAgain("A")).rejects.toThrow("Cloud recovery is unavailable");
  expect(await f.service.cloudStatus("A")).toMatchObject({
    state: "approved",
    requestId: f.approved.requestId,
  });
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
  const answer = await leasesNewWait(f, f.service.cloudStart("A"));
  expect(answer.requestId).toBe(f.approved.requestId);
  expect(await f.service.cloudStatus("A")).toMatchObject({
    state: "approved",
    requestId: f.approved.requestId,
  });
  await expect(f.service.cloudStartAgain("A")).rejects.toThrow("Cloud recovery is unavailable");
  expect(f.service.runningInMemory()).toBe(true);
  f.service.cloudRenew("A");
});

it("leaves a sealed Cloud wait and its request as they were when the Start after the seal fails", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  f.control.refuse = "start";
  await expect(f.service.cloudStart("A")).rejects.toThrow("Cloud recovery is unavailable");
  f.control.refuse = "";
  expect(await f.service.cloudStatus("A")).toMatchObject({
    state: "approved",
    requestId: f.approved.requestId,
  });
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
  const answer = await leasesNewWait(f, f.service.cloudStart("A"));
  expect(answer.requestId).toBe(f.approved.requestId);
});

it("keeps the new wait a Start takes over leased when a fence runs during its Cloud call", async () => {
  const f = await cloudFixture();
  const gate = barrier();
  const reached = barrier();
  let holding = false;
  const service = recovery({
    ...f.options,
    cloud: {
      ...f.options.cloud,
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        if (holding) {
          reached.resolve();
          await gate.promise;
        }
        return f.options.cloud.fetch(url, init);
      },
    },
  });
  const first = await service.cloudStart();
  service.sealLapsed();
  holding = true;
  const starting = service.cloudStart("A");
  starting.catch(() => {});
  try {
    await reached.promise;
    service.sealLapsed();
  } finally {
    gate.resolve();
  }
  expect((await starting).requestId).toBe(first.requestId);
  expect(service.runningInMemory()).toBe(true);
  service.cloudRenew("A");
});

it("writes the journal of an open after a seal under a new wait, so its holder's Check leases once the session closes", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  const session = await f.service.open(f.request, client);
  await f.service.prepare(session.sessionId, { action: "clock-challenge" }, client);
  expect((await f.workspace.read()).at(-1)!.target.recoveryId).toBe(session.recoveryId);
  await f.service.close(session.sessionId);
  expect(f.service.runningInMemory()).toBe(false);
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  expect(f.service.runningInMemory()).toBe(true);
  f.service.cloudRenew("A");
});

it("leaves a sealed Cloud wait and its request as they were when an open after the seal fails", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  f.control.refuse = "read";
  await expect(f.service.open(f.request, client)).rejects.toBeDefined();
  f.control.refuse = "";
  expect(await f.service.cloudStatus("A")).toMatchObject({
    state: "approved",
    requestId: f.approved.requestId,
  });
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
  const answer = await leasesNewWait(f, f.service.cloudStart("A"));
  expect(answer.requestId).toBe(f.approved.requestId);
});

it("refuses an open after a seal as a conflict when another tab's Start moves the sealed request before the open reads it", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  const gate = barrier();
  const reached = barrier();
  const real = (await vi.importActual<typeof filesystem>("node:fs/promises")).mkdtemp;
  const held = vi.mocked(filesystem.mkdtemp).mockImplementation(async (prefix, options) => {
    if (prefix.includes("waitron-backup-proof-")) {
      reached.resolve();
      await gate.promise;
    }
    return real(prefix, options);
  });
  const opening = f.service.open(f.request, client);
  opening.catch(() => {});
  let started: { requestId: string };
  try {
    await reached.promise;
    started = await f.service.cloudStart("B");
  } finally {
    gate.resolve();
    held.mockRestore();
  }
  await expect(opening).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(started.requestId).toBe(f.approved.requestId);
  expect(f.service.runningInMemory()).toBe(true);
  f.service.cloudRenew("B");
  expect(await f.service.cloudStatus("B")).toMatchObject({
    state: "approved",
    requestId: f.approved.requestId,
  });
});

it("answers Check on a sealed Cloud recovery from its own request, and leases nothing", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  const answer = await f.service.cloudStatus("A");
  expect(answer.state).toBe("approved");
  expect(answer.requestId).toBe(f.approved.requestId);
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

const sockets: TLSSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});
