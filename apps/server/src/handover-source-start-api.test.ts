import { Socket, type AddressInfo } from "node:net";
import { TLSSocket } from "node:tls";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  readTenant,
  stampDeployment,
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
  setNodeMode,
} from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { createHandoverGate, type HandoverGate } from "./handover-gate.js";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { promotionTurn } from "./handover-promotion-turn.js";
import {
  mountHandoverSourceStartApi,
  type HandoverSourceStartDeps,
} from "./handover-source-start-api.js";
import { mountHandoverStatusApi } from "./handover-status-api.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
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
): Promise<void> {
  const body: MembershipDocumentBody = { term: 3, nodes };
  const held = {
    body,
    signerNodeId: self,
    signature: signDocumentBody(body, selfKey),
    endorsements: [endorseKey(spare, nodeSigningPublicKey(spareKey), self, selfKey)],
  };
  for (const db of boxes) await writeNodeMembership(db, held);
}

function mount(overrides: Partial<HandoverSourceStartDeps> = {}): Hono {
  const built = new Hono();
  built.use("*", gate.middleware);
  mountHandoverSourceStartApi(
    built,
    {
      db: mainBox.db,
      node: mainBox.node as NodeDatabase,
      ring: RING,
      nodeId: self,
      advertisedOrigin: MAIN_URL,
      credentialKeyRing: TOTP_KEY_RING,
      rpId: "localhost",
      origin: "http://localhost",
      venueCanPromote: true,
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
  mountHandoverDestinationApi(spareApp, spareDeps, () => undefined);
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
    ["has no params", "handover.not_a_spare", undefined],
    ["has a code the offer route never answers", "node.read_only", {}],
    ["has a code that is not text", 7, {}],
    [
      "has an unlisted code with a param named as the lookup misses",
      "node.read_only",
      { undefined: "x" },
    ],
  ])("does not repeat a refusal that %s", async (name, code, params) => {
    exchange = offerAnswers(() => answered(409, { error: { code, params } }));
    if (name === "has no params") {
      expect(await start()).toEqual(refusal(409, "handover.not_a_spare"));
      return;
    }
    expect(await start()).toEqual(
      refusal(409, "handover.destination_unreachable", { destinationNodeId: spare }),
    );
    await expectAbandoned("handover.destination_unreachable", { destinationNodeId: spare });
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

    expect(await start()).toEqual(
      refusal(409, "handover.destination_unreachable", { destinationNodeId: spare }),
    );

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
