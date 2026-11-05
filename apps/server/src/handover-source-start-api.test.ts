import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { serve } from "@hono/node-server";
import { eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  insertReservedNodeTx,
  nodes,
  readTenant,
  stampDeployment,
  venueLocationId,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  nodeSigningPublicKey,
  type KeyRing,
} from "@waitron/credentials";
import {
  bindingFingerprint,
  signEnvelope,
  verifyEnvelope,
  type HandoverBinding,
} from "@waitron/handover";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import {
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
  type NodeStanding,
} from "@waitron/membership";
import {
  NODE_MIGRATIONS,
  nodeHandoverEvents,
  nodeHandoverOperations,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
  setNodeMode,
} from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { BackgroundDuties } from "./background-duties.js";
import { createHandoverGate, type HandoverGate } from "./handover-gate.js";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { imageMigrationsDigest } from "./handover-manifest.js";
import { promotionTurn } from "./handover-promotion-turn.js";
import {
  mountHandoverSourceStartApi,
  type HandoverSourceStartDeps,
} from "./handover-source-start-api.js";
import { mountHandoverStatusApi } from "./handover-status-api.js";
import { stepDown } from "./handover-stepdown.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { closeSupersededOperation, repairAtStart } from "./start-peer-check.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { copyImageMigrations } from "./testing/image-migrations.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEXT_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_BOX = "33333333-3333-4333-8333-333333333333";
const MAIN_URL = "https://box-1";
const SPARE_URL = "https://box-2";
const ROUTE = "/management-api/handover";
const OFFER_PATH = "/api/node/handover/offer";
const QUERY_PATH = "/api/node/peer-status";
const STRANGER = { nodeId: OTHER_BOX, ...generateNodeKeyPair() };
const PASSWORD_SIGN_IN = { method: "password", password: "correct horse" };
const FORGED_TEXT = "<img src=x onerror=alert(1)>\nsecond line";

const migrations = [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS];
const mainBox = useVenueDb({ migrations });
const spareBox = useVenueDb({ migrations });

type Exchange = (path: string, init: RequestInit) => Response | Promise<Response>;

let self: string;
let spare: string;
let selfKey: string;
let spareKey: string;
let cookie: string;
let personId: string;
let app: Hono;
let spareApp: Hono;
let gate: HandoverGate;
let exchange: Exchange;
let exchanged: string[];
let stepDownAfterOffer: ReturnType<typeof vi.fn<HandoverSourceStartDeps["stepDownAfterOffer"]>>;
let socket: TLSSocket;
let mainState: string;
let spareState: string;
const closers: (() => Promise<void>)[] = [];

const toSpare: Exchange = (path, init) => spareApp.request(path, init);

function chartNodes(
  overrides: { standing?: NodeStanding; contactUrl?: string; selfStanding?: NodeStanding } = {},
): MembershipDocumentBody["nodes"] {
  return [
    {
      nodeId: self,
      contactUrl: MAIN_URL,
      standing: overrides.selfStanding ?? "serving-primary",
    },
    {
      nodeId: spare,
      contactUrl: overrides.contactUrl ?? SPARE_URL,
      standing: overrides.standing ?? "serving-secondary",
    },
  ];
}

async function holdChart(
  nodes: MembershipDocumentBody["nodes"],
  boxes: readonly Database[] = [mainBox.db, spareBox.db],
  term = 3,
): Promise<void> {
  const body: MembershipDocumentBody = { term, nodes };
  const held = {
    body,
    signerNodeId: self,
    signature: signDocumentBody(body, selfKey),
    endorsements: [endorseKey(spare, nodeSigningPublicKey(spareKey), self, selfKey)],
  };
  for (const db of boxes) await writeNodeMembership(db, held);
}

/** The spare's row in the main box's own file, as A947 3b's Task 6.2 plans to write it. */
async function writeSpareRow(publicKey: string): Promise<void> {
  const locationId = await venueLocationId(mainBox.db);
  await withTransaction(mainBox.db, (tx) =>
    insertReservedNodeTx(tx, {
      id: spare,
      locationId,
      name: "Test node (standby)",
      filingModule: null,
      taxModule: null,
      publicKey,
      endorsement: endorseKey(spare, publicKey, self, selfKey),
    }),
  );
}

function mount(
  overrides: Partial<HandoverSourceStartDeps> = {},
  behindTheGate: (built: Hono) => void = () => {},
): Hono {
  const built = new Hono();
  built.use("*", gate.middleware);
  behindTheGate(built);
  mountHandoverSourceStartApi(
    built,
    {
      db: mainBox.db,
      node: mainBox.node as NodeDatabase,
      ring: RING,
      nodeId: self,
      stateDir: mainState,
      migrationsRoot: null,
      advertisedOrigin: MAIN_URL,
      credentialKeyRing: TOTP_KEY_RING,
      rpId: "localhost",
      origin: "http://localhost",
      venueCanPromote: true,
      gate,
      stepDownAfterOffer,
      peerTimeoutMs: 50,
      fetch: ((url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        exchanged.push(path);
        return exchange(path, init);
      }) as typeof fetch,
      ...overrides,
    },
    () => undefined,
  );
  built.post("/sale", (c) => c.json({ sold: true }));
  return built;
}

beforeEach(async () => {
  mainState = await mkdtemp(join(tmpdir(), "handover-main-state-"));
  spareState = await mkdtemp(join(tmpdir(), "handover-spare-state-"));
  closers.push(() => rm(mainState, { recursive: true, force: true }));
  closers.push(() => rm(spareState, { recursive: true, force: true }));
  await seedVenue(mainBox.db);
  await seedVenue(spareBox.db);
  const tenant = await readTenant(mainBox.db);
  await spareBox.db.run(sql`update tenants set tax_id = ${tenant!.taxId}`);
  self = await seedNode(mainBox.db);
  spare = await seedNode(spareBox.db);
  await stampDeployment(mainBox.db, "preproduction");
  await stampDeployment(spareBox.db, "preproduction");
  await establishNodeIdentity({ ownerDb: mainBox.db, node: mainBox.node, ring: RING }, self);
  await establishNodeIdentity({ ownerDb: spareBox.db, node: spareBox.node, ring: RING }, spare);
  await setNodeMode({ venue: spareBox.db, node: spareBox.node }, spare, "mirror");
  selfKey = await readNodeIdentityKey(mainBox.node, RING, self);
  spareKey = await readNodeIdentityKey(spareBox.node, RING, spare);
  await pinMainBoxKey(spareBox.node, spare, {
    nodeId: self,
    publicKey: nodeSigningPublicKey(selfKey),
  });
  await holdChart(chartNodes());
  await writeSpareRow(nodeSigningPublicKey(spareKey));
  const session = await openManagementSession(mainBox.db, "admin");
  personId = session.personId;
  cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  socket = new TLSSocket(new Socket());
  gate = createHandoverGate();
  exchanged = [];
  exchange = toSpare;
  stepDownAfterOffer = vi.fn<HandoverSourceStartDeps["stepDownAfterOffer"]>(async () => {});
  spareApp = new Hono();
  const spareDeps = { db: spareBox.db, node: spareBox.node, ring: RING, nodeId: spare };
  mountPeerStatusApi(spareApp, spareDeps, () => undefined);
  mountHandoverStatusApi(spareApp, spareDeps, () => undefined);
  mountHandoverDestinationApi(
    spareApp,
    { ...spareDeps, stateDir: spareState, migrationsRoot: null },
    () => undefined,
  );
  app = mount();
});

afterEach(async () => {
  vi.restoreAllMocks();
  socket.destroy();
  for (const close of closers.splice(0)) await close();
});

async function start(
  body: Record<string, unknown> = {},
  on: Hono = app,
  withCookie: string | null = cookie,
): Promise<{ status: number; body: unknown }> {
  const response = await on.request(
    ROUTE,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withCookie === null ? {} : { cookie: withCookie }),
      },
      body: JSON.stringify({
        operationId: OP,
        destinationNodeId: spare,
        signIn: PASSWORD_SIGN_IN,
        ...body,
      }),
    },
    { incoming: { socket } },
  );
  return { status: response.status, body: await response.json() };
}

function refusal(status: number, code: string, params: object = {}) {
  return { status, body: { error: { code, params } } };
}

const operations = (box: typeof mainBox = mainBox) =>
  box.node.select().from(nodeHandoverOperations).all();
const events = (box: typeof mainBox = mainBox) => box.node.select().from(nodeHandoverEvents).all();

async function expectStillSelling(on: Hono = app): Promise<void> {
  expect(gate.isClosed()).toBe(false);
  expect(stepDownAfterOffer).not.toHaveBeenCalled();
  expect(await readHandoverRestriction(mainBox.node, self)).toBeNull();
  const sale = await on.request("/sale", { method: "POST" });
  expect(sale.status).toBe(200);
}

async function expectNothingRecorded(on: Hono = app): Promise<void> {
  expect(operations()).toEqual([]);
  expect(events()).toEqual([]);
  expect(operations(spareBox)).toEqual([]);
  await expectStillSelling(on);
}

async function expectAbandoned(code: string, params: object = {}): Promise<void> {
  expect(operations().map((row) => [row.operationId, row.state])).toEqual([[OP, "abandoned"]]);
  expect(events().map((row) => row.kind)).toEqual(["offer", "abandoned"]);
  expect(events()[1]!.detail).toEqual({ code, params });
  await expectStillSelling();
}

const offerAnswers =
  (answer: Exchange): Exchange =>
  (path, init) =>
    path === OFFER_PATH ? answer(path, init) : toSpare(path, init);

const queryAnswers =
  (answer: Exchange): Exchange =>
  (path, init) =>
    path === QUERY_PATH ? answer(path, init) : toSpare(path, init);

const silent: Exchange = (_path, init) =>
  new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
  });

const answered = (status: number, body: unknown): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

function statusBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationId: OP,
    role: "destination",
    scenario: "controlled",
    state: "prepared",
    sourceNodeId: self,
    destinationNodeId: spare,
    waitingReason: null,
    ...overrides,
  };
}

const signedStatus = (
  body: unknown,
  signer: { nodeId: string; privateKey: string } = { nodeId: spare, privateKey: spareKey },
) => signEnvelope("status", body as CanonicalValue, signer);

describe("a valid start", () => {
  it("records `prepared`, offers the signed binding, and the spare holds the same operation", async () => {
    const answer = await start();

    expect(answer).toEqual({
      status: 200,
      body: { handoverPage: `${SPARE_URL}/handover/${OP}` },
    });
    const [row] = operations();
    expect(row).toMatchObject({
      nodeId: self,
      operationId: OP,
      role: "source",
      scenario: "controlled",
      state: "prepared",
      sourceNodeId: self,
      destinationNodeId: spare,
    });
    const [spareRow] = operations(spareBox);
    expect(spareRow).toMatchObject({ role: "destination", state: "prepared" });
    expect(spareRow!.fingerprint).toBe(row!.fingerprint);
    expect(row!.fingerprint).toBe(bindingFingerprint(row!.binding as unknown as HandoverBinding));
    expect(exchanged).toEqual([QUERY_PATH, OFFER_PATH]);
  });

  it("stores the offer it sent, naming the person who signed in, for the relinquishment", async () => {
    await start();

    const [offer] = events();
    expect(offer).toMatchObject({ nodeId: self, operationId: OP, kind: "offer", detail: {} });
    const verdict = verifyEnvelope<{ authorisedBy: string; binding: HandoverBinding }>(
      JSON.parse(offer!.envelope!),
      "stepdown",
      (id) => (id === self ? nodeSigningPublicKey(selfKey) : undefined),
    );
    expect(verdict.valid).toBe(true);
    if (!verdict.valid) return;
    expect(verdict.signerNodeId).toBe(self);
    expect(verdict.body.authorisedBy).toBe(personId);
    expect(verdict.body.binding).toEqual(operations()[0]!.binding);
    expect(events(spareBox)[0]!.envelope).toBe(offer!.envelope);
    expect((verdict.body as unknown as { imageMigrations: string }).imageMigrations).toBe(
      imageMigrationsDigest(null),
    );
  });

  it("reaches the stepdown seam once, after the offer, with this request and the binding", async () => {
    let seen: { self: Context; binding: HandoverBinding } | undefined;
    stepDownAfterOffer.mockImplementation(async (c, binding) => {
      seen = { self: c, binding };
      expect(exchanged).toEqual([QUERY_PATH, OFFER_PATH]);
    });

    await start();

    expect(stepDownAfterOffer).toHaveBeenCalledTimes(1);
    expect(seen!.self.req.path).toBe(ROUTE);
    expect(seen!.binding).toEqual(operations()[0]!.binding);
  });

  it("builds the page address from a chart address with a trailing slash", async () => {
    await holdChart(chartNodes({ contactUrl: `${SPARE_URL}/` }));

    expect((await start()).body).toEqual({ handoverPage: `${SPARE_URL}/handover/${OP}` });
  });

  it("works over a real connection to a real spare", async () => {
    const server = serve({ fetch: spareApp.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise((resolve) => server.once("listening", resolve));
    closers.push(() => new Promise((resolve) => void server.close(() => resolve())));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await holdChart(chartNodes({ contactUrl: url }));

    const answer = await start({}, mount({ fetch: undefined, peerTimeoutMs: 5000 }));

    expect(answer).toEqual({ status: 200, body: { handoverPage: `${url}/handover/${OP}` } });
    expect(operations(spareBox)).toHaveLength(1);
  });

  it("gives each exchange with the spare five seconds", async () => {
    const timeouts = vi.spyOn(AbortSignal, "timeout");

    await start({}, mount({ peerTimeoutMs: undefined }));

    expect(timeouts.mock.calls).toEqual([[5000], [5000]]);
  });
});

describe("the connection", () => {
  const NOT_PERMITTED = refusal(403, "authorization.not_permitted", {
    permission: "node.promote",
  });
  const send = async (
    headers: Record<string, string>,
    env: unknown,
    signIn: unknown = PASSWORD_SIGN_IN,
  ): Promise<{ status: number; body: unknown }> => {
    const response = await app.request(
      ROUTE,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ operationId: OP, destinationNodeId: spare, signIn }),
      },
      env as object,
    );
    return { status: response.status, body: await response.json() };
  };

  it("refuses plain HTTP and records nothing", async () => {
    expect(await send({ cookie }, undefined)).toEqual(NOT_PERMITTED);
    await expectNothingRecorded();
    expect(exchanged).toEqual([]);
  });

  it("refuses a request from another origin and records nothing", async () => {
    const answer = await send(
      { cookie, origin: "https://elsewhere.example" },
      {
        incoming: { socket },
      },
    );
    expect(answer).toEqual(NOT_PERMITTED);
    await expectNothingRecorded();
    expect(exchanged).toEqual([]);
  });

  it("refuses a request a browser marks as from another site and records nothing", async () => {
    const answer = await send(
      { cookie, "sec-fetch-site": "cross-site" },
      {
        incoming: { socket },
      },
    );
    expect(answer).toEqual(NOT_PERMITTED);
    await expectNothingRecorded();
  });

  it("refuses plain HTTP before reading a session", async () => {
    expect(await send({}, undefined)).toEqual(NOT_PERMITTED);
  });

  it("refuses plain HTTP before reading a password", async () => {
    const answer = await send({ cookie }, undefined, { method: "password", password: "wrong" });
    expect(answer).toEqual(NOT_PERMITTED);
  });

  it("accepts a request from this box's own origin", async () => {
    const answer = await send({ cookie, origin: "http://localhost" }, { incoming: { socket } });
    expect(answer.status).toBe(200);
  });
});

describe("who may start one", () => {
  it("refuses without a session", async () => {
    expect(await start({}, app, null)).toEqual(refusal(401, "management_session.required"));
    await expectNothingRecorded();
  });

  it("refuses an unknown session", async () => {
    const unknown = `${MANAGEMENT_COOKIE}=dddddddd-dddd-4ddd-8ddd-dddddddddddd`;
    expect((await start({}, app, unknown)).status).toBe(401);
    await expectNothingRecorded();
  });

  it("a person without `node.promote` is refused, before their password is looked at", async () => {
    const manager = await openManagementSession(mainBox.db, "manager");
    const answer = await start(
      { signIn: { method: "password", password: "wrong" } },
      app,
      `${MANAGEMENT_COOKIE}=${manager.token}`,
    );
    expect(answer).toEqual(
      refusal(403, "authorization.not_permitted", { permission: "node.promote" }),
    );
    await expectNothingRecorded();
  });

  it("refuses a wrong password", async () => {
    const answer = await start({ signIn: { method: "password", password: "wrong" } });
    expect(answer).toEqual(refusal(401, "password.invalid"));
    await expectNothingRecorded();
    expect(exchanged).toEqual([]);
  });

  it("refuses a missing sign-in", async () => {
    const answer = await start({ signIn: undefined });
    expect(answer).toEqual(refusal(400, "management.request_invalid", { field: "method" }));
    await expectNothingRecorded();
  });

  it("checks the sign-in before looking at the stored operation", async () => {
    await start();
    const answer = await start({
      destinationNodeId: OTHER_BOX,
      signIn: { method: "password", password: "wrong" },
    });
    expect(answer).toEqual(refusal(401, "password.invalid"));
  });
});

describe("a malformed request", () => {
  it.each([
    ["an operation id in capitals", { operationId: OP.toUpperCase() }, "operationId"],
    [
      "an operation id that is not version 4",
      { operationId: OTHER_BOX.replace("4333", "1333") },
      "operationId",
    ],
    ["an operation id trying a path", { operationId: "../x" }, "operationId"],
    ["no operation id", { operationId: undefined }, "operationId"],
    ["a destination that is not an id", { destinationNodeId: "box-2" }, "destinationNodeId"],
    ["a numeric destination", { destinationNodeId: 7 }, "destinationNodeId"],
    ["an unknown key", { extra: true }, "body"],
  ])("refuses %s", async (_name, body, field) => {
    expect(await start(body)).toEqual(refusal(400, "handover.request_invalid", { field }));
    await expectNothingRecorded();
  });

  it.each([
    ["an array", "[]"],
    ["a null", "null"],
  ])("refuses %s as the whole body", async (_name, raw) => {
    const response = await app.request(
      ROUTE,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: raw,
      },
      { incoming: { socket } },
    );
    expect({ status: response.status, body: await response.json() }).toEqual(
      refusal(400, "handover.request_invalid", { field: "body" }),
    );
    await expectNothingRecorded();
  });
});

describe("the checks before anything is recorded", () => {
  it("refuses on a box holding no chart", async () => {
    await mainBox.db.run(sql`delete from node_membership`);
    expect(await start()).toEqual(refusal(409, "handover.not_main_box"));
    await expectNothingRecorded();
    expect(exchanged).toEqual([]);
  });

  it("refuses on a box the chart names a spare", async () => {
    await holdChart([
      { nodeId: OTHER_BOX, contactUrl: "https://box-3", standing: "serving-primary" },
      ...chartNodes({ selfStanding: "serving-secondary" }),
    ]);
    expect(await start()).toEqual(refusal(409, "handover.not_main_box"));
    await expectNothingRecorded();
  });

  it("refuses a venue with no promotion module", async () => {
    const on = mount({ venueCanPromote: false });
    expect(await start({}, on)).toEqual(refusal(409, "handover.venue_not_supported"));
    await expectNothingRecorded(on);
    expect(exchanged).toEqual([]);
  });

  it("says the venue is unsupported only on the main box", async () => {
    await holdChart(chartNodes({ selfStanding: "serving-secondary" }));
    expect(await start({}, mount({ venueCanPromote: false }))).toEqual(
      refusal(409, "handover.not_main_box"),
    );
  });

  it("refuses a destination the chart does not list", async () => {
    expect(await start({ destinationNodeId: OTHER_BOX })).toEqual(
      refusal(409, "handover.destination_not_spare", { destinationNodeId: OTHER_BOX }),
    );
    await expectNothingRecorded();
    expect(exchanged).toEqual([]);
  });

  it.each(["sell-only", "evicted"] as const)(
    "refuses a destination whose standing is %s",
    async (standing) => {
      await holdChart(chartNodes({ standing }));
      expect(await start()).toEqual(
        refusal(409, "handover.destination_not_spare", { destinationNodeId: spare }),
      );
      await expectNothingRecorded();
    },
  );

  it("refuses this box itself as the destination", async () => {
    expect(await start({ destinationNodeId: self })).toEqual(
      refusal(409, "handover.destination_not_spare", { destinationNodeId: self }),
    );
    await expectNothingRecorded();
  });

  it.each([
    ["no address", ""],
    ["this box's address", MAIN_URL],
    ["this box's address with a slash", `${MAIN_URL}/`],
    ["this box's address in capitals with its port", "HTTPS://BOX-1:443"],
  ])("refuses a destination with %s", async (_name, contactUrl) => {
    await holdChart(chartNodes({ contactUrl }));
    expect(await start()).toEqual(
      refusal(409, "handover.destination_unaddressable", { destinationNodeId: spare }),
    );
    await expectNothingRecorded();
    expect(exchanged).toEqual([]);
  });

  it("does not take another port on this box's host for this box", async () => {
    await holdChart(chartNodes({ contactUrl: `${MAIN_URL}:8443` }));
    expect((await start()).status).toBe(200);
  });

  const unreachable = () =>
    refusal(409, "handover.destination_unreachable", { destinationNodeId: spare });

  it.each<[string, () => Exchange]>([
    ["a dropped connection", () => () => Promise.reject(new Error("connection refused"))],
    ["silence past the limit", () => silent],
    ["a refusal", () => () => answered(403, { error: { code: "handover.peer_unknown" } })],
    ["an answer that is not JSON", () => () => answered(200, "<html>")],
    [
      "an answer signed by another box",
      () => () =>
        answered(
          200,
          signEnvelope("status", { nonce: "x" }, { nodeId: self, privateKey: selfKey }),
        ),
    ],
  ])("refuses a destination answering the query with %s", async (_name, answer) => {
    exchange = queryAnswers(answer());
    expect(await start()).toEqual(unreachable());
    await expectNothingRecorded();
    expect(exchanged).toEqual([QUERY_PATH]);
  });

  it("refuses a destination whose key nothing here vouches for", async () => {
    const body: MembershipDocumentBody = { term: 3, nodes: chartNodes() };
    await writeNodeMembership(mainBox.db, {
      body,
      signerNodeId: self,
      signature: signDocumentBody(body, selfKey),
      endorsements: [],
    });
    expect(await start()).toEqual(unreachable());
    await expectNothingRecorded();
  });

  describe("the spare's row in this box's own file", () => {
    const dropSpareRow = () => mainBox.db.delete(nodes).where(eq(nodes.id, spare));

    it("no row: refused before anything stops, sending no offer", async () => {
      await dropSpareRow();
      // Failing case: 200, a `prepared` row on both boxes and the stepdown seam reached.
      expect(await start()).toEqual(
        refusal(409, "handover.destination_not_joined", { destinationNodeId: spare }),
      );
      await expectNothingRecorded();
      expect(exchanged).toEqual([QUERY_PATH]);
    });

    it("a row holding another key is refused the same way", async () => {
      await dropSpareRow();
      await writeSpareRow(generateNodeKeyPair().publicKey);
      expect(await start()).toEqual(
        refusal(409, "handover.destination_not_joined", { destinationNodeId: spare }),
      );
      await expectNothingRecorded();
    });

    it("control: the row the chart's key names lets the start go on", async () => {
      expect((await start()).status).toBe(200);
      expect(stepDownAfterOffer).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses while another handover is open on this box, sending no offer", async () => {
    const other = { ...bindingFor(NEXT_OP) };
    await beginHandover({ node: mainBox.node, nodeId: self }, other, "source");

    expect(await start()).toEqual(
      refusal(409, "handover.operation_in_progress", { operationId: NEXT_OP }),
    );

    expect(operations().map((row) => row.operationId)).toEqual([NEXT_OP]);
    expect(exchanged).toEqual([QUERY_PATH]);
    await expectStillSelling();
  });
});

function bindingFor(operationId: string): HandoverBinding {
  return {
    operationId,
    scenario: "controlled",
    venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
    sourceNodeId: self,
    destinationNodeId: spare,
    membership: { term: 3, digest: "a".repeat(64) },
  };
}

describe("an offer the spare refuses", () => {
  it("not a spare, on a real spare: `abandoned`, the box selling, and a new handover allowed", async () => {
    await setNodeMode({ venue: spareBox.db, node: spareBox.node }, spare, "primary");

    expect(await start()).toEqual(refusal(409, "handover.not_a_spare"));

    await expectAbandoned("handover.not_a_spare");
    await setNodeMode({ venue: spareBox.db, node: spareBox.node }, spare, "mirror");
    expect((await start({ operationId: NEXT_OP })).status).toBe(200);
    expect(operations().map((row) => [row.operationId, row.state])).toEqual(
      expect.arrayContaining([
        [OP, "abandoned"],
        [NEXT_OP, "prepared"],
      ]),
    );
  });

  it("a spare being promoted, on a real spare", async () => {
    const turn = promotionTurn(spareBox.node);
    turn.claim();
    try {
      expect(await start()).toEqual(refusal(409, "handover.promotion_running"));
    } finally {
      turn.release();
    }
    await expectAbandoned("handover.promotion_running");
  });

  it("a spare holding another chart, on a real spare", async () => {
    const body: MembershipDocumentBody = { term: 4, nodes: chartNodes() };
    await writeNodeMembership(spareBox.db, {
      body,
      signerNodeId: self,
      signature: signDocumentBody(body, selfKey),
      endorsements: [],
    });
    expect(await start()).toEqual(
      refusal(409, "handover.membership_mismatch", { operationId: OP }),
    );
    await expectAbandoned("handover.membership_mismatch", { operationId: OP });
  });

  it("a spare already in another handover, on a real spare", async () => {
    await beginHandover({ node: spareBox.node, nodeId: spare }, bindingFor(NEXT_OP), "destination");
    expect(await start()).toEqual(
      refusal(409, "handover.operation_in_progress", { operationId: NEXT_OP }),
    );
    await expectAbandoned("handover.operation_in_progress", { operationId: NEXT_OP });
  });

  it.each([
    ["handover.request_invalid", { field: "envelope" }, 400],
    ["handover.peer_unknown", {}, 403],
    ["handover.operation_conflict", { operationId: OP }, 409],
  ])("%s", async (code, params, status) => {
    exchange = offerAnswers(() => answered(status, { error: { code, params } }));
    expect(await start()).toEqual(refusal(status, code, params));
    await expectAbandoned(code, params);
  });

  it("keeps only the words a refusal is known to carry", async () => {
    exchange = offerAnswers(() =>
      answered(409, {
        error: {
          code: "handover.operation_in_progress",
          params: { operationId: NEXT_OP, password: "hunter2" },
        },
      }),
    );
    expect(await start()).toEqual(
      refusal(409, "handover.operation_in_progress", { operationId: NEXT_OP }),
    );
    await expectAbandoned("handover.operation_in_progress", { operationId: NEXT_OP });
  });

  it.each([
    ["names no field", "handover.request_invalid", {}],
    ["names a field that is not text", "handover.request_invalid", { field: 7 }],
    [
      "names an overlong operation",
      "handover.operation_in_progress",
      { operationId: "x".repeat(65) },
    ],
    ["names a field in free text", "handover.request_invalid", { field: FORGED_TEXT }],
    ["names a field of over 64 characters", "handover.request_invalid", { field: "x".repeat(65) }],
    ["names an operation in free text", "handover.operation_in_progress", { operationId: "x" }],
    [
      "names an operation in free text, as a mismatch",
      "handover.membership_mismatch",
      { operationId: FORGED_TEXT },
    ],
    [
      "names an operation in free text, as a conflict",
      "handover.operation_conflict",
      { operationId: FORGED_TEXT },
    ],
    ["has a code the offer route never answers", "node.read_only", {}],
    ["has a code that is not text", 7, {}],
    [
      "has an unlisted code with a param named as the lookup misses",
      "node.read_only",
      { undefined: "x" },
    ],
  ])("does not repeat a refusal that %s", async (_name, code, params) => {
    exchange = offerAnswers(() => answered(409, { error: { code, params } }));
    expect(await start()).toEqual(
      refusal(409, "handover.destination_unreachable", { destinationNodeId: spare }),
    );
    await expectAbandoned("handover.destination_unreachable", { destinationNodeId: spare });
  });

  it("repeats a refusal with no params when its code carries none", async () => {
    exchange = offerAnswers(() => answered(409, { error: { code: "handover.not_a_spare" } }));
    expect(await start()).toEqual(refusal(409, "handover.not_a_spare"));
    await expectAbandoned("handover.not_a_spare");
  });

  it("repeats a refusal naming a field with a dot in its name", async () => {
    const params = { field: "membership.term" };
    exchange = offerAnswers(() =>
      answered(400, { error: { code: "handover.request_invalid", params } }),
    );
    expect(await start()).toEqual(refusal(400, "handover.request_invalid", params));
    await expectAbandoned("handover.request_invalid", params);
  });

  it.each<[string, () => Exchange]>([
    ["a dropped connection", () => () => Promise.reject(new Error("connection reset"))],
    ["silence past the limit", () => silent],
    ["a server failure", () => () => answered(500, { error: { code: "server.internal" } })],
    ["a refusal that is not JSON", () => () => answered(502, "<html>")],
    ["a refusal that is a list", () => () => answered(409, [])],
    ["a refusal with no error", () => () => answered(409, { error: null })],
    ["a success that is not JSON", () => () => answered(200, "<html>")],
    ["a success that is not an envelope", () => () => answered(200, { state: "prepared" })],
    [
      "a status signed by a key nothing here vouches for",
      () => () => answered(200, signedStatus(statusBody(), STRANGER)),
    ],
    [
      "a status signed by another known box",
      () => () => answered(200, signedStatus(statusBody(), { nodeId: self, privateKey: selfKey })),
    ],
    [
      "an envelope of another kind",
      () => () =>
        answered(
          200,
          signEnvelope("stepdown", statusBody() as CanonicalValue, {
            nodeId: spare,
            privateKey: spareKey,
          }),
        ),
    ],
    [
      "a status of another operation",
      () => () => answered(200, signedStatus(statusBody({ operationId: NEXT_OP }))),
    ],
    [
      "a status of the other role",
      () => () => answered(200, signedStatus(statusBody({ role: "source" }))),
    ],
    [
      "a status of an emergency",
      () => () => answered(200, signedStatus(statusBody({ scenario: "emergency" }))),
    ],
    [
      "a status naming another source",
      () => () => answered(200, signedStatus(statusBody({ sourceNodeId: OTHER_BOX }))),
    ],
    [
      "a status naming another destination",
      () => () => answered(200, signedStatus(statusBody({ destinationNodeId: OTHER_BOX }))),
    ],
    ["a signed list", () => () => answered(200, signedStatus([]))],
    ["a signed null", () => () => answered(200, signedStatus(null))],
  ])("treats %s as no answer", async (_name, answer) => {
    exchange = offerAnswers(answer());
    expect(await start()).toEqual(
      refusal(409, "handover.destination_unreachable", { destinationNodeId: spare }),
    );
    await expectAbandoned("handover.destination_unreachable", { destinationNodeId: spare });
  });

  it.each(["replaced", "abandoned", "copy_accepted"])(
    "a signed answer in state %s is a refused offer, not an accepted one",
    async (state) => {
      exchange = offerAnswers(() => answered(200, signedStatus(statusBody({ state }))));
      expect(await start()).toEqual(
        refusal(409, "handover.destination_not_spare", { destinationNodeId: spare }),
      );
      await expectAbandoned("handover.destination_not_spare", { destinationNodeId: spare });
    },
  );
});

describe("the same operation again", () => {
  it("a stored abandonment answers the same refusal, asking the spare nothing", async () => {
    await setNodeMode({ venue: spareBox.db, node: spareBox.node }, spare, "primary");
    const first = await start();
    exchanged = [];

    expect(await start()).toEqual(first);

    expect(exchanged).toEqual([]);
    expect(events().map((row) => row.kind)).toEqual(["offer", "abandoned"]);
  });

  it("a stored abandonment keeps its params", async () => {
    exchange = offerAnswers(() =>
      answered(409, {
        error: { code: "handover.operation_in_progress", params: { operationId: NEXT_OP } },
      }),
    );
    const first = await start();
    expect(await start()).toEqual(first);
  });

  it("other inputs are refused as a conflict, asking the spare nothing", async () => {
    await start();
    exchanged = [];

    expect(await start({ destinationNodeId: OTHER_BOX })).toEqual(
      refusal(409, "handover.operation_conflict", { operationId: OP }),
    );

    expect(exchanged).toEqual([]);
    expect(operations()).toHaveLength(1);
  });

  it("an id this box holds as a destination is a conflict", async () => {
    await beginHandover({ node: mainBox.node, nodeId: self }, bindingFor(OP), "destination");
    expect(await start()).toEqual(refusal(409, "handover.operation_conflict", { operationId: OP }));
  });

  it("an id this box holds as an emergency is a conflict", async () => {
    await beginHandover(
      { node: mainBox.node, nodeId: self },
      { ...bindingFor(OP), scenario: "emergency" },
      "source",
    );
    expect(await start()).toEqual(refusal(409, "handover.operation_conflict", { operationId: OP }));
  });

  it("a `prepared` one sends the same offer again and carries on, recording nothing new", async () => {
    await start();
    const sent = events()[0]!.envelope;
    exchanged = [];
    let resent: unknown;
    exchange = offerAnswers((path, init) => {
      resent = init.body;
      return toSpare(path, init);
    });

    expect(await start()).toEqual({
      status: 200,
      body: { handoverPage: `${SPARE_URL}/handover/${OP}` },
    });

    expect(exchanged).toEqual([OFFER_PATH]);
    expect(JSON.parse(resent as string)).toEqual(JSON.parse(sent!));
    expect(events()).toHaveLength(1);
    expect(events(spareBox)).toHaveLength(1);
    expect(stepDownAfterOffer).toHaveBeenCalledTimes(2);
  });

  it("a `prepared` one the spare has closed since is abandoned", async () => {
    await start();
    await advanceHandover({ node: spareBox.node, nodeId: spare }, OP, "abandoned", {});
    stepDownAfterOffer.mockClear();

    expect(await start()).toEqual(
      refusal(409, "handover.destination_not_spare", { destinationNodeId: spare }),
    );

    await expectAbandoned("handover.destination_not_spare", { destinationNodeId: spare });
  });

  it("a `prepared` one whose destination left the chart is abandoned", async () => {
    await start();
    await holdChart([chartNodes()[0]!], [mainBox.db]);
    stepDownAfterOffer.mockClear();
    exchanged = [];

    expect(await start()).toEqual(
      refusal(409, "handover.destination_not_spare", { destinationNodeId: spare }),
    );

    expect(exchanged).toEqual([]);
    await expectAbandoned("handover.destination_not_spare", { destinationNodeId: spare });
  });

  it("a `prepared` one whose signing key cannot be read is abandoned, offering nothing", async () => {
    await start();
    stepDownAfterOffer.mockClear();
    exchanged = [];
    const otherRing = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x8).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });

    const answer = await start({}, mount({ ring: otherRing }));

    expect({ answer, state: operations()[0]!.state, exchanged }).toEqual({
      answer: refusal(409, "handover.destination_unreachable", { destinationNodeId: spare }),
      state: "abandoned",
      exchanged: [],
    });
    await expectAbandoned("handover.destination_unreachable", { destinationNodeId: spare });
  });

  it("one past `prepared` answers the page, asking the spare nothing", async () => {
    await start();
    await advanceHandover({ node: mainBox.node, nodeId: self }, OP, "source_stepped_down", {});
    exchanged = [];
    stepDownAfterOffer.mockClear();

    expect(await start()).toEqual({
      status: 200,
      body: { handoverPage: `${SPARE_URL}/handover/${OP}` },
    });

    expect(exchanged).toEqual([]);
    expect(stepDownAfterOffer).not.toHaveBeenCalled();
  });
});

describe("a `prepared` one whose chart has changed since", () => {
  /** A first start that reached the seam, so the retry below is the only call to look at. */
  async function startedThenForgotten(): Promise<void> {
    await start();
    stepDownAfterOffer.mockClear();
    exchanged = [];
  }

  async function expectRefusedUnsent(
    answer: { status: number; body: unknown },
    code: string,
    params: object = {},
  ): Promise<void> {
    // First, so a route that resends prints the seam being called rather than its 200.
    expect(stepDownAfterOffer).not.toHaveBeenCalled();
    expect(answer).toEqual(refusal(409, code, params));
    expect(exchanged).toEqual([]);
    await expectAbandoned(code, params);
  }

  it("this box no longer main: abandoned, sending nothing", async () => {
    await startedThenForgotten();
    await holdChart(
      [
        { nodeId: OTHER_BOX, contactUrl: "https://box-3", standing: "serving-primary" },
        ...chartNodes({ selfStanding: "serving-secondary" }),
      ],
      [mainBox.db],
    );

    await expectRefusedUnsent(await start(), "handover.not_main_box");
  });

  it("the spare's row gone from this box's own file: abandoned, sending nothing", async () => {
    await startedThenForgotten();
    await mainBox.db.delete(nodes).where(eq(nodes.id, spare));

    await expectRefusedUnsent(await start(), "handover.destination_not_joined", {
      destinationNodeId: spare,
    });
  });

  it("no chart held any more: abandoned, sending nothing", async () => {
    await startedThenForgotten();
    await mainBox.db.run(sql`delete from node_membership`);

    await expectRefusedUnsent(await start(), "handover.not_main_box");
  });

  it.each(["sell-only", "evicted"] as const)(
    "the destination now %s: abandoned, sending nothing",
    async (standing) => {
      await startedThenForgotten();
      await holdChart(chartNodes({ standing }), [mainBox.db]);

      await expectRefusedUnsent(await start(), "handover.destination_not_spare", {
        destinationNodeId: spare,
      });
    },
  );

  it("only the term moved: abandoned, sending nothing", async () => {
    await startedThenForgotten();
    await holdChart(chartNodes(), [mainBox.db], 4);

    await expectRefusedUnsent(await start(), "handover.membership_changed");
  });

  it("only the digest moved, at the same term: abandoned, sending nothing", async () => {
    await startedThenForgotten();
    await holdChart(chartNodes({ contactUrl: "https://box-2b" }), [mainBox.db]);

    await expectRefusedUnsent(await start(), "handover.membership_changed");
  });

  it("the taxpayer changed under the same chart: abandoned, sending nothing", async () => {
    await startedThenForgotten();
    await mainBox.db.run(sql`update tenants set tax_id = 'B87654321'`);

    await expectRefusedUnsent(await start(), "handover.membership_changed");
  });

  it("repeats the same refusal after that, from what it recorded", async () => {
    await startedThenForgotten();
    await holdChart(chartNodes(), [mainBox.db], 4);
    const first = await start();
    await holdChart(chartNodes(), [mainBox.db], 3);

    expect(await start()).toEqual(first);
    expect(events().map((row) => row.kind)).toEqual(["offer", "abandoned"]);
  });
});

describe("one a restart closed before it stepped down", () => {
  it("answers a refusal with a code, asking the spare nothing", async () => {
    await start();
    stepDownAfterOffer.mockClear();
    exchanged = [];
    await repairAtStart({ db: mainBox.db, node: mainBox.node, nodeId: self });

    expect(await start()).toEqual(refusal(409, "handover.restarted_before_stepdown"));

    expect(exchanged).toEqual([]);
    await expectAbandoned("handover.restarted_before_stepdown");
  });

  it("a stored abandonment of any other shape is a fault, never a refusal with no code", async () => {
    await start();
    await advanceHandover({ node: mainBox.node, nodeId: self }, OP, "abandoned", {
      reason: "written by a fault",
    });

    expect(await start()).toEqual({ status: 500, body: { error: { code: "server.internal" } } });
  });

  it("a stored abandonment whose params are not a record is a fault too", async () => {
    await start();
    await advanceHandover({ node: mainBox.node, nodeId: self }, OP, "abandoned", {
      code: "handover.not_a_spare",
      params: "text",
    });

    expect(await start()).toEqual({ status: 500, body: { error: { code: "server.internal" } } });
  });
});

describe("two requests at once", () => {
  it("the second is refused while the first waits on the spare, and may run after", async () => {
    let release: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      exchange = offerAnswers(async (path, init) => {
        resolve();
        await new Promise<void>((held) => (release = held));
        return toSpare(path, init);
      });
    });
    const on = mount({ peerTimeoutMs: 5000 });
    const first = start({}, on);
    await reached;

    expect(await start({}, on)).toEqual(
      refusal(409, "handover.operation_in_progress", { operationId: OP }),
    );
    expect(await start({ operationId: NEXT_OP }, on)).toEqual(
      refusal(409, "handover.operation_in_progress", { operationId: OP }),
    );

    release();
    expect((await first).status).toBe(200);
    exchange = toSpare;
    expect((await start({}, on)).status).toBe(200);
  });

  it("a refusal lets the next request run", async () => {
    await setNodeMode({ venue: spareBox.db, node: spareBox.node }, spare, "primary");
    await start();
    await setNodeMode({ venue: spareBox.db, node: spareBox.node }, spare, "mirror");
    expect((await start({ operationId: NEXT_OP })).status).toBe(200);
  });
});

describe("the settings the offer carries", () => {
  const BACKUP = "WAITRON_BACKUP_RETAIN=5\nWAITRON_BACKUP_SCHEDULE=hourly\n";
  const write = (state: string, file: string, text: string) => writeFile(join(state, file), text);
  const switchedOff = (...names: string[]) =>
    JSON.stringify({ modules: Object.fromEntries(names.map((name) => [name, false])) });

  /** Asks first and then checks, so a spare that accepted prints its row. */
  async function expectRefusedByTheSpare(code: string, params: object = {}): Promise<void> {
    const answer = await start();
    expect(operations(spareBox).map((row) => row.state)).toEqual([]);
    expect(events(spareBox)).toEqual([]);
    expect(answer).toEqual(refusal(409, code, params));
    await expectAbandoned(code, params);
  }

  describe("a spare whose settings differ", () => {
    it("An offer whose backup settings differ is refused, records nothing on the spare, and the main box records abandoned and keeps selling", async () => {
      await write(mainState, "backup.env", BACKUP);
      await expectRefusedByTheSpare("handover.backup_settings_differ");
    });

    it("the same when only the spare holds backup settings", async () => {
      await write(spareState, "backup.env", BACKUP);
      await expectRefusedByTheSpare("handover.backup_settings_differ");
    });

    it("A spare on an image one migration behind is refused the same way", async () => {
      const root = join(spareState, "older-image");
      await copyImageMigrations(root, "fiscal-verifactu");
      spareApp = new Hono();
      mountHandoverDestinationApi(
        spareApp,
        {
          db: spareBox.db,
          node: spareBox.node,
          ring: RING,
          nodeId: spare,
          stateDir: spareState,
          migrationsRoot: root,
        },
        () => undefined,
      );
      mountPeerStatusApi(
        spareApp,
        { db: spareBox.db, node: spareBox.node, ring: RING, nodeId: spare },
        () => undefined,
      );
      await expectRefusedByTheSpare("handover.modules_differ");
    });

    it("An offer whose module settings differ is refused the same way", async () => {
      await write(mainState, "modules.json", switchedOff("bookings"));
      await expectRefusedByTheSpare("handover.modules_differ");
    });

    it("A ring version the spare lacks is refused the same way", async () => {
      const rotated = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x8).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "2",
        WAITRON_CREDENTIALS_KEY_PREVIOUS: Buffer.alloc(32, 0x7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
      });
      app = mount({ ring: rotated });
      await expectRefusedByTheSpare("handover.key_ring_mismatch");
    });

    it("a second try with the same id answers the same refusal, sending nothing", async () => {
      await write(mainState, "backup.env", BACKUP);
      const first = await start();
      exchanged = [];
      expect(await start()).toEqual(first);
      expect(exchanged).toEqual([]);
    });

    it("a new attempt once the settings match goes ahead", async () => {
      await write(mainState, "backup.env", BACKUP);
      await start();
      await write(spareState, "backup.env", BACKUP);
      expect((await start({ operationId: NEXT_OP })).status).toBe(200);
      expect(operations(spareBox).map((row) => row.state)).toEqual(["prepared"]);
    });
  });

  describe("settings that match", () => {
    it("the same settings in another key order pass", async () => {
      await write(mainState, "backup.env", BACKUP);
      await write(
        spareState,
        "backup.env",
        "WAITRON_BACKUP_SCHEDULE=hourly\nWAITRON_BACKUP_RETAIN=5\n",
      );
      await write(mainState, "modules.json", switchedOff("bookings", "workforce"));
      await write(spareState, "modules.json", switchedOff("workforce", "bookings"));

      expect((await start()).status).toBe(200);

      expect(operations(spareBox).map((row) => row.state)).toEqual(["prepared"]);
      expect(stepDownAfterOffer).toHaveBeenCalledTimes(1);
    });

    it("limit: on settings owned by the environment both digests are null and nothing compares them, and the digest reads backup.env alone", async () => {
      await write(mainState, "trading.env", "WAITRON_BACKUP_RETAIN=5\n");
      await write(mainState, "secrets.env", "WAITRON_BACKUP_RECOVERY_KEY=main\n");
      await write(spareState, "trading.env", "WAITRON_BACKUP_RETAIN=9\n");

      expect((await start()).status).toBe(200);

      expect(operations(spareBox).map((row) => row.state)).toEqual(["prepared"]);
    });

    it("the signed offer carries digests and versions, and none of the settings' values", async () => {
      await write(mainState, "backup.env", BACKUP);
      await write(spareState, "backup.env", BACKUP);
      await write(mainState, "modules.json", switchedOff("bookings"));
      await write(spareState, "modules.json", switchedOff("bookings"));

      await start();

      const envelope = events()[0]!.envelope!;
      const { settings } = (JSON.parse(envelope) as { body: { settings: Record<string, unknown> } })
        .body;
      expect(settings).toEqual({
        backupSettings: expect.stringMatching(/^[0-9a-f]{64}$/),
        moduleSettings: expect.stringMatching(/^[0-9a-f]{64}$/),
        ringVersions: [1],
      });
      expect(envelope).not.toContain("hourly");
      expect(envelope).not.toContain("bookings");
    });
  });

  const DAMAGED = [
    ["modules.json", "text that is not JSON", "not json"],
    ["modules.json", "a value of the wrong kind", JSON.stringify({ modules: "every one" })],
    ["module-preparation-state.json", "text that is not JSON", "not json"],
    [
      "module-preparation-state.json",
      "the wrong shape",
      JSON.stringify({ version: 2, revisions: [] }),
    ],
  ] as const;
  const FILES = ["backup.env", "modules.json", "module-preparation-state.json"] as const;

  const unreadableByPermission = async (state: string, file: string) => {
    await write(state, file, "{}");
    await chmod(join(state, file), 0o000);
  };
  const noPermissionToReadIt = process.getuid?.() === 0;

  describe("this box's own bad file", () => {
    let restart: ReturnType<typeof vi.fn<() => void>>;

    /** With the real stepdown, so a route that went ahead prints a stepped-down box. */
    function realBox(): Hono {
      restart = vi.fn<() => void>();
      return mount({
        stepDownAfterOffer: async (c, binding) => {
          await stepDown(
            {
              node: mainBox.node as NodeDatabase,
              nodeId: self,
              gate,
              duties: { aborts: [], closers: [] },
              close: async () => {},
              restart,
              log: () => undefined,
            },
            { binding, kind: "handed-over", self: c },
          );
        },
      });
    }

    async function expectStillSellingNoOfferNoCopy(on: Hono, file: string): Promise<void> {
      const answer = await start({}, on);
      expect(await readHandoverRestriction(mainBox.node, self)).toBeNull();
      expect(gate.isClosed()).toBe(false);
      expect(restart).not.toHaveBeenCalled();
      expect(answer).toEqual(refusal(409, "handover.settings_unreadable", { file }));
      expect(exchanged).not.toContain(OFFER_PATH);
      expect(existsSync(join(mainState, "handover", OP))).toBe(false);
      await expectNothingRecorded(on);
    }

    it("a state folder that is gone refuses before any offer", async () => {
      await rm(mainState, { recursive: true });
      await expectStillSellingNoOfferNoCopy(realBox(), "backup.env");
    });

    it.each(DAMAGED)(
      "a damaged %s holding %s refuses before any offer",
      async (file, _name, text) => {
        await write(mainState, file, text);
        await expectStillSellingNoOfferNoCopy(realBox(), file);
      },
    );

    it.each(FILES)("%s being a folder refuses before any offer", async (file) => {
      await mkdir(join(mainState, file));
      await expectStillSellingNoOfferNoCopy(realBox(), file);
    });

    it.skipIf(noPermissionToReadIt).each(FILES)(
      "%s with no read permission refuses before any offer",
      async (file) => {
        await unreadableByPermission(mainState, file);
        await expectStillSellingNoOfferNoCopy(realBox(), file);
      },
    );

    it("control: with the file put right, the same real stepdown goes ahead", async () => {
      await write(mainState, "modules.json", "{}");
      const on = realBox();
      expect((await start({}, on)).status).toBe(200);
      expect(gate.isClosed()).toBe(true);
    });

    it("leaves no record, so the same id goes ahead once the file is put right", async () => {
      await write(mainState, "modules.json", "not json");
      await start();
      await rm(join(mainState, "modules.json"));
      expect((await start()).status).toBe(200);
      expect(operations().map((row) => row.state)).toEqual(["prepared"]);
    });
  });

  describe("the spare's own bad file", () => {
    it.each(DAMAGED)(
      "a damaged %s holding %s refuses, recording nothing on the spare",
      async (file, _name, text) => {
        await write(spareState, file, text);
        await expectRefusedByTheSpare("handover.destination_settings_unreadable", { file });
      },
    );

    it.each(FILES)("%s being a folder refuses the same way", async (file) => {
      await mkdir(join(spareState, file));
      await expectRefusedByTheSpare("handover.destination_settings_unreadable", { file });
    });

    it.skipIf(noPermissionToReadIt).each(FILES)(
      "%s with no read permission refuses the same way",
      async (file) => {
        await unreadableByPermission(spareState, file);
        await expectRefusedByTheSpare("handover.destination_settings_unreadable", { file });
      },
    );

    it.each([
      ["a file name that is no settings file", { file: "../secrets" }],
      ["no file name", {}],
    ])("a refusal naming %s is the spare being unreachable", async (_name, params) => {
      exchange = offerAnswers(() =>
        answered(409, {
          error: { code: "handover.destination_settings_unreadable", params },
        }),
      );
      const unreachable = { destinationNodeId: spare };
      expect(await start()).toEqual(refusal(409, "handover.destination_unreachable", unreachable));
      await expectAbandoned("handover.destination_unreachable", unreachable);
    });
  });

  describe("a `prepared` one tried again", () => {
    /** A first start that reached the seam, so the retry below is the only call to look at. */
    async function startedThenForgotten(): Promise<void> {
      await start();
      stepDownAfterOffer.mockClear();
      exchanged = [];
    }

    async function expectRefusedUnsent(code: string, params: object = {}): Promise<void> {
      const answer = await start();
      expect(stepDownAfterOffer).not.toHaveBeenCalled();
      expect(answer).toEqual(refusal(409, code, params));
      expect(exchanged).toEqual([]);
      await expectAbandoned(code, params);
    }

    it.each(DAMAGED)(
      "a %s damaged since, holding %s, is abandoned, sending nothing",
      async (file, _name, text) => {
        await startedThenForgotten();
        await write(mainState, file, text);
        await expectRefusedUnsent("handover.settings_unreadable", { file });
      },
    );

    it("backup settings changed since are abandoned, sending nothing", async () => {
      await startedThenForgotten();
      await write(mainState, "backup.env", BACKUP);
      await expectRefusedUnsent("handover.settings_changed");
    });

    it("module settings changed since are abandoned, sending nothing", async () => {
      await startedThenForgotten();
      await write(mainState, "modules.json", switchedOff("bookings"));
      await expectRefusedUnsent("handover.settings_changed");
    });

    it("a key ring changed since is abandoned, sending nothing", async () => {
      await startedThenForgotten();
      app = mount({
        ring: loadKeyRing({
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x8).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "2",
          WAITRON_CREDENTIALS_KEY_PREVIOUS: Buffer.alloc(32, 0x7).toString("base64"),
          WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
        }),
      });
      await expectRefusedUnsent("handover.settings_changed");
    });

    it("control: the same settings in another spelling send the same offer again", async () => {
      await write(mainState, "backup.env", BACKUP);
      await write(spareState, "backup.env", BACKUP);
      await startedThenForgotten();
      await write(
        mainState,
        "backup.env",
        "WAITRON_BACKUP_SCHEDULE=hourly\nWAITRON_BACKUP_RETAIN=5\n",
      );
      expect((await start()).status).toBe(200);
      expect(exchanged).toEqual([OFFER_PATH]);
      expect(stepDownAfterOffer).toHaveBeenCalledTimes(1);
    });
  });
});

describe("with the real stepdown", () => {
  const SPARE_PAGE = { handoverPage: `${SPARE_URL}/handover/${OP}` };
  const STEPPING_DOWN = refusal(503, "handover.stepping_down");
  const INTERNAL = { status: 500, body: { error: { code: "server.internal" } } };
  const OTHER_RESTRICTION = {
    operationId: null,
    kind: "superseded" as const,
    successorNodeId: OTHER_BOX,
    membershipTerm: 1,
  };

  let restart: ReturnType<typeof vi.fn<() => void>>;
  let close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let duties: BackgroundDuties;
  let holdNextStart: Promise<void> | null;
  let slowWork: Promise<void>;

  beforeEach(() => {
    restart = vi.fn<() => void>();
    close = vi.fn<() => Promise<void>>(async () => {});
    duties = { aborts: [], closers: [] };
    holdNextStart = null;
    slowWork = Promise.resolve();
  });

  const stepDownDeps = () => ({
    node: mainBox.node as NodeDatabase,
    nodeId: self,
    gate,
    duties,
    close,
    restart,
    log: () => undefined,
  });

  /** The stepdown a newer chart causes, which goes through `/api/node/membership` on a real box. */
  const chartStepsDown = (successorNodeId: string | null = OTHER_BOX) =>
    stepDown(stepDownDeps(), {
      kind: "superseded",
      successorNodeId,
      membershipTerm: 4,
      self: {} as Context,
    });

  /** Routes behind the gate, and a way to hold a request just past it. */
  function behindTheGate(built: Hono): void {
    const box = { db: mainBox.db, node: mainBox.node as NodeDatabase, ring: RING, nodeId: self };
    built.use(ROUTE, async (_c, next) => {
      const hold = holdNextStart;
      holdNextStart = null;
      if (hold !== null) await hold;
      await next();
    });
    built.post("/slow", async (c) => {
      await slowWork;
      return c.json({ done: true });
    });
    mountHandoverStatusApi(built, box, () => undefined);
    mountPeerStatusApi(built, box, () => undefined);
  }

  function realBox(changeBinding: (binding: HandoverBinding) => HandoverBinding = (b) => b): Hono {
    return mount(
      {
        stepDownAfterOffer: async (c, binding) => {
          await stepDown(stepDownDeps(), {
            binding: changeBinding(binding),
            kind: "handed-over",
            self: c,
          });
        },
      },
      behindTheGate,
    );
  }

  /** Lets a timer run, where a restart that was wrongly scheduled would have shown. */
  const aTurnLater = () => new Promise((resolve) => setTimeout(resolve, 20));

  const stateOf = (operationId = OP) =>
    operations().find((row) => row.operationId === operationId)?.state;
  const eventKinds = () => events().map((row) => row.kind);

  async function statusRead(on: Hono): Promise<{ state: string; handoverPage?: string }> {
    const response = await on.request(`/api/node/handover/${OP}`);
    expect(response.status).toBe(200);
    const { body } = (await response.json()) as {
      body: { state: string; handoverPage?: string };
    };
    return body;
  }

  async function saleStatus(on: Hono): Promise<number> {
    return (await on.request("/sale", { method: "POST" })).status;
  }

  async function expectRestartedOnce(): Promise<void> {
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    await aTurnLater();
    expect(restart).toHaveBeenCalledTimes(1);
  }

  /** The first check refused: nothing was stopped, so nothing restarts. */
  async function expectStillOpen(on: Hono): Promise<void> {
    await aTurnLater();
    expect(gate.isClosed()).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(await saleStatus(on)).toBe(200);
  }

  function failRestrictionWrites(): void {
    mainBox.node.run(
      sql`create trigger refuse_restriction before insert on node_handover_restriction
          begin select raise(abort, 'the write fails here'); end`,
    );
  }

  const allowRestrictionWrites = () => mainBox.node.run(sql`drop trigger refuse_restriction`);

  describe("a valid start", () => {
    it("records `prepared`, offers, steps down, and the caller receives the page address", async () => {
      const box = realBox();

      expect(await start({}, box)).toEqual({ status: 200, body: SPARE_PAGE });

      expect(exchanged).toEqual([QUERY_PATH, OFFER_PATH]);
      expect(operations(spareBox).map((row) => row.state)).toEqual(["prepared"]);
      expect(stateOf()).toBe("source_stepped_down");
      expect(eventKinds()).toEqual(["offer", "source_stepped_down"]);
      expect(await readHandoverRestriction(mainBox.node, self)).toMatchObject({
        operationId: OP,
        kind: "handed-over",
        successorNodeId: spare,
        membershipTerm: 3,
      });
      expect(gate.isClosed()).toBe(true);
      expect(await saleStatus(box)).toBe(503);
      await expectRestartedOnce();
      expect(close.mock.invocationCallOrder[0]!).toBeLessThan(restart.mock.invocationCallOrder[0]!);
    });

    it("answers before the wait for admitted work and the restart", async () => {
      let finishSlowWork!: () => void;
      slowWork = new Promise((resolve) => (finishSlowWork = resolve));
      const box = realBox();
      const slow = box.request("/slow", { method: "POST" });
      await aTurnLater();

      expect(await start({}, box)).toEqual({ status: 200, body: SPARE_PAGE });

      await aTurnLater();
      expect(close).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();
      finishSlowWork();
      expect((await slow).status).toBe(200);
      await expectRestartedOnce();
    });
  });

  describe("a stepdown refused at its first check", () => {
    it("a conflicting restriction: `abandoned`, the box selling, and a repeat answers the same", async () => {
      await withNodeTransaction(mainBox.node, (tx) =>
        recordHandoverRestrictionTx(tx, { nodeId: self, ...OTHER_RESTRICTION }),
      );
      const box = realBox();
      const refused = refusal(409, "handover.restriction_conflict");

      expect(await start({}, box)).toEqual(refused);

      expect(stateOf()).toBe("abandoned");
      expect(eventKinds()).toEqual(["offer", "abandoned"]);
      expect(events()[1]!.detail).toEqual({ code: "handover.restriction_conflict", params: {} });
      await expectStillOpen(box);

      exchanged = [];
      expect(await start({}, box)).toEqual(refused);
      expect(exchanged).toEqual([]);
    });

    it("a conflicting binding: `abandoned`, the box selling, and a new handover allowed", async () => {
      const tampered = realBox((binding) => ({
        ...binding,
        membership: { ...binding.membership, term: binding.membership.term + 1 },
      }));

      expect(await start({}, tampered)).toEqual(
        refusal(409, "handover.operation_conflict", { operationId: OP }),
      );

      await expectAbandoned("handover.operation_conflict", { operationId: OP });
      await expectStillOpen(tampered);

      // Stands in for the spare's own closing of the offer it took, which is a later piece.
      await advanceHandover({ node: spareBox.node, nodeId: spare }, OP, "abandoned", {});
      expect(await start({ operationId: NEXT_OP }, realBox())).toEqual({
        status: 200,
        body: { handoverPage: `${SPARE_URL}/handover/${NEXT_OP}` },
      });
      expect(stateOf(NEXT_OP)).toBe("source_stepped_down");
    });

    it("a first check that cannot read: `abandoned` as a fault, and a repeat answers the fault", async () => {
      const box = realBox();
      mainBox.node.run(sql`alter table node_handover_restriction rename to hidden_restriction`);
      try {
        expect(await start({}, box)).toEqual(INTERNAL);
      } finally {
        mainBox.node.run(sql`alter table hidden_restriction rename to node_handover_restriction`);
      }

      expect(stateOf()).toBe("abandoned");
      expect(events()[1]!.detail).toEqual({ code: "server.internal", params: {} });
      await expectStillOpen(box);
      expect(await start({}, box)).toEqual(refusal(500, "server.internal"));
    });

    it("a refusal that cannot be recorded leaves `prepared` and the box selling", async () => {
      const box = realBox();
      await withNodeTransaction(mainBox.node, (tx) =>
        recordHandoverRestrictionTx(tx, { nodeId: self, ...OTHER_RESTRICTION }),
      );
      mainBox.node.run(
        sql`create trigger refuse_event before insert on node_handover_events
            when new.kind = 'abandoned'
            begin select raise(abort, 'the record fails here'); end`,
      );
      try {
        expect(await start({}, box)).toEqual(INTERNAL);
      } finally {
        mainBox.node.run(sql`drop trigger refuse_event`);
      }

      expect(stateOf()).toBe("prepared");
      await expectStillOpen(box);

      exchanged = [];
      expect(await start({}, box)).toEqual(refusal(409, "handover.restriction_conflict"));
      expect(exchanged).toEqual([OFFER_PATH]);
      expect(stateOf()).toBe("abandoned");
      await expectStillOpen(box);
    });

    it("a retry after a refusal that could not be recorded offers again, and can step down", async () => {
      const box = realBox();
      mainBox.node.run(sql`alter table node_handover_restriction rename to hidden_restriction`);
      mainBox.node.run(
        sql`create trigger refuse_event before insert on node_handover_events
            when new.kind = 'abandoned'
            begin select raise(abort, 'the record fails here'); end`,
      );
      try {
        expect(await start({}, box)).toEqual(INTERNAL);
      } finally {
        mainBox.node.run(sql`drop trigger refuse_event`);
        mainBox.node.run(sql`alter table hidden_restriction rename to node_handover_restriction`);
      }
      expect(stateOf()).toBe("prepared");
      await expectStillOpen(box);

      exchanged = [];
      expect(await start({}, box)).toEqual({ status: 200, body: SPARE_PAGE });
      expect(exchanged).toEqual([OFFER_PATH]);
      expect(stateOf()).toBe("source_stepped_down");
      await expectRestartedOnce();
    });
  });

  describe("a stepdown whose write fails", () => {
    it("answers the failure and restarts, and the next start leaves it `abandoned`, which the spare's next read sees", async () => {
      const box = realBox();
      failRestrictionWrites();
      try {
        expect(await start({}, box)).toEqual(INTERNAL);
        expect(stateOf()).toBe("prepared");
        expect(eventKinds()).toEqual(["offer"]);
        expect(await readHandoverRestriction(mainBox.node, self)).toBeNull();
        expect(gate.isClosed()).toBe(true);
        expect(await start({}, box)).toEqual(STEPPING_DOWN);
        await expectRestartedOnce();
      } finally {
        allowRestrictionWrites();
      }

      await repairAtStart({ db: mainBox.db, node: mainBox.node, nodeId: self });
      gate = createHandoverGate();
      const nextStart = realBox();

      expect(await saleStatus(nextStart)).toBe(200);
      expect(await statusRead(nextStart)).toMatchObject({ state: "abandoned" });
      const query = signEnvelope(
        "query",
        { nonce: "n".repeat(20), atMs: 1, operationId: OP, purpose: "status" },
        { nodeId: spare, privateKey: spareKey },
      );
      const read = await nextStart.request(QUERY_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(query),
      });
      expect(await read.json()).toMatchObject({
        body: { requestedOperation: { operationId: OP, state: "abandoned" } },
      });
      expect(await start({}, nextStart)).toEqual(
        refusal(409, "handover.restarted_before_stepdown"),
      );
    });

    it("a write refused with the first check's own code still records nothing further", async () => {
      duties = {
        aborts: [
          {
            name: "changes the operation after the first check",
            abort: () => {
              mainBox.node.update(nodeHandoverOperations).set({ fingerprint: "changed" }).run();
            },
          },
        ],
        closers: [],
      };
      const box = realBox();

      expect(await start({}, box)).toEqual(
        refusal(409, "handover.operation_conflict", { operationId: OP }),
      );

      expect(stateOf()).toBe("prepared");
      expect(eventKinds()).toEqual(["offer"]);
      expect(gate.isClosed()).toBe(true);
      await expectRestartedOnce();
    });
  });

  describe("a stepdown whose write is refused because the operation moved", () => {
    it("answers a conflict, not a malformed request, and records nothing further", async () => {
      duties = {
        aborts: [
          {
            name: "moves the operation after the first check",
            abort: () => {
              mainBox.node.update(nodeHandoverOperations).set({ state: "abandoned" }).run();
            },
          },
        ],
        closers: [],
      };

      const answer = await start({}, realBox());

      expect(answer).toEqual(
        refusal(409, "handover.step_out_of_order", {
          from: "abandoned",
          to: "source_stepped_down",
        }),
      );
      expect(eventKinds()).toEqual(["offer"]);
      expect(gate.isClosed()).toBe(true);
      await expectRestartedOnce();
    });
  });

  describe("another stepdown that got there first", () => {
    it("a newer chart during the offer: refused for what happened, and the next restricted start closes the operation", async () => {
      exchange = offerAnswers(async (path, init) => {
        await chartStepsDown();
        return toSpare(path, init);
      });
      const box = realBox();

      expect(await start({}, box)).toEqual(refusal(409, "handover.superseded_during_start"));

      expect(stateOf()).toBe("prepared");
      expect(eventKinds()).toEqual(["offer"]);
      expect(await readHandoverRestriction(mainBox.node, self)).toMatchObject({
        kind: "superseded",
      });
      await expectRestartedOnce();

      await closeSupersededOperation({ node: mainBox.node, nodeId: self }, () => undefined);

      expect(stateOf()).toBe("abandoned");
      expect(events()[1]!.detail).toEqual({
        code: "handover.superseded_during_start",
        params: {},
      });
      expect((await statusRead(box)).state).toBe("abandoned");
    });

    it("a newer chart that names no main box: refused, never answered with the page", async () => {
      exchange = offerAnswers(async (path, init) => {
        await chartStepsDown(null);
        return toSpare(path, init);
      });

      expect(await start({}, realBox())).toEqual(refusal(409, "handover.superseded_during_start"));

      expect(stateOf()).toBe("prepared");
      expect(eventKinds()).toEqual(["offer"]);
      expect(await readHandoverRestriction(mainBox.node, self)).toBeNull();
      await expectRestartedOnce();
    });

    it("a newer chart during the first query: records nothing and offers nothing", async () => {
      exchange = queryAnswers(async (path, init) => {
        await chartStepsDown();
        return toSpare(path, init);
      });

      expect(await start({}, realBox())).toEqual(refusal(409, "handover.superseded_during_start"));

      expect(operations()).toEqual([]);
      expect(exchanged).toEqual([QUERY_PATH]);
      expect(operations(spareBox)).toEqual([]);
      await expectRestartedOnce();
    });

    it("a different refusal behind that closed gate keeps its own answer", async () => {
      exchange = offerAnswers(async (path, init) => {
        await chartStepsDown();
        return toSpare(path, init);
      });
      const changedTerm = (binding: HandoverBinding): HandoverBinding => ({
        ...binding,
        membership: { ...binding.membership, term: binding.membership.term + 1 },
      });

      expect(await start({}, realBox(changedTerm))).toEqual(
        refusal(409, "handover.operation_conflict", { operationId: OP }),
      );

      expect(stateOf()).toBe("prepared");
      expect(eventKinds()).toEqual(["offer"]);
      await expectRestartedOnce();
    });

    it("a restriction under another operation is the fault its words say, behind a closed gate too", async () => {
      exchange = offerAnswers(async (path, init) => {
        const binding = operations()[0]!.binding as unknown as HandoverBinding;
        await stepDown(stepDownDeps(), {
          binding: { ...binding, operationId: NEXT_OP },
          kind: "superseded",
          self: {} as Context,
        });
        return toSpare(path, init);
      });

      expect(await start({}, realBox())).toEqual(refusal(409, "handover.restriction_conflict"));

      expect(stateOf()).toBe("prepared");
      expect(eventKinds()).toEqual(["offer"]);
      await expectRestartedOnce();
    });
  });

  describe("a stepdown whose signal to the duties fails", () => {
    it("records nothing further, restarts restricted, and a retry reads the status", async () => {
      duties = {
        aborts: [
          {
            name: "throws",
            abort: () => {
              throw new Error("the signal fails here");
            },
          },
        ],
        closers: [],
      };
      const box = realBox();

      expect(await start({}, box)).toEqual(INTERNAL);

      expect(stateOf()).toBe("source_stepped_down");
      expect(eventKinds()).toEqual(["offer", "source_stepped_down"]);
      expect(await readHandoverRestriction(mainBox.node, self)).toMatchObject({ operationId: OP });
      expect(gate.isClosed()).toBe(true);
      await expectRestartedOnce();

      expect(await start({}, box)).toEqual(STEPPING_DOWN);
      expect(await statusRead(box)).toMatchObject({
        state: "source_stepped_down",
        handoverPage: SPARE_PAGE.handoverPage,
      });
    });
  });

  describe("a request admitted before the gate closed, running after", () => {
    /** Runs a first start while a second waits just past the gate, then lets the second go on. */
    async function secondAfterFirst(
      box: Hono,
      second: Record<string, unknown> = {},
    ): Promise<{ first: unknown; second: unknown }> {
      let release!: () => void;
      holdNextStart = new Promise((resolve) => (release = resolve));
      const held = start(second, box);
      await aTurnLater();
      const first = await start({}, box);
      expect(gate.isClosed()).toBe(true);
      exchanged = [];
      release();
      return { first, second: await held };
    }

    it("after a stepdown: the same operation answers the page, asking the spare nothing", async () => {
      const answers = await secondAfterFirst(realBox());

      expect(answers).toEqual({
        first: { status: 200, body: SPARE_PAGE },
        second: { status: 200, body: SPARE_PAGE },
      });
      expect(exchanged).toEqual([]);
      await expectRestartedOnce();
    });

    it("after a failed write: the same operation answers the failure and records nothing further", async () => {
      failRestrictionWrites();
      try {
        const answers = await secondAfterFirst(realBox());

        expect(answers).toEqual({ first: INTERNAL, second: INTERNAL });
        expect(stateOf()).toBe("prepared");
        expect(eventKinds()).toEqual(["offer"]);
        expect(exchanged).toEqual([]);
        await expectRestartedOnce();
      } finally {
        allowRestrictionWrites();
      }
    });

    it("after a newer chart stepped it down: the same operation records nothing and offers nothing", async () => {
      exchange = offerAnswers(async (path, init) => {
        await holdChart(
          chartNodes({ selfStanding: "evicted", standing: "serving-primary" }),
          [mainBox.db],
          4,
        );
        await chartStepsDown(spare);
        return toSpare(path, init);
      });

      const answers = await secondAfterFirst(realBox());

      const superseded = refusal(409, "handover.superseded_during_start");
      expect(answers).toEqual({ first: superseded, second: superseded });
      expect(stateOf()).toBe("prepared");
      expect(eventKinds()).toEqual(["offer"]);
      expect(exchanged).toEqual([]);
      await expectRestartedOnce();
    });

    it("a `prepared` operation whose stepdown replay reports success is a fault, not the page", async () => {
      const seam = vi.fn<HandoverSourceStartDeps["stepDownAfterOffer"]>(async (c) => {
        if (!gate.isClosed()) {
          gate.close({ allowed: () => false, self: c });
          throw new Error("the first stepdown failed");
        }
      });
      const box = mount({ stepDownAfterOffer: seam }, behindTheGate);

      const answers = await secondAfterFirst(box);

      expect(answers).toEqual({ first: INTERNAL, second: INTERNAL });
      expect(seam).toHaveBeenCalledTimes(2);
      expect(stateOf()).toBe("prepared");
      expect(exchanged).toEqual([]);
    });

    it("after a stepdown: another operation is refused and records nothing", async () => {
      const answers = await secondAfterFirst(realBox(), { operationId: NEXT_OP });

      expect(answers).toEqual({
        first: { status: 200, body: SPARE_PAGE },
        second: refusal(409, "handover.operation_in_progress", { operationId: OP }),
      });
      expect(operations().map((row) => row.operationId)).toEqual([OP]);
      expect(stateOf()).toBe("source_stepped_down");
      await expectRestartedOnce();
    });
  });
});
