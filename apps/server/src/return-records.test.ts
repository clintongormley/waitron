import * as loop from "./loop.js";
import * as database from "@waitron/db";
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, stampDeployment, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { endorseKey, signDocumentBody, type CanonicalValue } from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import type { WaitronModule } from "@waitron/module";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { startReturnRecordsDuty, runReturnRecordsPass } from "./return-records.js";
import { mountReturnRecordsApi } from "./return-records-api.js";
import { signAsThisBox } from "./handover-signing.js";
import { AppError } from "@waitron/shared";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
let source: string;
let receiver: string;
let received: CanonicalValue[];
let accounted: boolean;
const modules: WaitronModule[] = [
  {
    name: "sample",
    version: "1.0.0",
    tier: "mandatory",
    handover: {
      summarise: async () => null,
      returnRecords: {
        read: async () => ["first", "second"],
        receive: async (_tx, _source, batch) => {
          received.push(batch);
          return accounted;
        },
      },
    },
  },
];

beforeEach(async () => {
  received = [];
  accounted = true;
  await seedVenue(suite.db, { name: "Return venue", operationDescription: "Restaurant service" });
  await stampDeployment(suite.db, "preproduction");
  source = await seedNode(suite.db);
  receiver = await seedNode(suite.db);
  for (const nodeId of [source, receiver])
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  await pinMainBoxKey(suite.node, receiver, {
    nodeId: source,
    publicKey: nodeSigningPublicKey(sourceKey),
  });
  const body = {
    term: 2,
    nodes: [
      {
        nodeId: receiver,
        contactUrl: "https://receiver.test",
        standing: "serving-primary" as const,
      },
      { nodeId: source, contactUrl: "https://source.test", standing: "sell-only" as const },
    ],
  };
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: receiver,
    signature: signDocumentBody(body, receiverKey),
    endorsements: [endorseKey(receiver, nodeSigningPublicKey(receiverKey), source, sourceKey)],
  });
});

function destination(requireWritable = () => {}) {
  const app = new Hono();
  mountReturnRecordsApi(
    app,
    {
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: receiver,
      modules,
      requireWritable,
      wake: () => {},
    },
    () => {},
  );
  return app;
}
function send(fetch: typeof globalThis.fetch) {
  return runReturnRecordsPass({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    fetch,
    stopped: () => false,
  });
}

it("returns all module batches through real signatures and confirms only the complete inventory", async () => {
  const app = destination();
  const answers: unknown[] = [];
  const result = await send(async (url, init) => {
    const response = await app.request(String(url), init);
    answers.push(await response.clone().json());
    return response;
  });
  expect(result).toBe("confirmed");
  expect(received).toEqual(["first", "second"]);
  expect(answers).toEqual([
    expect.objectContaining({
      body: expect.objectContaining({ accounted: true, complete: false }),
    }),
    expect.objectContaining({ body: expect.objectContaining({ accounted: true, complete: true }) }),
  ]);
});

it.each(["environment", "venue", "destination", "signature", "payload"])(
  "refuses a return with wrong %s before invoking its module",
  async (field) => {
    const app = destination();
    let status = 0;
    const result = await send(async (url, init) => {
      const raw = JSON.parse(String(init?.body)) as {
        body: Record<string, CanonicalValue>;
        signature: string;
      };
      const venue = raw.body.venue as Record<string, CanonicalValue>;
      if (field === "signature") raw.signature = Buffer.alloc(64).toString("base64");
      else {
        if (field === "payload") delete raw.body.payload;
        if (field === "environment") venue.environment = "production";
        if (field === "venue") venue.taxId = "other-taxpayer";
        if (field === "destination") raw.body.destinationNodeId = source;
        const { signAsThisBox } = await import("./handover-signing.js");
        Object.assign(
          raw,
          await signAsThisBox({ node: suite.node, ring, nodeId: source }, "return-batch", raw.body),
        );
      }
      const response = await app.request(String(url), { ...init, body: JSON.stringify(raw) });
      status = response.status;
      return response;
    });
    expect(status).toBe(409);
    expect(result).toBe("needs-attention");
    expect(received).toEqual([]);
  },
);

it.each([
  "pinned source",
  "primary receiver",
  "revoked source",
  "changed chart",
  "read-only receiver",
])("refuses a trusted return for a %s before importing facts", async (field) => {
  const chart = (await database.readNodeMembership(suite.db))!;
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  const app = destination(() => {
    if (field === "read-only receiver") throw new AppError("node.read_only", {});
  });
  const result = await send(async (url, init) => {
    const changed = structuredClone(chart);
    if (field === "pinned source") {
      await pinMainBoxKey(suite.node, receiver, {
        nodeId: receiver,
        publicKey: nodeSigningPublicKey(receiverKey),
      });
      changed.endorsements.push(
        endorseKey(source, nodeSigningPublicKey(sourceKey), receiver, receiverKey),
      );
    }
    if (field === "primary receiver") changed.body.nodes[0]!.standing = "sell-only";
    if (field === "revoked source") changed.body.revoked = [source];
    changed.signature = signDocumentBody(changed.body, receiverKey);
    if (field === "changed chart") {
      changed.body.term++;
      changed.signature = signDocumentBody(changed.body, receiverKey);
      const read = database.readNodeMembership;
      let reads = 0;
      const spy = vi.spyOn(database, "readNodeMembership").mockImplementation(async (db) => {
        if (++reads === 2) await database.writeNodeMembershipTx(db, changed);
        return read(db);
      });
      try {
        return await app.request(String(url), init);
      } finally {
        spy.mockRestore();
      }
    }
    await writeNodeMembership(suite.db, changed);
    return app.request(String(url), init);
  });
  expect(result).toBe("needs-attention");
  expect(received).toEqual([]);
});

it.each(["digest", "nonce"])(
  "refuses a validly signed receipt with the wrong %s",
  async (field) => {
    const app = destination();
    expect(
      await send(async (url, init) => {
        const answer = await app.request(String(url), init);
        const receipt = (await answer.json()) as { body: Record<string, CanonicalValue> };
        receipt.body[field] = "different";
        return Response.json(
          await signAsThisBox(
            { node: suite.node, ring, nodeId: receiver },
            "return-receipt",
            receipt.body,
          ),
        );
      }),
    ).toBe("needs-attention");
    expect(received).toEqual(["first"]);
  },
);

it("waits after a lost final confirmation and safely re-enumerates on the next pass", async () => {
  const app = destination();
  let calls = 0;
  const first = await send(async (url, init) => {
    const response = await app.request(String(url), init);
    if (++calls === 2) throw new TypeError("connection lost after commit");
    return response;
  });
  expect(first).toBe("waiting");
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("confirmed");
  expect(received).toEqual(["first", "second", "first", "second"]);
});

it("distinguishes a signed unaccounted batch from a request refusal", async () => {
  accounted = false;
  const app = destination();
  expect(await send(async (url, init) => app.request(String(url), init))).toBe("clash");
  expect(received).toEqual(["first"]);
});

it("waits for the active exchange to end before shutdown and starts no later batch", async () => {
  const app = destination();
  let begun!: () => void;
  let proceed!: () => void;
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  const release = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const events: string[] = [];
  const duty = startReturnRecordsDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    log: () => {},
    fetch: async (url, init) => {
      begun();
      await release;
      const response = await app.request(String(url), init);
      events.push("exchange ended");
      return response;
    },
  });
  await started;
  const stopping = duty.stop().then(() => {
    events.push("stopped");
  });
  proceed();
  await stopping;
  expect(events).toEqual(["exchange ended", "stopped"]);
  expect(received).toEqual(["first"]);
  expect(duty.state()).not.toBe("confirmed");
});

it("ends the duty after a signed clash without scheduling another receiver pass", async () => {
  accounted = false;
  const app = destination();
  const pause = vi.spyOn(loop, "realSleep");
  const duty = startReturnRecordsDuty({
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: source,
    modules,
    log: () => {},
    fetch: async (url, init) => app.request(String(url), init),
  });
  try {
    await vi.waitFor(() => expect(duty.state()).toBe("clash"));
    await duty.stop();
    expect(received).toEqual(["first"]);
    expect(pause).not.toHaveBeenCalled();
  } finally {
    await duty.stop();
    pause.mockRestore();
  }
});
