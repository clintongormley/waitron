import { createHash, randomBytes } from "node:crypto";
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
  emptyAbandonedBackupRecovery,
  isEmptiedTombstone,
  raiseStartAgainNote,
  readStartAgainMarker,
  readStartAgainNote,
  type StartAgainSummary,
} from "@waitron/provisioning";
import { encodeMinuteIdentity } from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { clock } from "../test/hour-recovery-host.js";
import {
  barrier,
  fixture,
  preparedRepair,
  recovery,
  repairFixture,
  selectedRepair,
} from "../test/first-setup-backup-recovery-fixture.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { PASSWORD } from "../test/first-fiscal.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import {
  mountFirstSetupResolutionApi,
  mountFirstSetupResolutionFence,
} from "./setup-first-fiscal-api.js";
import { mountFirstSetupBackupApi } from "./setup-first-backup-api.js";
import * as sources from "./first-setup-backup-source.js";
import * as backupEntry from "./first-setup-backup-entry.js";
import * as restore from "./restore.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { holdVenueElsewhere } from "./testing/venue-held-elsewhere.js";

vi.mock("./first-setup-backup-source.js", { spy: true });
vi.mock("./first-setup-backup-entry.js", { spy: true });
vi.mock("./restore.js", { spy: true });

const LEASE = 5 * 60_000;
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

async function confirmedStartAgain(
  f: Pick<Awaited<ReturnType<typeof selectedRepair>>, "host" | "roots">,
  backupRecovery: Service,
) {
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    capability: recovered.capability,
  };
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const actions = createFirstSetupResolutionActions({ ...f.roots, host: f.host, backupRecovery });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  return {
    shown,
    run: () =>
      actions.startAgainFirstSetup({
        ...ids,
        owner,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      }),
  };
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
  expect(await readStartAgainNote(f.roots.stateDir)).toBeNull();
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
  expected: { lastName: string; shown: StartAgainSummary; lock: { ino: number } },
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
  expect((await readStartAgainNote(f.roots.stateDir))?.lastName).toBe(expected.lastName);
  expect(expected.shown.recovery).toBeDefined();
  expect((await confirmations(f.roots.stateDir)).map(({ shown }) => shown)).toEqual([
    expected.shown,
  ]);
}

it("a backup recovery prepared and given up is discarded by Start again: the note holds its name, its lock stays", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const startAgain = await confirmedStartAgain(f, f.service);
  expect(startAgain.shown.lastName).not.toBe(f.selected.identity);
  await expect(startAgain.run()).resolves.toBeUndefined();
  await expectDiscarded(f, { lastName: f.selected.identity, shown: startAgain.shown, lock });
});

it("a recovery that failed at placement-started is discarded by Start again at once", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    const saved = await append(record);
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return saved;
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  vi.mocked(f.workspace.append).mockRestore();
  await f.service.dispose();
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
  await writeFile(join(f.record.target.target.venueDir, "venue.db"), "placed");
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const startAgain = await confirmedStartAgain(f, recovery(f.options));
  await expect(startAgain.run()).resolves.toBeUndefined();
  await expectDiscarded(f, { lastName: f.selected.identity, shown: startAgain.shown, lock });
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

type Service = Awaited<ReturnType<typeof selectedRepair>>["service"];
type Host = Awaited<ReturnType<typeof selectedRepair>>["host"];
type Roots = Awaited<ReturnType<typeof selectedRepair>>["roots"];

// The repair app's mounts, in resolutionApp's order, around a service the test drives as A.
function repairApp(f: { service: Service; host: Host; roots: Roots }) {
  const app = new Hono();
  mountFirstSetupResolutionFence(app, f.service, () => {});
  mountFirstSetupBackupApi(app, f.service, () => {});
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: f.service,
  });
  mountFirstSetupResolutionApi(app, f.host, () => {}, {
    startAgain: actions.startAgainFirstSetup,
    summary: actions.startAgainSummary,
  });
  return { app, actions };
}

async function passwordStep(app: Hono, host: Host) {
  const inspected = await host.resolution.inspectFirstSetupResolution();
  return app.request(
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
  );
}

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

const inProgress = (activity: { startedAt: string; lastActiveAt: string }) => ({
  error: {
    code: "setup.recovery_in_progress",
    params: { startedAt: activity.startedAt, lastActiveAt: activity.lastActiveAt },
  },
});

it("B's password step while A's recovery is leased answers 409, writes nothing, and A's next step succeeds", async () => {
  const f = await selectedRepair();
  const { app } = repairApp(f);
  const attempt = join(f.roots.stateDir, "first-setup.json");
  const before = await readFile(attempt);
  const activity = await f.service.liveness();
  expect(activity).toMatchObject({ state: "running" });
  const refused = await passwordStep(app, f.host);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual(inProgress(activity!));
  expect(await readFile(attempt)).toEqual(before);
  await f.service.commit(f.session.sessionId, f.selected.input, client);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it("once A's lease lapsed, B's password step seals A: A's renewal and step are refused, it stays stopped, and B's summary names it even though the attempt changed", async () => {
  const f = await selectedRepair();
  const { actions, app } = repairApp(f);
  clock.advance(LEASE + 1);
  const recovered = await passwordStep(app, f.host);
  expect(recovered.status, await recovered.clone().text()).toBe(200);
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, client),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(f.service.runningInMemory()).toBe(false);
  const stopped = await f.service.liveness();
  expect(stopped).toMatchObject({ state: "stopped", phase: "prepared" });
  const { owner, ids } = await signedIn(f.host, recovered);
  expect((await actions.startAgainSummary({ ...ids, owner })).recovery).toEqual({
    startedAt: stopped!.startedAt,
    lastActiveAt: stopped!.lastActiveAt,
    lastActiveSource: "memory",
    lastName: f.selected.identity,
    failed: false,
    cloud: false,
  });
});

it("B gets no summary and no Start again while A's lease is fresh, and nothing is written", async () => {
  const f = await selectedRepair();
  const { owner, ids } = await signedIn(f.host);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: f.service,
  });
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  const activity = (await f.service.liveness())!;
  expect(activity.state).toBe("running");
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toEqual(
    expect.objectContaining(inProgress(activity).error),
  );
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      confirmMissingDatabase: {
        nothingFiledOrSold: true,
        shown: { reached: "claimed", lastName: null },
      },
    }),
  ).rejects.toEqual(expect.objectContaining(inProgress(activity).error));
  await expectNothingWritten(f, before);
});

it("an open in flight closes the fence, and the attempt is unchanged", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const { app } = repairApp({ ...f, service });
  const gate = barrier();
  const real = vi.mocked(sources.openFirstSetupBackupSource).getMockImplementation()!;
  vi.mocked(sources.openFirstSetupBackupSource).mockImplementationOnce(async (...args) => {
    await gate.promise;
    return real(...args);
  });
  const opening = service.open(f.request, client);
  try {
    const attempt = join(f.roots.stateDir, "first-setup.json");
    const before = await readFile(attempt);
    const refused = await passwordStep(app, f.host);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "setup.recovery_in_progress" } });
    expect(await readFile(attempt)).toEqual(before);
  } finally {
    gate.resolve();
    await opening.catch(() => {});
  }
});

it("the fence lets the backup routes and every read through while A's recovery runs", async () => {
  const f = await selectedRepair();
  const { app } = repairApp(f);
  const inspection = await app.request(
    "https://box.test/setup-api/first-setup/resolution",
    {},
    tls(),
  );
  expect(inspection.status).toBe(200);
  const activity = await app.request(
    "https://box.test/setup-api/first-setup/resolution/backup/activity",
    {},
    tls(),
  );
  expect(await activity.json()).toMatchObject({ activity: { state: "running" } });
  const renewed = await app.request(
    "https://box.test/setup-api/first-setup/resolution/backup/renew",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: f.session.sessionId }),
    },
    tls(),
  );
  expect(renewed.status, await renewed.clone().text()).toBe(200);
  expect(await renewed.json()).toEqual({ renewed: true });
});

it("a stopped recovery is named in the summary with the name it chose", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  const attemptOnly = createFirstSetupResolutionActions({ ...f.roots, host: f.host });
  const stopped = (await f.service.liveness())!;
  expect(stopped.state).toBe("stopped");
  const plain = await attemptOnly.startAgainSummary({ ...ids, owner });
  expect(plain.lastName).not.toBe(f.selected.identity);
  expect(await actions.startAgainSummary({ ...ids, owner })).toEqual({
    ...plain,
    recovery: {
      startedAt: stopped.startedAt,
      lastActiveAt: stopped.lastActiveAt,
      lastActiveSource: "memory",
      lastName: f.selected.identity,
      failed: false,
      cloud: false,
    },
  });
});

it("a recovery that failed at placement-started is named as failed at once", async () => {
  const f = await selectedRepair();
  vi.mocked(restore.writeValidated).mockRejectedValueOnce(new Error("placement interrupted"));
  await expect(f.service.commit(f.session.sessionId, f.selected.input, client)).rejects.toThrow(
    "placement interrupted",
  );
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  expect((await actions.startAgainSummary({ ...ids, owner })).recovery).toEqual({
    startedAt: expect.any(String),
    lastActiveAt: expect.any(String),
    lastActiveSource: "memory",
    lastName: f.selected.identity,
    failed: true,
    cloud: false,
  });
});

type Repair = Awaited<ReturnType<typeof preparedRepair>>;
// The kept picks in the recovery's own copy, which the summary reads first.
async function removeTargetPicks(f: Pick<Repair, "record">) {
  await unlink(join(f.record.target.target.stateDir, "module-preparation-state.json")).catch(
    (error: unknown) => {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    },
  );
}

it("a stopped recovery whose own copy holds no picks is named from its journal's input", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  expect(f.record.input).toEqual(f.selected.input);
  await access(join(f.record.target.target.stateDir, "module-preparation-state.json"));
  await removeTargetPicks(f);
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  expect((await actions.startAgainSummary({ ...ids, owner })).recovery).toMatchObject({
    lastName: f.selected.identity,
  });
});

it.each([
  ["cannot be read", () => "unreadable"],
  [
    "hold an entry its module cannot read",
    (binding: unknown) =>
      JSON.stringify({
        version: 1,
        revisions: [{ binding, value: { version: 1, entries: [{}] } }],
      }),
  ],
])(
  "a stopped recovery whose own copy's picks %s is named from its journal's input",
  async (_name, picksOf) => {
    const f = await selectedRepair();
    await f.service.close(f.session.sessionId);
    await writeFile(
      join(f.record.target.target.stateDir, "module-preparation-state.json"),
      picksOf(f.record.binding),
    );
    const { owner, ids } = await signedIn(f.host);
    const { actions } = repairApp(f);
    expect((await actions.startAgainSummary({ ...ids, owner })).recovery).toMatchObject({
      lastName: f.selected.identity,
    });
  },
);

// Appends a later record of the same recovery, carrying `input`.
async function appendInput(f: Pick<Repair, "workspace" | "record">, input: unknown) {
  const { version, sequence, previousRecordDigest, recordedAt, ...last } = f.record;
  void version;
  void sequence;
  void previousRecordDigest;
  void recordedAt;
  await f.workspace.append({ ...last, input });
}

// The same recorded input, naming the minute `minutes` after its own.
function laterInput(input: unknown, minutes: number) {
  const later = structuredClone(input) as {
    allocation: {
      installationIdentity: string;
      issuedAt: string;
      series: { code: string; purpose: string }[];
    };
  };
  const ms = Date.parse(later.allocation.issuedAt) + minutes * 60_000;
  const identity = encodeMinuteIdentity(ms);
  later.allocation.series = later.allocation.series.map((series) => ({
    ...series,
    code: series.code.replace(later.allocation.installationIdentity, identity),
  }));
  later.allocation.installationIdentity = identity;
  later.allocation.issuedAt = new Date(ms).toISOString();
  return { input: later, identity };
}

it("a later name in a stopped recovery's journal wins over an older name in its own copy's picks", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  await access(join(f.record.target.target.stateDir, "module-preparation-state.json"));
  const later = laterInput(f.selected.input, 5);
  expect(later.identity).not.toBe(f.selected.identity);
  await appendInput(f, later.input);
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  expect((await actions.startAgainSummary({ ...ids, owner })).recovery).toMatchObject({
    lastName: later.identity,
  });
});

it("a stopped recovery that never chose a name, and whose copy holds no picks file, is named with no name", async () => {
  const f = await preparedRepair();
  expect(f.record).toMatchObject({ phase: "prepared", input: null });
  await f.service.close(f.session.sessionId);
  await removeTargetPicks(f);
  const stopped = (await f.service.liveness())!;
  expect(stopped.state).toBe("stopped");
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  expect((await actions.startAgainSummary({ ...ids, owner })).recovery).toEqual({
    startedAt: stopped.startedAt,
    lastActiveAt: stopped.lastActiveAt,
    lastActiveSource: "memory",
    lastName: null,
    failed: false,
    cloud: false,
  });
});

const PICKS_NAMING_NOTHING = (binding: unknown) =>
  JSON.stringify({ version: 1, revisions: [{ binding, value: { version: 1, entries: [] } }] });

it.each<[string, string, unknown, ((binding: unknown) => string) | null]>([
  ["named nothing", "cannot be read", null, () => "unreadable"],
  [
    // A valid minute name, one minute after the time the input says it was chosen.
    "recorded a name its own time disagrees with",
    "are missing",
    {
      allocation: {
        version: 1,
        allocationId: "hour/restore",
        taxpayerNif: "89890001K",
        softwareId: "W1",
        environment: "preproduction",
        installationIdentity: "0CNQV",
        series: [{ code: "A-0CNQV", purpose: "standard" }],
        source: "hour",
        reservationEvidence: null,
        issuedAt: "2026-10-16T12:42:00.000Z",
      },
      approval: {
        version: 1,
        eventId: "restore",
        sourceId: "archive",
        targetNodeId: "node",
        operatorId: { kind: "recovery-key", nodeId: "node", eventId: "restore" },
        oldMachineAbsent: false,
        oldMachineOffline: true,
        noParallelRecovery: true,
        confirmedAt: "2026-10-16T12:42:00.000Z",
        incidentEvidence: "hour/restore",
      },
    },
    null,
  ],
])(
  "a stopped recovery whose journal %s and whose copy's picks %s refuses the summary setup.not_ready, and nothing is written",
  async (_name, _picks, input, picksOf) => {
    const f = await preparedRepair();
    expect(f.record).toMatchObject({ phase: "prepared", input: null });
    await f.service.close(f.session.sessionId);
    if (input !== null) await appendInput(f, input);
    expect((await f.workspace.read()).at(-1)).toMatchObject({ phase: "prepared", input });
    await removeTargetPicks(f);
    if (picksOf !== null)
      await writeFile(
        join(f.record.target.target.stateDir, "module-preparation-state.json"),
        picksOf(f.record.binding),
      );
    expect((await f.service.liveness())?.state).toBe("stopped");
    const { owner, ids } = await signedIn(f.host);
    const { actions } = repairApp(f);
    const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
    await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    await expectNothingWritten(f, before);
  },
);

it("a stopped recovery whose module has no start-again seat refuses the summary setup.not_ready", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const { owner, ids } = await signedIn(f.host);
  const modules = f.host.modules.map((module) =>
    module.name === f.record.binding.module
      ? {
          ...module,
          provisioning: {
            ...module.provisioning,
            initialSetup: { ...module.provisioning!.initialSetup!, startAgainFloor: undefined },
          },
        }
      : module,
  );
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: { ...f.host, modules },
    backupRecovery: f.service,
  });
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("after a restart, a stopped recovery is named with its saved steps' times", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  await f.service.dispose();
  const restarted = recovery(f.options);
  const records = await f.workspace.read();
  const { owner, ids } = await signedIn(f.host);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: restarted,
  });
  expect((await actions.startAgainSummary({ ...ids, owner })).recovery).toEqual({
    startedAt: records[0]!.recordedAt,
    lastActiveAt: records.at(-1)!.recordedAt,
    lastActiveSource: "saved-step",
    lastName: f.selected.identity,
    failed: false,
    cloud: false,
  });
});

it("a recovery that failed after it was restored is named as failed", async () => {
  const f = await selectedRepair();
  vi.spyOn(f.workspace, "select").mockRejectedValueOnce(new Error("selection interrupted"));
  await expect(f.service.commit(f.session.sessionId, f.selected.input, client)).rejects.toThrow(
    "selection interrupted",
  );
  expect((await f.workspace.read()).at(-1)!.phase).toBe("restored");
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  expect((await actions.startAgainSummary({ ...ids, owner })).recovery).toEqual({
    startedAt: expect.any(String),
    lastActiveAt: expect.any(String),
    lastActiveSource: "memory",
    lastName: f.selected.identity,
    failed: true,
    cloud: false,
  });
});

it("a stopped recovery that is not the journal's latest refuses the summary setup.not_ready", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const { owner, ids } = await signedIn(f.host);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: {
      ...f.service,
      liveness: async () => ({ ...(await f.service.liveness())!, recoveryId: "another" }),
    },
  });
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a stopped recovery on a host that lists no modules refuses the summary setup.not_ready", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const { owner, ids } = await signedIn(f.host);
  const { modules, ...host } = f.host;
  expect(modules.length).toBeGreaterThan(0);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host,
    backupRecovery: f.service,
  });
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

const UNKNOWN_ROUTE = "https://box.test/setup-api/first-setup/resolution/no-such-route";

it.each([
  [
    "from another site",
    { Origin: "https://evil.test", "Content-Type": "text/plain" },
    403,
    { code: "setup.owner_required", params: {} },
  ],
  [
    "marked cross-site",
    { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
    403,
    { code: "setup.owner_required", params: {} },
  ],
  [
    "not sent as JSON",
    { "Content-Type": "text/plain" },
    400,
    { code: "setup.request_invalid", params: { field: "body" } },
  ],
])(
  "a POST %s is refused by the fence, uncached, and does not seal a lapsed recovery",
  async (_name, headers, status, error) => {
    const f = await selectedRepair();
    const { app } = repairApp(f);
    clock.advance(LEASE + 1);
    expect(f.service.runningInMemory()).toBe(false);
    const refused = await app.request(
      UNKNOWN_ROUTE,
      { method: "POST", headers, body: "{}" },
      tls(),
    );
    expect(refused.status).toBe(status);
    expect(refused.headers.get("Cache-Control")).toBe("no-store");
    expect(await refused.json()).toEqual({ error });
    expect(() => f.service.renew(f.session.sessionId)).not.toThrow();
  },
);

it("a same-site JSON POST seals a lapsed recovery, even on a route that does not exist", async () => {
  const f = await selectedRepair();
  const { app } = repairApp(f);
  clock.advance(LEASE + 1);
  const answered = await app.request(
    UNKNOWN_ROUTE,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    tls(),
  );
  expect(answered.status).toBe(404);
  expect(() => f.service.renew(f.session.sessionId)).toThrow(
    expect.objectContaining({ code: "setup.owner_required" }),
  );
});

it("the fence's refusal of a write while a recovery runs is not cached", async () => {
  const f = await selectedRepair();
  const { app } = repairApp(f);
  const refused = await passwordStep(app, f.host);
  expect(refused.status).toBe(409);
  expect(refused.headers.get("Cache-Control")).toBe("no-store");
});

it("after a discard, the summary names no recovery", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const { recordedAt } = await f.workspace.abandon(f.session.recoveryId);
  await f.host.coordinator.run(() => f.service.discardInTurn(f.session.recoveryId, recordedAt));
  await emptyAbandonedBackupRecovery(f.roots, f.session.recoveryId);
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  const attemptOnly = createFirstSetupResolutionActions({ ...f.roots, host: f.host });
  const summary = await actions.startAgainSummary({ ...ids, owner });
  expect(summary).not.toHaveProperty("recovery");
  expect(summary).toEqual(await attemptOnly.startAgainSummary({ ...ids, owner }));
});

it("a recovery already selected refuses the summary setup.not_ready", async () => {
  const f = await selectedRepair();
  await f.service.commit(f.session.sessionId, f.selected.input, client);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  clock.advance(LEASE + 1);
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a recovery whose journal cannot be read refuses the summary setup.not_ready", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const journal = dirname(dirname(f.record.target.target.stateDir));
  for (const name of await readdir(journal))
    if (/^\d{6}\.json$/.test(name)) await writeFile(join(journal, name), "unreadable");
  const { owner, ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("the box's repair app fences its writes and names a stopped recovery in its summary", async () => {
  const f = await selectedRepair();
  vi.mocked(backupEntry.firstSetupBackupRecoveryFor).mockReturnValue(f.service);
  const entry = await resolveFirstSetupEntry(f.roots, { WAITRON_ENV: "preproduction" });
  if (entry.kind !== "resolution") throw new Error("repair app missing");
  const refused = await passwordStep(entry.app, f.host);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: { code: "setup.recovery_in_progress" } });
  clock.advance(LEASE + 1);
  const recovered = await passwordStep(entry.app, f.host);
  expect(recovered.status, await recovered.clone().text()).toBe(200);
  const { owner, ids } = await signedIn(f.host, recovered);
  const summary = await entry.app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again/summary",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": owner.capability,
        "X-Waitron-Setup-Attempt": owner.attemptId,
        "X-Waitron-Setup-Revision": String(owner.revision),
        "X-Waitron-Setup-Generation": String(owner.ownerGeneration),
      },
      body: JSON.stringify(ids),
    },
    tls(),
  );
  expect(summary.status, await summary.clone().text()).toBe(200);
  expect(await summary.json()).toMatchObject({ recovery: { lastName: f.selected.identity } });
});

// B's confirmed Start again over a stopped recovery, through the actions the repair app mounts.
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

it("once A's lease lapsed, B's password step rewrites the attempt and B's Start again discards A", async () => {
  const f = await selectedRepair();
  const { app } = repairApp(f);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const attempt = await readFile(join(f.roots.stateDir, "first-setup.json"));
  clock.advance(LEASE + 1);
  const recovered = await passwordStep(app, f.host);
  expect(recovered.status, await recovered.clone().text()).toBe(200);
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).not.toEqual(attempt);
  const startAgain = await startAgainOver(f, f.service, recovered);
  await expect(startAgain.run()).resolves.toBeUndefined();
  await expectDiscarded(f, { lastName: f.selected.identity, shown: startAgain.shown, lock });
});

it("A's late step after B's Start again is refused setup.recovery_discarded, in the same process and after a restart", async () => {
  const f = await selectedRepair();
  clock.advance(LEASE + 1);
  const startAgain = await startAgainOver(f, f.service);
  await startAgain.run();
  const abandoned = (await f.workspace.read()).at(-1)!;
  expect(abandoned.phase).toBe("abandoned");
  const discarded = {
    code: "setup.recovery_discarded",
    params: { discardedAt: abandoned.recordedAt },
  };
  // A renewal reads no journal, so only what Start again told the service can answer it.
  expect(() => f.service.renew(f.session.sessionId)).toThrow(expect.objectContaining(discarded));
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, client),
  ).rejects.toMatchObject(discarded);
  await f.service.dispose();
  const restarted = recovery(f.options);
  await expect(
    restarted.commit(f.session.sessionId, f.selected.input, client),
  ).rejects.toMatchObject(discarded);
});

it("a stopped recovery beside trading.env: Start again refuses setup.not_ready, and nothing changes", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  await writeFile(join(f.roots.stateDir, "trading.env"), "WAITRON_ENV=production\n");
  const startAgain = await startAgainOver(f, f.service);
  const last = (await f.workspace.readChain()).at(-1)!;
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(startAgain.run()).rejects.toMatchObject({ code: "setup.not_ready" });
  await expectNothingWritten(f, before);
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
});

/** The inspection reads the venue database as present and empty. */
function databasePresent(host: Host): Host {
  const inspect = host.resolution.inspectFirstSetupResolution;
  return {
    ...host,
    resolution: {
      ...host.resolution,
      inspectFirstSetupResolution: async () => ({
        ...(await inspect()),
        database: "no-venue-rows" as const,
        emptyDatabase: true,
      }),
    },
  };
}

async function presentOver(f: Pick<Repair, "host" | "roots">, backupRecovery: Service) {
  const { owner, ids } = await signedIn(f.host);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: databasePresent(f.host),
    backupRecovery,
  });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  return {
    shown,
    owner,
    ids,
    actions,
    run: (confirmed: StartAgainSummary = shown) =>
      actions.startAgainFirstSetup({ ...ids, owner, confirmRecoveryDiscard: { shown: confirmed } }),
  };
}

it("with the database present, the password and the confirmed summary discard a stopped recovery, with a record of who chose it", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const startAgain = await presentOver(f, f.service);
  expect(startAgain.shown.recovery).toMatchObject({ lastName: f.selected.identity });
  await expect(startAgain.run()).resolves.toBeUndefined();
  await expectDiscarded(f, { lastName: f.selected.identity, shown: startAgain.shown, lock });
  const records = await confirmations(f.roots.stateDir);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    database: "present",
    administrator: { displayName: "Elena", email: "elena@example.test" },
  });
});

it("with the database present, a stopped recovery's Start again without the setup password is refused setup.owner_required, and nothing changes", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const startAgain = await presentOver(f, f.service);
  const last = (await f.workspace.readChain()).at(-1)!;
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(
    startAgain.actions.startAgainFirstSetup({
      ...startAgain.ids,
      confirmRecoveryDiscard: { shown: startAgain.shown },
    }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expectNothingWritten(f, before);
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
});

it.each([
  ["without confirmRecoveryDiscard", () => undefined],
  [
    "with a summary whose recovery was active at another time",
    (shown: StartAgainSummary) => ({
      shown: {
        ...shown,
        recovery: { ...shown.recovery!, lastActiveAt: shown.recovery!.startedAt },
      },
    }),
  ],
  [
    "with a summary that named no recovery",
    (shown: StartAgainSummary) => ({
      shown: Object.fromEntries(
        Object.entries(shown).filter(([key]) => key !== "recovery"),
      ) as StartAgainSummary,
    }),
  ],
] as const)(
  "with the database present, a stopped recovery's Start again %s is refused setup.attempt_conflict, and nothing changes",
  async (_label, confirm) => {
    const f = await selectedRepair();
    await f.service.close(f.session.sessionId);
    const startAgain = await presentOver(f, f.service);
    expect(startAgain.shown.recovery!.lastActiveAt).not.toBe(startAgain.shown.recovery!.startedAt);
    const last = (await f.workspace.readChain()).at(-1)!;
    const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
    const confirmRecoveryDiscard = confirm(startAgain.shown);
    await expect(
      startAgain.actions.startAgainFirstSetup({
        ...startAgain.ids,
        owner: startAgain.owner,
        ...(confirmRecoveryDiscard === undefined ? {} : { confirmRecoveryDiscard }),
      }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    await expectNothingWritten(f, before);
    expect((await f.workspace.readChain()).at(-1)).toEqual(last);
  },
);

it("with the database missing, confirmRecoveryDiscard is refused setup.attempt_conflict, and nothing changes", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const startAgain = await startAgainOver(f, f.service);
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(
    startAgain.actions.startAgainFirstSetup({
      ...startAgain.ids,
      owner: startAgain.owner,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown: startAgain.shown },
      confirmRecoveryDiscard: { shown: startAgain.shown },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expectNothingWritten(f, before);
});

it("with the database present and no recovery, the summary refuses setup.not_ready and confirmRecoveryDiscard is refused setup.attempt_conflict", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const { owner, ids } = await signedIn(f.host);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: databasePresent(f.host),
    backupRecovery: service,
  });
  await expect(actions.startAgainSummary({ ...ids, owner })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      confirmRecoveryDiscard: { shown: { reached: "claimed", lastName: null } },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expectNothingWritten(f, before);
});

it("with the database present, the fence refuses Start again while the recovery runs, and nothing changes", async () => {
  const f = await selectedRepair();
  const { app } = repairApp({ ...f, host: databasePresent(f.host) });
  const { owner, ids } = await signedIn(f.host);
  const activity = (await f.service.liveness())!;
  expect(activity.state).toBe("running");
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  const refused = await app.request(
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
        confirmRecoveryDiscard: { shown: { reached: "claimed", lastName: null } },
      }),
    },
    tls(),
  );
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: { code: "setup.recovery_in_progress" } });
  await expectNothingWritten(f, before);
});

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

it("an abandoned journal whose emptying was refused is finished by the next Start again, with the same note and no second confirmation", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const planted = join(f.record.target.target.stateDir, "planted");
  await symlink("/nonexistent", planted);
  const first = await startAgainOver(f, f.service);
  await expect(first.run()).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
  await access(join(f.roots.stateDir, "first-setup.json"));
  const note = await readFile(join(f.roots.stateDir, "first-setup-start-again.json"));
  const noteFile = await lstat(join(f.roots.stateDir, "first-setup-start-again.json"));
  await unlink(planted);
  const second = await startAgainOver(f, f.service);
  expect(second.shown).not.toHaveProperty("recovery");
  await expect(second.run()).resolves.toBeUndefined();
  expect(await readFile(join(f.roots.stateDir, "first-setup-start-again.json"))).toEqual(note);
  expect((await lstat(join(f.roots.stateDir, "first-setup-start-again.json"))).ino).toBe(
    noteFile.ino,
  );
  await expectDiscarded(f, { lastName: f.selected.identity, shown: first.shown, lock });
});

it("finishing an abandoned journal whose note is gone raises the note again with the attempt's own floor", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const planted = join(f.record.target.target.stateDir, "planted");
  await symlink("/nonexistent", planted);
  await expect((await startAgainOver(f, f.service)).run()).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await unlink(planted);
  await unlink(join(f.roots.stateDir, "first-setup-start-again.json"));
  clock.advance(1);
  const second = await startAgainOver(f, f.service);
  expect(second.shown).not.toHaveProperty("recovery");
  expect(second.shown.lastName).not.toBeNull();
  await expect(second.run()).resolves.toBeUndefined();
  expect((await readStartAgainNote(f.roots.stateDir))?.lastName).toBe(second.shown.lastName);
});

it("after Start again discards a recovery, the backup entry answers absent and the box answers fresh setup", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  await (await startAgainOver(f, f.service)).run();
  expect(await backupEntry.resolveFirstSetupBackupEntry(f.roots)).toEqual({ kind: "absent" });
  const entry = await resolveFirstSetupEntry(f.roots, { WAITRON_ENV: "preproduction" });
  expect(entry.kind).toBe("normal");
});

it("Start again never lowers a note that already holds a later name than the recovery's", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const later = laterInput(f.selected.input, 60);
  const raised = await raiseStartAgainNote(f.roots.stateDir, {
    floorMs: Date.parse((later.input as { allocation: { issuedAt: string } }).allocation.issuedAt),
    lastName: later.identity,
    module: f.record.binding.module,
  });
  await (await startAgainOver(f, f.service)).run();
  expect(await readStartAgainNote(f.roots.stateDir)).toEqual(raised);
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
  expect(await readStartAgainNote(f.roots.stateDir)).toBeNull();
  await expect(access(join(f.roots.stateDir, START_AGAIN_CONFIRMATIONS_DIR))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
  expect(await opening).toMatchObject({ recoveryId: session.recoveryId });
});

it("a recovery stopped during its settle wait, whose picks name nothing, is shown with no name, and Start again takes only the attempt's floor", async () => {
  const f = await preparedRepair();
  expect(f.record).toMatchObject({ phase: "prepared", input: null });
  await f.service.close(f.session.sessionId);
  await writeFile(
    join(f.record.target.target.stateDir, "module-preparation-state.json"),
    PICKS_NAMING_NOTHING(f.record.binding),
  );
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const startAgain = await startAgainOver(f, f.service);
  const attemptOnly = await createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
  }).startAgainSummary({ ...startAgain.ids, owner: startAgain.owner });
  expect(startAgain.shown.recovery).toMatchObject({ lastName: null });
  expect(startAgain.shown.lastName).toBe(attemptOnly.lastName);
  await expect(startAgain.run()).resolves.toBeUndefined();
  expect((await f.workspace.read()).at(-1)!.phase).toBe("abandoned");
  expect((await lstat(join(f.record.target.target.venueDir, "venue.lock"))).ino).toBe(lock.ino);
  expect((await readStartAgainNote(f.roots.stateDir))?.lastName ?? null).toBe(attemptOnly.lastName);
});

// The box's next start, with a service that has just been created, as after a power cut.
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
  // The run seals once while it finds the recovery, and again just before the abandon.
  const seal = f.service.sealLapsed.bind(f.service);
  let seals = 0;
  vi.spyOn(f.service, "sealLapsed").mockImplementation(() => {
    if (++seals === 2) throw POWER_CUT();
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
  }
});

it("an emptying refused at the start, a symlink in the recovery: the repair page is served, the refusal is logged with its reason, and nothing is deleted", async () => {
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
      logReason: `emptying failed: provisioning.database_unreachable ERR_SQLITE_ERROR ${await realpath(path)}`,
    }),
  });
  await vi.waitFor(() => expect(restarts).toHaveBeenCalledTimes(1));
  expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
  expect((await readStartAgainNote(f.roots.stateDir))?.lastName).toBe(f.selected.identity);
  expect((await confirmations(f.roots.stateDir)).map(({ shown }) => shown)).toEqual([shown]);
  await access(join(f.record.target.target.venueDir, "venue.db"));
  await access(join(f.roots.stateDir, "first-setup.json"));
  const note = await readFile(join(f.roots.stateDir, "first-setup-start-again.json"));
  const noteFile = await lstat(join(f.roots.stateDir, "first-setup-start-again.json"));
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
  expect(await readFile(join(f.roots.stateDir, "first-setup-start-again.json"))).toEqual(note);
  expect((await lstat(join(f.roots.stateDir, "first-setup-start-again.json"))).ino).toBe(
    noteFile.ino,
  );
});
