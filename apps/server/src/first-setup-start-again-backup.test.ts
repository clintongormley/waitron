import { createHash, randomBytes } from "node:crypto";

import "node:fs";

import { access, lstat, readFile, readdir, unlink, writeFile } from "node:fs/promises";

import { Socket } from "node:net";

import { TLSSocket } from "node:tls";

import { dirname, join } from "node:path";

import { Hono } from "hono";

import { afterEach, expect, it, vi } from "vitest";

import { AppError } from "@waitron/shared";

import "@waitron/db";

import {
  START_AGAIN_CONFIRMATIONS_DIR,
  readStartAgainMarker,
  type StartAgainSummary,
} from "@waitron/provisioning";

import { encodeMinuteIdentity } from "@waitron/fiscal-verifactu/src/hour-identity.js";

import { clock } from "../test/hour-recovery-host.js";

import {
  barrier,
  fixture,
  preparedRepair,
  recovery,
  selectedRepair,
} from "../test/first-setup-backup-recovery-fixture.js";

import "./testing/hour-test-clock.js";

import { PASSWORD } from "../test/first-fiscal.js";

import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";

import {
  mountFirstSetupResolutionApi,
  mountFirstSetupResolutionFence,
} from "./setup-first-fiscal-api.js";

import { mountFirstSetupBackupApi } from "./setup-first-backup-api.js";

import * as sources from "./first-setup-backup-source.js";

import "./first-setup-backup-entry.js";

import * as restore from "./restore.js";

import "@waitron/provisioning";

import "./first-setup-entry.js";

import "./testing/venue-held-elsewhere.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

vi.mock("./first-setup-backup-entry.js", { spy: true });

vi.mock("./restore.js", { spy: true });

vi.mock("@waitron/provisioning", { spy: true });

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

it("a backup recovery prepared and given up is discarded by Start again, and its lock stays", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const startAgain = await confirmedStartAgain(f, f.service);
  await expect(startAgain.run()).resolves.toBeUndefined();
  await expectDiscarded(f, { shown: startAgain.shown, lock });
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
  await expectDiscarded(f, { shown: startAgain.shown, lock });
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

type Service = Awaited<ReturnType<typeof selectedRepair>>["service"];

type Host = Awaited<ReturnType<typeof selectedRepair>>["host"];

type Roots = Awaited<ReturnType<typeof selectedRepair>>["roots"];

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

async function appendInput(f: Pick<Repair, "workspace" | "record">, input: unknown) {
  const { version, sequence, previousRecordDigest, recordedAt, ...last } = f.record;
  void version;
  void sequence;
  void previousRecordDigest;
  void recordedAt;
  await f.workspace.append({ ...last, input });
}

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
