import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { CORE_MIGRATIONS, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { signDocumentBody, type MembershipDocumentBody } from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import {
  JOIN_CANCEL_LABEL,
  JOIN_POLL_LABEL,
  JOIN_REVEAL_LABEL,
  commitmentFor,
  pollMessageFields,
  revealAnswerFields,
  verifyJoinMessage,
  type JoinHello,
} from "./box-join-code.js";
import { mountBoxJoinApi } from "./box-join-api.js";
import { createBoxJoinRequests, type BoxJoinRequests } from "./box-join-requests.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import {
  boxPost,
  helloBody as joinHelloBody,
  joiningBox,
  revealBody,
  signedBy,
  type HelloAnswer,
  type JoiningBox,
} from "./testing/box-join.js";
import { holdChartNamingMainBox } from "./testing/membership-doc-fixture.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const NOW = Date.parse("2026-11-21T10:00:00.000Z");

type NewBox = JoiningBox;

const newBox = (address: string, identity = generateStandbyIdentity()): NewBox =>
  joiningBox(address, { identity, addresses: [address, "10.0.0.9"] });

const helloBody = (box: NewBox, overrides: Record<string, unknown> = {}, at = NOW) =>
  joinHelloBody(box, overrides, at);

describe("the main box's box-to-box join routes", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS], timeoutMs: 60_000 });
  let app: Hono;
  let requests: BoxJoinRequests;
  let mainNodeId: string;
  let mainPublicKey: string;

  function mount(store: BoxJoinRequests = createBoxJoinRequests()) {
    requests = store;
    app = new Hono();
    mountBoxJoinApi(app, {
      appDb: suite.db,
      node: suite.node,
      ring: RING,
      designated: { nodeId: mainNodeId },
      requests: store,
      now: () => new Date(NOW),
    });
  }

  beforeEach(async () => {
    await seedVenue(suite.db, { name: "Main room", invoiceLocales: ["es-ES"] });
    mainNodeId = await seedNode(suite.db);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, mainNodeId);
    mainPublicKey = nodeSigningPublicKey(await readNodeIdentityKey(suite.node, RING, mainNodeId));
    mount();
  }, 60_000);

  const post = (path: string, body: unknown, from: string) => boxPost(app, path, body, from);

  async function hello(box: NewBox) {
    const response = await post("hello", helloBody(box), box.address);
    expect(response.status).toBe(200);
    return (await response.json()) as HelloAnswer;
  }

  const signed = signedBy;

  const err = (code: string, params: Record<string, unknown> = {}) => ({
    error: { code, params },
  });

  it("refuses a hello from an address the hello does not list", async () => {
    const box = newBox("192.168.1.20");
    const response = await post("hello", helloBody(box), "192.168.1.66");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(err("mirror.join_address_mismatch"));
    // Not stored: a held hello from 192.168.1.66 would refuse the next one from it.
    box.hello = { ...box.hello, addresses: [...box.hello.addresses, "192.168.1.66"] };
    expect((await post("hello", helloBody(box), "192.168.1.66")).status).toBe(200);
  });

  it("holds one unrevealed hello from an address when two arrive at once", async () => {
    const box = newBox("192.168.1.20");
    const responses = await Promise.all([
      post("hello", helloBody(box), box.address),
      post("hello", helloBody(box), box.address),
    ]);
    const answers = await Promise.all(
      responses.map(async (r) => [
        r.status,
        ((await r.json()) as { error?: { code: string } }).error?.code,
      ]),
    );
    expect(answers.sort()).toEqual([
      [200, undefined],
      [429, "mirror.join_full"],
    ]);
  });

  it.each([
    ["a scope", "FE80:0:0::1%eth0", "fe80::1"],
    ["an IPv4-mapped prefix", "::ffff:192.168.1.20", "::ffff:192.168.1.20"],
    ["upper case and leading zeros", "2001:DB8::0001", "2001:db8::1"],
    ["no compression", "2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
    ["plain IPv4, from an IPv4-mapped source", "192.168.1.20", "::ffff:192.168.1.20"],
    ["no scope, from a scoped source", "fe80::1", "fe80::1%en0"],
  ])("matches a listed address written with %s", async (_name, listed, source) => {
    const box = newBox("192.168.1.20");
    box.hello = { ...box.hello, addresses: [listed] };
    const response = await post("hello", helloBody(box), source);
    expect(response.status).toBe(200);
  });

  it("counts refused hellos against the address limit, before reading the venue", async () => {
    const other = generateStandbyIdentity();
    const named = newBox("192.168.1.20", {
      ...other,
      nodeId: `${mainNodeId.slice(0, 4)}${other.nodeId.slice(4)}`,
    });
    const statuses = [];
    for (let n = 0; n < 6; n++) {
      const response = await post("hello", helloBody(named), named.address);
      statuses.push([
        response.status,
        ((await response.json()) as { error: { code: string } }).error.code,
      ]);
    }
    expect(statuses).toEqual([
      ...Array.from({ length: 5 }, () => [409, "mirror.standby_name_taken"]),
      [429, "mirror.join_full"],
    ]);
  });

  it("refuses a later request from an address the hello does not list", async () => {
    const box = newBox("192.168.1.20");
    const { requestId } = await hello(box);
    const response = await post("reveal", revealBody(box, requestId), "192.168.1.66");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(err("mirror.join_address_mismatch"));
    expect(requests.listed()).toEqual([]);
  });

  it("answers a hello with the commitment and the main box's identity, and no Nm", async () => {
    const box = newBox("192.168.1.20");
    const answer = await hello(box);
    expect(Object.keys(answer).sort()).toEqual(
      ["commitment", "expiresAt", "mainNodeId", "mainPublicKey", "requestId"].sort(),
    );
    expect(answer.mainNodeId).toBe(mainNodeId);
    expect(answer.mainPublicKey).toBe(mainPublicKey);

    const reveal = await post("reveal", revealBody(box, answer.requestId), box.address);
    expect(reveal.status).toBe(200);
    const { mainNonce } = (await reveal.json()) as { mainNonce: string };
    expect(answer.commitment).toBe(
      commitmentFor(answer.requestId, Buffer.from(mainNonce, "base64")).toString("base64"),
    );
    expect(JSON.stringify(answer)).not.toContain(mainNonce);
  });

  it("signs the reveal answer over every hello field, Nn and Nm", async () => {
    const box = newBox("192.168.1.20");
    const { requestId } = await hello(box);
    const response = await post("reveal", revealBody(box, requestId), box.address);
    const { mainNonce, signature } = (await response.json()) as {
      mainNonce: string;
      signature: string;
    };
    const nm = Buffer.from(mainNonce, "base64");
    const verifies = (h: JoinHello) =>
      verifyJoinMessage(
        JOIN_REVEAL_LABEL,
        requestId,
        1,
        revealAnswerFields(h, box.newNonce, nm),
        signature,
        mainPublicKey,
      );
    expect(verifies(box.hello)).toBe(true);
    const other = generateStandbyIdentity();
    const changed: [string, JoinHello][] = [
      ["newNodeId", { ...box.hello, newNodeId: other.nodeId }],
      ["newPublicKey", { ...box.hello, newPublicKey: other.publicKey }],
      ["encryptionKey", { ...box.hello, encryptionKey: newBox("x").hello.encryptionKey }],
      ["contactUrl", { ...box.hello, contactUrl: "https://192.168.1.21:8443" }],
      ["storeUrl", { ...box.hello, storeUrl: "https://192.168.1.20:9001" }],
      ["addresses", { ...box.hello, addresses: ["192.168.1.20"] }],
    ];
    expect(changed.map(([field, h]) => [field, verifies(h)])).toEqual(
      changed.map(([field]) => [field, false]),
    );
    expect(
      verifyJoinMessage(
        JOIN_REVEAL_LABEL,
        requestId,
        1,
        revealAnswerFields(box.hello, randomBytes(32), nm),
        signature,
        mainPublicKey,
      ),
    ).toBe(false);
  });

  it("answers a reveal whose code a listed request shows with no Nm", async () => {
    const first = newBox("192.168.1.20");
    const second = newBox("192.168.1.30");
    const real = createBoxJoinRequests();
    // The store's own case shows when a code is taken; this one is the route's answer to it.
    mount({
      ...real,
      reveal: (input) =>
        input.requestId === secondId ? { refused: "code_taken" } : real.reveal(input),
    });
    const firstHello = await hello(first);
    const secondHello = await hello(second);
    const secondId = secondHello.requestId;
    expect(
      (await post("reveal", revealBody(first, firstHello.requestId), first.address)).status,
    ).toBe(200);
    const taken = await post("reveal", revealBody(second, secondId), second.address);
    expect(taken.status).toBe(409);
    const body = await taken.text();
    expect(JSON.parse(body)).toEqual(err("mirror.join_code_taken"));
    expect(body).not.toContain("mainNonce");
    expect(requests.listed().map((r) => r.id)).toEqual([firstHello.requestId]);
  });

  it("refuses a message whose signature does not check, and ends its request", async () => {
    const box = newBox("192.168.1.20");
    const { requestId } = await hello(box);
    await post("reveal", revealBody(box, requestId), box.address);
    const pollBody = (seq: number, at: number) => ({
      requestId,
      seq,
      at,
      confirmed: false,
      signature: signed(box, JOIN_POLL_LABEL, requestId, seq, pollMessageFields(at, false)),
    });
    const forged = { ...pollBody(2, NOW), at: NOW + 1 };
    const response = await post("poll", forged, box.address);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(err("mirror.join_invalid"));
    const later = await post("poll", pollBody(3, NOW), box.address);
    expect(await later.json()).toEqual({ state: "ended", reason: "invalid" });
    expect(requests.listed()).toEqual([]);
  });

  it.each([
    ["address", "hello"],
    ["network", "hello"],
    ["listed", "reveal"],
    ["recent", "reveal"],
  ] as const)(
    "answers the %s limit at %s with 429, the limit and when it frees",
    async (limit, at) => {
      const retryAt = "2026-11-21T10:15:00.000Z";
      const real = createBoxJoinRequests();
      const refusal = { refused: "full" as const, limit, retryAt, max: 4, minutes: 20 };
      mount({
        ...real,
        ...(at === "hello" ? { admitHello: () => refusal } : { reveal: () => refusal }),
      });
      const box = newBox("192.168.1.20");
      const response =
        at === "hello"
          ? await post("hello", helloBody(box), box.address)
          : await post("reveal", revealBody(box, (await hello(box)).requestId), box.address);
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual(
        err("mirror.join_full", { limit, retryAt, max: 4, minutes: 20 }),
      );
    },
  );

  it("polls a waiting request, and cancel ends it", async () => {
    const box = newBox("192.168.1.20");
    const { requestId } = await hello(box);
    await post("reveal", revealBody(box, requestId), box.address);
    const at = NOW + 1_000;
    const poll = await post(
      "poll",
      {
        requestId,
        seq: 2,
        at,
        confirmed: false,
        signature: signed(box, JOIN_POLL_LABEL, requestId, 2, pollMessageFields(at, false)),
      },
      box.address,
    );
    expect(poll.status).toBe(200);
    expect(await poll.json()).toEqual({ state: "waiting" });

    const cancel = await post(
      "cancel",
      { requestId, seq: 3, signature: signed(box, JOIN_CANCEL_LABEL, requestId, 3, []) },
      box.address,
    );
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toEqual({ cancelled: true });
    expect(requests.listed()).toEqual([]);
    expect(requests.check(requestId)).toEqual({ refused: "not_found" });
  });

  describe("the new box's Yes in a poll", () => {
    async function revealed(box: NewBox): Promise<string> {
      const { requestId } = await hello(box);
      await post("reveal", revealBody(box, requestId), box.address);
      return requestId;
    }
    const pollBody = (box: NewBox, requestId: string, seq: number, confirmed: boolean) => ({
      requestId,
      seq,
      at: NOW,
      confirmed,
      signature: signed(box, JOIN_POLL_LABEL, requestId, seq, pollMessageFields(NOW, confirmed)),
    });

    it("is recorded on the listed request", async () => {
      const box = newBox("192.168.1.20");
      const requestId = await revealed(box);
      const response = await post("poll", pollBody(box, requestId, 2, true), box.address);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ state: "waiting" });
      expect(requests.listed()).toMatchObject([{ id: requestId, newConfirmed: true }]);
    });

    it("is refused, and ends the request, when it was added after the poll was signed", async () => {
      const box = newBox("192.168.1.20");
      const requestId = await revealed(box);
      const forged = { ...pollBody(box, requestId, 2, false), confirmed: true };
      const response = await post("poll", forged, box.address);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(err("mirror.join_invalid"));
      expect(requests.listed()).toEqual([]);
      expect(requests.check(requestId)).toEqual({ refused: "not_found" });
    });

    it.each([
      ["missing", undefined],
      ["a string", "true"],
      ["a number", 1],
      ["null", null],
    ])("is refused when it is %s rather than true or false", async (_name, confirmed) => {
      const box = newBox("192.168.1.20");
      const requestId = await revealed(box);
      const response = await post(
        "poll",
        { ...pollBody(box, requestId, 2, true), confirmed },
        box.address,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(err("mirror.join_invalid"));
      expect(requests.listed()).toMatchObject([{ id: requestId, newConfirmed: false }]);
    });
  });

  it("refuses a malformed hello, an unknown protocol, a bad signature, clocks apart and a taken box name", async () => {
    const box = newBox("192.168.1.20");
    const other = generateStandbyIdentity();
    const named = newBox("192.168.1.20", {
      ...other,
      nodeId: `${mainNodeId.slice(0, 4)}${other.nodeId.slice(4)}`,
    });
    const listed = generateStandbyIdentity();
    const charted = newBox("192.168.1.20");
    await holdChartNamingMainBox(
      suite.db,
      { nodeId: mainNodeId, contactUrl: "https://waitron.local" },
      {
        nodeId: `${charted.identity.nodeId.slice(0, 4)}${listed.nodeId.slice(4)}`,
        contactUrl: "https://192.168.1.40:8443",
      },
    );
    const behind = NOW - 11 * 60_000;
    // A point of small order: it reads as an X25519 key, but no key can be agreed with it.
    const unusable = Buffer.concat([
      Buffer.from("302a300506032b656e032100", "hex"),
      Buffer.alloc(32),
    ]).toString("base64");
    const unlockable = { ...box, hello: { ...box.hello, encryptionKey: unusable } };
    const plainHttp = joiningBox("192.168.1.20", {
      addresses: ["192.168.1.20"],
      contactUrl: "http://box-abcd.waitron.local",
      storeUrl: "https://box-abcd.waitron.local:9000",
    });
    const cases: [string, Record<string, unknown>, number, unknown][] = [
      ["malformed", helloBody(box, { addresses: [] }), 400, err("mirror.standby_invalid")],
      ["unusable key", helloBody(unlockable), 400, err("mirror.standby_invalid")],
      ["plain http contact", helloBody(plainHttp), 400, err("mirror.standby_invalid")],
      ["protocol", helloBody(box, { protocol: 1, addresses: [] }), 400, err("mirror.join_invalid")],
      ["signature", { ...helloBody(box), at: NOW + 1 }, 400, err("mirror.join_invalid")],
      [
        "clock",
        helloBody(box, {}, behind),
        409,
        err("mirror.clocks_apart", {
          primaryAt: new Date(NOW).toISOString(),
          standbyAt: new Date(behind).toISOString(),
        }),
      ],
      ["main box's name", helloBody(named), 409, err("mirror.standby_name_taken")],
      ["a listed box's name", helloBody(charted), 409, err("mirror.standby_name_taken")],
    ];
    const results = [];
    for (const [name, body] of cases) {
      const response = await post("hello", body, box.address);
      results.push([name, response.status, await response.json()]);
    }
    expect(results).toEqual(cases.map(([name, , status, body]) => [name, status, body]));
  });

  it("admits a hello from a box the chart already lists, and still refuses another box with its name", async () => {
    const listed = newBox("192.168.1.20");
    const other = generateStandbyIdentity();
    const clashing = newBox("192.168.1.21", {
      ...other,
      nodeId: `${listed.identity.nodeId.slice(0, 4)}${other.nodeId.slice(4)}`,
    });
    await holdChartNamingMainBox(
      suite.db,
      { nodeId: mainNodeId, contactUrl: "https://waitron.local" },
      { nodeId: listed.identity.nodeId, contactUrl: "https://192.168.1.20:8443" },
    );

    expect((await post("hello", helloBody(listed), listed.address)).status).toBe(200);
    const refused = await post("hello", helloBody(clashing), clashing.address);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual(err("mirror.standby_name_taken"));
  });

  it("does not tell a hello that the held chart cannot be read", async () => {
    const body = { term: 1 } as unknown as MembershipDocumentBody;
    await writeNodeMembership(suite.db, {
      body,
      signerNodeId: mainNodeId,
      signature: signDocumentBody(body, await readNodeIdentityKey(suite.node, RING, mainNodeId)),
      endorsements: [],
    });
    const box = newBox("192.168.1.20");

    expect((await post("hello", helloBody(box), box.address)).status).toBe(200);
  });

  it("answers mirror.join_not_found for a request it does not hold", async () => {
    const box = newBox("192.168.1.20");
    const response = await post(
      "poll",
      {
        requestId: "33333333-3333-4333-8333-333333333333",
        seq: 2,
        at: NOW,
        confirmed: false,
        signature: "x",
      },
      box.address,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(err("mirror.join_not_found"));
  });

  it.each([
    [{ refused: "ended", reason: "code_taken" }, 409, "mirror.join_code_taken"],
    [{ refused: "ended", reason: "invalid" }, 400, "mirror.join_invalid"],
    [{ refused: "ended", reason: "dismissed" }, 404, "mirror.join_not_found"],
    [{ refused: "invalid" }, 400, "mirror.join_invalid"],
  ] as const)("answers a reveal the store refuses with %o as %i", async (refusal, status, code) => {
    mount({ ...createBoxJoinRequests(), reveal: () => refusal });
    const box = newBox("192.168.1.20");
    const response = await post(
      "reveal",
      revealBody(box, (await hello(box)).requestId),
      box.address,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(err(code));
  });

  it.each([
    ["approving", 409, "mirror.join_approving"],
    ["not_found", 404, "mirror.join_not_found"],
  ] as const)("answers a cancel the store refuses as %s", async (refused, status, code) => {
    mount({ ...createBoxJoinRequests(), cancel: () => ({ refused }) });
    const box = newBox("192.168.1.20");
    const { requestId } = await hello(box);
    const response = await post(
      "cancel",
      { requestId, seq: 2, signature: signed(box, JOIN_CANCEL_LABEL, requestId, 2, []) },
      box.address,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(err(code));
  });

  it.each([
    ["a nonce that is not text", { newNonce: 7 }],
    ["a short nonce", { newNonce: Buffer.alloc(8).toString("base64") }],
    ["a sequence number below one", { seq: 0 }],
  ])("refuses a reveal carrying %s, before checking its signature", async (_, change) => {
    const box = newBox("192.168.1.20");
    const { requestId } = await hello(box);
    const response = await post(
      "reveal",
      { ...revealBody(box, requestId), ...change },
      box.address,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(err("mirror.join_invalid"));
    expect(requests.listed()).toEqual([]);
    const proper = await post("reveal", revealBody(box, requestId), box.address);
    expect(proper.status).toBe(200);
  });

  it.each([
    ["a signing key that is not text", { newPublicKey: 7 }],
    [
      "a signing key that is not a key",
      { newPublicKey: Buffer.from("not a key").toString("base64") },
    ],
  ])("refuses a hello carrying %s", async (_, change) => {
    const box = newBox("192.168.1.20");
    const response = await post("hello", helloBody(box, change), box.address);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(err("mirror.standby_invalid"));
    expect(requests.listed()).toEqual([]);
  });

  it("refuses a poll whose time is not a time, and a poll the store refuses", async () => {
    const real = createBoxJoinRequests();
    let refuse = false;
    mount({
      ...real,
      poll: (input) => (refuse ? { refused: "invalid" } : real.poll(input)),
    });
    const box = newBox("192.168.1.20");
    const { requestId } = await hello(box);
    await post("reveal", revealBody(box, requestId), box.address);
    const pollBody = (seq: number, at: unknown) => ({
      requestId,
      seq,
      at,
      confirmed: false,
      signature: signed(box, JOIN_POLL_LABEL, requestId, seq, [
        Buffer.from(String(at)),
        Buffer.from("false"),
      ]),
    });
    const notATime = await post("poll", pollBody(2, "soon"), box.address);
    expect(notATime.status).toBe(400);
    expect(await notATime.json()).toEqual(err("mirror.join_invalid"));
    refuse = true;
    const refused = await post("poll", pollBody(3, NOW), box.address);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual(err("mirror.join_invalid"));
    refuse = false;
    expect(await (await post("poll", pollBody(4, NOW), box.address)).json()).toEqual({
      state: "waiting",
    });
  });
});
