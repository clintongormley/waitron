import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import {
  endorseKey,
  signDocumentBody,
  type CanonicalValue,
  type NodeStanding,
} from "@waitron/membership";
import {
  NODE_MIGRATIONS,
  appendHandoverEventTx,
  nodeHandoverEvents,
  nodeHandoverRestriction,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import type { WaitronModule } from "@waitron/module";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { signAsThisBox } from "./handover-signing.js";
import { returnDigest } from "./return-records.js";
import { replacedResetCheck } from "./replaced-reset-check.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const modules: WaitronModule[] = [
  {
    name: "sample",
    version: "1.0.0",
    tier: "mandatory",
    handover: {
      summarise: async () => null,
      returnRecords: {
        read: async () => ["first", "second"],
        receive: async () => true,
        acceptPermission: "sample.accept",
        inspect: async () => [],
      },
    },
  },
];
const OPERATION = "source-handover";
const NONCE = "nonce-1";
const inventory = () =>
  returnDigest(["first", "second"].map((payload) => returnDigest({ module: "sample", payload })));

/** The old box, replaced. */
let source: string;
/** The new main box, which answers. */
let receiver: string;

async function holdChart(primary: string, sourceStanding: NodeStanding = "sell-only") {
  const signer = primary;
  const signerKey = await readNodeIdentityKey(suite.node, ring, signer);
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  const receiverKey = await readNodeIdentityKey(suite.node, ring, receiver);
  const body = {
    term: 3,
    nodes: [
      {
        nodeId: receiver,
        contactUrl: "https://receiver.test",
        standing: primary === receiver ? ("serving-primary" as const) : ("sell-only" as const),
      },
      {
        nodeId: source,
        contactUrl: "https://source.test",
        standing: primary === source ? ("serving-primary" as const) : sourceStanding,
      },
    ],
  };
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: signer,
    signature: signDocumentBody(body, signerKey),
    // The old box vouches for the new main box's key, as a main box does for a spare it admits.
    endorsements: [endorseKey(receiver, nodeSigningPublicKey(receiverKey), source, sourceKey)],
  });
}

async function restrict() {
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: source,
      operationId: OPERATION,
      kind: "handed-over",
      successorNodeId: receiver,
      membershipTerm: 3,
    }),
  );
}

async function confirmReturn(confirmed = inventory()) {
  await withNodeTransaction(suite.node, (tx) =>
    appendHandoverEventTx(tx, {
      nodeId: source,
      operationId: OPERATION,
      kind: "return_confirmed",
      detail: { destinationNodeId: receiver, inventory: confirmed },
    }),
  );
}

type Answer = {
  nonce: string;
  sourceNodeId: string;
  order: { orderId: string; acceptLoss: boolean } | null;
  lacking: Record<string, CanonicalValue[]>;
};
const answerBody = (over: Partial<Answer> = {}): Answer => ({
  nonce: NONCE,
  sourceNodeId: source,
  order: { orderId: "order-1", acceptLoss: false },
  lacking: { sample: [] },
  ...over,
});

async function signedAnswer(body: Answer = answerBody(), signer = receiver) {
  return {
    status: 200,
    text: JSON.stringify(
      await signAsThisBox({ node: suite.node, ring, nodeId: signer }, "reset-order", body),
    ),
  };
}

const check = (answer: { status: number; text: string }, nonce = NONCE, asked = receiver) =>
  replacedResetCheck(
    { db: suite.db, node: suite.node, ring, nodeId: source, modules },
    { targetNodeId: asked, nonce, answer },
  );

beforeEach(async () => {
  await seedVenue(suite.db, { name: "Reset venue" });
  await stampDeployment(suite.db, "preproduction");
  source = await seedNode(suite.db);
  receiver = await seedNode(suite.db);
  for (const nodeId of [source, receiver])
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const sourceKey = await readNodeIdentityKey(suite.node, ring, source);
  await pinMainBoxKey(suite.node, receiver, {
    nodeId: source,
    publicKey: nodeSigningPublicKey(sourceKey),
  });
  await holdChart(receiver);
  await restrict();
  await confirmReturn();
});

it("goes ahead on a fenced chart with a confirmed return and nothing lacking, setting nothing aside", async () => {
  expect(await check(await signedAnswer())).toEqual({
    outcome: "ordered",
    targetNodeId: receiver,
    orderId: "order-1",
    acceptLoss: false,
    setAside: false,
    lacking: { sample: [] },
  });
});

it("goes ahead while its chart still names itself main and its restriction names the target", async () => {
  await holdChart(source);
  expect(await check(await signedAnswer())).toMatchObject({
    outcome: "ordered",
    targetNodeId: receiver,
    setAside: false,
  });
});

it("refuses without its restriction row", async () => {
  await suite.node.delete(nodeHandoverRestriction);
  expect(await check(await signedAnswer())).toEqual({ outcome: "failed", check: "restriction" });
});

it("refuses when its chart neither fences it nor names it main", async () => {
  await holdChart(receiver, "serving-secondary");
  expect(await check(await signedAnswer())).toEqual({ outcome: "failed", check: "standing" });
});

it("refuses an order without loss while the inventory read now is unconfirmed", async () => {
  await suite.node.delete(nodeHandoverEvents);
  await confirmReturn("an-earlier-inventory");
  expect(await check(await signedAnswer())).toEqual({ outcome: "failed", check: "unconfirmed" });
});

it("sets aside for a loss order, with no confirmed return", async () => {
  await suite.node.delete(nodeHandoverEvents);
  expect(
    await check(
      await signedAnswer(answerBody({ order: { orderId: "order-2", acceptLoss: true } })),
    ),
  ).toEqual({
    outcome: "ordered",
    targetNodeId: receiver,
    orderId: "order-2",
    acceptLoss: true,
    setAside: true,
    lacking: { sample: [] },
  });
});

it("sets aside for an order without loss when the main box lacks a chain", async () => {
  const chain = { nodeId: "earlier-box", reason: "record_missing" };
  expect(await check(await signedAnswer(answerBody({ lacking: { sample: [chain] } })))).toEqual({
    outcome: "ordered",
    targetNodeId: receiver,
    orderId: "order-1",
    acceptLoss: false,
    setAside: true,
    lacking: { sample: [chain] },
  });
});

it("refuses an answer with a bad signature", async () => {
  const answer = await signedAnswer();
  const raw = JSON.parse(answer.text) as { signature: string };
  raw.signature = Buffer.alloc(64).toString("base64");
  expect(await check({ status: 200, text: JSON.stringify(raw) })).toEqual({
    outcome: "failed",
    check: "signature",
  });
});

it("refuses an answer signed by a box other than the target", async () => {
  expect(await check(await signedAnswer(answerBody(), source))).toEqual({
    outcome: "failed",
    check: "signer",
  });
});

it("refuses an answer whose nonce differs from the one sent", async () => {
  expect(await check(await signedAnswer(), "nonce-2")).toEqual({
    outcome: "failed",
    check: "nonce",
  });
});

it("refuses an order that names another box", async () => {
  expect(await check(await signedAnswer(answerBody({ sourceNodeId: receiver })))).toEqual({
    outcome: "failed",
    check: "source",
  });
});

it("reports a checked answer without an order", async () => {
  expect(await check(await signedAnswer(answerBody({ order: null })))).toEqual({
    outcome: "no-order",
    lacking: { sample: [] },
  });
});

it("tells the main box's refusal apart from a failed check", async () => {
  const refusal = {
    status: 409,
    text: JSON.stringify({
      error: { code: "handover.reset_query_refused", params: { reason: "standing" } },
    }),
  };
  expect(await check(refusal)).toEqual({ outcome: "refused", reason: "standing" });
  expect(await check({ status: 500, text: "{}" })).toEqual({ outcome: "failed", check: "answer" });
});

it("refuses an answer when the box it would ask now is not the box that was asked", async () => {
  expect(await check(await signedAnswer(), NONCE, "an-earlier-main-box")).toEqual({
    outcome: "failed",
    check: "target",
  });
});

it.each([
  ["an order id that is not text", { order: { orderId: 5, acceptLoss: false } }],
  ["a loss flag that is not true or false", { order: { orderId: "order-1", acceptLoss: "no" } }],
  ["lacking chains that are not a list", { lacking: { sample: "record_missing" } }],
  ["lacking that is not per module", { lacking: ["record_missing"] }],
])("refuses a correctly signed answer with %s", async (_, over) => {
  const body = { ...answerBody(), ...over } as unknown as Answer;
  expect(await check(await signedAnswer(body))).toEqual({ outcome: "failed", check: "answer" });
});

it("refuses a failed answer whose body is not JSON", async () => {
  expect(await check({ status: 500, text: "Internal Server Error" })).toEqual({
    outcome: "failed",
    check: "answer",
  });
});
