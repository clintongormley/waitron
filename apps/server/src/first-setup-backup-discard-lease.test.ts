import { clock } from "../test/hour-recovery-host.js";

import { createHash, randomBytes } from "node:crypto";

import { readFile, readdir } from "node:fs/promises";

import "node:fs/promises";

import { join } from "node:path";

import { Socket } from "node:net";

import { TLSSocket } from "node:tls";

import { Hono } from "hono";

import { afterEach, expect, it, vi } from "vitest";

import { emptyAbandonedBackupRecovery, isEmptiedTombstone } from "@waitron/provisioning";

import "@waitron/shared";

import "./restore.js";

import * as stateSecrets from "./state-secrets.js";

import * as sources from "./first-setup-backup-source.js";

import {
  recovery,
  barrier,
  fixture,
  selectedRepair,
} from "../test/first-setup-backup-recovery-fixture.js";

import {
  fixture as cloudFixture,
  selectedRepair as cloudSelectedRepair,
} from "../test/first-setup-backup-cloud-fixture.js";

import { PASSWORD } from "../test/first-fiscal.js";

import "./testing/hour-test-clock.js";

import { mountFirstSetupBackupApi } from "./setup-first-backup-api.js";

import {
  mountFirstSetupResolutionApi,
  mountFirstSetupResolutionFence,
} from "./setup-first-fiscal-api.js";

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

const refused = expect.objectContaining({ code: "setup.owner_required" });

// The Cloud fixture's own start and Check name no holder, so they renew nothing.
async function heldCloudWait(holder = "A") {
  const f = await cloudFixture();
  expect((await f.service.cloudStatus(holder)).state).toBe("approved");
  return f;
}

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

async function discard(
  f: {
    workspace: { abandon(id: string): Promise<{ recordedAt: string }> };
    service: ReturnType<typeof recovery>;
    options: Parameters<typeof recovery>[0];
    roots: { venueDir: string; stateDir: string };
  },
  recoveryId: string,
) {
  const { recordedAt } = await f.workspace.abandon(recoveryId);
  await f.options.host.coordinator.run(() => f.service.discardInTurn(recoveryId, recordedAt));
  await emptyAbandonedBackupRecovery(f.roots, recoveryId);
  return recordedAt;
}

const discardedAt = (at: string) =>
  expect.objectContaining({ code: "setup.recovery_discarded", params: { discardedAt: at } });

async function tree(roots: { venueDir: string; stateDir: string }) {
  const found: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        found[path] = "directory";
        await walk(path);
      } else
        found[path] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
    }
  };
  for (const directory of new Set([roots.stateDir, roots.venueDir])) await walk(directory);
  return found;
}

it("refuses a late step from a discarded recovery in the same process, with when it was discarded", async () => {
  const f = await preparedSession();
  const at = await discard(f, f.session.recoveryId);
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(discardedAt(at));
});

it("refuses a late step from a discarded recovery after a restart, with when it was discarded", async () => {
  const f = await preparedSession();
  const at = await discard(f, f.session.recoveryId);
  await f.service.dispose();
  const restarted = recovery(f.options);
  await expect(
    restarted.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(discardedAt(at));
  expect(() => restarted.renew(f.session.sessionId)).toThrow(discardedAt(at));
  expect(() => restarted.cloudRenew("A")).toThrow(refused);
});

it("still tells a discarded recovery's tab when it was discarded after a fence sealed its session first", async () => {
  const f = await preparedSession();
  clock.advance(LEASE + 1);
  f.service.sealLapsed();
  const at = await discard(f, f.session.recoveryId);
  expect(() => f.service.renew(f.session.sessionId)).toThrow(discardedAt(at));
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(discardedAt(at));
  await expect(f.service.close(f.session.sessionId)).rejects.toEqual(discardedAt(at));
});

it("tells a new recovery's tab whose session a second tab took that the owner is needed, not that it was discarded, before and after a restart", async () => {
  const f = await preparedSession();
  const at = await discard(f, f.session.recoveryId);
  const second = await f.service.open(f.request, client);
  const third = await f.service.open(f.request, client);
  expect(third.recoveryId).not.toBe(second.recoveryId);
  expect(() => f.service.renew(second.sessionId)).toThrow(refused);
  await expect(
    f.service.prepare(second.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(refused);
  await expect(f.service.close(second.sessionId)).rejects.toEqual(refused);
  expect(() => f.service.renew(f.session.sessionId)).toThrow(discardedAt(at));
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(discardedAt(at));
  await expect(f.service.close(f.session.sessionId)).rejects.toEqual(discardedAt(at));
  f.service.renew(third.sessionId);
  await f.service.dispose();
  const restarted = recovery(f.options);
  await expect(
    restarted.prepare(second.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(refused);
  expect(() => restarted.renew(second.sessionId)).toThrow(refused);
  await expect(restarted.close(second.sessionId)).rejects.toEqual(refused);
  await expect(
    restarted.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(discardedAt(at));
  expect(() => restarted.renew(f.session.sessionId)).toThrow(discardedAt(at));
  await expect(restarted.close(f.session.sessionId)).rejects.toEqual(discardedAt(at));
});

it("tells a new recovery's tab whose session a fence sealed that the owner is needed, not that it was discarded, before and after a restart", async () => {
  const f = await preparedSession();
  const at = await discard(f, f.session.recoveryId);
  const second = await f.service.open(f.request, client);
  clock.advance(LEASE + 1);
  f.service.sealLapsed();
  await expect(
    f.service.prepare(second.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(refused);
  expect(() => f.service.renew(second.sessionId)).toThrow(refused);
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(discardedAt(at));
  await f.service.dispose();
  const restarted = recovery(f.options);
  await expect(
    restarted.prepare(second.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(refused);
  await expect(
    restarted.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(discardedAt(at));
});

it("tells the holder of a Cloud wait started after a discard that the owner is needed after a restart, not that it was discarded", async () => {
  const f = await closedCloudSession();
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  clock.advance(LEASE + 1);
  f.service.sealLapsed();
  const at = await discard(f, f.session.recoveryId);
  expect((await f.service.cloudStart("C")).state).toBe("awaiting_owner");
  f.service.cloudRenew("C");
  expect(() => f.service.cloudRenew("A")).toThrow(discardedAt(at));
  await f.service.dispose();
  const restarted = recovery(f.options);
  await restarted.status();
  expect(() => restarted.cloudRenew("C")).toThrow(refused);
  expect(() => restarted.cloudRenew("A")).toThrow(refused);
});

it("makes a fresh open in flight lose when the recovery another tab opened is discarded meanwhile", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const first = await service.open(f.request, client);
  const gate = barrier();
  const reached = barrier();
  const real = vi.mocked(sources.openFirstSetupBackupSource).getMockImplementation()!;
  vi.mocked(sources.openFirstSetupBackupSource).mockImplementationOnce(async (...args) => {
    reached.resolve();
    await gate.promise;
    return real(...args);
  });
  const opening = service.open(f.request, client);
  opening.catch(() => {});
  await reached.promise;
  try {
    await service.prepare(first.sessionId, { action: "clock-challenge" }, client);
    expect((await f.workspace.read()).at(-1)!.target.recoveryId).toBe(first.recoveryId);
    await discard({ ...f, service }, first.recoveryId);
  } finally {
    gate.resolve();
  }
  await expect(opening).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(service.runningInMemory()).toBe(false);
});

it("makes a resume in flight when the recovery is discarded lose", async () => {
  const f = await selectedRepair();
  vi.mocked(stateSecrets.unpackBundleToDir).mockRejectedValueOnce(new Error("interrupted secrets"));
  await expect(f.service.commit(f.session.sessionId, f.selected.input, client)).rejects.toThrow(
    "interrupted secrets",
  );
  await f.service.dispose();
  const restarted = recovery(f.options);
  const gate = barrier();
  const reached = barrier();
  const real = vi.mocked(sources.authenticatedFirstSetupBackupPreview).getMockImplementation();
  const actual = await vi.importActual<typeof sources>("./first-setup-backup-source.js");
  vi.mocked(sources.authenticatedFirstSetupBackupPreview).mockImplementationOnce(
    async (...args) => {
      reached.resolve();
      await gate.promise;
      return (real ?? actual.authenticatedFirstSetupBackupPreview)(...args);
    },
  );
  const resuming = restarted.resume(
    {
      observation: f.request.observation,
      recoveryId: f.session.recoveryId,
      nodeRecoverySecret: f.request.nodeRecoverySecret,
      context: { oldBoxGone: true, soleRecovery: true },
    },
    client,
  );
  resuming.catch(() => {});
  await reached.promise;
  const at = await discard({ ...f, service: restarted }, f.session.recoveryId).finally(
    gate.resolve,
  );
  await expect(resuming).rejects.toEqual(discardedAt(at));
  expect(restarted.runningInMemory()).toBe(false);
});

it("lets nothing A sends revive a discarded recovery, and leaves the folders as they were", async () => {
  const f = await preparedSession();
  const at = await discard(f, f.session.recoveryId);
  const before = await tree(f.roots);
  await expect(f.service.commit(f.session.sessionId, {}, client)).rejects.toEqual(discardedAt(at));
  expect(() => f.service.renew(f.session.sessionId)).toThrow(discardedAt(at));
  await expect(f.service.close(f.session.sessionId)).rejects.toEqual(discardedAt(at));
  await expect(
    f.service.open({ ...f.request, recoveryId: f.session.recoveryId }, client),
  ).rejects.toEqual(discardedAt(at));
  await expect(
    f.service.resume(
      {
        observation: f.request.observation,
        recoveryId: f.session.recoveryId,
        nodeRecoverySecret: f.request.nodeRecoverySecret,
        context: { oldBoxGone: true, soleRecovery: true },
      },
      client,
    ),
  ).rejects.toEqual(discardedAt(at));
  expect(await tree(f.roots)).toEqual(before);
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toBeNull();
});

it("makes a reopen in flight when the recovery is discarded lose", async () => {
  const f = await preparedSession();
  await f.service.close(f.session.sessionId);
  const gate = barrier();
  const reached = barrier();
  const real = vi.mocked(sources.openFirstSetupBackupSource).getMockImplementation()!;
  vi.mocked(sources.openFirstSetupBackupSource).mockImplementationOnce(async (...args) => {
    reached.resolve();
    await gate.promise;
    return real(...args);
  });
  const reopening = f.service.open({ ...f.request, recoveryId: f.session.recoveryId }, client);
  reopening.catch(() => {});
  await reached.promise;
  const at = await discard(f, f.session.recoveryId).finally(gate.resolve);
  await expect(reopening).rejects.toEqual(discardedAt(at));
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toBeNull();
});

it("starts a new Cloud recovery after a stopped one is discarded in the same service, writing nothing under the tombstone", async () => {
  const f = await closedCloudSession();
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  clock.advance(LEASE + 1);
  f.service.sealLapsed();
  expect(f.service.runningInMemory()).toBe(false);
  const at = await discard(f, f.session.recoveryId);
  const tombstone = join(f.roots.stateDir, "first-setup-resolutions", "backup-recovery");
  const before = await tree({ stateDir: tombstone, venueDir: tombstone });
  expect(() => f.service.cloudRenew("A")).toThrow(discardedAt(at));
  const answer = await f.service.cloudStart("C");
  expect(answer.state).toBe("awaiting_owner");
  expect(answer.requestId).not.toBe(f.approved.requestId);
  expect(f.service.runningInMemory()).toBe(true);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  f.service.cloudRenew("C");
  expect(() => f.service.cloudRenew("A")).toThrow(discardedAt(at));
  expect(() => f.service.cloudRenew("Z")).toThrow(refused);
  expect(await tree({ stateDir: tombstone, venueDir: tombstone })).toEqual(before);
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(true);
  expect((await f.service.cloudStatus("A")).state).toBe("approved");
  f.service.cloudRenew("A");
  clock.advance(LEASE + 1);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

it.each(["A", "C"])(
  "tells holder %s of a new Cloud recovery's wait that the owner is needed after it releases, not that the old one was discarded",
  async (holder) => {
    const f = await closedCloudSession();
    expect((await f.service.cloudStatus("A")).state).toBe("approved");
    clock.advance(LEASE + 1);
    f.service.sealLapsed();
    const at = await discard(f, f.session.recoveryId);
    expect(() => f.service.cloudRenew("A")).toThrow(discardedAt(at));
    expect((await f.service.cloudStart(holder)).state).toBe("awaiting_owner");
    f.service.cloudRenew(holder);
    f.service.cloudRelease(holder);
    expect(() => f.service.cloudRenew(holder)).toThrow(refused);
  },
);

it("answers owner-required for an unknown session once a new recovery is under way beside the tombstone", async () => {
  const f = await preparedSession();
  const at = await discard(f, f.session.recoveryId);
  expect(() => f.service.renew("unknown")).toThrow(refused);
  expect(() => f.service.renew(f.session.sessionId)).toThrow(discardedAt(at));
  const second = await f.service.open(f.request, client);
  await f.service.prepare(second.sessionId, { action: "clock-challenge" }, client);
  expect(second.recoveryId).not.toBe(f.session.recoveryId);
  expect(() => f.service.renew("unknown")).toThrow(refused);
  await expect(f.service.close("unknown")).rejects.toEqual(refused);
  f.service.renew(second.sessionId);
});

it("refuses a second prepare once its journal is abandoned under the live session", async () => {
  const f = await preparedSession();
  const { recordedAt } = await f.workspace.abandon(f.session.recoveryId);
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toEqual(discardedAt(recordedAt));
});

it("answers owner-required for an unknown session when nothing was discarded", async () => {
  const f = await preparedSession();
  await expect(f.service.prepare("unknown", { action: "clock-challenge" }, client)).rejects.toEqual(
    refused,
  );
  expect(() => f.service.renew("unknown")).toThrow(refused);
  await expect(f.service.close("unknown")).rejects.toEqual(refused);
  await expect(f.service.commit("unknown", {}, client)).rejects.toEqual(refused);
});

const sockets: TLSSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

function tls() {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket } };
}

it("a commit held 6 minutes with no renewal closes the repair page's fence, and then reaches selected", async () => {
  const f = await heldCloudCommit();
  const takeBack = advanceMonotonic(6 * 60_000);
  const app = new Hono();
  mountFirstSetupResolutionFence(app, f.service, () => {});
  mountFirstSetupBackupApi(app, f.service, () => {});
  mountFirstSetupResolutionApi(app, f.options.host, () => {});
  let passwordStep: Promise<Response> | undefined;
  try {
    const attempt = join(f.roots.stateDir, "first-setup.json");
    const before = await readFile(attempt);
    const inspected = await f.options.host.resolution.inspectFirstSetupResolution();
    // Not awaited: a step let through would queue behind A's held turn, so it is raced instead.
    passwordStep = Promise.resolve(
      app.request(
        "https://box.test/setup-api/first-setup/resolution/recover",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inspectionId: inspected.inspectionId,
            revision: inspected.revision,
            ownerGeneration: inspected.ownerGeneration,
            clientClaimNonce: randomBytes(32).toString("base64url"),
            password: PASSWORD,
          }),
        },
        tls(),
      ),
    );
    let timer: NodeJS.Timeout | undefined;
    const settled = await Promise.race([
      passwordStep,
      new Promise<"still waiting">((resolve) => {
        timer = setTimeout(() => resolve("still waiting"), 2_000);
      }),
    ]).finally(() => clearTimeout(timer));
    if (settled === "still waiting") expect.fail("B's password step was still waiting after 2 s");
    expect(settled.status).toBe(409);
    expect(await settled.json()).toMatchObject({ error: { code: "setup.recovery_in_progress" } });
    expect(await readFile(attempt)).toEqual(before);
    expect(f.service.runningInMemory()).toBe(true);
  } finally {
    takeBack();
    f.gate.resolve();
    await passwordStep?.catch(() => {});
  }
  await f.commit;
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it("answers a discarded recovery's late step through the route as 409, with when it was discarded", async () => {
  const f = await preparedSession();
  const at = await discard(f, f.session.recoveryId);
  const app = new Hono();
  mountFirstSetupBackupApi(app, f.service, () => {});
  const late = await app.request(
    "https://box.test/setup-api/first-setup/resolution/backup/prepare",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: f.session.sessionId,
        proposal: { action: "clock-challenge" },
      }),
    },
    tls(),
  );
  expect(late.status).toBe(409);
  expect(await late.json()).toEqual({
    error: { code: "setup.recovery_discarded", params: { discardedAt: at } },
  });
});
