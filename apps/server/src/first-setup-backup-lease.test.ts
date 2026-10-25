import { clock } from "../test/hour-recovery-host.js";

import { randomBytes } from "node:crypto";
import { access, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect, it, vi } from "vitest";

import * as restore from "./restore.js";
import * as sources from "./first-setup-backup-source.js";
import {
  recovery,
  barrier,
  fixture,
  selectedRepair,
} from "../test/first-setup-backup-recovery-fixture.js";
import { selectedRepair as cloudSelectedRepair } from "../test/first-setup-backup-cloud-fixture.js";
import { PASSWORD } from "../test/first-fiscal.js";

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
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
});

it("fails a session whose attempt changed under it, refusing its steps and renewals", async () => {
  const f = await preparedSession();
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await f.service.liveness()).toMatchObject({ state: "stopped", failed: true });
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
  await expect(
    f.service.prepare(f.session.sessionId, { action: "clock-challenge" }, client),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
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

// The selected name's second clock goes stale over 6 monotonic minutes and refuses the placement
// (second_clock_missing); the point here is the lease, so the hold's minutes are taken back before
// the commit goes on.
function advanceMonotonic(ms: number) {
  const now = performance.now.bind(performance);
  const spy = vi.spyOn(performance, "now").mockImplementation(() => now() + ms);
  return () => spy.mockRestore();
}

async function heldCloudCommit() {
  const f = await cloudSelectedRepair();
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
