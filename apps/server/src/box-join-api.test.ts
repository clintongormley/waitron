import { generateKeyPairSync, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import {
  JOIN_CANCEL_LABEL,
  JOIN_HELLO_LABEL,
  JOIN_POLL_LABEL,
  JOIN_REVEAL_LABEL,
  commitmentFor,
  helloMessageFields,
  joinCode,
  revealAnswerFields,
  signJoinMessage,
  verifyJoinMessage,
} from "./box-join-code.js";
import { mountBoxJoinApi } from "./box-join-api.js";
import {
  createBoxJoinRequests,
  type BoxJoinRequests,
  type JoinHello,
} from "./box-join-requests.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { generateStandbyIdentity, type StandbyIdentity } from "./reserved-identity.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const NOW = Date.parse("2026-11-21T10:00:00.000Z");

interface NewBox {
  identity: StandbyIdentity;
  hello: JoinHello;
  address: string;
  newNonce: Buffer;
}

function newBox(address: string, identity = generateStandbyIdentity()): NewBox {
  const ek = generateKeyPairSync("x25519").publicKey.export({ format: "der", type: "spki" });
  return {
    identity,
    address,
    newNonce: randomBytes(32),
    hello: {
      newNodeId: identity.nodeId,
      newPublicKey: identity.publicKey,
      encryptionKey: ek.toString("base64"),
      contactUrl: `https://${address}:8443`,
      storeUrl: `https://${address}:9000`,
      addresses: [address, "10.0.0.9"],
    },
  };
}

function helloBody(box: NewBox, overrides: Record<string, unknown> = {}, at = NOW) {
  return {
    protocol: 1,
    ...box.hello,
    at,
    signature: signJoinMessage(
      JOIN_HELLO_LABEL,
      "",
      0,
      helloMessageFields(box.hello, at),
      box.identity.privateKey,
    ),
    ...overrides,
  };
}

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

  const post = (path: string, body: unknown, from: string) =>
    app.request(
      `https://waitron.local/api/node/join/${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { incoming: { socket: { remoteAddress: from } } },
    );

  async function hello(box: NewBox) {
    const response = await post("hello", helloBody(box), box.address);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      requestId: string;
      mainNodeId: string;
      mainPublicKey: string;
      commitment: string;
      expiresAt: string;
    };
  }

  function signed(box: NewBox, label: string, requestId: string, seq: number, fields: Buffer[]) {
    return signJoinMessage(label, requestId, seq, fields, box.identity.privateKey);
  }

  const revealBody = (box: NewBox, requestId: string) => ({
    requestId,
    seq: 1,
    newNonce: box.newNonce.toString("base64"),
    signature: signed(box, JOIN_REVEAL_LABEL, requestId, 1, [box.newNonce]),
  });

  const err = (code: string, params: Record<string, unknown> = {}) => ({
    error: { code, params },
  });

  it("refuses a hello from an address the hello does not list", async () => {
    const box = newBox("192.168.1.20");
    const response = await post("hello", helloBody(box), "192.168.1.66");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(err("mirror.join_address_mismatch"));
    expect(requests.requestFor("anything")).toBeNull();
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
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const nonces = [randomBytes(32), randomBytes(32)];
    const secondCode = joinCode({
      ...second.hello,
      mainNodeId,
      mainPublicKey,
      newNonce: second.newNonce,
      mainNonce: nonces[1]!,
      requestId: ids[1]!,
    });
    // The second request's real code becomes one of the first request's decoys.
    const draws = [secondCode, "000001", "000002"];
    let made = 0;
    mount(
      createBoxJoinRequests({
        newId: () => ids[made]!,
        newMainNonce: () => nonces[made++]!,
        drawCode: () => draws.shift()!,
      }),
    );
    const firstHello = await hello(first);
    const secondHello = await hello(second);
    expect(
      (await post("reveal", revealBody(first, firstHello.requestId), first.address)).status,
    ).toBe(200);
    const taken = await post("reveal", revealBody(second, secondHello.requestId), second.address);
    expect(taken.status).toBe(409);
    const body = await taken.text();
    expect(JSON.parse(body)).toEqual(err("mirror.join_code_taken"));
    expect(body).not.toContain(nonces[1]!.toString("base64"));
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
      signature: signed(box, JOIN_POLL_LABEL, requestId, seq, [Buffer.from(String(at))]),
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
      const refusal = { refused: "full" as const, limit, retryAt };
      mount({
        ...real,
        ...(at === "hello" ? { hello: () => refusal } : { reveal: () => refusal }),
      });
      const box = newBox("192.168.1.20");
      const response =
        at === "hello"
          ? await post("hello", helloBody(box), box.address)
          : await post("reveal", revealBody(box, (await hello(box)).requestId), box.address);
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual(err("mirror.join_full", { limit, retryAt }));
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
        signature: signed(box, JOIN_POLL_LABEL, requestId, 2, [Buffer.from(String(at))]),
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

  it("refuses a malformed hello, an unknown protocol, clocks apart and a taken box name", async () => {
    const box = newBox("192.168.1.20");
    const other = generateStandbyIdentity();
    const named = newBox("192.168.1.20", {
      ...other,
      nodeId: `${mainNodeId.slice(0, 4)}${other.nodeId.slice(4)}`,
    });
    const behind = NOW - 11 * 60_000;
    const cases: [string, Record<string, unknown>, number, unknown][] = [
      ["malformed", helloBody(box, { addresses: [] }), 400, err("mirror.standby_invalid")],
      ["protocol", helloBody(box, { protocol: 2 }), 400, err("mirror.join_invalid")],
      [
        "clock",
        helloBody(box, {}, behind),
        409,
        err("mirror.clocks_apart", {
          primaryAt: new Date(NOW).toISOString(),
          standbyAt: new Date(behind).toISOString(),
        }),
      ],
      ["name", helloBody(named), 409, err("mirror.standby_name_taken")],
    ];
    const results = [];
    for (const [name, body] of cases) {
      const response = await post("hello", body, box.address);
      results.push([name, response.status, await response.json()]);
    }
    expect(results).toEqual(cases.map(([name, , status, body]) => [name, status, body]));
  });

  it("answers mirror.join_not_found for a request it does not hold", async () => {
    const box = newBox("192.168.1.20");
    const response = await post(
      "poll",
      { requestId: "33333333-3333-4333-8333-333333333333", seq: 2, at: NOW, signature: "x" },
      box.address,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(err("mirror.join_not_found"));
  });
});
