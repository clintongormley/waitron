import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  nodeSigningPublicKey,
  type KeyRing,
} from "@waitron/credentials";
import { verifyEnvelope, type HandoverRole, type HandoverState } from "@waitron/handover";
import type { SignedMembershipDocument } from "@waitron/membership";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { mountHandoverStatusApi, type HandoverStatusBody } from "./handover-status-api.js";
import { advanceHandover, beginHandover, waitHandover } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_BOX = "99999999-9999-4999-8999-999999999999";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
});

let self: string;
let app: Hono;

beforeEach(async () => {
  await seedVenue(suite.db);
  self = await seedNode(suite.db);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, self);
  app = new Hono();
  mountHandoverStatusApi(
    app,
    { db: suite.db, node: suite.node, ring: RING, nodeId: self },
    () => undefined,
  );
});

/** This box's operation with `OTHER_BOX` at the other end, moved through `path`. */
async function operation(role: HandoverRole, path: readonly HandoverState[] = []): Promise<void> {
  const store = { node: suite.node, nodeId: self };
  await beginHandover(
    store,
    {
      operationId: OP,
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
      sourceNodeId: role === "source" ? self : OTHER_BOX,
      destinationNodeId: role === "source" ? OTHER_BOX : self,
      membership: { term: 3, digest: "a".repeat(64) },
    },
    role,
  );
  for (const state of path) await advanceHandover(store, OP, state, {});
}

async function holdChart(otherBoxContactUrl: string | null): Promise<void> {
  const chart: SignedMembershipDocument = {
    body: {
      term: 3,
      nodes: [
        { nodeId: self, contactUrl: "https://this-box.example", standing: "serving-primary" },
        ...(otherBoxContactUrl === null
          ? []
          : [
              {
                nodeId: OTHER_BOX,
                contactUrl: otherBoxContactUrl,
                standing: "serving-secondary" as const,
              },
            ]),
      ],
    },
    signerNodeId: self,
    signature: "not-verified-by-this-read",
    endorsements: [],
  };
  await writeNodeMembership(suite.db, chart);
}

/** The answer's body, after checking this box's own key signed it. */
async function signedStatus(): Promise<HandoverStatusBody> {
  const response = await app.request(`/api/node/handover/${OP}`);
  expect(response.status).toBe(200);
  const key = nodeSigningPublicKey(await readNodeIdentityKey(suite.node, RING, self));
  const verdict = verifyEnvelope<HandoverStatusBody>(await response.json(), "status", (id) =>
    id === self ? key : undefined,
  );
  if (!verdict.valid) throw new Error(`the answer did not verify: ${verdict.reason}`);
  return verdict.body;
}

describe("GET /api/node/handover/:operationId", () => {
  it("answers a destination's operation, signed, with no sign-in and only the listed keys", async () => {
    await operation("destination");
    expect(await signedStatus()).toEqual({
      operationId: OP,
      role: "destination",
      scenario: "controlled",
      state: "prepared",
      sourceNodeId: OTHER_BOX,
      destinationNodeId: self,
      waitingReason: null,
    });
  });

  it("carries why the box is waiting", async () => {
    await operation("destination");
    await waitHandover({ node: suite.node, nodeId: self }, OP, "handover.operation_unknown");
    expect((await signedStatus()).waitingReason).toBe("handover.operation_unknown");
  });

  it("gives a source past `prepared` the page on the destination's address", async () => {
    await holdChart("https://other-box.example");
    await operation("source", ["source_stepped_down"]);
    expect(await signedStatus()).toEqual({
      operationId: OP,
      role: "source",
      scenario: "controlled",
      state: "source_stepped_down",
      sourceNodeId: self,
      destinationNodeId: OTHER_BOX,
      waitingReason: null,
      handoverPage: `https://other-box.example/handover/${OP}`,
    });
  });

  it("keeps the page for a source further on", async () => {
    await holdChart("https://other-box.example");
    await operation("source", ["source_stepped_down", "filing_relinquished"]);
    expect((await signedStatus()).handoverPage).toBe(`https://other-box.example/handover/${OP}`);
  });

  it("joins the page to a contact address ending in a slash without doubling it", async () => {
    await holdChart("https://other-box.example/");
    await operation("source", ["source_stepped_down"]);
    expect((await signedStatus()).handoverPage).toBe(`https://other-box.example/handover/${OP}`);
  });

  it("gives no page to a source still at `prepared`", async () => {
    await holdChart("https://other-box.example");
    await operation("source");
    expect(await signedStatus()).not.toHaveProperty("handoverPage");
  });

  it("gives no page to a source that abandoned from `prepared`, never having stepped down", async () => {
    await holdChart("https://other-box.example");
    await operation("source", ["abandoned"]);
    expect(await signedStatus()).not.toHaveProperty("handoverPage");
  });

  it("gives no page to a destination, even past `prepared`", async () => {
    await holdChart("https://other-box.example");
    await operation("destination", ["copy_accepted"]);
    expect(await signedStatus()).not.toHaveProperty("handoverPage");
  });

  it("still answers, with no page, when no address for the destination is held", async () => {
    await operation("source", ["source_stepped_down"]);
    expect(await signedStatus()).not.toHaveProperty("handoverPage");
    await holdChart(null);
    expect(await signedStatus()).not.toHaveProperty("handoverPage");
    await holdChart("");
    expect(await signedStatus()).not.toHaveProperty("handoverPage");
  });

  it("refuses an operation this box holds no record of", async () => {
    const response = await app.request(`/api/node/handover/${OP}`);
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 404,
      body: { error: { code: "handover.operation_unknown", params: { operationId: OP } } },
    });
  });

  it("does not read another box's row", async () => {
    await beginHandover(
      { node: suite.node, nodeId: OTHER_BOX },
      {
        operationId: OP,
        scenario: "controlled",
        venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
        sourceNodeId: self,
        destinationNodeId: OTHER_BOX,
        membership: { term: 3, digest: "a".repeat(64) },
      },
      "destination",
    );
    expect((await app.request(`/api/node/handover/${OP}`)).status).toBe(404);
  });

  it("refuses an id longer than 64 characters, the limit the signed query has", async () => {
    const atLimit = await app.request(`/api/node/handover/${"x".repeat(64)}`);
    expect(atLimit.status).toBe(404);
    const response = await app.request(`/api/node/handover/${"x".repeat(65)}`);
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 400,
      body: { error: { code: "handover.request_invalid", params: { field: "operationId" } } },
    });
  });
});
