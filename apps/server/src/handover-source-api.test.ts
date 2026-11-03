import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withNodeTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  nodeSigningPublicKey,
  type KeyRing,
} from "@waitron/credentials";
import {
  signEnvelope,
  verifyEnvelope,
  type FinalStateIndicator,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  endorseKey,
  signDocumentBody,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import { NODE_MIGRATIONS, recordHandoverRestrictionTx } from "@waitron/node-db";
import { captureFinalCopy, type CaptureDeps } from "./handover-capture.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x6).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NONCE = "n".repeat(24);

const MODULES = [
  {
    name: "core",
    version: "1.2.3",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
  },
] as const satisfies readonly WaitronModule[];

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
  setup: async (db) => {
    db.run(sql`create table handover_probe (n integer not null)`);
  },
});

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-source-api-"));
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

interface Boxes {
  self: string;
  selfKey: string;
  destination: { nodeId: string; privateKey: string };
  bystander: { nodeId: string; privateKey: string };
  deps: CaptureDeps;
  app: Hono;
}

/** This box, stepped down for OP to `destination`, with a chart listing it and one other box. */
async function boxes({ steppedDown = true } = {}): Promise<Boxes> {
  const db = suite.db;
  await seedVenue(db);
  const self = await seedNode(db);
  const destination = await seedNode(db);
  const bystander = await seedNode(db);
  for (const nodeId of [self, destination, bystander])
    await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
  const selfKey = await readNodeIdentityKey(suite.node, RING, self);
  const destinationKey = await readNodeIdentityKey(suite.node, RING, destination);
  const bystanderKey = await readNodeIdentityKey(suite.node, RING, bystander);
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: [
      { nodeId: self, contactUrl: "https://box-0", standing: "serving-primary" },
      { nodeId: destination, contactUrl: "https://box-1", standing: "serving-secondary" },
      { nodeId: bystander, contactUrl: "https://box-2", standing: "serving-secondary" },
    ],
  };
  const held: SignedMembershipDocument = {
    body,
    signerNodeId: self,
    signature: signDocumentBody(body, selfKey),
    endorsements: [
      endorseKey(destination, nodeSigningPublicKey(destinationKey), self, selfKey),
      endorseKey(bystander, nodeSigningPublicKey(bystanderKey), self, selfKey),
    ],
  };
  await writeNodeMembership(db, held);
  const store = { node: suite.node, nodeId: self };
  await beginHandover(
    store,
    {
      operationId: OP,
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
      sourceNodeId: self,
      destinationNodeId: destination,
      membership: { term: 3, digest: "a".repeat(64) },
    },
    "source",
  );
  if (steppedDown) {
    await advanceHandover(store, OP, "source_stepped_down", {});
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: self,
        operationId: OP,
        kind: "handed-over",
        successorNodeId: destination,
        membershipTerm: 3,
      }),
    );
  }
  const deps: CaptureDeps = {
    venue: db,
    node: suite.node,
    stateDir,
    ring: RING,
    nodeId: self,
    modules: MODULES,
  };
  const app = new Hono();
  mountHandoverSourceApi(app, deps, () => {});
  return {
    self,
    selfKey,
    destination: { nodeId: destination, privateKey: destinationKey },
    bystander: { nodeId: bystander, privateKey: bystanderKey },
    deps,
    app,
  };
}

function ask(
  app: Hono,
  route: "indicator" | "final-copy",
  signer: { nodeId: string; privateKey: string },
  operationId = OP,
  body: Record<string, string | number> = { nonce: NONCE, atMs: 1, operationId },
): Promise<Response> {
  return Promise.resolve(
    app.request(`/api/node/handover/${operationId}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signEnvelope("query", body, signer)),
    }),
  );
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const copyPath = () => join(stateDir, "handover", OP, "venue.db");

describe("the final copy and its indicator, served to the selected box only", () => {
  it("the destination gets the indicator and the copy, and the copy's digest matches", async () => {
    const { app, self, selfKey, destination } = await boxes();
    const indicatorResponse = await ask(app, "indicator", destination);
    expect(indicatorResponse.status).toBe(200);
    const indicator =
      (await indicatorResponse.json()) as SignedHandoverEnvelope<FinalStateIndicator>;
    const selfPublic = nodeSigningPublicKey(selfKey);
    const verdict = verifyEnvelope<FinalStateIndicator>(indicator, "final-state", (id) =>
      id === self ? selfPublic : undefined,
    );
    expect(verdict.valid).toBe(true);
    expect(indicator.body.binding.operationId).toBe(OP);
    expect(indicator.body.binding.destinationNodeId).toBe(destination.nodeId);

    const copyResponse = await ask(app, "final-copy", destination);
    expect(copyResponse.status).toBe(200);
    expect(copyResponse.headers.get("content-type")).toBe("application/octet-stream");
    const bytes = new Uint8Array(await copyResponse.arrayBuffer());
    expect(bytes.length).toBe(indicator.body.snapshot.bytes);
    expect(sha256(bytes)).toBe(indicator.body.snapshot.sha256);
  });

  it("the copy asked for first is the one the indicator then names", async () => {
    const { app, destination } = await boxes();
    const bytes = new Uint8Array(await (await ask(app, "final-copy", destination)).arrayBuffer());
    const indicator = (await (
      await ask(app, "indicator", destination)
    ).json()) as SignedHandoverEnvelope<FinalStateIndicator>;
    expect(sha256(bytes)).toBe(indicator.body.snapshot.sha256);
  });

  for (const route of ["indicator", "final-copy"] as const) {
    it(`another listed box is refused the ${route}`, async () => {
      const { app, bystander } = await boxes();
      const response = await ask(app, route, bystander);
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("handover.peer_unknown");
    });

    it(`an unknown operation is 404 for the ${route}`, async () => {
      const { app, destination } = await boxes();
      const response = await ask(app, route, destination, OTHER_OP);
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe("handover.operation_unknown");
    });

    it(`a query naming another operation than the path is refused for the ${route}`, async () => {
      const { app, destination } = await boxes();
      const response = await ask(app, route, destination, OP, {
        nonce: NONCE,
        atMs: 1,
        operationId: OTHER_OP,
      });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("handover.request_invalid");
    });

    it(`a query naming no operation is refused for the ${route}`, async () => {
      const { app, destination } = await boxes();
      const response = await ask(app, route, destination, OP, { nonce: NONCE, atMs: 1 });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("handover.request_invalid");
    });

    it(`a signer no stored key vouches for is refused the ${route}`, async () => {
      const { app, destination, bystander } = await boxes();
      const response = await ask(app, route, {
        nodeId: destination.nodeId,
        privateKey: bystander.privateKey,
      });
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("handover.peer_unknown");
    });
  }

  it("a copy file that went missing is taken again and served when it matches the indicator", async () => {
    const { app, deps, destination } = await boxes();
    const indicator = await captureFinalCopy(deps, OP);
    await rm(copyPath());
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(sha256(bytes)).toBe(indicator.body.snapshot.sha256);
    expect(sha256(await readFile(copyPath()))).toBe(indicator.body.snapshot.sha256);
  });

  it("a copy file that went missing after venue.db changed is refused, not served", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(copyPath());
    suite.db.run(sql`insert into handover_probe (n) values (1)`);
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("handover.final_copy_changed");
  });

  it("a copy file that cannot be opened is reported as a fault, not retaken", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await chmod(copyPath(), 0o000);
    try {
      const response = await ask(app, "final-copy", destination);
      expect(response.status).toBe(500);
      expect(await errorCode(response)).toBe("server.internal");
    } finally {
      await chmod(copyPath(), 0o600);
    }
  });

  it("a copy path that cannot be read is reported as a fault", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(copyPath());
    await mkdir(copyPath());
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("server.internal");
  });

  it("a box that has not stepped down for the operation is refused", async () => {
    const { app, destination } = await boxes({ steppedDown: false });
    const response = await ask(app, "indicator", destination);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("handover.not_stepped_down");
  });
});
