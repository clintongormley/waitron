import { createHash, randomBytes } from "node:crypto";

import "node:fs";

import { access, lstat, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";

import { Socket } from "node:net";

import { TLSSocket } from "node:tls";

import { dirname, join } from "node:path";

import { Hono } from "hono";

import { afterEach, expect, it, vi } from "vitest";

import { AppError } from "@waitron/shared";

import "@waitron/db";

import * as provisioning from "@waitron/provisioning";
import {
  SPARE_SPACE_FILE,
  START_AGAIN_CONFIRMATIONS_DIR,
  emptyAbandonedBackupRecovery,
  isEmptiedTombstone,
  readStartAgainMarker,
  type StartAgainSummary,
} from "@waitron/provisioning";

import { clock } from "../test/hour-recovery-host.js";

import {
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
import { releaseSpareBeforeStartAgain } from "./spare-space.js";

import "./first-setup-backup-source.js";

import * as backupEntry from "./first-setup-backup-entry.js";

import "./restore.js";

import "@waitron/provisioning";

import { resolveFirstSetupEntry } from "./first-setup-entry.js";

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
  return {
    owner: {
      attemptId: answer.state.attemptId,
      revision: answer.state.revision,
      ownerGeneration: answer.state.ownerGeneration,
      capability: answer.capability,
    },
    ids: await currentIds(host),
  };
}

async function currentIds(host: Host) {
  const current = await host.resolution.inspectFirstSetupResolution();
  return {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
}

type Repair = Awaited<ReturnType<typeof preparedRepair>>;

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
  const { ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  const attemptOnly = createFirstSetupResolutionActions({ ...f.roots, host: f.host });
  const summary = await actions.startAgainSummary(ids);
  expect(summary).not.toHaveProperty("recovery");
  expect(summary).toEqual(await attemptOnly.startAgainSummary(ids));
});

it("a recovery already selected refuses the summary setup.not_ready", async () => {
  const f = await selectedRepair();
  await f.service.commit(f.session.sessionId, f.selected.input, client);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  clock.advance(LEASE + 1);
  const { ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it("a recovery whose journal cannot be read refuses the summary setup.not_ready", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const journal = dirname(dirname(f.record.target.target.stateDir));
  for (const name of await readdir(journal))
    if (/^\d{6}\.json$/.test(name)) await writeFile(join(journal, name), "unreadable");
  const { ids } = await signedIn(f.host);
  const { actions } = repairApp(f);
  await expect(actions.startAgainSummary(ids)).rejects.toMatchObject({
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
  const { ids } = await signedIn(f.host, recovered);
  const summary = await entry.app.request(
    "https://box.test/setup-api/first-setup/resolution/start-again/summary",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ids),
    },
    tls(),
  );
  expect(summary.status, await summary.clone().text()).toBe(200);
  expect((await summary.json()).recovery).toBeDefined();
});

async function startAgainOver(
  f: Pick<Repair, "host" | "roots">,
  backupRecovery: Service,
  recovered?: Response,
) {
  const { ids } = await signedIn(f.host, recovered);
  const actions = createFirstSetupResolutionActions({ ...f.roots, host: f.host, backupRecovery });
  const shown = await actions.startAgainSummary(ids);
  return {
    shown,
    ids,
    actions,
    run: (confirmed: StartAgainSummary = shown) =>
      actions.startAgainFirstSetup({
        ...ids,
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
  await expectDiscarded(f, { shown: startAgain.shown, lock });
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

it("a stopped recovery beside trading.env: the summary and Start again refuse setup.not_ready, and nothing changes", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  // The summary refuses beside trading.env, so the shown summary is read before it is written.
  const { shown } = await startAgainOver(f, f.service);
  await writeFile(join(f.roots.stateDir, "trading.env"), "WAITRON_ENV=production\n");
  const startAgain = await startAgainOver(f, f.service).catch((error: unknown) => error);
  expect(startAgain).toMatchObject({ code: "setup.not_ready" });
  const ids = await currentIds(f.host);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: f.host,
    backupRecovery: f.service,
  });
  const last = (await f.workspace.readChain()).at(-1)!;
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  await expectNothingWritten(f, before);
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
});

/** The inspection reads the venue database as present: empty unless `database` says it holds rows. */
function databasePresent(
  host: Host,
  database: "no-venue-rows" | "occupied" = "no-venue-rows",
): Host {
  const inspect = host.resolution.inspectFirstSetupResolution;
  return {
    ...host,
    resolution: {
      ...host.resolution,
      inspectFirstSetupResolution: async () => ({
        ...(await inspect()),
        database,
        emptyDatabase: database === "no-venue-rows",
      }),
    },
  };
}

type AttemptStatus = NonNullable<
  Awaited<ReturnType<Host["store"]["readForRepair"]>>
>["state"]["status"];

/** The attempt's record reads as having reached `status`. */
function attemptAt(host: Host, status: AttemptStatus): Host {
  const read = host.store.readForRepair;
  return {
    ...host,
    store: {
      ...host.store,
      readForRepair: async () => {
        const retained = await read();
        return retained === null ? null : { ...retained, state: { ...retained.state, status } };
      },
    },
  };
}

async function presentOver(
  f: Pick<Repair, "host" | "roots">,
  backupRecovery: Service,
  stamp?: () => Promise<void>,
  { passwordStep = true }: { passwordStep?: boolean } = {},
) {
  const { ids } = passwordStep ? await signedIn(f.host) : { ids: await currentIds(f.host) };
  await stamp?.();
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: databasePresent(f.host),
    backupRecovery,
  });
  const shown = await actions.startAgainSummary(ids);
  return {
    shown,
    ids,
    actions,
    run: (confirmed: StartAgainSummary = shown) =>
      actions.startAgainFirstSetup({ ...ids, confirmRecoveryDiscard: { shown: confirmed } }),
  };
}

it("with the database present, the confirmed summary discards a stopped recovery with no password, with a record of whose setup it was", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const startAgain = await presentOver(f, f.service, undefined, { passwordStep: false });
  await expect(startAgain.run()).resolves.toBeUndefined();
  await expectDiscarded(f, { shown: startAgain.shown, lock });
  const records = await confirmations(f.roots.stateDir);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    database: "present",
    setupAdministrator: { displayName: "Elena", email: "elena@example.test" },
    confirmedOn: "repair-page",
    signedIn: false,
  });
});

it("with the database present, a stopped recovery's Start again with no password step goes ahead, and the recovery is discarded", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const startAgain = await presentOver(f, f.service, undefined, { passwordStep: false });
  await expect(
    startAgain.actions.startAgainFirstSetup({
      ...startAgain.ids,
      confirmRecoveryDiscard: { shown: startAgain.shown },
    }),
  ).resolves.toBeUndefined();
  await expectDiscarded(f, { shown: startAgain.shown, lock });
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
      confirmMissingDatabase: { nothingFiledOrSold: true, shown: startAgain.shown },
      confirmRecoveryDiscard: { shown: startAgain.shown },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expectNothingWritten(f, before);
});

it("with the database present and no recovery, the summary answers with no recovery and confirmRecoveryDiscard is refused setup.attempt_conflict", async () => {
  const f = await fixture(true);
  const service = recovery(f.options);
  const { ids } = await signedIn(f.host);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host: databasePresent(f.host),
    backupRecovery: service,
  });
  expect(await actions.startAgainSummary(ids)).not.toHaveProperty("recovery");
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(
    actions.startAgainFirstSetup({
      ...ids,
      confirmRecoveryDiscard: { shown: { reached: "claimed" } },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expectNothingWritten(f, before);
});

it.each([
  ["damaged", true],
  ["intact", false],
] as const)(
  "with the database present, an abandoned recovery not yet emptied beside a %s picks file: the summary answers with no recovery, and Start again finishes emptying it",
  async (_label, damaged) => {
    const f = await selectedRepair();
    await f.service.close(f.session.sessionId);
    const planted = join(f.record.target.target.stateDir, "planted");
    await symlink("/nonexistent", planted);
    await expect((await presentOver(f, f.service)).run()).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect((await f.workspace.readChain()).at(-1)!.phase).toBe("abandoned");
    await unlink(planted);
    if (damaged)
      await writeFile(join(f.roots.stateDir, "module-preparation-state.json"), "{damaged");
    const { ids } = await signedIn(f.host);
    const actions = createFirstSetupResolutionActions({
      ...f.roots,
      host: databasePresent(f.host),
      backupRecovery: f.service,
    });
    expect(await actions.startAgainSummary(ids)).not.toHaveProperty("recovery");
    expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(false);
    await expect(actions.startAgainFirstSetup(ids)).resolves.toBeUndefined();
    expect(await isEmptiedTombstone(f.roots, f.session.recoveryId)).toBe(true);
  },
);

it.each([
  ["the venue database holds rows", (host: Host) => databasePresent(host, "occupied")],
  [
    "the attempt reached activation",
    (host: Host) => attemptAt(databasePresent(host), "activation-started"),
  ],
] as const)(
  "with the database present and a stopped recovery, the summary refuses setup.not_ready when %s, as Start again would",
  async (_label, present) => {
    const f = await selectedRepair();
    await f.service.close(f.session.sessionId);
    const { ids } = await signedIn(f.host);
    const actions = createFirstSetupResolutionActions({
      ...f.roots,
      host: present(f.host),
      backupRecovery: f.service,
    });
    await expect(actions.startAgainSummary(ids)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
  },
);

it.each([
  ["damaged", "{damaged"],
  ["intact", JSON.stringify({ version: 1, modules: {}, history: [] })],
] as const)(
  "with the database present and empty, a %s public fiscal record beside a stopped recovery refuses the summary and Start again setup.not_ready, and nothing is written",
  async (_label, bytes) => {
    const f = await selectedRepair();
    await f.service.close(f.session.sessionId);
    const startAgain = await presentOver(f, f.service);
    expect(startAgain.shown.recovery).toBeDefined();
    await writeFile(join(f.roots.stateDir, "module-operation-public.json"), bytes);
    const current = await f.host.resolution.inspectFirstSetupResolution();
    const ids = {
      inspectionId: current.inspectionId,
      revision: current.revision!,
      ownerGeneration: current.ownerGeneration!,
    };
    const last = (await f.workspace.readChain()).at(-1)!;
    const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
    await expect(startAgain.actions.startAgainSummary(ids)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    await expect(
      startAgain.actions.startAgainFirstSetup({
        ...ids,
        confirmRecoveryDiscard: { shown: startAgain.shown },
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await expectNothingWritten(f, before);
    expect((await f.workspace.readChain()).at(-1)).toEqual(last);
  },
);

it("with the database present, the fence refuses a well-formed discard while the recovery runs, before it reaches Start again, and nothing changes", async () => {
  const f = await selectedRepair();
  const host = databasePresent(f.host);
  const actions = createFirstSetupResolutionActions({
    ...f.roots,
    host,
    backupRecovery: f.service,
  });
  const startAgain = vi.fn(actions.startAgainFirstSetup);
  const appWith = (fenced: boolean) => {
    const app = new Hono();
    if (fenced) mountFirstSetupResolutionFence(app, f.service, () => {});
    mountFirstSetupResolutionApi(app, host, () => {}, { startAgain });
    return app;
  };
  const { ids } = await signedIn(f.host);
  const activity = (await f.service.liveness())!;
  expect(activity.state).toBe("running");
  const shown: StartAgainSummary = {
    reached: "claimed",
    recovery: {
      startedAt: activity.startedAt,
      lastActiveAt: activity.lastActiveAt,
      lastActiveSource: "memory",
      failed: false,
      cloud: false,
    },
  };
  const send = (app: Hono) =>
    app.request(
      "https://box.test/setup-api/first-setup/resolution/start-again",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ids, confirmRecoveryDiscard: { shown } }),
      },
      tls(),
    );
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  const refused = await send(appWith(true));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: { code: "setup.recovery_in_progress" } });
  expect(startAgain).not.toHaveBeenCalled();
  await expectNothingWritten(f, before);
  // Control: with no fence, the route's shape check passes the same body on to Start again.
  startAgain.mockResolvedValueOnce(undefined);
  await send(appWith(false));
  expect(startAgain).toHaveBeenCalledTimes(1);
});

it("an inspection read under a nearly full reading releases the spare, and Start again over the stopped recovery then discards it", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const lock = await lstat(join(f.record.target.target.venueDir, "venue.lock"));
  const spare = join(f.roots.stateDir, SPARE_SPACE_FILE);
  await writeFile(spare, Buffer.alloc(4096, 1));
  const app = new Hono();
  app.use(
    "*",
    releaseSpareBeforeStartAgain({
      stateDir: f.roots.stateDir,
      roots: f.roots,
      statfs: async () => ({ bavail: 1024 * 1024, frsize: 1 }),
      recovery: f.service,
      log: () => {},
    }),
  );
  app.route("/", repairApp(f).app);
  await app.request("https://box.test/setup-api/first-setup/resolution");
  await expect(access(spare)).rejects.toMatchObject({ code: "ENOENT" });
  const startAgain = await presentOver(f, f.service);
  await expect(startAgain.run()).resolves.toBeUndefined();
  await expectDiscarded(f, { shown: startAgain.shown, lock });
});

it("when the confirmation record cannot be written, Start again abandons, empties and deletes nothing", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const last = (await f.workspace.readChain()).at(-1)!;
  const startAgain = await presentOver(f, f.service);
  vi.mocked(provisioning.writeStartAgainConfirmation).mockRejectedValueOnce(
    new AppError("setup.attempt_invalid", {}),
  );
  await expect(startAgain.run()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect((await f.workspace.readChain()).at(-1)).toEqual(last);
  const left = Object.keys(await tree(dirname(dirname(f.record.target.target.stateDir))));
  expect(left).toEqual(
    expect.arrayContaining(["evidence/0.bin", "target/state/module-preparation-state.json"]),
  );
  await access(join(f.roots.stateDir, "first-setup.json"));
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
});
