import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import {
  signDocumentBody,
  type MembershipDocumentBody,
  type NodeKeyPair,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { planVenue, type AdoptResult } from "@waitron/provisioning";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { fiscalReservations } from "@waitron/fiscal-verifactu/src/schema/reservations.js";
import { readOperationAuthority, type WaitronModule } from "@waitron/module";
import { readPairLink } from "@waitron/node-db";
import { AppError, nodeId } from "@waitron/shared";
import { joinCode } from "./box-join-code.js";
import type { BoxJoinRequests } from "./box-join-requests.js";
import type { Logger } from "./logger.js";
import { unlockJoinBundle, type LockedJoinBundle } from "./box-join-seal.js";
import { ALL_MODULES } from "./modules.js";
import { mountMembershipRemovalApi } from "./membership-removal-api.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import {
  allocatedStandbyModules,
  standbyContract,
  withoutActivationMark,
} from "./testing/allocated-contract.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import {
  approveJoin,
  cancelJoin,
  checkJoin,
  dismissJoin,
  joiningBox,
  listedJoin,
  mountBoxJoin,
  pollJoin,
  signedInCookie,
  type ListedJoin,
  type PersonSent,
} from "./testing/box-join.js";
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
let designated: AdoptResult;
let primaryKeyPair: NodeKeyPair;
let requests: BoxJoinRequests;
let app: Hono;
let cookie: string;
let approverId: string;
let nifCounter = 0;
let afterIssue: () => void = () => {};

/** A hello and its reveal, so the request is listed; carries the code the new box would show. */
const listedRequest = (address: string): Promise<ListedJoin> =>
  listedJoin(app, joiningBox(address, { unlikeNodeId: designated.nodeId }));

const poll = (listed: ListedJoin): Promise<unknown> => pollJoin(app, listed);

async function cancel(listed: ListedJoin): Promise<void> {
  expect((await cancelJoin(app, listed)).status).toBe(200);
}

type Sent = Partial<PersonSent>;

const personSent = (sent: Sent = {}): PersonSent => ({ ...sent, cookie: sent.cookie ?? cookie });
const check = (requestId: string, sent?: Sent) => checkJoin(app, requestId, personSent(sent));
const approve = (requestId: string, body: unknown, sent?: Sent) =>
  approveJoin(app, requestId, body, personSent(sent));
const dismiss = (requestId: string, sent?: Sent) => dismissJoin(app, requestId, personSent(sent));

const refusal = (status: number, code: string, params: Record<string, unknown> = {}) => ({
  status,
  body: { error: { code, params } },
});

const sessionFor = (personId: string, fresh = true): Promise<string> =>
  signedInCookie(db, personId, fresh);

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

function mount(log?: Logger): void {
  app = new Hono();
  requests = mountBoxJoin(app, {
    log,
    appDb: db,
    node: suite.node,
    ring: RING,
    designated,
    stateDir,
    boxHostname: "waitron.local",
    advertisedOrigin: "https://box.deli.test",
    wakeSpareJoin: () => afterIssue(),
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
  afterIssue = () => {};
  mount();
}, 60_000);

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

  it("refuses another page's request that does not come through Cloud", async () => {
    const { requestId } = await listedRequest("192.168.1.20");
    expect(await check(requestId, { headers: { origin: "https://elsewhere.example" } })).toEqual(
      refusal(403, "node.operation_page_required"),
    );
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
      const answer = first.body as { choices: string[] };
      expect(Object.keys(answer)).toEqual(["choices"]);
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
    expect((await check(requestId)).status).toBe(200);
    expect(requests.listed().find((r) => r.id === requestId)?.startedAgain).toBe(true);
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
        startedAgain: false,
      },
    ]);
  });

  it("lists no join requests to Cloud remote access, which cannot approve them", async () => {
    mountMembershipRemovalApi(
      app,
      {
        db,
        node: suite.node,
        ring: RING,
        nodeId: designated.nodeId,
        reloadStream: async () => {},
        listJoinRequests: () => requests.listed(),
      },
      () => {},
    );
    await listedRequest("192.168.1.20");
    const response = await app.request(
      `${ORIGIN}/management-api/servers`,
      { headers: { cookie } },
      { remoteStaff: true },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("joinRequests");
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

  it("refuses Check and approve while the held chart cannot be read, leaving the request waiting", async () => {
    const body = { term: ((await readNodeMembership(db))?.body.term ?? -1) + 1 };
    await writeNodeMembership(db, {
      body,
      signerNodeId: designated.nodeId,
      signature: signDocumentBody(body as MembershipDocumentBody, primaryKeyPair.privateKey),
      endorsements: [],
    } as unknown as SignedMembershipDocument);
    const listed = await listedRequest("192.168.1.20");
    const broken = refusal(409, "membership.held_untrusted", { reason: "malformed" });

    expect(await check(listed.requestId)).toEqual(broken);
    expect(await approve(listed.requestId, { code: listed.code })).toEqual(broken);
    expect(await poll(listed)).toEqual({ state: "waiting" });
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
    for (const secret of [bundle.store.secretAccessKey, bundle.boxCaKeyPem, bundle.boxCaPem])
      expect(JSON.stringify(answer)).not.toContain(secret);
    expect((await readNodeMembership(db))?.body.nodes.map((n) => n.contactUrl)).toContain(
      listed.box.hello.contactUrl,
    );
    expect(await check(listed.requestId)).toEqual(refusal(404, "mirror.join_not_found"));
  });

  it("writes nothing for a request whose key cannot lock the copy", async () => {
    // The hello refuses such a key, so the request is placed in the store directly.
    const box = joiningBox("192.168.1.20", { unlikeNodeId: designated.nodeId });
    box.hello.encryptionKey = Buffer.concat([
      Buffer.from("302a300506032b656e032100", "hex"),
      Buffer.alloc(32),
    ]).toString("base64");
    const main = { nodeId: designated.nodeId, publicKey: primaryKeyPair.publicKey };
    expect(requests.admitHello(box.address)).toBeNull();
    const opened = requests.openHello({
      address: box.address,
      hello: box.hello,
      main,
      at: new Date().toISOString(),
    });
    if ("refused" in opened) throw new Error("hello refused");
    const revealed = requests.reveal({
      requestId: opened.requestId,
      newNonce: box.newNonce,
      seq: 1,
      signAnswer: () => "signed",
    });
    if ("refused" in revealed) throw new Error("reveal refused");
    const code = joinCode({
      ...box.hello,
      mainNodeId: main.nodeId,
      mainPublicKey: main.publicKey,
      newNonce: box.newNonce,
      mainNonce: revealed.mainNonce,
      requestId: opened.requestId,
    });
    const chartBefore = await readNodeMembership(db);

    expect(await approve(opened.requestId, { code })).toEqual(
      refusal(400, "mirror.standby_invalid"),
    );
    expect(await readNodeMembership(db)).toEqual(chartBefore);
    expect(await readPairLink(suite.node, designated.nodeId)).toBeNull();
  });

  it("refuses the new box's cancel and a Dismiss while a right tap is being approved", async () => {
    const listed = await listedRequest("192.168.1.20");
    expect(requests.approve.begin(listed.requestId, listed.code)).not.toHaveProperty("refused");
    const cancelled = await cancelJoin(app, listed);
    expect({ status: cancelled.status, body: await cancelled.json() }).toEqual(
      refusal(409, "mirror.join_approving"),
    );
    expect(await dismiss(listed.requestId)).toEqual(refusal(409, "mirror.join_in_progress"));
    requests.approve.abandon(listed.requestId);
    await cancel(listed);
    expect(await poll(listed)).toEqual({ state: "ended", reason: "cancelled" });
  });

  it("ends the request and says the spare was listed when the approval fails after listing it", async () => {
    const lines: [string, string, Record<string, unknown>][] = [];
    mount((level, event, fields = {}) => lines.push([level, event, fields]));
    const listed = await listedRequest("192.168.1.20");
    afterIssue = () => {
      afterIssue = () => {};
      throw new AppError("membership.write_contended", { attempts: 8 });
    };
    expect(await approve(listed.requestId, { code: listed.code })).toEqual(
      refusal(409, "mirror.join_stopped_after_listing"),
    );
    expect(lines).toContainEqual([
      "error",
      "mirror.join_failed",
      expect.objectContaining({ errorCode: "membership.write_contended" }),
    ]);
    const cancelled = await cancelJoin(app, listed);
    expect({ status: cancelled.status, body: await cancelled.json() }).toEqual(
      refusal(409, "mirror.join_approving"),
    );
    expect((await readNodeMembership(db))?.body.nodes.map((n) => n.nodeId)).toContain(
      listed.box.hello.newNodeId,
    );
    expect(await poll(listed)).toEqual({ state: "ended", reason: "stopped" });
    expect(await approve(listed.requestId, { code: listed.code })).toEqual(
      refusal(404, "mirror.join_not_found"),
    );
  });

  it("answers a full disk after listing as a full disk, and still ends the request", async () => {
    const listed = await listedRequest("192.168.1.20");
    afterIssue = () => {
      afterIssue = () => {};
      throw new AppError("storage.disk_full", {});
    };
    expect(await approve(listed.requestId, { code: listed.code })).toEqual(
      refusal(507, "storage.disk_full"),
    );
    expect(await poll(listed)).toEqual({ state: "ended", reason: "stopped" });
  });

  it("says the spare was listed when its request ended while the copy was built", async () => {
    const listed = await listedRequest("192.168.1.20");
    // The new box lost its attempt and asked again, which replaces the request being approved.
    afterIssue = () => {
      afterIssue = () => {};
      const again = joiningBox(listed.box.address, { unlikeNodeId: designated.nodeId });
      expect(requests.admitHello(again.address)).toBeNull();
      const opened = requests.openHello({
        address: again.address,
        hello: again.hello,
        main: { nodeId: designated.nodeId, publicKey: primaryKeyPair.publicKey },
        at: new Date().toISOString(),
      });
      if ("refused" in opened) throw new Error("hello refused");
      requests.reveal({
        requestId: opened.requestId,
        newNonce: again.newNonce,
        seq: 1,
        signAnswer: () => "signed",
      });
    };
    expect(await approve(listed.requestId, { code: listed.code })).toEqual(
      refusal(409, "mirror.join_stopped_after_listing"),
    );
    expect((await readNodeMembership(db))?.body.nodes.map((n) => n.nodeId)).toContain(
      listed.box.hello.newNodeId,
    );
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

  it("reserves once when a right tap is sent again after membership.write_contended", async () => {
    const listed = await listedRequest("192.168.1.20");
    await holdChartNamingOnlyMainBox();
    await withReservingModule(listed.box.hello.newNodeId, async (moduleOperation, operators) => {
      await db.execute(
        sql.raw(
          "create trigger test_node_membership_contended before update on node_membership begin select raise(ignore); end",
        ),
      );
      try {
        expect(await approve(listed.requestId, { code: listed.code, moduleOperation })).toEqual(
          refusal(503, "membership.write_contended", { attempts: 8 }),
        );
      } finally {
        await db.execute(sql.raw("drop trigger test_node_membership_contended"));
      }
      const again = await approve(listed.requestId, { code: listed.code, moduleOperation });
      expect(again.status, JSON.stringify(again.body)).toBe(202);
      // This module's reserve writes no venue row, so its calls are the reservations it made.
      expect(await db.select().from(fiscalReservations)).toEqual([]);
      expect(operators).toEqual([approverId]);
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

  it("refuses a tap on a second box while the first is approved, keeping the first's pair link", async () => {
    const first = await listedRequest("192.168.1.20");
    const second = await listedRequest("192.168.1.21");
    expect(requests.approve.begin(first.requestId, first.code)).not.toHaveProperty("refused");
    expect(await approve(second.requestId, { code: second.code })).toEqual(
      refusal(409, "mirror.join_other_approved"),
    );
    requests.approve.abandon(first.requestId);

    expect((await approve(first.requestId, { code: first.code })).status).toBe(202);
    expect(await approve(second.requestId, { code: second.code })).toEqual(
      refusal(409, "mirror.join_other_approved"),
    );
    expect((await readPairLink(suite.node, designated.nodeId))?.peerNodeId).toBe(
      first.box.hello.newNodeId,
    );
    expect((await readNodeMembership(db))?.body.nodes.map((n) => n.nodeId)).not.toContain(
      second.box.hello.newNodeId,
    );
    expect(await poll(second)).toEqual({ state: "waiting" });
  });

  it("takes a tap on the new code once the approved box has chosen Start again and asked again", async () => {
    const box = joiningBox("192.168.1.20", { unlikeNodeId: designated.nodeId });
    const first = await listedJoin(app, box);
    expect((await approve(first.requestId, { code: first.code })).status).toBe(202);
    expect(await poll(first)).toMatchObject({ state: "approved" });
    const cancelled = await cancelJoin(app, first);
    expect({ status: cancelled.status, body: await cancelled.json() }).toEqual(
      refusal(409, "mirror.join_approving"),
    );

    const again = await listedRequest("192.168.1.20");
    expect(await approve(again.requestId, { code: again.code })).toEqual({
      status: 202,
      body: null,
    });
    expect(await poll(first)).toEqual({ state: "ended", reason: "replaced" });
    expect((await readPairLink(suite.node, designated.nodeId))?.peerNodeId).toBe(
      again.box.hello.newNodeId,
    );
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
