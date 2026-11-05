import { Socket } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { Agent } from "undici";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  locations,
  nodes,
  stampDeployment,
  tenants,
  withNodeTransaction,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing } from "@waitron/credentials";
import { ALLOCATED_FISCAL_STANDBY } from "@waitron/fiscal-verifactu/src/allocated-standby.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { hashPassword, managementSessions, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  withOperationAuthority,
  withPreparedModuleOperations,
  type OperationBinding,
} from "@waitron/module";
import {
  appendHandoverEventTx,
  readHandoverOperation,
  setNodeMode,
  writeMirrorLink,
  type HandoverOperation,
} from "@waitron/node-db";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import { locationId } from "@waitron/shared";
import { startServer, type StartedServer } from "./boot.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { COPY_PLACED_EVENT } from "./handover-place-copy.js";
import {
  assertBindingNamesOperation,
  handoverPromotionContext,
  mountHandoverPreparationApi,
} from "./handover-preparation.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { establishNodeIdentity } from "./node-identity.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { freePorts } from "./testing/free-ports.js";

const external = vi.hoisted(() => ({
  internet: vi.fn(),
  hashes: 0,
  duringHash: undefined as undefined | (() => Promise<void>),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
// The real key derivation, counted, so "the same hashing work" is a number a case can read.
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
const suite = useVenueDb({ migrations });
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const standby = { ...primary, nodeId: TENANT_A.nodeId2 };
const OPERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN = "e1000000-0000-4000-8000-000000000004";
const ADMIN_EMAIL = "admin@venue.test";
const PASSWORD = "synthetic-handover-password";
const passwordHash = hashPassword(PASSWORD);
const signIn = { email: ADMIN_EMAIL, password: PASSWORD };
const credentials = { personId: ADMIN, password: PASSWORD };
const MODULE = "fiscal-verifactu";
const binding: OperationBinding = {
  module: MODULE,
  action: "promote",
  eventId: OPERATION,
  sourceId: primary.nodeId,
  targetNodeId: standby.nodeId,
};
const fiscalModules = ALL_MODULES.filter((module) => module.name === MODULE);
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const store = () => ({ node: suite.node, nodeId: standby.nodeId });
let root: string;
const sockets: TLSSocket[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "handover-preparation-"));
  await mkdir(join(root, "state"));
  await mkdir(join(root, "venue"));
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
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Handover SL" });
  await suite.db.insert(locations).values({
    id: primary.locationId,
    name: "Restaurant",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
  });
  await suite.db.insert(nodes).values(
    [primary, standby].map((node) => ({
      id: node.nodeId,
      locationId: node.locationId,
      name: node === primary ? "Primary" : "Standby",
      filingModule: "verifactu",
      taxModule: "vat",
    })),
  );
  await stampDeployment(suite.db, "preproduction");
  await suite.db.insert(persons).values({
    id: ADMIN,
    displayName: "Administrator",
    role: "admin",
    passwordHash,
    email: ADMIN_EMAIL,
  });
  // The old box's own fiscal setup, which a promotion's selection reads as its history.
  let value: unknown = null;
  const first = { ...binding, action: "setup", eventId: "first", targetNodeId: primary.nodeId };
  const setup = createHourPreparation({
    withState: async (_binding, run) =>
      run({
        get value() {
          return value;
        },
        history: [],
        async replace(next) {
          value = next;
        },
      }),
    monotonicNow: () => performance.now(),
    read: async () => ({
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
      bases,
      contextKey: "first",
      history: [{ reference: "empty", complete: true, records: [] }],
      clock: compareHourClocks(
        ["box", "browser"].map((source) => ({
          source: source as "box" | "browser",
          result: "usable",
          instantMs: Date.now(),
          uncertaintyMs: 0,
          wallStartedMs: Date.now(),
          wallFinishedMs: Date.now(),
          monotonicStartedMs: 0,
          monotonicFinishedMs: 0,
        })),
        Date.parse("2026-10-15T00:00:00Z"),
      ),
    }),
  });
  await withOperationAuthority(first, ADMIN, async (authority) => {
    let selected = await setup.select({ binding: first, authority, comparisonId: "comparison" });
    if (selected.status === "waiting") {
      vi.advanceTimersByTime(selected.targetMs + 1 - Date.now());
      selected = await setup.select({ binding: first, authority, comparisonId: "comparison" });
    }
    if (selected.status !== "selected") throw new Error("first setup selection");
    await setup.prepare({ binding: first, authority, input: selected.input }, (ready) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, primary, ready)),
    );
  });
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, standby.nodeId);
  await setNodeMode({ venue: suite.db, node: suite.node }, standby.nodeId, "mirror");
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  while (sockets.length > 0) sockets.pop()?.destroy();
  if (root) await rm(root, { recursive: true, force: true });
});

function service(modules = fiscalModules) {
  return createNodeOperationPreparation({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    db: suite.db,
    nodeDb: suite.node,
    node: standby,
    modules,
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
}
type Service = ReturnType<typeof service>;

/** The dormant setup a promotion needs; the step that writes it for a handover is a later piece. */
async function seedDormant(s: Service, sourceId = primary.nodeId): Promise<void> {
  const reserve = { ...binding, action: "reserve", eventId: "admission", sourceId };
  let state: unknown;
  await s.withOperation(
    { binding: reserve, input: { kind: "hour-dormant", version: 1 } },
    credentials,
    {},
    async (modules, operations) =>
      withPreparedModuleOperations(modules, operations, standby.nodeId, "reserve", (ready) =>
        withTransaction(suite.db, async (tx) => {
          state = (await ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, ready.get(MODULE)))
            .state;
        }),
      ),
  );
  await s.withOperation(
    { binding: { ...reserve, action: "establish" }, input: state },
    credentials,
    {},
    async (modules, operations) =>
      withPreparedModuleOperations(modules, operations, standby.nodeId, "establish", (ready) =>
        withTransaction(suite.db, (tx) =>
          ALLOCATED_FISCAL_STANDBY.establish(tx, standby, state, ready.get(MODULE)),
        ),
      ),
  );
}

async function beginOperation(scenario: "controlled" | "emergency"): Promise<void> {
  await beginHandover(
    store(),
    {
      operationId: OPERATION,
      scenario,
      venue: { country: "ES", taxId: "89890001K", environment: "preproduction" },
      sourceNodeId: primary.nodeId,
      destinationNodeId: standby.nodeId,
      membership: { term: 1, digest: "a".repeat(64) },
    },
    "destination",
  );
}
async function recordPlaced(): Promise<void> {
  await withNodeTransaction(suite.node, (tx) =>
    appendHandoverEventTx(tx, {
      nodeId: standby.nodeId,
      operationId: OPERATION,
      kind: COPY_PLACED_EVENT,
      detail: {},
      envelope: null,
    }),
  );
}
async function controlledAtFilingAssumed({ placed = true } = {}): Promise<void> {
  await beginOperation("controlled");
  await advanceHandover(store(), OPERATION, "copy_accepted", {});
  await advanceHandover(store(), OPERATION, "filing_assumed", {});
  if (placed) await recordPlaced();
}
async function emergencyDeclared(): Promise<void> {
  await beginOperation("emergency");
  await advanceHandover(store(), OPERATION, "emergency_declared", {});
}
async function record(): Promise<HandoverOperation> {
  const row = await readHandoverOperation(suite.node, standby.nodeId, OPERATION);
  if (row === null) throw new Error("no operation");
  return row;
}

interface PreparationAnswer {
  id: string;
  clock: { secondClock: boolean; unavailable: unknown[] };
  input: { approval: unknown };
  error: { code: string };
}

function route(s: Service, requestFromBox: () => boolean = () => false) {
  const app = new Hono();
  mountHandoverPreparationApi(app, {
    node: suite.node,
    nodeId: standby.nodeId,
    appDb: suite.db,
    nodePreparation: s,
    requestFromBox,
  });
  return app;
}
async function post(
  app: Hono,
  body: unknown,
  { operationId = OPERATION, base = "https://box.test", headers = {} } = {},
): Promise<{ status: number; body: PreparationAnswer; cache: string | null }> {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  const response = await app.request(
    `${base}/api/node/handover/${operationId}/preparation`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    { incoming: { socket } },
  );
  return {
    status: response.status,
    body: (await response.json()) as PreparationAnswer,
    cache: response.headers.get("cache-control"),
  };
}
const request = (proposal: unknown, overrides: Record<string, unknown> = {}) => ({
  moduleOperation: { binding, input: null },
  signIn,
  proposal,
  ...overrides,
});
async function selectThrough(app: Hono, extra: Record<string, unknown> = {}) {
  const challenge = await post(app, request({ action: "clock-challenge" }, extra));
  expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
  const compared = await post(
    app,
    request(
      {
        action: "compare-clocks",
        browser: { challengeId: challenge.body.id, instantMs: Date.now() },
      },
      extra,
    ),
  );
  expect(compared.status, JSON.stringify(compared.body)).toBe(200);
  const selected = await post(
    app,
    request({ action: "select", comparisonId: compared.body.id }, extra),
  );
  expect(selected.status, JSON.stringify(selected.body)).toBe(200);
  return { challenge, compared, selected };
}
async function promoteWith(
  s: Service,
  input: unknown,
  context: ReturnType<typeof handoverPromotionContext>,
) {
  return s.withPromotion({ binding, input }, credentials, context, (modules, runner) =>
    promoteMirrorToPrimary(
      {
        db: suite.db,
        node: suite.node,
        nodeId: standby.nodeId,
        ring,
        modules,
        holders: createDeploymentHolders("mirror", "secondary"),
        log: () => {},
        persistTradingEnv: async () => {},
        withModuleOperations: runner,
      },
      { oldNodeNeutralised: true },
    ),
  );
}
const standbyAllocations = async () =>
  (await suite.db.select().from(fiscalAllocations)).filter((row) => row.nodeId === standby.nodeId);

describe("handoverPromotionContext", () => {
  const row = (scenario: "controlled" | "emergency") => ({ scenario });
  it("a controlled operation says the old box relinquished", () => {
    expect(handoverPromotionContext(row("controlled"))).toStrictEqual({
      oldNodeNeutralised: true,
      noParallelRecovery: true,
      oldMachineRelinquished: true,
    });
  });
  it("an emergency says it did not", () => {
    expect(handoverPromotionContext(row("emergency"))).toStrictEqual({
      oldNodeNeutralised: true,
      noParallelRecovery: true,
      oldMachineRelinquished: false,
    });
  });
});

describe("assertBindingNamesOperation", () => {
  const row = { operationId: OPERATION, sourceNodeId: primary.nodeId };

  it("passes the binding naming this operation, its source and this box", () => {
    expect(() => assertBindingNamesOperation(binding, row, standby.nodeId)).not.toThrow();
  });

  it.each([
    ["another action", { action: "establish" }],
    ["another target", { targetNodeId: primary.nodeId }],
    ["another event", { eventId: "promotion" }],
    ["another source", { sourceId: standby.nodeId }],
  ])("refuses %s, naming the module", (_name, changed) => {
    let refused: unknown;
    try {
      assertBindingNamesOperation({ ...binding, ...changed }, row, standby.nodeId);
    } catch (cause) {
      refused = cause;
    }
    expect(refused).toMatchObject({
      code: "module.operation_invalid",
      params: { module: MODULE },
    });
  });
});

describe("the handover's preparation route", () => {
  it("a controlled operation at filing_assumed gets a clock challenge and a comparison", async () => {
    const s = service();
    await seedDormant(s);
    await controlledAtFilingAssumed();
    const { challenge, compared, selected } = await selectThrough(route(s));
    expect(challenge.cache).toBe("no-store");
    expect(challenge.body).toMatchObject({ id: expect.any(String) });
    expect(compared.body.clock).toMatchObject({ secondClock: true });
    expect(selected.body).toMatchObject({ status: "selected", identity: "0CNQR", bases });
  });

  it("an emergency at emergency_declared prepares too, with no placed copy to wait for", async () => {
    const s = service();
    await seedDormant(s);
    await emergencyDeclared();
    const { selected } = await selectThrough(route(s));
    expect(selected.body).toMatchObject({ status: "selected", identity: "0CNQR" });
  });

  it("a body that sets oldMachineRelinquished is ignored: the context comes from the record", async () => {
    const s = service();
    await seedDormant(s);
    await emergencyDeclared();
    const claims = { oldMachineRelinquished: true, oldNodeNeutralised: false };
    const { selected } = await selectThrough(route(s), claims);
    expect(selected.body.input.approval).toMatchObject({ version: 1, oldMachineOffline: true });
    expect(selected.body.input.approval).not.toHaveProperty("oldMachineRelinquished");
  });

  it("a controlled record's relinquishment holds against a body denying it", async () => {
    const s = service();
    await seedDormant(s);
    await controlledAtFilingAssumed();
    const { selected } = await selectThrough(route(s), {
      oldMachineRelinquished: false,
      noParallelRecovery: false,
    });
    expect(selected.body.input.approval).toMatchObject({
      version: 2,
      oldMachineRelinquished: true,
      oldMachineOffline: false,
    });
  });

  it.each(["prepared", "copy_accepted"] as const)(
    "an operation at %s is refused handover.step_out_of_order, before any hash",
    async (state) => {
      const s = service();
      await beginOperation("controlled");
      if (state === "copy_accepted") await advanceHandover(store(), OPERATION, state, {});
      await recordPlaced();
      const answer = await post(route(s), request({ action: "clock-challenge" }));
      expect(answer).toMatchObject({
        status: 409,
        body: { error: { code: "handover.step_out_of_order" } },
      });
      expect(external.hashes).toBe(0);
    },
  );

  it("an activated operation is refused handover.step_out_of_order", async () => {
    await controlledAtFilingAssumed();
    await advanceHandover(store(), OPERATION, "activated", {});
    expect(await post(route(service()), request({ action: "clock-challenge" }))).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
  });

  it("the window between recording filing_assumed and the restart: refused until copy_placed", async () => {
    const s = service();
    await seedDormant(s);
    await controlledAtFilingAssumed({ placed: false });
    const app = route(s);
    const before = await post(app, request({ action: "clock-challenge" }));
    expect(before).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
    await recordPlaced();
    expect((await post(app, request({ action: "clock-challenge" }))).status).toBe(200);
  });

  it("an operation that moves on while the password is being checked is refused, leaving no session", async () => {
    const s = service();
    await seedDormant(s);
    await controlledAtFilingAssumed();
    const sessionsBefore = await suite.db.select().from(managementSessions);
    external.duringHash = async () => {
      external.duringHash = undefined;
      await advanceHandover(store(), OPERATION, "activated", {});
    };
    const answer = await post(route(s), request({ action: "clock-challenge" }));
    expect(answer).toMatchObject({
      status: 409,
      body: { error: { code: "handover.step_out_of_order" } },
    });
    expect(await suite.db.select().from(managementSessions)).toEqual(sessionsBefore);
  });

  it("an unknown operation and an id that is not one both get handover.operation_unknown", async () => {
    const app = route(service());
    for (const operationId of ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "..%2F..%2Fmembership"]) {
      expect(await post(app, request(null), { operationId })).toMatchObject({
        status: 404,
        body: { error: { code: "handover.operation_unknown" } },
      });
    }
    expect(external.hashes).toBe(0);
  });

  it("an over-long id is refused without being looked up or echoed", async () => {
    const answer = await post(route(service()), request(null), { operationId: "a".repeat(65) });
    expect(answer).toMatchObject({
      status: 400,
      body: { error: { code: "handover.request_invalid", params: { field: "operationId" } } },
    });
  });

  it("the row's own id, source and this box are what a binding must name", async () => {
    await controlledAtFilingAssumed();
    const app = route(service());
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    for (const changed of [
      { action: "reserve" },
      { action: "establish" },
      { targetNodeId: primary.nodeId },
      { eventId: other },
      { eventId: "promotion" },
      { sourceId: standby.nodeId },
      { sourceId: other },
    ]) {
      const answer = await post(
        app,
        request(null, { moduleOperation: { binding: { ...binding, ...changed }, input: null } }),
      );
      expect([changed, answer.status, answer.body.error]).toEqual([
        changed,
        400,
        { code: "module.operation_invalid", params: { module: MODULE } },
      ]);
    }
    expect(external.hashes).toBe(0);
  });

  it("a missing or malformed moduleOperation is refused module.operation_invalid", async () => {
    await controlledAtFilingAssumed();
    const app = route(service());
    for (const moduleOperation of [
      undefined,
      null,
      { binding },
      { binding: { ...binding, action: "restore" }, input: null },
    ]) {
      expect(await post(app, request(null, { moduleOperation }))).toMatchObject({
        status: 400,
        body: { error: { code: "module.operation_invalid", params: { module: "unknown" } } },
      });
    }
  });

  it("the browser on the box itself is refused as the second clock", async () => {
    const s = service();
    await seedDormant(s);
    await controlledAtFilingAssumed();
    external.internet.mockImplementation(async () => ({
      source: "internet",
      result: "unavailable",
      reason: "offline",
    }));
    const compare = async (onBox: boolean) => {
      const app = route(s, () => onBox);
      const challenge = await post(app, request({ action: "clock-challenge" }));
      const compared = await post(
        app,
        request({
          action: "compare-clocks",
          browser: { challengeId: challenge.body.id, instantMs: Date.now() },
        }),
      );
      return compared.body.clock;
    };
    const onBox = await compare(true);
    expect(onBox.secondClock).toBe(false);
    expect(onBox.unavailable).toContainEqual(
      expect.objectContaining({ source: "browser", reason: "same_machine" }),
    );
    expect((await compare(false)).secondClock).toBe(true);
  });

  it("after a prepare here, the activation with the same context is not refused event_mismatch", async () => {
    const s = service();
    await seedDormant(s);
    await controlledAtFilingAssumed();
    const { selected } = await selectThrough(route(s));
    expect(
      await promoteWith(s, selected.body.input, handoverPromotionContext(await record())),
    ).toMatchObject({ alreadyPrimary: false });
    const [allocation] = await standbyAllocations();
    expect(allocation?.approval).toMatchObject({ version: 2, oldMachineRelinquished: true });
  });

  it("control: prepared with the other scenario's context, the activation is refused event_mismatch", async () => {
    const s = service();
    await seedDormant(s);
    await emergencyDeclared();
    const { selected } = await selectThrough(route(s));
    const controlled = handoverPromotionContext({ scenario: "controlled" });
    await expect(promoteWith(s, selected.body.input, controlled)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
    expect(await standbyAllocations()).toEqual([]);
  });

  describe("sign-in by email", () => {
    const attempt = (app: Hono, who: Record<string, unknown>) =>
      post(app, request({ action: "clock-challenge" }, { signIn: who }));

    it("an unknown email and a wrong password get the same answer, password.invalid, after one hash each", async () => {
      const s = service();
      await seedDormant(s);
      await controlledAtFilingAssumed();
      const app = route(s);
      external.hashes = 0;
      const unknown = await attempt(app, { email: "nobody@venue.test", password: PASSWORD });
      expect(external.hashes).toBe(1);
      external.hashes = 0;
      const wrong = await attempt(app, { email: ADMIN_EMAIL, password: "not-the-password" });
      expect(external.hashes).toBe(1);
      expect(unknown).toEqual(wrong);
      expect(wrong).toMatchObject({
        status: 401,
        body: { error: { code: "password.invalid", params: {} } },
      });
      external.hashes = 0;
      expect((await attempt(app, signIn)).status).toBe(200);
      expect(external.hashes).toBe(1);
    });

    it("a suspended account gets that same answer after one hash", async () => {
      const s = service();
      await seedDormant(s);
      await controlledAtFilingAssumed();
      await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, ADMIN));
      external.hashes = 0;
      expect(await attempt(route(s), signIn)).toMatchObject({
        status: 401,
        body: { error: { code: "password.invalid" } },
      });
      expect(external.hashes).toBe(1);
    });

    it("a person without node.promote is refused authorization.not_permitted", async () => {
      const s = service();
      await seedDormant(s);
      await controlledAtFilingAssumed();
      await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, ADMIN));
      expect(await attempt(route(s), signIn)).toMatchObject({
        status: 403,
        body: { error: { code: "authorization.not_permitted" } },
      });
    });

    it("malformed sign-ins are all password.invalid, and a person id or break-glass secret signs nobody in", async () => {
      await controlledAtFilingAssumed();
      const app = route(service());
      for (const who of [
        undefined,
        null,
        [],
        "admin",
        {},
        { password: PASSWORD },
        { email: 7, password: PASSWORD },
        { email: ADMIN_EMAIL },
        { email: ADMIN_EMAIL, password: 7 },
        { email: ADMIN_EMAIL, password: PASSWORD, totp: 7 },
        { personId: ADMIN, password: PASSWORD },
        { breakGlass: "any-secret" },
      ]) {
        const answer = await attempt(app, who as Record<string, unknown>);
        expect([who, answer.status, answer.body.error.code]).toEqual([
          who,
          401,
          "password.invalid",
        ]);
      }
    });

    it("the box's real break-glass secret inside sign-in does not stand in for the password", async () => {
      const s = service();
      await seedDormant(s);
      await controlledAtFilingAssumed();
      const key = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, standby.nodeId);
      expect(
        await attempt(route(s), {
          email: ADMIN_EMAIL,
          password: "not-the-password",
          breakGlass: key.secret,
        }),
      ).toMatchObject({ status: 401, body: { error: { code: "password.invalid" } } });
    });

    it("a top-level breakGlass or personId beside a wrong sign-in does not get through", async () => {
      await controlledAtFilingAssumed();
      const answer = await post(
        route(service()),
        request(
          { action: "clock-challenge" },
          {
            breakGlass: "any-secret",
            personId: ADMIN,
            password: PASSWORD,
            signIn: { email: ADMIN_EMAIL, password: "not-the-password" },
          },
        ),
      );
      expect(answer).toMatchObject({ status: 401, body: { error: { code: "password.invalid" } } });
    });
  });

  it("a plain-HTTP or cross-origin request is refused authorization.not_permitted, before anything else", async () => {
    const s = service();
    await controlledAtFilingAssumed();
    const app = route(s);
    const plain = await app.request(`http://box.test/api/node/handover/${OPERATION}/preparation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request({ action: "clock-challenge" })),
    });
    expect([plain.status, await plain.json()]).toEqual([
      403,
      { error: { code: "authorization.not_permitted", params: { permission: "node.promote" } } },
    ]);
    for (const headers of [
      { Origin: "https://elsewhere.test" },
      { "Sec-Fetch-Site": "cross-site" },
    ]) {
      expect(await post(app, request({ action: "clock-challenge" }), { headers })).toMatchObject({
        status: 403,
        body: { error: { code: "authorization.not_permitted" } },
      });
    }
    expect(
      await post(app, request(null), {
        headers: { Origin: "https://elsewhere.test" },
        operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).toMatchObject({ status: 403 });
    expect(external.hashes).toBe(0);
    expect(
      await readModulePreparationHistory(
        { stateDir: join(root, "state"), venueDir: join(root, "venue") },
        MODULE,
      ),
    ).toEqual([]);
  });

  it("a real mirror start serves the route over verified HTTPS", async () => {
    const s = service();
    await seedDormant(s);
    await controlledAtFilingAssumed();
    await writeMirrorLink(suite.node, standby.nodeId, {
      relayUrl: "https://127.0.0.1:1/",
      boxHostname: "box.test",
      boxCaPem: "unused-ca",
      originNodeId: primary.nodeId,
    });
    for (const [index, set] of manifestSets().entries())
      await cp(migrations[index]!.migrationsFolder, join(root, "migrations", set.name), {
        recursive: true,
      });
    const stateDir = join(root, "state");
    await ensureBoxSecrets({ stateDir, hostnames: ["localhost"], now: () => new Date() });
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { [MODULE]: true, "fiscal-none": false } }),
    );
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    let server: StartedServer | undefined;
    let agent: Agent | undefined;
    try {
      server = await startServer({
        WAITRON_VENUE_DIR: dirname(database),
        WAITRON_STATE_DIR: stateDir,
        WAITRON_MIGRATIONS_DIR: join(root, "migrations"),
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_NODE_ID: standby.nodeId,
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_ENV: "dev",
        WAITRON_MANAGEMENT_RP_ID: "localhost",
        WAITRON_MANAGEMENT_ORIGIN: `https://localhost:${port}`,
      });
      agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
      const send = async (proposal: unknown) => {
        const response = await fetch(
          `https://127.0.0.1:${port}/api/node/handover/${OPERATION}/preparation`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Origin: `https://127.0.0.1:${port}`,
              "Sec-Fetch-Site": "same-origin",
            },
            body: JSON.stringify(request(proposal)),
            dispatcher: agent,
          } as RequestInit,
        );
        const value = (await response.json()) as { id: string };
        expect(response.status, JSON.stringify(value)).toBe(200);
        return value;
      };
      const challenge = await send({ action: "clock-challenge" });
      expect(challenge.id).toEqual(expect.any(String));
      expect(
        await send({
          action: "compare-clocks",
          browser: { challengeId: challenge.id, instantMs: Date.now() },
        }),
      ).toMatchObject({ clock: expect.any(Object) });
    } finally {
      await agent?.close();
      await server?.close();
    }
  }, 120_000);
});
