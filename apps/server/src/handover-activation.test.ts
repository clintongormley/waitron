import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Socket } from "node:net";
import { mkdtemp, rm, mkdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  openVenueDatabase,
  outgoingMail,
  readNodeMembership,
  withTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { handoverActivations, verifyEnvelope } from "@waitron/handover";
import { nodeSigningPublicKey } from "@waitron/credentials";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { hashPassword, managementSessions } from "@waitron/identity";
import { signDocumentBody, type MembershipNode } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverEvent, readHandoverOperation, readNodeMode } from "@waitron/node-db";
import { createPasswordThrottle, createFirstSetupCoordinator } from "@waitron/provisioning";
import { recordCorrected } from "@waitron/fiscal-verifactu/src/clock-corrected-incident.js";
import {
  BOX_EMAIL_CHECK_MS,
  readOpenEmailedIncidents,
  startBoxEmailDuty,
} from "./box-alert-email.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { mountHandoverActivationApi, type HandoverActivationDeps } from "./handover-activation.js";
import { checkEmergencyCopy } from "./handover-emergency-check.js";
import { mountHandoverEmergencyApi, type EmergencyHandover } from "./handover-emergency-api.js";
import { handoverPromotionContext, mountHandoverPreparationApi } from "./handover-preparation.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { placeAcceptedCopyAtStart } from "./handover-place-copy.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import {
  ADMIN,
  ADMIN_EMAIL,
  OPERATION,
  PASSWORD,
  binding,
  fiscalModules,
  placedSpareFixture,
  primary,
  ring,
  standby,
  type PlacedSpare,
} from "./testing/handover-placed-copy.js";

const external = vi.hoisted(() => ({
  internet: vi.fn(),
  hashes: 0,
  duringHash: undefined as undefined | (() => Promise<void>),
  integrityChecks: 0,
}));
vi.mock("node:worker_threads", async (original) => {
  const real = await original<typeof import("node:worker_threads")>();
  return {
    ...real,
    Worker: class extends real.Worker {
      constructor(source: string | URL, options?: import("node:worker_threads").WorkerOptions) {
        if ((options?.workerData as { path?: string } | undefined)?.path !== undefined)
          external.integrityChecks += 1;
        super(source, options);
      }
    },
  };
});
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/identity/src/verify-password.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity/src/verify-password.js")>();
  return {
    ...actual,
    verifyPassword: async (password: string, stored: string) => {
      external.hashes += 1;
      await external.duringHash?.();
      return actual.verifyPassword(password, stored);
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations, timeoutMs: 60_000 });
const spareBefore = useVenueDb({ migrations, timeoutMs: 60_000 });
const THIRD_BOX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const signIn = { email: ADMIN_EMAIL, password: PASSWORD };

let root: string;
let placed: PlacedSpare | undefined;
const sockets: TLSSocket[] = [];
const dirs = () => ({
  mainState: join(root, "main-state"),
  spareState: join(root, "spare-state"),
  spareVenue: join(root, "spare-venue"),
});
const fixture = placedSpareFixture({ mainBox, spareBefore, dirs });

type Store = { venue: Database; node: NodeDatabase };
type Answer = {
  status: number;
  cache: string | null;
  body: {
    activated?: boolean;
    restarting?: boolean;
    error?: { code: string; params: Record<string, unknown> };
  };
};
type Service = ReturnType<typeof serviceFor>;

function serviceFor(store: Store) {
  return createNodeOperationPreparation({
    stateDir: dirs().spareState,
    venueDir: dirs().spareVenue,
    db: store.venue,
    nodeDb: store.node,
    node: standby,
    modules: fiscalModules,
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
}

/** The real promotion and both real routes, with the restart a thing the case can read. */
function spareOn(
  store: Store,
  service: Service = serviceFor(store),
  emergency?: EmergencyHandover,
) {
  const holders = createDeploymentHolders("mirror", "secondary");
  const steps: string[] = [];
  const run: HandoverActivationDeps["run"] = async (attestation, runner, beforeRestart) => {
    const result = await promoteMirrorToPrimary(
      {
        db: store.venue,
        node: store.node,
        nodeId: standby.nodeId,
        ring,
        modules: fiscalModules,
        holders,
        log: () => {},
        persistTradingEnv: async () => {
          steps.push("trading env");
        },
        withModuleOperations: runner,
      },
      attestation,
    );
    if (!result.alreadyPrimary) {
      steps.push(`role ${(await readNodeMode(store.node, standby.nodeId)).mode}`);
      try {
        await beforeRestart?.();
      } finally {
        steps.push(
          `restart at ${(await readHandoverOperation(store.node, standby.nodeId, OPERATION))?.state}`,
        );
      }
    }
    return { alreadyPrimary: result.alreadyPrimary, restarting: !result.alreadyPrimary };
  };
  const app = new Hono();
  const common = {
    node: store.node,
    nodeId: standby.nodeId,
    appDb: store.venue,
    nodePreparation: service,
    passwordThrottle: createPasswordThrottle(),
  };
  mountHandoverPreparationApi(app, { ...common, requestFromBox: () => false });
  mountHandoverActivationApi(app, {
    ...common,
    stateDir: dirs().spareState,
    run,
    ...(emergency === undefined ? {} : { emergency }),
  });
  return { app, service, steps, run };
}

async function request(
  app: Hono,
  step: "preparation" | "activate" | "declare",
  body: unknown,
  { operationId = OPERATION, base = "https://box.test", headers = {} } = {},
): Promise<Answer> {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  const response = await app.request(
    `${base}/api/node/handover/${operationId}/${step}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    { incoming: { socket } },
  );
  return {
    status: response.status,
    cache: response.headers.get("cache-control"),
    body: (await response.json()) as Answer["body"],
  };
}

/** Through the real preparation route: what `select` answers is what the activation sends. */
async function selectName(app: Hono): Promise<{ input: unknown; identity: string }> {
  const prepare = async (proposal: unknown) => {
    const answer = await request(app, "preparation", {
      moduleOperation: { binding, input: null },
      signIn,
      proposal,
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body as { id: string; input: unknown; identity: string; status: string };
  };
  const challenge = await prepare({ action: "clock-challenge" });
  const compared = await prepare({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  });
  const selected = await prepare({ action: "select", comparisonId: compared.id });
  expect(selected.status).toBe("selected");
  return selected;
}

const activate = (app: Hono, input: unknown, extra: Record<string, unknown> = {}) =>
  request(app, "activate", { moduleOperation: { binding, input }, signIn, ...extra });

async function placedSpare(options?: { recordPlaced?: boolean }): Promise<PlacedSpare> {
  placed = await fixture.placeRealCopy(options);
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  return placed;
}

/** A chart this box already took, on top of the one the copy holds. */
async function chartMovesOn(store: PlacedSpare, nodes: MembershipNode[], term = 2): Promise<void> {
  const body = { term, nodes };
  await writeNodeMembership(store.venue, {
    body,
    signerNodeId: primary.nodeId,
    signature: signDocumentBody(body, store.mainKey),
    endorsements: store.chart.endorsements,
  });
}
const node = (nodeId: string, standing: MembershipNode["standing"]): MembershipNode => ({
  nodeId,
  contactUrl: "https://box.example",
  standing,
});

const operationRow = (store: Store) => readHandoverOperation(store.node, standby.nodeId, OPERATION);
const allocations = (store: Store) => store.venue.select().from(fiscalAllocations);
const activations = (store: Store) => store.venue.select().from(handoverActivations);
const sifRows = (store: Store) => store.venue.select().from(registroSif);

async function emergencySpare(gate = true) {
  placed = await fixture.placeEmergencyCopy();
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  await seedWorkingOrder(placed.venue, { openedAt: "2026-10-16T12:00:00Z" });
  const declarationApp = new Hono();
  const exchange = vi.fn(async () => {
    throw Object.assign(new Error("source off"), { code: "ECONNREFUSED" });
  });
  const emergencyDeps = {
    db: placed.venue,
    node: placed.node,
    nodeId: standby.nodeId,
    ring,
    stateDir: dirs().spareState,
    venueDir: dirs().spareVenue,
    modules: fiscalModules,
    origin: "https://box.test",
    credentialKeyRing: TOTP_KEY_RING,
    fetch: exchange,
  };
  const emergency = mountHandoverEmergencyApi(declarationApp, emergencyDeps);
  const declarationBody = {
    operationId: OPERATION,
    expectedCopy: await checkEmergencyCopy({ venueDir: dirs().spareVenue, modules: fiscalModules }),
    signIn,
    statements: { sourceSwitchedOff: true, noParallelRecovery: true, missingTailAccepted: true },
    reason: "Source stopped",
    locale: "en",
  };
  const declared = await request(declarationApp, "declare", declarationBody, {
    operationId: "emergency",
  });
  expect(declared.status, JSON.stringify(declared.body)).toBe(200);
  return {
    store: placed,
    ...spareOn(
      placed,
      serviceFor(placed),
      gate ? emergency : mountHandoverEmergencyApi(new Hono(), emergencyDeps),
    ),
    declared: declared.body as unknown as { declaration: unknown },
    repeat: () => request(declarationApp, "declare", declarationBody, { operationId: "emergency" }),
    exchange,
  };
}

describe("emergency activation on a real copy", () => {
  it("commits the spare's signed interval evidence after clock sign-ins, with a version-one offline approval and safe replay", async () => {
    const s = await emergencySpare();
    const { input } = await selectName(s.app);
    expect((await s.repeat()).body).toEqual(s.declared);
    const before = Date.now();
    const scans = external.integrityChecks;
    expect((await activate(s.app, input)).body).toEqual({ activated: true, restarting: true });
    expect(external.integrityChecks).toBe(scans);
    expect(Date.now()).toBe(before);
    const rows = await activations(s.store);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.evidence).toEqual(s.declared.declaration);
    const verified = verifyEnvelope<{ lastCopy: { lastChangeAtMs: number } }>(
      rows[0]!.evidence,
      "declaration",
      () => nodeSigningPublicKey(s.store.spareKey),
    );
    expect(verified.valid).toBe(true);
    if (!verified.valid) throw new Error("unverified declaration");
    expect(verified.body.lastCopy.lastChangeAtMs).toBe(1792152000000);
    const own = (await allocations(s.store)).filter((row) => row.nodeId === standby.nodeId);
    expect(own).toHaveLength(1);
    expect(own[0]!.approval).toMatchObject({ version: 1, oldMachineOffline: true });
    expect(own[0]!.approval).not.toHaveProperty("oldMachineRelinquished");
    expect(s.exchange).toHaveBeenCalledTimes(2);
    expect((await activate(s.app, input)).body).toEqual({ activated: true, restarting: false });
    expect(await allocations(s.store)).toHaveLength(2);
    expect(s.exchange).toHaveBeenCalledTimes(2);
  }, 60_000);

  it.each([false, true])(
    "rechecks emergency activation in a new process, copy changed %s",
    async (changed) => {
      const s = await emergencySpare(false);
      const { input } = await selectName(s.app);
      if (changed) await seedWorkingOrder(s.store.venue, { openedAt: "2026-10-16T12:05:00Z" });
      const answer = await activate(s.app, input);
      if (changed) {
        expect(answer.body.error?.code).toBe("handover.copy_mismatch");
        expect(await activations(s.store)).toHaveLength(0);
        expect((await readNodeMode(s.store.node, standby.nodeId)).mode).toBe("mirror");
      } else {
        expect(answer.body).toEqual({ activated: true, restarting: true });
        expect(await activations(s.store)).toHaveLength(1);
        expect((await readNodeMode(s.store.node, standby.nodeId)).mode).toBe("primary");
      }
    },
    60_000,
  );
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "handover-activation-"));
  external.hashes = 0;
  external.duringHash = undefined;
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  while (sockets.length > 0) sockets.pop()?.destroy();
  await placed?.close();
  placed = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("activating on a real placed copy", () => {
  it("clears selected-copy provenance after the activation commits", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const marker = join(dirs().spareState, "pair-copy", "placed.json");
    await mkdir(join(dirs().spareState, "pair-copy"));
    await writeFile(
      marker,
      JSON.stringify({ source: "selected-backup", sourceId: "a".repeat(64) }),
    );
    expect((await activate(app, (await selectName(app)).input)).body.activated).toBe(true);
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);
  it("activates under a new SIF and series, with M1's SIF and series untouched", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const seriesOf = async (nodeId: string) =>
      store.venue.select().from(invoiceSeries).where(eq(invoiceSeries.nodeId, nodeId));
    const oldSif = (await sifRows(store)).filter((row) => row.nodeId === primary.nodeId);
    const oldSeries = await seriesOf(primary.nodeId);
    expect(oldSif).toHaveLength(1);
    expect(oldSeries.length).toBeGreaterThan(0);
    const selected = await selectName(app);

    const answer = await activate(app, selected.input);

    expect(answer).toEqual({
      status: 200,
      cache: "no-store",
      body: { activated: true, restarting: true },
    });
    const sif = await sifRows(store);
    expect(sif.filter((row) => row.nodeId === primary.nodeId)).toEqual(oldSif);
    const own = sif.filter((row) => row.nodeId === standby.nodeId);
    expect(own.map((row) => row.numeroInstalacion)).toEqual([selected.identity]);
    expect(own[0]!.numeroInstalacion).not.toBe(oldSif[0]!.numeroInstalacion);
    expect(await seriesOf(primary.nodeId)).toEqual(oldSeries);
    const newCodes = (await seriesOf(standby.nodeId)).map((row) => row.code);
    expect(newCodes.length).toBeGreaterThan(0);
    for (const code of newCodes) {
      expect(oldSeries.map((row) => row.code)).not.toContain(code);
    }
  }, 60_000);

  it("the stored approval says relinquished, not offline", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    await activate(app, (await selectName(app)).input);
    const own = (await allocations(store)).filter((row) => row.nodeId === standby.nodeId);
    expect(own).toHaveLength(1);
    expect(own[0]!.approval).toMatchObject({
      version: 2,
      oldMachineRelinquished: true,
      oldMachineOffline: false,
    });
  }, 60_000);

  it("the new chart makes this box the main box and marks M1 sell-only", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    await activate(app, (await selectName(app)).input);
    const chart = await readNodeMembership(store.venue);
    expect(chart?.body.term).toBe(2);
    expect(chart?.signerNodeId).toBe(standby.nodeId);
    expect(
      Object.fromEntries(chart!.body.nodes.map((entry) => [entry.nodeId, entry.standing])),
    ).toEqual({ [primary.nodeId]: "sell-only", [standby.nodeId]: "serving-primary" });
  }, 60_000);

  it("writes one handover_activations row, holding the old box's stored relinquishment", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    await activate(app, (await selectName(app)).input);
    expect(await activations(store)).toEqual([
      {
        operationId: OPERATION,
        scenario: "controlled",
        sourceNodeId: primary.nodeId,
        destinationNodeId: standby.nodeId,
        evidence: store.relinquishment,
        personId: ADMIN,
        activatedAt: new Date("2026-10-16T12:40:00Z").toISOString(),
      },
    ]);
  }, 60_000);

  it("the venue save comes first, then the role, then activated, then the restart", async () => {
    const store = await placedSpare();
    const { app, steps } = spareOn(store);
    await activate(app, (await selectName(app)).input);
    expect(steps).toEqual(["trading env", "role primary", "restart at activated"]);
    expect((await operationRow(store))?.state).toBe("activated");
  }, 60_000);

  it("a body cannot choose the context, the person or the evidence", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    const answer = await activate(app, input, {
      oldMachineRelinquished: false,
      oldNodeNeutralised: false,
      noParallelRecovery: false,
      personId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      evidence: { forged: true },
    });
    expect(answer.body).toEqual({ activated: true, restarting: true });
    expect(await activations(store)).toMatchObject([
      { personId: ADMIN, evidence: store.relinquishment },
    ]);
  }, 60_000);

  it("the prepare step and the promotion take one context", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    expect((await activate(app, input)).status).toBe(200);
  }, 60_000);

  it("control: prepared under the other scenario's context, the promotion is refused event_mismatch", async () => {
    const store = await placedSpare();
    const service = serviceFor(store);
    const { app } = spareOn(store, service);
    const other = handoverPromotionContext({ scenario: "emergency" });
    const credentials = { personId: ADMIN, password: PASSWORD };
    const client = { onBox: false };
    await selectName(app); // Writes the dormant setup; its name is not used.
    const challenge = (await service.prepare(
      binding,
      credentials,
      other,
      { action: "clock-challenge" },
      client,
    )) as { id: string };
    const compared = (await service.prepare(
      binding,
      credentials,
      other,
      {
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      },
      client,
    )) as { id: string };
    const { input } = (await service.prepare(
      binding,
      credentials,
      other,
      { action: "select", comparisonId: compared.id },
      client,
    )) as { input: unknown };

    expect(await activate(app, input)).toMatchObject({
      status: 400,
      body: { error: { code: "sif.allocation_invalid", params: { reason: "event_mismatch" } } },
    });
    expect((await activations(store)).length).toBe(0);
    expect((await operationRow(store))?.state).toBe("filing_assumed");
  }, 60_000);
});

describe("a failure inside the one venue transaction", () => {
  it("the row commits with the chart, or neither does", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    const chartBefore = await readNodeMembership(store.venue);
    const sifBefore = await sifRows(store);
    store.venue.run(sql`
      create trigger refuse_activation before insert on handover_activations
      begin select raise(abort, 'injected after consume'); end
    `);

    const refused = await activate(app, input);

    expect(refused.status).toBe(500);
    expect(await readNodeMembership(store.venue)).toEqual(chartBefore);
    expect(await sifRows(store)).toEqual(sifBefore);
    expect(await activations(store)).toEqual([]);
    expect((await allocations(store)).filter((row) => row.nodeId === standby.nodeId)).toEqual([]);
    expect((await operationRow(store))?.state).toBe("filing_assumed");
    expect((await readNodeMode(store.node, standby.nodeId)).mode).toBe("mirror");
  }, 60_000);
});

describe("when the operation is not ready", () => {
  it.each(["prepared", "copy_accepted"] as const)(
    "at %s it is refused handover.step_out_of_order, before any hash",
    async (state) => {
      const store = { venue: spareBefore.db, node: spareBefore.node };
      const deps = { node: store.node, nodeId: standby.nodeId };
      await beginHandover(
        deps,
        {
          operationId: OPERATION,
          scenario: "controlled",
          venue: { country: "ES", taxId: "89890001K", environment: "preproduction" },
          sourceNodeId: primary.nodeId,
          destinationNodeId: standby.nodeId,
          membership: { term: 1, digest: "a".repeat(64) },
        },
        "destination",
      );
      if (state === "copy_accepted") await advanceHandover(deps, OPERATION, state, {});
      await expect(
        activate(spareOn(store).app, null).then(({ status, body }) => ({ status, body })),
      ).resolves.toEqual({
        status: 409,
        body: {
          error: { code: "handover.step_out_of_order", params: { from: state, to: "activated" } },
        },
      });
      expect(external.hashes).toBe(0);
    },
  );

  it("the window between recording filing_assumed and copy_placed: refused, nothing written", async () => {
    const store = await placedSpare({ recordPlaced: false });
    const answer = await activate(spareOn(store).app, null);
    expect(answer).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
    expect(external.hashes).toBe(0);
    expect(await activations(store)).toEqual([]);
  }, 60_000);

  it("an operation that moves on while the password is being checked is refused", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    const sessions = (await store.venue.select().from(managementSessions)).length;
    external.duringHash = async () => {
      external.duringHash = undefined;
      await advanceHandover(
        { node: store.node, nodeId: standby.nodeId },
        OPERATION,
        "activated",
        {},
      );
    };
    expect(await activate(app, input)).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
    expect(await activations(store)).toEqual([]);
    expect((await store.venue.select().from(managementSessions)).length).toBe(sessions);
  }, 60_000);

  it("with no operation ready to promote, a right and a wrong password get the same refusal", async () => {
    const store = await placedSpare({ recordPlaced: false });
    const { app } = spareOn(store);
    const wrongSignIn = { email: ADMIN_EMAIL, password: "not-the-password" };
    const answers = async (operationId: string) => {
      const body = { moduleOperation: { binding, input: null }, signIn };
      const right = await request(app, "activate", body, { operationId });
      const wrong = await request(
        app,
        "activate",
        { ...body, signIn: wrongSignIn },
        { operationId },
      );
      return { right, wrong };
    };
    const unknown = await answers("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(unknown.right).toEqual(unknown.wrong);
    expect(unknown.right).toMatchObject({
      status: 404,
      body: { error: { code: "handover.operation_unknown" } },
    });
    const early = await answers(OPERATION);
    expect(early.right).toEqual(early.wrong);
    expect(early.right).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
    expect((await operationRow(store))?.state).toBe("filing_assumed");
    expect(await activations(store)).toEqual([]);
  }, 60_000);

  it("an unknown operation, and an over-long id, are refused", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const body = { moduleOperation: { binding, input: null }, signIn };
    expect(
      await request(app, "activate", body, {
        operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).toMatchObject({ status: 404, body: { error: { code: "handover.operation_unknown" } } });
    expect(await request(app, "activate", body, { operationId: "x".repeat(65) })).toMatchObject({
      status: 400,
      body: { error: { code: "handover.request_invalid", params: { field: "operationId" } } },
    });
    expect(external.hashes).toBe(0);
  }, 60_000);

  it.each([
    ["no moduleOperation", undefined],
    ["another event", { binding: { ...binding, eventId: "another" }, input: null }],
    ["another source", { binding: { ...binding, sourceId: THIRD_BOX }, input: null }],
    ["another action", { binding: { ...binding, action: "reserve" }, input: null }],
    ["another target", { binding: { ...binding, targetNodeId: THIRD_BOX }, input: null }],
  ])(
    "%s is refused module.operation_invalid before any hash",
    async (_name, moduleOperation) => {
      const store = await placedSpare();
      const answer = await request(spareOn(store).app, "activate", { moduleOperation, signIn });
      expect(answer).toMatchObject({
        status: 400,
        body: { error: { code: "module.operation_invalid" } },
      });
      expect(external.hashes).toBe(0);
    },
    60_000,
  );

  it("a stored step with no evidence is a fault in Waitron, and activates nothing", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    const stored = await readHandoverEvent(store.node, standby.nodeId, OPERATION, "filing_assumed");
    expect(stored?.envelope).not.toBeNull();
    store.node.run(
      sql`update node_handover_events set envelope = null where kind = 'filing_assumed'`,
    );
    expect((await activate(app, input)).status).toBe(500);
    expect(await activations(store)).toEqual([]);
    expect((await readNodeMembership(store.venue))?.body.term).toBe(1);
  }, 60_000);
});

describe("signing in against the placed copy", () => {
  it("a person without node.manage there is refused", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    await setBuiltInRoleForTest(store.venue, ADMIN, "staff");
    expect(await activate(app, input)).toMatchObject({
      status: 403,
      body: { error: { code: "authorization.not_permitted" } },
    });
    expect(await activations(store)).toEqual([]);
  }, 60_000);

  it("shares password refusal delays between preparation and activation", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const selected = await selectName(app);
    const body = {
      moduleOperation: { binding, input: selected.input },
      signIn: { ...signIn, password: "wrong" },
      proposal: { action: "clock-challenge" },
    };
    for (const step of ["preparation", "activate", "preparation", "activate"] as const) {
      expect(await request(app, step, body)).toMatchObject({
        status: 401,
        body: { error: { code: "password.invalid" } },
      });
    }
    for (const step of ["preparation", "activate"] as const) {
      expect(await request(app, step, body)).toMatchObject({
        status: 429,
        body: { error: { code: "password.throttled" } },
      });
    }
  }, 60_000);

  it("an unknown email and a wrong password are both password.invalid", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    for (const attempt of [
      { email: "nobody@venue.test", password: PASSWORD },
      { email: ADMIN_EMAIL, password: "wrong" },
      { email: 7, password: PASSWORD },
      null,
    ]) {
      expect(await activate(app, input, { signIn: attempt })).toMatchObject({
        status: 401,
        body: { error: { code: "password.invalid" } },
      });
    }
    expect(await activations(store)).toEqual([]);
    expect((await operationRow(store))?.state).toBe("filing_assumed");
  }, 60_000);

  it("a plain-HTTP or cross-origin request is refused, before anything else", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const plain = await app.request(`http://box.test/api/node/handover/${OPERATION}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect([plain.status, await plain.json()]).toEqual([
      403,
      { error: { code: "authorization.not_permitted", params: { permission: "node.manage" } } },
    ]);
    for (const headers of [
      { Origin: "https://elsewhere.test" },
      { "Sec-Fetch-Site": "cross-site" },
    ]) {
      expect(await request(app, "activate", {}, { headers })).toMatchObject({
        status: 403,
        body: { error: { code: "authorization.not_permitted" } },
      });
    }
    expect(external.hashes).toBe(0);
  }, 60_000);
});

describe("a chart that no longer has the old box as the main box", () => {
  const moved: [string, MembershipNode[]][] = [
    [
      "another box is the main box and the old box sell-only",
      [
        node(primary.nodeId, "sell-only"),
        node(standby.nodeId, "serving-secondary"),
        node(THIRD_BOX, "serving-primary"),
      ],
    ],
    [
      "the old box evicted",
      [node(primary.nodeId, "evicted"), node(standby.nodeId, "serving-secondary")],
    ],
    ["the old box gone from it", [node(standby.nodeId, "serving-secondary")]],
  ];

  it.each(moved)(
    "%s: refused, before any hash, with nothing written",
    async (_name, nodes) => {
      const store = await placedSpare();
      const { app } = spareOn(store);
      const { input } = await selectName(app);
      const hashes = external.hashes;
      await chartMovesOn(store, nodes, 4);
      const chartBefore = await readNodeMembership(store.venue);
      const sifBefore = await sifRows(store);

      expect(await activate(app, input)).toMatchObject({
        status: 409,
        body: { error: { code: "handover.source_no_longer_main" } },
      });

      expect(external.hashes).toBe(hashes);
      expect(await readNodeMembership(store.venue)).toEqual(chartBefore);
      expect(await sifRows(store)).toEqual(sifBefore);
      expect(await activations(store)).toEqual([]);
      expect((await operationRow(store))?.state).toBe("filing_assumed");
    },
    60_000,
  );

  it("a chart fencing this box itself answers the promotion's own refusal", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    await chartMovesOn(
      store,
      [node(primary.nodeId, "serving-primary"), node(standby.nodeId, "sell-only")],
      4,
    );
    expect(await activate(app, input)).toMatchObject({
      status: 409,
      body: { error: { code: "promotion.node_fenced" } },
    });
    expect(await activations(store)).toEqual([]);
  }, 60_000);

  it("no chart at all is refused the same way", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    store.venue.run(sql`delete from node_membership`);
    expect(await activate(app, input)).toMatchObject({
      status: 409,
      body: { error: { code: "handover.source_no_longer_main" } },
    });
  }, 60_000);

  it("a chart taken while the password is being checked is refused inside the transaction", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    external.duringHash = async () => {
      external.duringHash = undefined;
      await chartMovesOn(
        store,
        [
          node(primary.nodeId, "sell-only"),
          node(standby.nodeId, "serving-secondary"),
          node(THIRD_BOX, "serving-primary"),
        ],
        4,
      );
    };
    expect(await activate(app, input)).toMatchObject({
      status: 409,
      body: { error: { code: "handover.source_no_longer_main" } },
    });
    expect(await activations(store)).toEqual([]);
    expect((await allocations(store)).filter((row) => row.nodeId === standby.nodeId)).toEqual([]);
    expect((await readNodeMembership(store.venue))?.body.term).toBe(4);
  }, 60_000);

  it("a chart too broken to read answers membership.held_untrusted", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    await writeNodeMembership(store.venue, {
      ...store.chart,
      body: { term: 5, nodes: "broken" },
    } as never);
    expect(await activate(app, input)).toMatchObject({
      status: 409,
      body: { error: { code: "membership.held_untrusted" } },
    });
  }, 60_000);

  it("control: a newer chart still naming the old box the main box activates, on top of it", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    await chartMovesOn(
      store,
      [node(primary.nodeId, "serving-primary"), node(standby.nodeId, "serving-secondary")],
      4,
    );
    expect((await activate(app, input)).body).toEqual({ activated: true, restarting: true });
    expect((await readNodeMembership(store.venue))?.body.term).toBe(5);
  }, 60_000);
});

describe("one activation at a time, and asking again", () => {
  it.each(["activated", "return_pending"] as const)(
    "at %s it answers activated with no sign-in, no body and no hash",
    async (state) => {
      const store = await placedSpare();
      const { app } = spareOn(store);
      const deps = { node: store.node, nodeId: standby.nodeId };
      await advanceHandover(deps, OPERATION, "activated", {});
      if (state === "return_pending") await advanceHandover(deps, OPERATION, state, {});
      const socket = new TLSSocket(new Socket());
      sockets.push(socket);
      const response = await app.request(
        `https://box.test/api/node/handover/${OPERATION}/activate`,
        { method: "POST" },
        { incoming: { socket } },
      );
      expect([response.status, await response.json()]).toEqual([
        200,
        { activated: true, restarting: false },
      ]);
      expect(external.hashes).toBe(0);
    },
    60_000,
  );

  it("a source's operation at a later state is not an activation", async () => {
    const store = { venue: spareBefore.db, node: spareBefore.node };
    const deps = { node: store.node, nodeId: standby.nodeId };
    await beginHandover(
      deps,
      {
        operationId: OPERATION,
        scenario: "controlled",
        venue: { country: "ES", taxId: "89890001K", environment: "preproduction" },
        sourceNodeId: standby.nodeId,
        destinationNodeId: primary.nodeId,
        membership: { term: 1, digest: "a".repeat(64) },
      },
      "source",
    );
    await advanceHandover(deps, OPERATION, "source_stepped_down", {});
    await advanceHandover(deps, OPERATION, "filing_relinquished", {});
    await advanceHandover(deps, OPERATION, "return_pending", {});
    expect(await activate(spareOn(store).app, null)).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
  });

  it("when the record of activated is lost, a request finds the box already primary and writes it", async () => {
    const store = await placedSpare();
    const { app, run, service } = spareOn(store);
    const { input } = await selectName(app);
    let first = true;
    const failingOnce: HandoverActivationDeps["run"] = (attestation, runner, beforeRestart) =>
      run(attestation, runner, async () => {
        if (first) {
          first = false;
          throw new Error("node.db write lost");
        }
        await beforeRestart?.();
      });
    const again = new Hono();
    mountHandoverActivationApi(again, {
      node: store.node,
      nodeId: standby.nodeId,
      appDb: store.venue,
      nodePreparation: service,
      run: failingOnce,
    });

    const lost = await activate(again, input);
    expect(lost.status, JSON.stringify(lost.body)).toBe(500);
    expect((await operationRow(store))?.state).toBe("filing_assumed");
    const count = (await allocations(store)).length;
    expect(await activations(store)).toHaveLength(1);

    expect((await activate(again, input)).body).toEqual({ activated: true, restarting: false });

    expect((await operationRow(store))?.state).toBe("activated");
    expect(await allocations(store)).toHaveLength(count);
    expect(await activations(store)).toHaveLength(1);
  }, 60_000);

  it("a primary with no row is refused handover.step_out_of_order, and is never marked", async () => {
    const store = await placedSpare();
    const { app, service } = spareOn(store);
    const { input } = await selectName(app);
    const already = new Hono();
    mountHandoverActivationApi(already, {
      node: store.node,
      nodeId: standby.nodeId,
      appDb: store.venue,
      nodePreparation: service,
      run: async () => ({ alreadyPrimary: true, restarting: false }),
    });
    expect(await activate(already, input)).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
    expect((await operationRow(store))?.state).toBe("filing_assumed");
  }, 60_000);

  it("two at once take one name and write one row, and each gets its own answer", async () => {
    const store = await placedSpare();
    const { app, steps } = spareOn(store);
    const { input } = await selectName(app);
    const [one, two, wrong] = await Promise.all([
      activate(app, input),
      activate(app, input),
      activate(app, input, { signIn: { email: ADMIN_EMAIL, password: "wrong" } }),
    ]);
    expect(one.body).toEqual({ activated: true, restarting: true });
    expect(two.body).toEqual({ activated: true, restarting: false });
    // Behind the winner, this one finds the operation activated: no sign-in is asked for any more.
    expect(wrong.body).toEqual({ activated: true, restarting: false });
    expect((await allocations(store)).filter((row) => row.nodeId === standby.nodeId)).toHaveLength(
      1,
    );
    expect(await activations(store)).toHaveLength(1);
    expect(steps.filter((step) => step.startsWith("restart"))).toHaveLength(1);
  }, 60_000);

  it("a wrong password ahead of a right one does not pass its refusal on", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    const [wrong, right] = await Promise.all([
      activate(app, input, { signIn: { email: ADMIN_EMAIL, password: "wrong" } }),
      activate(app, input),
    ]);
    expect(wrong.status).toBe(401);
    expect(right.body).toEqual({ activated: true, restarting: true });
  }, 60_000);
});

describe("a lost reply, then a retry or a reboot", () => {
  /** A real close and reopen of the box's own files; the next `spareOn` is the new process. */
  async function rebooted(store: PlacedSpare): Promise<PlacedSpare> {
    await store.close();
    const opened = await openVenueDatabase(dirs().spareVenue);
    placed = { ...store, venue: opened.venue, node: opened.node, close: () => opened.close() };
    return placed;
  }
  const appRunning = (store: Store, service: Service, run: HandoverActivationDeps["run"]): Hono => {
    const app = new Hono();
    mountHandoverActivationApi(app, {
      node: store.node,
      nodeId: standby.nodeId,
      appDb: store.venue,
      nodePreparation: service,
      run,
    });
    return app;
  };
  const everything = async (store: Store) => ({
    sif: await sifRows(store),
    allocations: await allocations(store),
    activations: await activations(store),
    chart: await readNodeMembership(store.venue),
  });

  it("a lost activation answer, then a retry with the same operation, answers activated and takes no second name", async () => {
    const first = await placedSpare();
    const { app } = spareOn(first);
    const { input, identity } = await selectName(app);
    expect((await activate(app, input)).body).toEqual({ activated: true, restarting: true });
    const before = await everything(first);
    expect(before.allocations.filter((row) => row.nodeId === standby.nodeId)).toHaveLength(1);
    const hashes = external.hashes;

    const store = await rebooted(first);
    const after = spareOn(store);
    const retry = await activate(after.app, input);

    expect(retry).toEqual({
      status: 200,
      cache: "no-store",
      body: { activated: true, restarting: false },
    });
    expect(external.hashes).toBe(hashes);
    expect(await everything(store)).toEqual(before);
    expect(after.steps).toEqual([]);
    expect(before.sif.filter((row) => row.nodeId === standby.nodeId)).toMatchObject([
      { numeroInstalacion: identity },
    ]);
    expect((await operationRow(store))?.state).toBe("activated");
    expect((await readNodeMode(store.node, standby.nodeId)).mode).toBe("primary");
  }, 60_000);

  it("after a lost answer, a browser asking for a name again is refused one", async () => {
    const first = await placedSpare();
    const { app } = spareOn(first);
    await activate(app, (await selectName(app)).input);
    const before = await everything(first);

    const store = await rebooted(first);
    const answer = await request(spareOn(store).app, "preparation", {
      moduleOperation: { binding, input: null },
      signIn,
      proposal: { action: "clock-challenge" },
    });

    expect(answer).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
    expect(await everything(store)).toEqual(before);
  }, 60_000);

  it("a throw right after the venue save: the retry finishes the role and activated, with no second name", async () => {
    const first = await placedSpare();
    const crashing = spareOn(first);
    const { input } = await selectName(crashing.app);
    const crashApp = appRunning(first, crashing.service, (attestation, runner, beforeRestart) =>
      crashing.run(
        attestation,
        async (context, consume) => {
          await runner(context, consume);
          throw new Error("stopped here");
        },
        beforeRestart,
      ),
    );
    expect((await activate(crashApp, input)).status).toBe(500);
    const before = await everything(first);
    expect(before.activations).toHaveLength(1);
    expect(before.chart?.signerNodeId).toBe(standby.nodeId);
    expect((await operationRow(first))?.state).toBe("filing_assumed");
    expect((await readNodeMode(first.node, standby.nodeId)).mode).toBe("mirror");
    const hashes = external.hashes;

    const store = await rebooted(first);
    const after = spareOn(store);
    const retry = await activate(after.app, input);

    expect(retry.body).toEqual({ activated: true, restarting: true });
    expect(external.hashes).toBe(hashes + 1);
    expect(await everything(store)).toEqual(before);
    expect(after.steps).toEqual(["role primary", "restart at activated"]);
    expect((await operationRow(store))?.state).toBe("activated");
    expect((await readNodeMode(store.node, standby.nodeId)).mode).toBe("primary");
  }, 60_000);

  it("a throw after the role and before activated: a wrong password records nothing, and retries at once record it once", async () => {
    const first = await placedSpare();
    const crashing = spareOn(first);
    const { input } = await selectName(crashing.app);
    const crashApp = appRunning(first, crashing.service, (attestation, runner) =>
      crashing.run(attestation, runner, async () => {
        throw new Error("stopped here");
      }),
    );
    expect((await activate(crashApp, input)).status).toBe(500);
    const before = await everything(first);
    expect((await operationRow(first))?.state).toBe("filing_assumed");
    expect((await readNodeMode(first.node, standby.nodeId)).mode).toBe("primary");

    const store = await rebooted(first);
    const after = spareOn(store);
    expect(
      await activate(after.app, input, { signIn: { email: ADMIN_EMAIL, password: "wrong" } }),
    ).toMatchObject({ status: 401, body: { error: { code: "password.invalid" } } });
    expect((await operationRow(store))?.state).toBe("filing_assumed");

    const hashes = external.hashes;
    const retries = await Promise.all([activate(after.app, input), activate(after.app, input)]);

    expect(retries.map((retry) => retry.body)).toEqual([
      { activated: true, restarting: false },
      { activated: true, restarting: false },
    ]);
    expect(external.hashes).toBe(hashes + 1);
    expect(await everything(store)).toEqual(before);
    expect(after.steps).toEqual([]);
    expect((await operationRow(store))?.state).toBe("activated");
  }, 60_000);

  it("a throw right after consume stores neither chart nor row, and a retry activates under the selected name", async () => {
    const first = await placedSpare();
    const crashing = spareOn(first);
    const { input, identity } = await selectName(crashing.app);
    const before = await everything(first);
    const throwing = appRunning(first, crashing.service, (attestation, runner, beforeRestart) =>
      crashing.run(
        attestation,
        (context, consume) =>
          runner(context, async (tx, operations) => {
            await consume(tx, operations);
            throw new Error("injected after consume");
          }),
        beforeRestart,
      ),
    );

    expect((await activate(throwing, input)).status).toBe(500);

    expect(await everything(first)).toEqual(before);
    expect((await operationRow(first))?.state).toBe("filing_assumed");
    expect((await readNodeMode(first.node, standby.nodeId)).mode).toBe("mirror");

    expect((await activate(spareOn(first, crashing.service).app, input)).body).toEqual({
      activated: true,
      restarting: true,
    });
    const own = (await sifRows(first)).filter((row) => row.nodeId === standby.nodeId);
    expect(own.map((row) => row.numeroInstalacion)).toEqual([identity]);
    expect(await activations(first)).toHaveLength(1);
    expect((await allocations(first)).filter((row) => row.nodeId === standby.nodeId)).toHaveLength(
      1,
    );
  }, 60_000);

  it("a reboot after that throw refuses the kept name until the clocks are compared again, and then takes one name", async () => {
    const first = await placedSpare();
    const crashing = spareOn(first);
    const { input } = await selectName(crashing.app);
    const throwing = appRunning(first, crashing.service, (attestation, runner, beforeRestart) =>
      crashing.run(
        attestation,
        (context, consume) =>
          runner(context, async (tx, operations) => {
            await consume(tx, operations);
            throw new Error("injected after consume");
          }),
        beforeRestart,
      ),
    );
    await activate(throwing, input);
    const before = await everything(first);

    const store = await rebooted(first);
    const after = spareOn(store);
    expect(await activate(after.app, input)).toMatchObject({
      status: 400,
      body: { error: { code: "sif.allocation_invalid", params: { reason: "clock_stale" } } },
    });
    expect(await everything(store)).toEqual(before);
    expect((await operationRow(store))?.state).toBe("filing_assumed");

    const again = await selectName(after.app);
    expect((await activate(after.app, again.input)).body).toEqual({
      activated: true,
      restarting: true,
    });
    const own = (await sifRows(store)).filter((row) => row.nodeId === standby.nodeId);
    expect(own.map((row) => row.numeroInstalacion)).toEqual([again.identity]);
    expect(await activations(store)).toHaveLength(1);
    expect((await allocations(store)).filter((row) => row.nodeId === standby.nodeId)).toHaveLength(
      1,
    );
  }, 60_000);

  it("a throw after the venue save: a fresh name asked for before the retry is not a second name", async () => {
    const first = await placedSpare();
    const crashing = spareOn(first);
    const { input } = await selectName(crashing.app);
    const crashApp = appRunning(first, crashing.service, (attestation, runner, beforeRestart) =>
      crashing.run(
        attestation,
        async (context, consume) => {
          await runner(context, consume);
          throw new Error("stopped here");
        },
        beforeRestart,
      ),
    );
    await activate(crashApp, input);
    const before = await everything(first);

    const store = await rebooted(first);
    const after = spareOn(store);
    vi.setSystemTime(new Date("2026-10-16T12:50:00Z"));
    const asked = async (proposal: unknown) =>
      request(after.app, "preparation", {
        moduleOperation: { binding, input: null },
        signIn,
        proposal,
      });
    const challenge = (await asked({ action: "clock-challenge" })).body as { id?: string };
    const compared = await asked({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
    const fresh = await asked({
      action: "select",
      comparisonId: (compared.body as { id?: string }).id,
    });

    expect(fresh).toMatchObject({
      status: 400,
      body: { error: { code: "sif.allocation_invalid", params: { reason: "minute_in_use" } } },
    });
    expect((await activate(after.app, input)).body).toEqual({ activated: true, restarting: true });
    expect(await everything(store)).toEqual(before);
  }, 60_000);
});

describe("one password hash for every failed sign-in", () => {
  it("an unknown email and a wrong password get the same answer after one password hash each", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    const { input } = await selectName(app);
    await seedPersons(store.venue, [
      {
        displayName: "Suspended",
        role: "admin",
        status: "suspended",
        passwordHash: hashPassword(PASSWORD),
        email: "suspended@venue.test",
      },
      { displayName: "No password", role: "admin", email: "nopassword@venue.test" },
    ]);
    const answers = [];
    for (const attempt of [
      { email: "nobody@venue.test", password: PASSWORD },
      { email: ADMIN_EMAIL, password: "wrong" },
      { email: "suspended@venue.test", password: PASSWORD },
      { email: "nopassword@venue.test", password: PASSWORD },
    ]) {
      const hashes = external.hashes;
      const answer = await activate(app, input, { signIn: attempt });
      expect(external.hashes - hashes).toBe(1);
      answers.push(answer);
    }
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(answers[0]).toMatchObject({
      status: 401,
      body: { error: { code: "password.invalid" } },
    });

    const hashes = external.hashes;
    expect((await activate(app, input)).body).toEqual({ activated: true, restarting: true });
    expect(external.hashes - hashes).toBe(1);
  }, 60_000);
});

describe("a clock step made while the handover page is open", () => {
  const STEP = {
    confirmationId: null,
    source: "admin",
    person: "Admin",
    deviceId: null,
    device: null,
    before: "2026-10-16T12:39:00.000Z",
    beforeOffsetMinutes: 0,
    after: "2026-10-16T12:40:00.000Z",
    afterOffsetMinutes: 0,
    stepMs: 60_000,
    direction: "forward",
    verified: false,
    unverified: true,
    byAdmin: true,
    byStaff: false,
  } as const;

  /** As the next start finds the folder: placement runs first, then the venue file is opened. */
  async function restart(): Promise<PlacedSpare> {
    const before = placed!;
    await before.close();
    placed = undefined;
    const { spareState, spareVenue } = dirs();
    await placeAcceptedCopyAtStart({
      venueDir: spareVenue,
      stateDir: spareState,
      nodeId: standby.nodeId,
      log: () => {},
    });
    const opened = await openVenueDatabase(spareVenue);
    placed = { ...before, venue: opened.venue, node: opened.node, close: () => opened.close() };
    return placed;
  }

  async function queuedEmails(store: PlacedSpare, incidentId: string) {
    const primaryNow = (await readNodeMode(store.node, standby.nodeId)).mode === "primary";
    const armed: (() => void)[] = [];
    const duty = startBoxEmailDuty({
      db: store.venue,
      now: () => new Date(),
      disk: { since: () => null },
      space: { current: () => ({ freeBytes: null, readAt: null, lowSince: null }) },
      moduleNotices: async () => ({ notices: [], unavailable: [] }),
      emailedIncidents: () => readOpenEmailedIncidents(store.venue),
      backupStopped: () => undefined,
      context: async () => ({
        venue: "Venue",
        recipients: [{ personId: ADMIN, email: ADMIN_EMAIL, language: "en" }],
        delivery: { mode: "smtp", smtp: { url: "smtp://127.0.0.1:1", from: "box@venue.test" } },
      }),
      send: async () => "sent",
      isPrimary: () => primaryNow,
      intervalMs: BOX_EMAIL_CHECK_MS,
      log: () => {},
      timer: (_ms, fn) => {
        armed.push(fn);
        return { cancel: () => {} };
      },
    });
    try {
      armed[0]!();
      await vi.waitFor(() => expect(armed.length).toBe(2));
    } finally {
      await duty.stop();
    }
    return store.venue.select().from(outgoingMail).where(eq(outgoingMail.subjectId, incidentId));
  }

  async function stepThenActivate(store: PlacedSpare, app: Hono) {
    const { input } = await selectName(app);
    const step = await withTransaction(store.venue, (tx) =>
      recordCorrected(tx, { detectedAt: new Date(), params: STEP }),
    );
    expect((await activate(app, input)).body).toEqual({ activated: true, restarting: true });
    return step.id;
  }

  async function stillOpenAfterRestart(id: string) {
    const after = await restart();
    expect((await readNodeMode(after.node, standby.nodeId)).mode).toBe("primary");
    const open = await readOpenEmailedIncidents(after.venue);
    expect(open.map((row) => [row.id, row.code])).toEqual([[id, "clock.corrected"]]);
    const mail = await queuedEmails(after, id);
    expect(mail.map((row) => [row.kind, row.personId, row.status])).toEqual([
      ["box_alert", ADMIN, "pending"],
    ]);
  }

  it("at filing_assumed, stays open through activation and its restart, and the main box queues its email", async () => {
    const store = await placedSpare();
    const { app } = spareOn(store);
    await stillOpenAfterRestart(await stepThenActivate(store, app));
  }, 60_000);

  it("at emergency_declared, stays open through activation and its restart, and the main box queues its email", async () => {
    const s = await emergencySpare();
    await stillOpenAfterRestart(await stepThenActivate(s.store, s.app));
  }, 60_000);

  it("control: on the spare before activation, the duty queues nothing for it", async () => {
    const store = await placedSpare();
    spareOn(store);
    const step = await withTransaction(store.venue, (tx) =>
      recordCorrected(tx, { detectedAt: new Date(), params: STEP }),
    );
    expect(await queuedEmails(store, step.id)).toEqual([]);
  }, 60_000);
});
