import { clock } from "../test/hour-recovery-host.js";

import { randomBytes } from "node:crypto";

import { access, readFile, readdir, writeFile } from "node:fs/promises";

import * as filesystem from "node:fs/promises";

import { dirname, join } from "node:path";

import "node:net";

import { TLSSocket } from "node:tls";

import "hono";

import { afterEach, expect, it, onTestFinished, vi } from "vitest";

import "@waitron/provisioning";

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

import { selectedRepair as cloudSelectedRepair } from "../test/first-setup-backup-cloud-fixture.js";

import { PASSWORD } from "../test/first-fiscal.js";

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

// The host fakes only Date and performance, so the session's real 15-minute expiry timer never
// fires within a test.
function expiryTimers() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const pending = new Map<unknown, { run: () => unknown; due: number }>();
  const setSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    run: () => unknown,
    ms?: number,
    ...rest: unknown[]
  ) => {
    const handle = realSetTimeout(run, ms, ...rest);
    if (ms === 15 * 60_000 + 1) pending.set(handle, { run, due: performance.now() + ms });
    return handle;
  }) as typeof setTimeout);
  const clearSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation((handle) => {
    pending.delete(handle);
    realClearTimeout(handle);
  });
  onTestFinished(() => {
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
  return async () => {
    for (const [handle, timer] of [...pending])
      if (timer.due <= performance.now()) {
        pending.delete(handle);
        realClearTimeout(handle as NodeJS.Timeout);
        await timer.run();
      }
  };
}

it("keeps a renewed session past 15 minutes, and drops it 15 minutes after its last renewal", async () => {
  const fireDue = expiryTimers();
  const f = await preparedSession();
  for (let elapsed = 0; elapsed < 16 * 60_000; elapsed += 30_000) {
    clock.advance(30_000);
    await fireDue();
    f.service.renew(f.session.sessionId);
  }
  expect(await f.service.liveness()).toMatchObject({ state: "running" });
  for (let elapsed = 0; elapsed < 15 * 60_000; elapsed += 60_000) {
    clock.advance(60_000);
    await fireDue();
  }
  expect(f.service.holdsInMemory()).toBe(true);
  expect(await f.service.liveness()).toMatchObject({ state: "stopped" });
  clock.advance(1);
  await fireDue();
  expect(f.service.holdsInMemory()).toBe(false);
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
});

it("drops an unrenewed session after 15 minutes, refuses a late renewal, and reads it as stopped", async () => {
  const fireDue = expiryTimers();
  const f = await preparedSession();
  clock.advance(15 * 60_000);
  await fireDue();
  expect(f.service.holdsInMemory()).toBe(true);
  clock.advance(1);
  await fireDue();
  expect(f.service.holdsInMemory()).toBe(false);
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

const sockets: TLSSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});
