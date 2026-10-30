import { createHash, randomBytes } from "node:crypto";

import { existsSync } from "node:fs";

import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";

import { Socket } from "node:net";

import { TLSSocket } from "node:tls";

import { dirname, join } from "node:path";

import { Hono } from "hono";

import { afterEach, expect, it, vi } from "vitest";

import { AppError } from "@waitron/shared";

import { lockVenueDatabase } from "@waitron/db";

import {
  START_AGAIN_CONFIRMATIONS_DIR,
  isEmptiedTombstone,
  readStartAgainMarker,
  type StartAgainSummary,
} from "@waitron/provisioning";

import { clock } from "../test/hour-recovery-host.js";

import {
  preparedRepair,
  recovery,
  repairFixture,
  selectedRepair,
} from "../test/first-setup-backup-recovery-fixture.js";

import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";

import { PASSWORD } from "../test/first-fiscal.js";

import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";

import { mountFirstSetupResolutionApi } from "./setup-first-fiscal-api.js";

import "./setup-first-backup-api.js";

import "./first-setup-backup-source.js";

import * as backupEntry from "./first-setup-backup-entry.js";

import "./restore.js";

import * as provisioning from "@waitron/provisioning";

import { resolveFirstSetupEntry } from "./first-setup-entry.js";

import { holdVenueElsewhere } from "./testing/venue-held-elsewhere.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

vi.mock("./first-setup-backup-entry.js", { spy: true });

vi.mock("./restore.js", { spy: true });

vi.mock("@waitron/provisioning", { spy: true });

const client = { onBox: false };

const sockets: TLSSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

function tls() {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket } };
}

async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let names: string[];
  try {
    names = await readdir(join(dir, prefix));
  } catch {
    return result;
  }
  for (const name of names.sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    // The anchor's own lock pair is rewritten by every exclusive turn; a nested lock is compared.
    if (prefix === "" && /^venue\.(lock|holder)/.test(name)) continue;
    if ((await lstat(join(dir, relative))).isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await tree(dir, relative));
    } else
      result[relative] = createHash("sha256")
        .update(await readFile(join(dir, relative)))
        .digest("hex");
  }
  return result;
}

async function expectNothingWritten(
  f: { roots: Roots },
  before: { venue: Record<string, string>; state: Record<string, string> },
) {
  expect({ venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) }).toEqual(
    before,
  );
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  await expect(
    access(join(f.roots.stateDir, "first-setup-start-again-confirmations")),
  ).rejects.toMatchObject({ code: "ENOENT" });
}

// A discarded recovery's folder keeps its records and its target's lock files, nothing else.
const KEPT =
  /^(\d{6}\.json|target\/|target\/(venue|state)\/|target\/(venue|state)\/((venue|migrations|recovery)\.lock(-journal)?|venue\.holder\.json))$/;

async function confirmations(stateDir: string) {
  const folder = join(stateDir, START_AGAIN_CONFIRMATIONS_DIR);
  return Promise.all(
    (await readdir(folder)).map(
      async (name) => JSON.parse(await readFile(join(folder, name), "utf8")) as { shown: unknown },
    ),
  );
}

async function expectDiscarded(
  f: Pick<Repair, "roots" | "record" | "session" | "workspace">,
  expected: { shown: StartAgainSummary; lock: { ino: number } },
) {
  expect((await f.workspace.read()).at(-1)).toMatchObject({
    phase: "abandoned",
    target: { recoveryId: f.session.recoveryId },
  });
  expect((await lstat(join(f.record.target.target.venueDir, "venue.lock"))).ino).toBe(
    expected.lock.ino,
  );
  const left = Object.keys(await tree(dirname(dirname(f.record.target.target.stateDir))));
  expect(left.some((name) => /^\d{6}\.json$/.test(name))).toBe(true);
  expect(left.filter((name) => !KEPT.test(name))).toEqual([]);
  await expect(access(join(f.roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  expect(expected.shown.recovery).toBeDefined();
  expect((await confirmations(f.roots.stateDir)).map(({ shown }) => shown)).toEqual([
    expected.shown,
  ]);
}

type Service = Awaited<ReturnType<typeof selectedRepair>>["service"];

type Host = Awaited<ReturnType<typeof selectedRepair>>["host"];

type Roots = Awaited<ReturnType<typeof selectedRepair>>["roots"];

async function signedIn(host: Host, recovered?: Response) {
  const answer = (
    recovered === undefined
      ? await (async () => {
          const inspected = await host.resolution.inspectFirstSetupResolution();
          return host.owner.recoverFirstSetupOwner({
            inspectionId: inspected.inspectionId,
            revision: inspected.revision!,
            ownerGeneration: inspected.ownerGeneration!,
            clientClaimNonce: randomBytes(32).toString("base64url"),
            password: PASSWORD,
          });
        })()
      : await recovered.json()
  ) as {
    state: { attemptId: string; revision: number; ownerGeneration: number };
    capability: string;
  };
  const current = await host.resolution.inspectFirstSetupResolution();
  return {
    owner: {
      attemptId: answer.state.attemptId,
      revision: answer.state.revision,
      ownerGeneration: answer.state.ownerGeneration,
      capability: answer.capability,
    },
    ids: {
      inspectionId: current.inspectionId,
      revision: current.revision!,
      ownerGeneration: current.ownerGeneration!,
    },
  };
}

type Repair = Awaited<ReturnType<typeof preparedRepair>>;

async function startAgainOver(
  f: Pick<Repair, "host" | "roots">,
  backupRecovery: Service,
  recovered?: Response,
) {
  const { owner, ids } = await signedIn(f.host, recovered);
  const actions = createFirstSetupResolutionActions({ ...f.roots, host: f.host, backupRecovery });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  return {
    shown,
    owner,
    ids,
    actions,
    run: (confirmed: StartAgainSummary = shown) =>
      actions.startAgainFirstSetup({
        ...ids,
        owner,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown: confirmed },
      }),
  };
}

it("a summary read before the recovery stopped, naming no recovery, refuses Start again setup.attempt_conflict, and nothing is written", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const startAgain = await startAgainOver(f, f.service);
  const { recovery: shownRecovery, ...earlier } = startAgain.shown;
  expect(shownRecovery).toBeDefined();
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(startAgain.run(earlier)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expectNothingWritten(f, before);
});

it("an abandoned journal whose emptying was refused is finished by the next Start again, with no second confirmation", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const planted = join(f.record.target.target.stateDir, "planted");
  await symlink("/nonexistent", planted);
  const first = await startAgainOver(f, f.service);
  await expect(first.run()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
  await access(join(f.roots.stateDir, "first-setup.json"));
  await unlink(planted);
  const second = await startAgainOver(f, f.service);
  expect(second.shown).not.toHaveProperty("recovery");
  await expect(second.run()).resolves.toBeUndefined();
  await expectDiscarded(f, { shown: first.shown, lock });
});

it("after Start again discards a recovery, the backup entry answers absent and the box answers fresh setup", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  await (await startAgainOver(f, f.service)).run();
  expect(await backupEntry.resolveFirstSetupBackupEntry(f.roots)).toEqual({ kind: "absent" });
  const entry = await resolveFirstSetupEntry(f.roots, { WAITRON_ENV: "preproduction" });
  expect(entry.kind).toBe("normal");
});

it("an open started while Start again runs its checks refuses it setup.recovery_in_progress before anything is written, and the open resumes the recovery", async () => {
  // Signed in before the recovery opened, so the recovery's own resume stays valid.
  const f = await repairFixture();
  const { owner } = await signedIn(f.host);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const request = {
    ...f.request,
    observation: {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    },
  };
  const service = recovery(f.options);
  const session = await service.open(request, client);
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, onBox) => service.prepare(session.sessionId, proposal, onBox) },
    client,
  )) as { status: string };
  expect(selected.status).toBe("selected");
  await service.close(session.sessionId);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  let opening: Promise<unknown> | undefined;
  const capture = f.host.resolution.captureFirstSetupOriginals;
  const resolution = {
    ...f.host.resolution,
    captureFirstSetupOriginals: () => {
      // The open counts as running from its call, before it reaches the turn Start again holds.
      opening ??= service.open({ ...request, recoveryId: session.recoveryId }, client).then(
        (resumed) => resumed,
        (error: unknown) => error,
      );
      return capture();
    },
  };
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: { ...f.host, resolution },
    backupRecovery: service,
  });
  const shown = await createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: service,
  }).startAgainSummary({ ...ids, owner });
  expect(shown.recovery).toBeDefined();
  const last = (await f.workspace.readChain()).at(-1)!;
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
    }),
  ).rejects.toMatchObject({ code: "setup.recovery_in_progress" });
  expect(opening).toBeDefined();
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
  await access(join(f.roots.stateDir, "first-setup.json"));
  await expect(access(join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
  expect(await opening).toMatchObject({ recoveryId: session.recoveryId });
});

it("an open started while Start again writes its confirmation record refuses it setup.recovery_in_progress before the seal, and the recovery is neither sealed nor abandoned", async () => {
  const f = await repairFixture();
  const { owner } = await signedIn(f.host);
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const request = {
    ...f.request,
    observation: {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision,
      ownerGeneration: inspected.ownerGeneration,
    },
  };
  const service = recovery(f.options);
  const session = await service.open(request, client);
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, onBox) => service.prepare(session.sessionId, proposal, onBox) },
    client,
  )) as { status: string };
  expect(selected.status).toBe("selected");
  await service.close(session.sessionId);
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: service,
  });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  expect(shown.recovery).toBeDefined();
  const last = (await f.workspace.readChain()).at(-1)!;
  const sealed = vi.spyOn(service, "sealLapsed");
  const discarded = vi.spyOn(service, "discardInTurn");
  let opening: Promise<unknown> | undefined;
  const real = vi.mocked(provisioning.writeStartAgainConfirmation).getMockImplementation();
  const actual = await vi.importActual<typeof provisioning>("@waitron/provisioning");
  vi.mocked(provisioning.writeStartAgainConfirmation).mockImplementationOnce(async (...args) => {
    sealed.mockClear();
    opening ??= service.open({ ...request, recoveryId: session.recoveryId }, client).then(
      (resumed) => resumed,
      (error: unknown) => error,
    );
    return (real ?? actual.writeStartAgainConfirmation)(...args);
  });
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
    }),
  ).rejects.toMatchObject({ code: "setup.recovery_in_progress" });
  expect(opening).toBeDefined();
  await opening;
  expect(sealed).not.toHaveBeenCalled();
  expect(discarded).not.toHaveBeenCalled();
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
  await access(join(f.roots.stateDir, "first-setup.json"));
});

async function nextStart(f: Pick<Repair, "roots" | "options">) {
  const restarted = recovery(f.options);
  vi.mocked(backupEntry.firstSetupBackupRecoveryFor).mockReturnValue(restarted);
  const lines: { event: string; fields: Record<string, unknown> | undefined }[] = [];
  const entry = await resolveFirstSetupEntry(
    f.roots,
    { WAITRON_ENV: "preproduction" },
    undefined,
    (_level, event, fields) => lines.push({ event, fields }),
  );
  if (entry.kind === "resolution") await entry.dispose();
  return { entry, restarted, lines };
}

const POWER_CUT = () => new Error("power cut");

// A cut Start again is followed by `clock.advance(1)`: a confirmation's file is named by its
// millisecond, and the next Start again writes another.

// A recovery that failed at placement-started, its target holding a venue database.
async function placementFailed() {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    const saved = await append(record);
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return saved;
  });
  await expect(f.service.commit(f.session.sessionId, f.selected.input, client)).rejects.toThrow();
  vi.mocked(f.workspace.append).mockRestore();
  await f.service.dispose();
  // The fixture's placement copies no database; a real one would leave one in the target.
  await writeFile(join(f.record.target.target.venueDir, "venue.db"), "placed");
  return { ...f, service: recovery(f.options) };
}

// Start again over a recovery, with the power cut at its discard, after the abandon.
async function cutAfterAbandon(f: Awaited<ReturnType<typeof placementFailed>>) {
  vi.spyOn(f.service, "discardInTurn").mockRejectedValue(POWER_CUT());
  await expect((await startAgainOver(f, f.service)).run()).rejects.toThrow("power cut");
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
  await f.service.dispose();
  clock.advance(1);
}

it("a power cut after the confirmation and before the abandon: the next start serves the repair page with the recovery stopped, and a second Start again finishes", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const first = await startAgainOver(f, f.service);
  // The first seal after the confirmation is written is the one just before the abandon.
  const seal = f.service.sealLapsed.bind(f.service);
  vi.spyOn(f.service, "sealLapsed").mockImplementation(() => {
    if (existsSync(join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR))) throw POWER_CUT();
    seal();
  });
  await expect(first.run()).rejects.toThrow("power cut");
  expect(await confirmations(f.roots.stateDir)).toHaveLength(1);
  await f.service.dispose();
  clock.advance(1);
  const { entry, restarted } = await nextStart(f);
  expect(entry.kind).toBe("resolution");
  expect((await f.workspace.readChain()).at(-1)!.phase).not.toBe("abandoned");
  const second = await startAgainOver(f, restarted);
  expect(second.shown.recovery).toBeDefined();
  await expect(second.run()).resolves.toBeUndefined();
  expect((await confirmations(f.roots.stateDir)).map(({ shown }) => shown)).toEqual(
    expect.arrayContaining([first.shown, second.shown]),
  );
  expect(await confirmations(f.roots.stateDir)).toHaveLength(2);
  expect((await lstat(join(f.record.target.target.venueDir, "venue.lock"))).ino).toBe(lock.ino);
  await expect(access(join(f.roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("a power cut after the abandon and before the emptying: the start empties the recovery before any request, and the ordinary ask's Start again deletes the attempt", async () => {
  const f = await placementFailed();
  await cutAfterAbandon(f);
  const { entry, restarted } = await nextStart(f);
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(true);
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(entry.kind).toBe("resolution");
  const second = await startAgainOver(f, restarted);
  expect(second.shown).not.toHaveProperty("recovery");
  await expect(second.run()).resolves.toBeUndefined();
  await expect(access(join(f.roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await confirmations(f.roots.stateDir)).toHaveLength(2);
});

it("a power cut during the attempt's deletion: the start finishes it beside the emptied recovery", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const { owner, ids } = await signedIn(f.host);
  let removed = 0;
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: f.service,
    remove: async (path, kind) => {
      if (removed++ === 1) throw POWER_CUT();
      await (kind === "file" ? unlink(path) : rmdir(path));
    },
  });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
    }),
  ).rejects.toMatchObject({ code: "setup.start_again_incomplete" });
  expect(removed).toBe(2);
  expect(await readStartAgainMarker(f.roots.venueDir)).not.toBeNull();
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(true);
  await f.service.dispose();
  const { entry } = await nextStart(f);
  expect(entry.kind).toBe("normal");
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  await expect(access(join(f.roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(true);
});

it("a file in the discarded recovery that cannot be deleted: Start again's refusal keeps the file system's errno in its log reason", async () => {
  const f = await placementFailed();
  const stuck = join(f.record.target.target.stateDir, "stuck");
  await mkdir(stuck);
  await writeFile(join(stuck, "leftover"), "leftover");
  await chmod(stuck, 0o500);
  try {
    const { run } = await startAgainOver(f, f.service);
    const error = await run().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "setup.start_again_incomplete" });
    const path = join(
      f.roots.stateDir,
      "first-setup-resolutions",
      "backup-recovery",
      f.session.recoveryId,
    );
    expect((error as AppError).reason).toBe(
      `emptying failed: unknown EACCES ${await realpath(path)}`,
    );
    await access(join(stuck, "leftover"));
  } finally {
    await chmod(stuck, 0o700);
    await f.service.dispose();
  }
});

it("a symlink in a discarded recovery at the start: the read-only check for an already emptied recovery refuses it, the repair page is served, the refusal is logged with its reason, and nothing is deleted", async () => {
  const f = await placementFailed();
  const outside = join(dirname(f.roots.stateDir), "outside");
  await writeFile(outside, "outside");
  await symlink(outside, join(f.record.target.target.stateDir, "planted"));
  await expect((await startAgainOver(f, f.service)).run()).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await f.service.dispose();
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  const { entry, lines } = await nextStart(f);
  expect(entry.kind).toBe("resolution");
  expect(lines).toContainEqual({
    event: "setup.recovery_cleanup_refused",
    fields: { reason: "setup.attempt_uncertain", path: expect.any(String) },
  });
  expect({ venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) }).toEqual(
    before,
  );
});

it("a second process holding the box's venue lock at the start: the recovery is not emptied, and the refusal names provisioning.database_in_use", async () => {
  const f = await placementFailed();
  await cutAfterAbandon(f);
  const holder = await holdVenueElsewhere(f.roots.venueDir);
  try {
    const { lines } = await nextStart(f);
    expect(lines).toContainEqual({
      event: "setup.recovery_cleanup_refused",
      fields: { reason: "provisioning.database_in_use", path: expect.any(String) },
    });
  } finally {
    await holder.stop();
  }
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(false);
  await access(join(f.record.target.target.venueDir, "venue.db"));
});

it("an abandoned recovery whose journal cannot be read at the start: the refusal is logged as unknown with the file system's errno and no path, and the start goes on", async () => {
  const f = await placementFailed();
  await cutAfterAbandon(f);
  const journal = join(
    f.roots.stateDir,
    "first-setup-resolutions",
    "backup-recovery",
    f.session.recoveryId,
  );
  await chmod(journal, 0o000);
  try {
    const { lines } = await nextStart(f);
    expect(lines).toContainEqual({
      event: "setup.recovery_cleanup_refused",
      fields: { reason: "unknown", errno: "EACCES" },
    });
  } finally {
    await chmod(journal, 0o700);
  }
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(false);
  await access(join(f.record.target.target.venueDir, "venue.db"));
});

it("a disk that fills after the abandon, before the target's lock: Start again answers 409 setup.start_again_incomplete and restarts the box, whose start empties the recovery, and a second Start again deletes the attempt", async () => {
  const f = await placementFailed();
  const targetVenue = await realpath(f.record.target.target.venueDir);
  const locked: string[] = [];
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: f.service,
    lock: async (dir) => {
      locked.push(dir);
      if (dir === targetVenue)
        throw Object.assign(new Error("unable to open database file"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 14,
        });
      return lockVenueDatabase(dir);
    },
  });
  const restarts = vi.fn();
  const lines: { event: string; fields: Record<string, unknown> | undefined }[] = [];
  const app = new Hono();
  mountFirstSetupResolutionApi(
    app,
    f.host,
    (_level, event, fields) => lines.push({ event, fields }),
    { startAgain: actions.startAgainFirstSetup, requestRestart: restarts },
  );
  const { owner, ids } = await signedIn(f.host);
  const shown = await actions.startAgainSummary({ ...ids, owner });
  expect(shown.recovery).toBeDefined();
  const response = await app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": owner.capability,
        "X-Waitron-Setup-Attempt": owner.attemptId,
        "X-Waitron-Setup-Revision": String(owner.revision),
        "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
      },
      body: JSON.stringify({
        ...ids,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      }),
    },
    tls(),
  );
  expect(response.status, await response.clone().text()).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "setup.start_again_incomplete", params: {} },
  });
  expect(locked).toHaveLength(2);
  expect(locked[1]).toBe(targetVenue);
  const path = join(
    f.roots.stateDir,
    "first-setup-resolutions",
    "backup-recovery",
    f.session.recoveryId,
  );
  expect(lines).toContainEqual({
    event: "setup.start_again_incomplete",
    fields: expect.objectContaining({
      logReason: `emptying failed: provisioning.database_unreachable ERR_SQLITE_ERROR errcode 14 ${await realpath(path)}`,
    }),
  });
  await vi.waitFor(() => expect(restarts).toHaveBeenCalledTimes(1));
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
  expect((await confirmations(f.roots.stateDir)).map(({ shown }) => shown)).toEqual([shown]);
  await access(join(f.record.target.target.venueDir, "venue.db"));
  await access(join(f.roots.stateDir, "first-setup.json"));
  await f.service.dispose();
  clock.advance(1);

  const { entry, restarted } = await nextStart(f);
  expect(entry.kind).toBe("resolution");
  expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(true);
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const second = await startAgainOver(f, restarted);
  expect(second.shown).not.toHaveProperty("recovery");
  await expect(second.run()).resolves.toBeUndefined();
  await expect(access(join(f.roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
