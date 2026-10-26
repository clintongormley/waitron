import { clock } from "../test/hour-recovery-host.js";

import { createHash, randomBytes } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { dirname, join } from "node:path";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";

import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";

import { emptyAbandonedBackupRecovery, isEmptiedTombstone } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";

import * as restore from "./restore.js";
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
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
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

async function changeAttempt(f: Awaited<ReturnType<typeof preparedSession>>) {
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
}

async function corruptJournal(stateDir: string) {
  const directory = dirname(dirname(stateDir));
  for (const name of await readdir(directory))
    if (/^\d{6}\.json$/.test(name)) await writeFile(join(directory, name), "unreadable");
}

it("reads an open in flight as running", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  expect(service.runningInMemory()).toBe(false);
  expect(await service.liveness()).toBeNull();
  const gate = barrier();
  const real = vi.mocked(sources.openFirstSetupBackupSource).getMockImplementation()!;
  vi.mocked(sources.openFirstSetupBackupSource).mockImplementationOnce(async (...args) => {
    await gate.promise;
    return real(...args);
  });
  const opening = service.open(f.request, client);
  expect(service.runningInMemory()).toBe(true);
  expect(await service.liveness()).toMatchObject({ state: "running" });
  gate.resolve();
  await opening;
  expect(service.runningInMemory()).toBe(true);
});

it("keeps a renewed session running for 5 minutes, and stopped 1 ms later", async () => {
  const f = await preparedSession();
  clock.advance(4 * 60_000);
  const renewedAt = new Date(clock.wall()).toISOString();
  f.service.renew(f.session.sessionId);
  clock.advance(LEASE);
  expect(f.service.runningInMemory()).toBe(true);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  clock.advance(1);
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toEqual({
    state: "stopped",
    startedAt: expect.any(String),
    lastActiveSource: "memory",
    lastActiveAt: renewedAt,
    phase: "prepared",
    recoveryId: f.session.recoveryId,
    failed: false,
    cloud: false,
  });
});

it("revives a lapsed session that A renews before anyone seals it, and never after a seal", async () => {
  const f = await preparedSession();
  clock.advance(LEASE + 1);
  expect(await f.service.liveness()).toMatchObject({ state: "stopped" });
  f.service.renew(f.session.sessionId);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  clock.advance(LEASE + 1);
  const stopped = await f.service.liveness();
  expect(stopped).toMatchObject({ state: "stopped" });
  f.service.sealLapsed();
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toEqual(stopped);
});

async function reopenHeldAfterTakingSession() {
  const f = await preparedSession();
  await f.service.close(f.session.sessionId);
  const { lstat } = await vi.importActual<typeof filesystem>("node:fs/promises");
  const gate = barrier();
  const reached = barrier();
  vi.spyOn(filesystem, "lstat").mockImplementation(async (path, options) => {
    if (String(path).endsWith("/publication.json")) {
      reached.resolve();
      await gate.promise;
    }
    return lstat(path, options as never);
  });
  const reopening = f.service.open({ ...f.request, recoveryId: f.session.recoveryId }, client);
  reopening.catch(() => {});
  await reached.promise;
  return { ...f, reopening, release: gate.resolve };
}

it.each([1, 6])(
  "never seals a reopen still in flight %i minutes after it took the session",
  async (minutes) => {
    const f = await reopenHeldAfterTakingSession();
    clock.advance(minutes * 60_000);
    expect(f.service.runningInMemory()).toBe(true);
    f.service.sealLapsed();
    expect(f.service.runningInMemory()).toBe(true);
    f.release();
    const reopened = await f.reopening;
    f.service.renew(reopened.sessionId);
    await f.service.prepare(reopened.sessionId, { action: "clock-challenge" }, client);
  },
);

it("hands back a reopen held 6 minutes with a fresh lease, so a seal right after leaves it", async () => {
  const f = await reopenHeldAfterTakingSession();
  clock.advance(6 * 60_000);
  f.release();
  const reopened = await f.reopening;
  f.service.sealLapsed();
  f.service.renew(reopened.sessionId);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
});

it("hands back a resume held 6 minutes with a fresh lease, so a seal right after leaves it", async () => {
  const f = await selectedRepair();
  vi.mocked(stateSecrets.unpackBundleToDir).mockRejectedValueOnce(new Error("interrupted secrets"));
  await expect(f.service.commit(f.session.sessionId, f.selected.input, client)).rejects.toThrow(
    "interrupted secrets",
  );
  await f.service.dispose();
  const restarted = recovery(f.options);
  const inspect = f.workspace.inspect.bind(f.workspace);
  const gate = barrier();
  const reached = barrier();
  vi.spyOn(f.workspace, "inspect").mockImplementationOnce(async (recoveryId) => {
    reached.resolve();
    await gate.promise;
    return inspect(recoveryId);
  });
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
  clock.advance(6 * 60_000);
  gate.resolve();
  const resumed = await resuming;
  restarted.sealLapsed();
  restarted.renew(resumed.sessionId);
  expect(await restarted.liveness()).toMatchObject({ state: "running" });
});

it("reports an open's own times while it runs beside an older, lapsed session", async () => {
  const f = await preparedSession();
  clock.advance(LEASE + 1);
  const gate = barrier();
  const real = vi.mocked(sources.openFirstSetupBackupSource).getMockImplementation()!;
  vi.mocked(sources.openFirstSetupBackupSource).mockImplementationOnce(async (...args) => {
    await gate.promise;
    return real(...args);
  });
  const openedAt = new Date(clock.wall()).toISOString();
  const reopening = f.service.open({ ...f.request, recoveryId: f.session.recoveryId }, client);
  const running = await f.service.liveness();
  gate.resolve();
  await reopening;
  expect(running).toEqual({ state: "running", startedAt: openedAt, lastActiveAt: openedAt });
});

it("never extends the 15 unused minutes by renewing", async () => {
  const f = await preparedSession();
  for (let minute = 4; minute <= 12; minute += 4) {
    clock.advance(4 * 60_000);
    f.service.renew(f.session.sessionId);
  }
  clock.advance(3 * 60_000 + 1);
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
  expect(await f.service.liveness()).toMatchObject({ state: "stopped" });
});

it("keeps running after a commit refused for a mismatched input, and the corrected commit succeeds", async () => {
  const f = await selectedRepair();
  await expect(
    f.service.commit(f.session.sessionId, { mismatched: true }, client),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(f.service.runningInMemory()).toBe(true);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  f.service.renew(f.session.sessionId);
  await f.service.commit(f.session.sessionId, f.selected.input, client);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it("stops at once when a commit throws after placement-started, and refuses the next step", async () => {
  const f = await selectedRepair();
  vi.mocked(restore.writeValidated).mockRejectedValueOnce(new Error("placement interrupted"));
  await expect(f.service.commit(f.session.sessionId, f.selected.input, client)).rejects.toThrow(
    "placement interrupted",
  );
  expect(f.service.runningInMemory()).toBe(false);
  expect(await f.service.liveness()).toMatchObject({
    state: "stopped",
    phase: "placement-started",
    lastActiveSource: "memory",
    failed: true,
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, client),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
});

it("refuses a failed session's next step as owner-required when a seal deletes its copy mid-check", async () => {
  const f = await selectedRepair();
  const copy = (await vi.mocked(sources.openFirstSetupBackupSource).mock.results.at(-1)!.value) as {
    copy: { databasePath: string };
  };
  vi.mocked(restore.writeValidated).mockRejectedValueOnce(new Error("placement interrupted"));
  await expect(f.service.commit(f.session.sessionId, f.selected.input, client)).rejects.toThrow(
    "placement interrupted",
  );
  const resolution = f.host.resolution;
  const real = resolution.inspectFirstSetupResolution.bind(resolution);
  const gate = barrier();
  const reached = barrier();
  vi.spyOn(resolution, "inspectFirstSetupResolution").mockImplementationOnce(async () => {
    reached.resolve();
    await gate.promise;
    return real();
  });
  const next = f.service.commit(f.session.sessionId, f.selected.input, client);
  next.catch(() => {});
  await reached.promise;
  f.service.sealLapsed();
  await vi.waitFor(() => expect(access(copy.copy.databasePath)).rejects.toThrow());
  gate.resolve();
  const refusal = await next.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(refusal).toBeInstanceOf(AppError);
  expect(refusal).toMatchObject({ code: "setup.owner_required" });
});

it("fails a session whose attempt changed under it, refusing its steps and renewals", async () => {
  const f = await preparedSession();
  await changeAttempt(f);
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.service.liveness()).toMatchObject({
    state: "stopped",
    phase: "prepared",
    recoveryId: f.session.recoveryId,
    failed: true,
  });
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(f.service.runningInMemory()).toBe(false);
});

it("reads a damaged chain as no recovery, even once the attempt has changed", async () => {
  const f = await preparedSession();
  await changeAttempt(f);
  await f.service.close(f.session.sessionId);
  const first = join(dirname(dirname(f.records[0]!.target.target.stateDir)), "000001.json");
  const record = JSON.parse(await readFile(first, "utf8")) as Record<string, unknown>;
  await writeFile(first, JSON.stringify({ ...record, recordedAt: "2026-01-01T00:00:00.000Z" }));
  expect(await f.service.liveness()).toBeNull();
});

it("refuses a failed session's next step once the existing checks let it through", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  const interrupted = vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    const saved = await append(record);
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return saved;
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, client),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  interrupted.mockRestore();
  await f.service.dispose();
  const restarted = recovery(f.options);
  const reopened = await restarted.open({ ...f.request, recoveryId: f.session.recoveryId }, client);
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, onBox) => restarted.prepare(reopened.sessionId, proposal, onBox) },
    client,
  )) as { status: string; input: unknown };
  expect(selected.status).toBe("selected");
  vi.mocked(restore.writeValidated).mockRejectedValueOnce(new Error("placement interrupted"));
  await expect(restarted.commit(reopened.sessionId, selected.input, client)).rejects.toThrow(
    "placement interrupted",
  );
  expect(await restarted.liveness()).toMatchObject({ state: "stopped", failed: true });
  await expect(restarted.commit(reopened.sessionId, selected.input, client)).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it("reads a live session as running even when its journal has become unreadable", async () => {
  const f = await preparedSession();
  await corruptJournal(f.records[0]!.target.target.stateDir);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
});

it("reads an unreadable journal with no live session as no recovery, and status stays uncertain", async () => {
  const f = await preparedSession();
  await f.service.close(f.session.sessionId);
  await corruptJournal(f.records[0]!.target.target.stateDir);
  expect(await f.service.liveness()).toBeNull();
  expect(await f.service.status()).toEqual({ phase: "uncertain", proofRequired: true });
});

it("reads a discarded recovery as no recovery", async () => {
  const f = await preparedSession();
  await f.service.close(f.session.sessionId);
  await f.workspace.abandon(f.session.recoveryId);
  expect(await f.service.liveness()).toBeNull();
});

it("reads a recovery after a restart as stopped at its last saved step", async () => {
  const f = await preparedSession();
  await f.service.dispose();
  clock.advance(60_000);
  const restarted = recovery(f.options);
  const records = await f.workspace.read();
  expect(await restarted.liveness()).toEqual({
    state: "stopped",
    startedAt: records[0]!.recordedAt,
    lastActiveSource: "saved-step",
    lastActiveAt: records.at(-1)!.recordedAt,
    phase: "prepared",
    recoveryId: f.session.recoveryId,
    failed: false,
    cloud: false,
  });
});

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

it("reads a commit held for 6 minutes with no renewal as running, and never seals it", async () => {
  const f = await heldCloudCommit();
  const takeBack = advanceMonotonic(6 * 60_000);
  expect(f.service.runningInMemory()).toBe(true);
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  f.service.sealLapsed();
  expect(f.service.runningInMemory()).toBe(true);
  await access(f.databasePath);
  takeBack();
  f.gate.resolve();
  await f.commit;
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

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

it("answers Check on a sealed Cloud recovery from its own request, and leases nothing", async () => {
  const f = await cloudFixture();
  f.service.sealLapsed();
  const answer = await f.service.cloudStatus("A");
  expect(answer.state).toBe("approved");
  expect(answer.requestId).toBe(f.approved.requestId);
  expect(f.service.runningInMemory()).toBe(false);
  expect(() => f.service.cloudRenew("A")).toThrow(refused);
});

// What B's Start again does to A's stopped recovery: the record, the discard in memory, then the
// emptying.
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
