import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTenant,
  stampDeployment,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing } from "@waitron/credentials";
import { sha256Hex, signEnvelope, type HandoverBinding } from "@waitron/handover";
import { hashPassword, hashPin, hashSecret, managementSessions, persons } from "@waitron/identity";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ModuleOperationPreparation, WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import {
  nodeHandoverEvents,
  nodeHandoverOperations,
  readNodeMode,
  setNodeMode,
  setRecoveryKeyTx,
} from "@waitron/node-db";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { AppError, locationId, nodeId } from "@waitron/shared";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { imageMigrationsDigest } from "./handover-manifest.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { mountPromoteApi, type PromoteRunResult } from "./promote-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";

// The promote routes beside the offer route on one real database: the real sign-ins and the real
// preparation service. Only the promotion's `run` and a module's `recovery` are doubled, so a case
// can hold them open.

const holds = vi.hoisted(() => ({
  recordingOffer: undefined as undefined | (() => Promise<void>),
  signingIn: undefined as undefined | (() => Promise<void>),
  afterReadingOpenOperation: undefined as undefined | (() => Promise<void>),
}));
vi.mock("@waitron/node-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/node-db")>();
  return {
    ...actual,
    readOpenHandoverOperation: async (
      ...args: Parameters<typeof actual.readOpenHandoverOperation>
    ) => {
      const open = await actual.readOpenHandoverOperation(...args);
      await holds.afterReadingOpenOperation?.();
      return open;
    },
  };
});
vi.mock("./handover-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handover-store.js")>();
  return {
    ...actual,
    beginHandoverFromOffer: async (...args: Parameters<typeof actual.beginHandoverFromOffer>) => {
      await holds.recordingOffer?.();
      return actual.beginHandoverFromOffer(...args);
    },
  };
});
vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  return {
    ...actual,
    checkManagerPassword: async (...args: Parameters<typeof actual.checkManagerPassword>) => {
      await holds.signingIn?.();
      return actual.checkManagerPassword(...args);
    },
  };
});

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE = { nodeId: "11111111-1111-4111-8111-111111111111", ...generateNodeKeyPair() };
const AUTHORISER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LOCATION = "c0000000-0000-4000-8000-000000000001";
const PASSWORD = "promotePass123";
const KEY = "paper-key";
const RESTARTING: PromoteRunResult = { alreadyPrimary: false, restarting: true };

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type RunDouble = () => Promise<PromoteRunResult>;
type RecoveryDouble = () => Promise<unknown>;

let self: string;
let personId: string;
let binding: HandoverBinding;
let app: Hono;
let socket: TLSSocket;
let stateRoot: string;
let run: ReturnType<typeof vi.fn<RunDouble>>;
let recovery: ReturnType<typeof vi.fn<RecoveryDouble>>;

function regimeModule(): WaitronModule {
  const configured: ModuleOperationPreparation = {
    prepare: async (operation, consume) => consume(operation),
    recovery: () => recovery(),
  };
  return fakeModule("test-regime", {
    provisioning: {
      standby: { activate: async () => undefined },
    } as unknown as WaitronModule["provisioning"],
    operations: { ...configured, configure: () => configured },
  });
}

beforeEach(async () => {
  holds.recordingOffer = undefined;
  holds.signingIn = undefined;
  holds.afterReadingOpenOperation = undefined;
  await seedVenue(suite.db);
  self = await seedNode(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, self);
  await setNodeMode({ venue: suite.db, node: suite.node }, self, "mirror");
  await pinMainBoxKey(suite.node, self, { nodeId: SOURCE.nodeId, publicKey: SOURCE.publicKey });
  await withNodeTransaction(suite.node, (tx) =>
    setRecoveryKeyTx(tx, self, hashSecret(KEY), "paper-1"),
  );
  const selfKey = await readNodeIdentityKey(suite.node, RING, self);
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: [
      { nodeId: SOURCE.nodeId, contactUrl: "https://box-0", standing: "serving-primary" },
      { nodeId: self, contactUrl: "https://box-1", standing: "serving-secondary" },
    ],
  };
  const held: SignedMembershipDocument = {
    body,
    signerNodeId: self,
    signature: signDocumentBody(body, selfKey),
    endorsements: [endorseKey(SOURCE.nodeId, SOURCE.publicKey, self, selfKey)],
  };
  await writeNodeMembership(suite.db, held);
  const tenant = await readTenant(suite.db);
  binding = {
    operationId: OP,
    scenario: "controlled",
    venue: { country: tenant!.country, taxId: tenant!.taxId, environment: "preproduction" },
    sourceNodeId: SOURCE.nodeId,
    destinationNodeId: self,
    membership: { term: 3, digest: sha256Hex(canonicalize(held as unknown as CanonicalValue)) },
  };
  personId = await withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role: "admin",
      })
      .returning({ id: persons.id });
    return person!.id;
  });

  run = vi.fn<RunDouble>(async () => RESTARTING);
  recovery = vi.fn<RecoveryDouble>(async () => ({ prepared: true }));
  stateRoot = await mkdtemp(join(tmpdir(), "promote-api-handover-"));
  const modules = [regimeModule()];
  app = new Hono();
  mountHandoverDestinationApi(
    app,
    {
      db: suite.db,
      node: suite.node,
      ring: RING,
      nodeId: self,
      stateDir: stateRoot,
      migrationsRoot: null,
    },
    () => undefined,
  );
  mountPromoteApi(app, {
    appDb: suite.db,
    nodeDb: suite.node,
    nodeId: self,
    credentialKeyRing: TOTP_KEY_RING,
    modules,
    run: () => run(),
    requestFromBox: () => false,
    nodePreparation: createNodeOperationPreparation({
      db: suite.db,
      nodeDb: suite.node,
      node: { nodeId: nodeId(self), locationId: locationId(LOCATION) },
      modules,
      credentialKeyRing: TOTP_KEY_RING,
      stateDir: join(stateRoot, "state"),
      venueDir: join(stateRoot, "venue"),
      coordinator: createFirstSetupCoordinator(),
      environment: {},
    }),
  });
  socket = new TLSSocket(new Socket());
});

afterEach(async () => {
  socket.destroy();
  await rm(stateRoot, { recursive: true, force: true });
});

type Route = "/management-api/promote" | "/management-api/promote/preparation";
const PROMOTE: Route = "/management-api/promote";
const PREPARATION: Route = "/management-api/promote/preparation";
interface Attempt {
  route: Route;
  body: Record<string, unknown>;
  https?: boolean;
}

async function answerOf(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

async function attempt({
  route,
  body,
  https,
}: Attempt): Promise<{ status: number; body: unknown }> {
  const url = `http${https === true ? "s" : ""}://box.test${route}`;
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  return answerOf(
    await (https === true
      ? app.request(url, init, { incoming: { socket } })
      : app.request(url, init)),
  );
}

function offer(
  overrides: Partial<HandoverBinding> = {},
): Promise<{ status: number; body: unknown }> {
  const envelope = signEnvelope(
    "stepdown",
    {
      binding: { ...binding, ...overrides },
      authorisedBy: AUTHORISER,
      settings: { backupSettings: null, moduleSettings: null, ringVersions: [1] },
      imageMigrations: imageMigrationsDigest(null),
    } as unknown as CanonicalValue,
    SOURCE,
  );
  return Promise.resolve(
    app.request("/api/node/handover/offer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    }),
  ).then(answerOf);
}

const stateOf = (answer: { status: number; body: unknown }) => ({
  status: answer.status,
  state: (answer.body as { body?: { state?: unknown } }).body?.state,
});

const refusal = (status: number, code: string, params: object = {}) => ({
  status,
  body: { error: { code, params } },
});

const moduleOperation = () => ({
  binding: {
    module: "test-regime",
    action: "promote",
    eventId: "event-1",
    sourceId: "promotion-1",
    targetNodeId: self,
  },
  input: null,
});

/** The fence and sole-recovery answers both preparation paths ask before any sign-in. */
const answers = { oldNodeNeutralised: true, noParallelRecovery: true };

/** Every way into the promotion itself, each with the right credentials. */
function promotions(): Record<string, Attempt> {
  const password = { personId, password: PASSWORD };
  const module = { moduleOperation: moduleOperation(), oldNodeNeutralised: true };
  return {
    password: { route: PROMOTE, body: { oldNodeNeutralised: true, ...password } },
    "break-glass key": { route: PROMOTE, body: { oldNodeNeutralised: true, breakGlass: KEY } },
    "module operation, password": { route: PROMOTE, body: { ...module, ...password } },
    "module operation, key": { route: PROMOTE, body: { ...module, breakGlass: KEY } },
    "module operation, noParallelRecovery, password": {
      route: PROMOTE,
      https: true,
      body: { ...module, ...answers, ...password },
    },
    "module operation, noParallelRecovery, key": {
      route: PROMOTE,
      https: true,
      body: { ...module, ...answers, breakGlass: KEY },
    },
  };
}

/** The promotion's ways in and the preparation's, each with the right credentials. */
function rightCredentials(): Record<string, Attempt> {
  const operation = { moduleOperation: moduleOperation(), ...answers };
  return {
    ...promotions(),
    "preparation, password": {
      route: PREPARATION,
      https: true,
      body: { ...operation, personId, password: PASSWORD },
    },
    "preparation, key": {
      route: PREPARATION,
      https: true,
      body: { ...operation, breakGlass: KEY },
    },
  };
}

async function answersTo(attempts: Record<string, Attempt>): Promise<Record<string, unknown>> {
  const answered: Record<string, unknown> = {};
  for (const [name, sent] of Object.entries(attempts)) answered[name] = await attempt(sent);
  return answered;
}

const sessions = () => suite.db.select().from(managementSessions);

async function recorded(): Promise<{ operations: unknown[]; events: unknown[] }> {
  return {
    operations: await suite.node.select().from(nodeHandoverOperations),
    events: await suite.node.select().from(nodeHandoverEvents),
  };
}

const NOTHING_RECORDED = { operations: [], events: [] };

async function openOperation(): Promise<void> {
  const store = { node: suite.node, nodeId: self };
  await beginHandover(store, binding, "destination");
  await advanceHandover(store, OP, "copy_accepted", {});
}

describe("the open-operation refusal comes after the sign-in", () => {
  it("right credentials on every path are refused naming the operation, and nothing is written", async () => {
    await openOperation();
    const before = await recorded();
    const attempts = rightCredentials();

    const answered = await answersTo(attempts);

    const refused = refusal(409, "handover.operation_in_progress", { operationId: OP });
    expect(answered).toEqual(Object.fromEntries(Object.keys(attempts).map((n) => [n, refused])));
    expect(run).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
    expect(await sessions()).toEqual([]);
    expect(await recorded()).toEqual(before);
  });

  it("wrong or missing credentials on every path get their usual 401 and no operation id, and nothing is written", async () => {
    await openOperation();
    const before = await recorded();
    const wrongPassword = { personId, password: "wrong" };
    const unknownPerson = { personId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", password: PASSWORD };
    const wrongKey = { breakGlass: "not-the-key" };
    const module = { moduleOperation: moduleOperation(), oldNodeNeutralised: true };
    const operation = { moduleOperation: moduleOperation(), ...answers };
    const usual = refusal(401, "password.invalid");
    const usualKey = refusal(401, "promotion.break_glass_invalid");
    const table: Record<string, [Attempt, unknown]> = {
      nothing: [{ route: PROMOTE, body: {} }, usual],
      "wrong password": [{ route: PROMOTE, body: wrongPassword }, usual],
      "unknown person": [{ route: PROMOTE, body: unknownPerson }, usual],
      "wrong key": [{ route: PROMOTE, body: wrongKey }, usualKey],
      "module, nothing": [{ route: PROMOTE, body: module }, usual],
      "module, wrong password": [{ route: PROMOTE, body: { ...module, ...wrongPassword } }, usual],
      "module, wrong key": [{ route: PROMOTE, body: { ...module, ...wrongKey } }, usualKey],
      "noParallelRecovery, nothing": [{ route: PROMOTE, https: true, body: operation }, usual],
      "noParallelRecovery, wrong password": [
        { route: PROMOTE, https: true, body: { ...operation, ...wrongPassword } },
        usual,
      ],
      "noParallelRecovery, wrong key": [
        { route: PROMOTE, https: true, body: { ...operation, ...wrongKey } },
        usualKey,
      ],
      "preparation, nothing": [{ route: PREPARATION, https: true, body: operation }, usual],
      "preparation, wrong password": [
        { route: PREPARATION, https: true, body: { ...operation, ...wrongPassword } },
        usual,
      ],
      "preparation, wrong key": [
        { route: PREPARATION, https: true, body: { ...operation, ...wrongKey } },
        usualKey,
      ],
    };

    const answered = await answersTo(
      Object.fromEntries(Object.entries(table).map(([name, [sent]]) => [name, sent])),
    );

    expect(answered).toEqual(
      Object.fromEntries(Object.entries(table).map(([name, [, expected]]) => [name, expected])),
    );
    expect(JSON.stringify(answered)).not.toContain(OP);
    expect(run).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
    expect(await sessions()).toEqual([]);
    expect(await recorded()).toEqual(before);
  });

  it("plain HTTP on the HTTPS-only paths learns no operation id, even with the right credentials", async () => {
    await openOperation();
    const { "module operation, noParallelRecovery, password": promote } = rightCredentials();
    const { "preparation, password": preparation } = rightCredentials();
    const refused = refusal(403, "authorization.not_permitted", { permission: "node.promote" });

    expect({
      promote: await attempt({ ...promote!, https: false }),
      preparation: await attempt({ ...preparation!, https: false }),
    }).toEqual({ promote: refused, preparation: refused });
    expect(await sessions()).toEqual([]);
  });

  it("with no operation open the same credentials go through, and a password writes its one ended session", async () => {
    const attempts = rightCredentials();
    const counts: Record<string, unknown> = {};
    for (const [name, sent] of Object.entries(attempts)) {
      const before = (await sessions()).length;
      const answer = await attempt(sent);
      counts[name] = { status: answer.status, sessions: (await sessions()).length - before };
    }
    expect(counts).toEqual({
      password: { status: 200, sessions: 1 },
      "break-glass key": { status: 200, sessions: 0 },
      "module operation, password": { status: 200, sessions: 1 },
      "module operation, key": { status: 200, sessions: 0 },
      "module operation, noParallelRecovery, password": { status: 200, sessions: 1 },
      "module operation, noParallelRecovery, key": { status: 200, sessions: 0 },
      "preparation, password": { status: 200, sessions: 1 },
      "preparation, key": { status: 200, sessions: 0 },
    });
    expect(run).toHaveBeenCalledTimes(6);
    expect(recovery).toHaveBeenCalledTimes(2);
  });
});

describe("an offer and a promotion take turns on one box", () => {
  /** Holds `run` open at the promotion's point of no return; `resolve` lets it go on. */
  function holdThePromotion(): {
    reached: Promise<void>;
    resolve: () => void;
  } {
    const reached = deferred();
    const gate = deferred();
    run.mockImplementation(async () => {
      reached.resolve();
      await gate.promise;
      return RESTARTING;
    });
    return { reached: reached.promise, resolve: gate.resolve };
  }

  it("an offer meeting a promotion past its check is refused and recorded nowhere, on every way in", async () => {
    const answered: Record<string, unknown> = {};
    for (const [name, sent] of Object.entries(promotions())) {
      const hold = holdThePromotion();
      const promotion = attempt(sent);
      // The race: a route that refuses without reaching `run` must print, not hang.
      await Promise.race([hold.reached, promotion]);
      const met = await offer();
      hold.resolve();
      answered[name] = { offer: met, promote: await promotion, recorded: await recorded() };
    }
    const expected = {
      offer: refusal(409, "handover.promotion_running"),
      promote: { status: 200, body: RESTARTING },
      recorded: NOTHING_RECORDED,
    };
    expect(answered).toEqual(
      Object.fromEntries(Object.keys(promotions()).map((name) => [name, expected])),
    );
  });

  it("an offer arriving just after the promote read for an open operation is refused too", async () => {
    let met: unknown;
    holds.afterReadingOpenOperation = async () => {
      holds.afterReadingOpenOperation = undefined;
      met = await offer();
    };

    const promoted = await attempt(promotions()["password"]!);

    expect({ met, promoted, recorded: await recorded() }).toEqual({
      met: refusal(409, "handover.promotion_running"),
      promoted: { status: 200, body: RESTARTING },
      recorded: NOTHING_RECORDED,
    });
  });

  it("a failed promotion lets a later offer through, on every way in", async () => {
    const answered: Record<string, unknown> = {};
    for (const [name, sent] of Object.entries(promotions())) {
      const reached = deferred();
      const gate = deferred();
      run.mockImplementation(async () => {
        reached.resolve();
        await gate.promise;
        throw new AppError("promotion.fence_not_attested", {});
      });
      const promotion = attempt(sent);
      await Promise.race([reached.promise, promotion]);
      const met = await offer();
      gate.resolve();
      answered[name] = { offer: met, promote: await promotion };
    }
    const expected = {
      offer: refusal(409, "handover.promotion_running"),
      promote: refusal(400, "promotion.fence_not_attested"),
    };
    expect(answered).toEqual(
      Object.fromEntries(Object.keys(promotions()).map((name) => [name, expected])),
    );

    expect(stateOf(await offer())).toEqual({ status: 200, state: "prepared" });
    expect((await recorded()).operations).toHaveLength(1);
  });

  it("a promote refused for the open operation leaves its turn behind it", async () => {
    await openOperation();
    await attempt(promotions()["password"]!);
    // The repeat offer is answered before the turn, so a different operation has to ask.
    const another = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(await offer({ operationId: another })).toEqual(
      refusal(409, "handover.operation_in_progress", { operationId: OP }),
    );
  });

  it("a promote that fails its sign-in never blocks an offer, even while it is signing in", async () => {
    const reached = deferred();
    const gate = deferred();
    holds.signingIn = async () => {
      reached.resolve();
      await gate.promise;
    };
    const promotion = attempt({ route: PROMOTE, body: { personId, password: "wrong" } });
    await reached.promise;

    expect(stateOf(await offer())).toEqual({ status: 200, state: "prepared" });

    gate.resolve();
    expect(await promotion).toEqual(refusal(401, "password.invalid"));
  });

  it("a promotion meeting an offer being recorded is refused naming it, and the offer goes on", async () => {
    const reached = deferred();
    const gate = deferred();
    holds.recordingOffer = async () => {
      reached.resolve();
      await gate.promise;
    };
    const recording = offer();
    await reached.promise;

    const answered = await answersTo(promotions());

    const refused = refusal(409, "handover.operation_in_progress", { operationId: OP });
    expect(answered).toEqual(
      Object.fromEntries(Object.keys(promotions()).map((name) => [name, refused])),
    );
    expect(run).not.toHaveBeenCalled();
    expect(await sessions()).toEqual([]);

    gate.resolve();
    expect(stateOf(await recording)).toEqual({ status: 200, state: "prepared" });
    expect((await recorded()).operations).toHaveLength(1);
  });

  it("an offer refused for its own reason lets a promotion through afterwards", async () => {
    const refused = await offer({
      membership: { term: 3, digest: "b".repeat(64) },
    });
    expect(refused).toEqual(refusal(409, "handover.membership_mismatch", { operationId: OP }));
    expect(await attempt(promotions()["password"]!)).toEqual({ status: 200, body: RESTARTING });
  });

  it("a repeat of an offer this box already holds still answers during a promotion, recording nothing", async () => {
    expect(stateOf(await offer())).toEqual({ status: 200, state: "prepared" });
    await advanceHandover({ node: suite.node, nodeId: self }, OP, "abandoned", {});
    const before = await recorded();
    const hold = holdThePromotion();
    const promotion = attempt(promotions()["password"]!);
    await hold.reached;

    expect(stateOf(await offer())).toEqual({ status: 200, state: "abandoned" });

    hold.resolve();
    expect((await promotion).status).toBe(200);
    expect(await recorded()).toEqual(before);
  });

  it("a preparation holds no turn: an offer meeting one is recorded, and the promote that follows is refused", async () => {
    const reached = deferred();
    const gate = deferred();
    recovery.mockImplementation(async () => {
      reached.resolve();
      await gate.promise;
      return { prepared: true };
    });
    const preparing = attempt(rightCredentials()["preparation, key"]!);
    await reached.promise;

    expect(stateOf(await offer())).toEqual({ status: 200, state: "prepared" });

    gate.resolve();
    expect(await preparing).toEqual({ status: 200, body: { prepared: true } });
    expect(await readNodeMode(suite.node, self)).toMatchObject({ mode: "mirror" });
    expect(await attempt(promotions()["password"]!)).toEqual(
      refusal(409, "handover.operation_in_progress", { operationId: OP }),
    );
    expect(run).not.toHaveBeenCalled();
  });
});
