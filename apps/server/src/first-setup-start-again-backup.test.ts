import { createHash, randomBytes } from "node:crypto";
import { access, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import {
  emptyAbandonedBackupRecovery,
  readStartAgainMarker,
  readStartAgainNote,
} from "@waitron/provisioning";
import { clock } from "../test/hour-recovery-host.js";
import {
  barrier,
  fixture,
  recovery,
  selectedRepair,
} from "../test/first-setup-backup-recovery-fixture.js";
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

async function confirmedStartAgain(f: Awaited<ReturnType<typeof selectedRepair>>) {
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
  const actions = createFirstSetupResolutionActions({ ...f.roots, host: f.host });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  return () =>
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
    });
}

async function expectNothingWritten(
  f: Awaited<ReturnType<typeof selectedRepair>>,
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

it("a backup recovery prepared and given up refuses Start again, and nothing is written or deleted", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const startAgain = await confirmedStartAgain(f);
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  const journal = Object.keys(before.state).filter((name) =>
    name.startsWith("first-setup-resolutions/backup-recovery/"),
  );
  expect(journal.some((name) => name.endsWith("/target/venue/venue.lock"))).toBe(true);
  expect(before.state["first-setup.json"]).toBeDefined();
  await expect(startAgain()).rejects.toMatchObject({ code: "setup.not_ready" });
  await expectNothingWritten(f, before);
});

it("a recovery at placement-started refuses Start again, and nothing is deleted", async () => {
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
  const startAgain = await confirmedStartAgain(f);
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(startAgain()).rejects.toMatchObject({ code: "setup.not_ready" });
  await expectNothingWritten(f, before);
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
