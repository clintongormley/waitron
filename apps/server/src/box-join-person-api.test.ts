import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nodes,
  readMembershipTrustSet,
  readNodeMembership,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { startManagementSession } from "@waitron/identity";
import type { NodeKeyPair } from "@waitron/membership";
import { planVenue, type AdoptResult } from "@waitron/provisioning";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { readOperationAuthority, type WaitronModule } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { nodeId } from "@waitron/shared";
import {
  JOIN_CANCEL_LABEL,
  JOIN_HELLO_LABEL,
  JOIN_POLL_LABEL,
  JOIN_REVEAL_LABEL,
  helloMessageFields,
  joinCode,
  signJoinMessage,
} from "./box-join-code.js";
import { mountBoxJoinApi, mountBoxJoinPersonApi } from "./box-join-api.js";
import {
  createBoxJoinRequests,
  type BoxJoinRequests,
  type JoinHello,
} from "./box-join-requests.js";
import { unlockJoinBundle, type LockedJoinBundle } from "./box-join-seal.js";
import { boxHostnameFor } from "./box-name.js";
import { ALL_MODULES } from "./modules.js";
import { mountMembershipRemovalApi } from "./membership-removal-api.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import {
  allocatedStandbyModules,
  standbyContract,
  withoutActivationMark,
} from "./testing/allocated-contract.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { holdRecoveryKey } from "./testing/recovery-key.js";
import { personHolding } from "./testing/session-holding.js";

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return { ...actual, ALL_MODULES: [...actual.ALL_MODULES] };
});

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const ORIGIN = "https://waitron.local";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let db: Database;
let stateDir: string;
let socket: TLSSocket;
let designated: AdoptResult;
let primaryKeyPair: NodeKeyPair;
let requests: BoxJoinRequests;
let app: Hono;
let cookie: string;
let approverId: string;
let nifCounter = 0;

interface NewBox {
  hello: JoinHello;
  address: string;
  privateKey: string;
  encryptionPrivateKey: string;
  newNonce: Buffer;
  seq: number;
}

function newBox(address: string): NewBox {
  let identity = generateStandbyIdentity();
  while (boxHostnameFor(identity.nodeId) === boxHostnameFor(designated.nodeId))
    identity = generateStandbyIdentity();
  const ek = generateKeyPairSync("x25519");
  return {
    address,
    privateKey: identity.privateKey,
    encryptionPrivateKey: ek.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    newNonce: randomBytes(32),
    seq: 0,
    hello: {
      newNodeId: identity.nodeId,
      newPublicKey: identity.publicKey,
      encryptionKey: ek.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      contactUrl: `https://${address}:8443`,
      storeUrl: `https://${address}:9000`,
      addresses: [address],
    },
  };
}

function boxPost(path: string, body: unknown, from: string) {
  return app.request(
    `${ORIGIN}/api/node/join/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { incoming: { socket: { remoteAddress: from } } },
  );
}

interface Listed {
  requestId: string;
  code: string;
  box: NewBox;
}

/** A hello and its reveal, so the request is listed; returns the code the new box would show. */
async function listedRequest(address: string): Promise<Listed> {
  const box = newBox(address);
  const at = Date.now();
  const hello = await boxPost(
    "hello",
    {
      protocol: 1,
      ...box.hello,
      at,
      signature: signJoinMessage(
        JOIN_HELLO_LABEL,
        "",
        0,
        helloMessageFields(box.hello, at),
        box.privateKey,
      ),
    },
    address,
  );
  expect(hello.status, JSON.stringify(await hello.clone().json())).toBe(200);
  const answer = (await hello.json()) as {
    requestId: string;
    mainNodeId: string;
    mainPublicKey: string;
  };
  box.seq = 1;
  const reveal = await boxPost(
    "reveal",
    {
      requestId: answer.requestId,
      seq: 1,
      newNonce: box.newNonce.toString("base64"),
      signature: signJoinMessage(
        JOIN_REVEAL_LABEL,
        answer.requestId,
        1,
        [box.newNonce],
        box.privateKey,
      ),
    },
    address,
  );
  expect(reveal.status, JSON.stringify(await reveal.clone().json())).toBe(200);
  const { mainNonce } = (await reveal.json()) as { mainNonce: string };
  const code = joinCode({
    ...box.hello,
    mainNodeId: answer.mainNodeId,
    mainPublicKey: answer.mainPublicKey,
    newNonce: box.newNonce,
    mainNonce: Buffer.from(mainNonce, "base64"),
    requestId: answer.requestId,
  });
  return { requestId: answer.requestId, code, box };
}

async function poll(listed: Listed): Promise<unknown> {
  listed.box.seq += 1;
  const at = Date.now();
  const response = await boxPost(
    "poll",
    {
      requestId: listed.requestId,
      seq: listed.box.seq,
      at,
      signature: signJoinMessage(
        JOIN_POLL_LABEL,
        listed.requestId,
        listed.box.seq,
        [Buffer.from(String(at))],
        listed.box.privateKey,
      ),
    },
    listed.box.address,
  );
  return response.json();
}

async function cancel(listed: Listed): Promise<void> {
  listed.box.seq += 1;
  const response = await boxPost(
    "cancel",
    {
      requestId: listed.requestId,
      seq: listed.box.seq,
      signature: signJoinMessage(
        JOIN_CANCEL_LABEL,
        listed.requestId,
        listed.box.seq,
        [],
        listed.box.privateKey,
      ),
    },
    listed.box.address,
  );
  expect(response.status).toBe(200);
}

interface Sent {
  cookie?: string;
  headers?: Record<string, string>;
  env?: Record<string, unknown>;
  body?: unknown;
}

async function personPost(
  path: string,
  sent: Sent = {},
): Promise<{ status: number; body: unknown }> {
  const response = await app.request(
    `${ORIGIN}${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sent.cookie ?? cookie,
        origin: ORIGIN,
        ...sent.headers,
      },
      body: JSON.stringify(sent.body ?? {}),
    },
    { incoming: { socket }, ...sent.env },
  );
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

const check = (requestId: string, sent?: Sent) =>
  personPost(`/management-api/box-joins/${requestId}/check`, sent);
const approve = (requestId: string, body: unknown, sent?: Sent) =>
  personPost(`/management-api/box-joins/${requestId}/approve`, { ...sent, body });
const dismiss = (requestId: string, sent?: Sent) =>
  personPost(`/management-api/box-joins/${requestId}/dismiss`, sent);

const refusal = (status: number, code: string, params: Record<string, unknown> = {}) => ({
  status,
  body: { error: { code, params } },
});

async function sessionFor(personId: string, fresh = true): Promise<string> {
  const session = await withTransaction(db, (tx) =>
    startManagementSession(tx, { method: "password", personId }),
  );
  const held = `${MANAGEMENT_COOKIE}=${session.token}`;
  await withTransaction(db, (tx) => setFreshManagementSignIn(tx, held, fresh));
  return held;
}

async function holdChartNamingOnlyMainBox(): Promise<number> {
  const term = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
  await writeNodeMembership(
    db,
    signedMembershipDoc(term, {
      signerNodeId: designated.nodeId,
      keyPair: primaryKeyPair,
      nodes: [
        {
          nodeId: designated.nodeId,
          contactUrl: "https://box.deli.test",
          standing: "serving-primary",
        },
      ],
    }),
  );
  return term;
}

/** Runs `body` with the fiscal module reserving at a join, recording each reservation's operator. */
async function withReservingModule<T>(
  standbyNodeId: string,
  body: (moduleOperation: unknown, operators: unknown[]) => Promise<T>,
): Promise<T> {
  const fixture = await standbyContract(
    db,
    { nodeId: nodeId(designated.nodeId) },
    standbyNodeId,
    [
      { code: "FA", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "RF", purpose: "rectificative" },
    ],
    approverId,
  );
  const held = fixture.request("reserve");
  const operators: unknown[] = [];
  const original = [...ALL_MODULES];
  const reserving = withoutActivationMark(allocatedStandbyModules(original, fixture)).map(
    (module) => {
      if (module.name !== "fiscal-verifactu") return module;
      const standby = module.provisioning!.standby!;
      return {
        ...module,
        provisioning: {
          ...module.provisioning,
          standby: {
            ...standby,
            async reserve(...args: Parameters<typeof standby.reserve>) {
              const operation = args[3];
              operators.push(
                operation === undefined
                  ? null
                  : readOperationAuthority(operation.authority, operation.binding)?.operatorId,
              );
              return standby.reserve(...args);
            },
          },
        },
      };
    },
  );
  (ALL_MODULES as WaitronModule[]).splice(0, ALL_MODULES.length, ...reserving);
  try {
    return await body({ binding: held.binding, input: held.input }, operators);
  } finally {
    (ALL_MODULES as WaitronModule[]).splice(0, ALL_MODULES.length, ...original);
  }
}

function mount(store: BoxJoinRequests = createBoxJoinRequests()): void {
  requests = store;
  app = new Hono();
  const deps = { appDb: db, node: suite.node, ring: RING, designated, requests: store };
  mountBoxJoinApi(app, deps);
  mountBoxJoinPersonApi(app, {
    ...deps,
    stateDir,
    boxHostname: "waitron.local",
    advertisedOrigin: "https://box.deli.test",
    wakeSpareJoin: () => {},
  });
}

beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-box-join-person-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  const ca = mintSelfSignedServerCert({
    hostnames: ["waitron.local"],
    ipAddresses: [],
    now: new Date(),
  });
  await writeFile(join(stateDir, "tls", "ca.crt"), ca.caCertPem);
  await writeFile(join(stateDir, "tls", "ca.key"), ca.caKeyPem);
  await holdRecoveryKey(stateDir);
  db = suite.db;
}, 180_000);

beforeEach(async () => {
  nifCounter += 1;
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: `${String(82_000_000 + nifCounter).padStart(8, "0")}K`,
        legalName: "Box Join SL",
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "FA",
        rectificativeSeriesCode: "RF",
        admin: {
          displayName: "Administrator",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  designated = { nodeId: venue.nodeId };
  await stampDeployment(db, "preproduction");
  await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, designated.nodeId);
  primaryKeyPair = {
    publicKey: (await readMembershipTrustSet(db))[designated.nodeId]!,
    privateKey: await readNodeIdentityKey(suite.node, RING, designated.nodeId),
  };
  approverId = await personHolding(db, ["node.manage"]);
  cookie = await sessionFor(approverId);
  socket = new TLSSocket(new Socket());
  mount();
}, 60_000);

afterEach(() => socket.destroy());

afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

describe("the main box's person routes for a joining box", () => {
  it("refuses in order: another page, Cloud, no node.manage, a stale sign-in", async () => {
    const { requestId } = await listedRequest("192.168.1.20");
    const staff = await personHolding(db, ["hardware.manage"]);
    const staleStaff = await sessionFor(staff, false);
    const stale = await sessionFor(approverId, false);

    expect(
      await check(requestId, {
        cookie: staleStaff,
        headers: { origin: "https://elsewhere.example" },
        env: { remoteStaff: true },
      }),
    ).toEqual(refusal(403, "node.operation_page_required"));
    expect(await check(requestId, { cookie: staleStaff, env: { remoteStaff: true } })).toEqual(
      refusal(403, "node.operation_page_required"),
    );
    expect(await check(requestId, { cookie: staleStaff })).toEqual(
      refusal(403, "authorization.not_permitted", { permission: "node.manage" }),
    );
    expect(await check(requestId, { cookie: stale })).toEqual(
      refusal(400, "management_session.proof_required"),
    );
    // A recovery code does not count as a fresh sign-in here.
    const recovered = await sessionFor(approverId);
    await withTransaction(db, (tx) =>
      setFreshManagementSignIn(tx, recovered, true, "recovery-code"),
    );
    expect(await check(requestId, { cookie: recovered })).toEqual(
      refusal(400, "management_session.proof_required"),
    );
    expect((await check(requestId)).status).toBe(200);
  });

  it("refuses Cloud remote access on every route, and dismisses on a stale sign-in", async () => {
    const { requestId } = await listedRequest("192.168.1.20");
    const remote = { env: { remoteStaff: true } };
    expect(await approve(requestId, { code: "000000" }, remote)).toEqual(
      refusal(403, "node.operation_page_required"),
    );
    expect(await dismiss(requestId, remote)).toEqual(refusal(403, "node.operation_page_required"));
    expect(await dismiss(requestId, { cookie: await sessionFor(approverId, false) })).toEqual({
      status: 204,
      body: null,
    });
    expect(await check(requestId)).toEqual(refusal(404, "mirror.join_not_found"));
  });

  it("shows three codes, fixed per request, with the real one not always in one place", async () => {
    const places = new Set<number>();
    for (let n = 0; n < 12; n++) {
      const { requestId, code } = await listedRequest(`192.168.1.${30 + n}`);
      const first = await check(requestId);
      expect(first.status).toBe(200);
      const answer = first.body as {
        address: string;
        askedAt: string;
        startedAgain: boolean;
        choices: string[];
      };
      expect(Object.keys(answer).sort()).toEqual(["address", "askedAt", "choices", "startedAgain"]);
      expect(answer.address).toBe(`192.168.1.${30 + n}`);
      expect(answer.startedAgain).toBe(false);
      expect(new Set(answer.choices).size).toBe(3);
      expect(answer.choices).toContain(code);
      expect(((await check(requestId)).body as { choices: string[] }).choices).toEqual(
        answer.choices,
      );
      places.add(answer.choices.indexOf(code));
      expect((await dismiss(requestId)).status).toBe(204);
    }
    expect(places.size).toBeGreaterThan(1);
  });

  it("shows the started-again flag for a box that cancelled and asked again", async () => {
    await cancel(await listedRequest("192.168.1.20"));
    const { requestId } = await listedRequest("192.168.1.20");
    expect(((await check(requestId)).body as { startedAgain: boolean }).startedAgain).toBe(true);
  });

  it("lists waiting requests on the Servers listing when given them", async () => {
    mountMembershipRemovalApi(
      app,
      {
        db,
        node: suite.node,
        ring: RING,
        nodeId: designated.nodeId,
        reloadStream: async () => {},
        authorityFingerprint: async () => null,
        listJoinRequests: () => requests.listed(),
      },
      () => {},
    );
    const { requestId } = await listedRequest("192.168.1.20");
    const response = await app.request(`${ORIGIN}/management-api/servers`, {
      headers: { cookie },
    });
    const listing = (await response.json()) as { joinRequests: unknown };
    expect(listing.joinRequests).toEqual([
      {
        id: requestId,
        address: "192.168.1.20",
        askedAt: expect.any(String),
        expiresAt: expect.any(String),
        startedAgain: false,
      },
    ]);
  });

  it("ends the request on a wrong tap and gives its reveal place back", async () => {
    for (let n = 0; n < 5; n++) await cancel(await listedRequest(`192.168.1.${40 + n}`));
    const sixth = await listedRequest("192.168.1.50");
    const { choices } = (await check(sixth.requestId)).body as { choices: string[] };
    const wrong = choices.find((c) => c !== sixth.code)!;

    expect(await approve(sixth.requestId, { code: wrong })).toEqual(
      refusal(409, "mirror.join_wrong_code"),
    );
    expect(await check(sixth.requestId)).toEqual(refusal(404, "mirror.join_not_found"));
    expect(await poll(sixth)).toEqual({ state: "ended", reason: "wrong_code" });
    // Six reveals in 15 minutes is the limit; the wrong tap's no longer counts.
    await listedRequest("192.168.1.51");
  });

  it("keeps only the locked bundle, which the new box's key opens", async () => {
    const listed = await listedRequest("192.168.1.20");
    expect(await approve(listed.requestId, { code: listed.code })).toEqual({
      status: 202,
      body: null,
    });

    const answer = (await poll(listed)) as { state: string; locked: LockedJoinBundle };
    expect(answer.state).toBe("approved");
    expect(Object.keys(answer.locked).sort()).toEqual([
      "ciphertext",
      "oneUsePublicKey",
      "signature",
    ]);
    const opened = unlockJoinBundle({
      requestId: listed.requestId,
      locked: answer.locked,
      encryptionKey: listed.box.hello.encryptionKey,
      encryptionPrivateKey: listed.box.encryptionPrivateKey,
      mainPublicKey: primaryKeyPair.publicKey,
    });
    const bundle = JSON.parse(opened!.toString("utf8")) as MirrorBundle;
    expect(bundle.designated.nodeId).toBe(designated.nodeId);
    const kept = JSON.stringify(answer);
    for (const secret of [bundle.store.secretAccessKey, bundle.boxCaKeyPem, bundle.boxCaPem])
      expect(kept).not.toContain(secret);
    expect((await readNodeMembership(db))?.body.nodes.map((n) => n.contactUrl)).toContain(
      listed.box.hello.contactUrl,
    );
    expect(await check(listed.requestId)).toEqual(refusal(404, "mirror.join_not_found"));
  });

  it("reaches the module with the approver as the operation's authority", async () => {
    const listed = await listedRequest("192.168.1.20");
    await withReservingModule(listed.box.hello.newNodeId, async (moduleOperation, operators) => {
      const answer = await approve(listed.requestId, { code: listed.code, moduleOperation });
      expect(answer.status, JSON.stringify(answer.body)).toBe(202);
      expect(operators).toEqual([approverId]);
    });
  });

  it.each([
    [
      "no deployment stamp",
      refusal(409, "mirror.not_provisioned"),
      async () => {
        await db.execute(sql`delete from deployment where id = 1`);
      },
    ],
    [
      "a malformed module operation",
      refusal(400, "module.operation_invalid", { module: "unknown" }),
      async () => ({ moduleOperation: { nonsense: true } }),
    ],
    [
      "a contended chart write",
      refusal(503, "membership.write_contended", { attempts: 8 }),
      async () => {
        await holdChartNamingOnlyMainBox();
        await db.execute(
          sql.raw(
            "create trigger test_node_membership_contended before update on node_membership begin select raise(ignore); end",
          ),
        );
      },
    ],
  ])("leaves the request waiting after a build refusal: %s", async (_name, expected, arrange) => {
    const listed = await listedRequest("192.168.1.20");
    const extra = (await arrange()) ?? {};
    try {
      expect(await approve(listed.requestId, { code: listed.code, ...extra })).toEqual(expected);
    } finally {
      await db.execute(sql.raw("drop trigger if exists test_node_membership_contended"));
    }
    expect((await check(listed.requestId)).status).toBe(200);
    expect(await poll(listed)).toEqual({ state: "waiting" });
    await stampDeployment(db, "preproduction");
    expect(await approve(listed.requestId, { code: listed.code })).toEqual({
      status: 202,
      body: null,
    });
  });

  it("answers mirror.join_in_progress to a second tap while the first is building", async () => {
    const listed = await listedRequest("192.168.1.20");
    const [first, second] = await Promise.all([
      approve(listed.requestId, { code: listed.code }),
      approve(listed.requestId, { code: listed.code }),
    ]);
    expect([first, second]).toContainEqual(refusal(409, "mirror.join_in_progress"));
    expect([first, second]).toContainEqual({ status: 202, body: null });
  });

  it("answers mirror.join_not_found for an unknown request", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect(await check(unknown)).toEqual(refusal(404, "mirror.join_not_found"));
    expect(await approve(unknown, { code: "123456" })).toEqual(
      refusal(404, "mirror.join_not_found"),
    );
    expect(await dismiss(unknown)).toEqual(refusal(404, "mirror.join_not_found"));
    expect(await db.select().from(nodes)).toHaveLength(1);
  });
});
