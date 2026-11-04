import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  openVenueDatabase,
  readTenant,
  stampDeployment,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
  type VenueDatabase,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  readHandoverOperation,
  readNodeMode,
  setNodeMode,
  setSingletonRole,
  writeMirrorLink,
} from "@waitron/node-db";
import { sha256Hex, signEnvelope } from "@waitron/handover";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { loadKeyRing } from "@waitron/credentials";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePort } from "./testing/free-ports.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { READ_ONLY_EXEMPTIONS, isReadOnlyExempt } from "./read-only-exemptions.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

// No background dial reaches a real host; Node's global `fetch` still serves the probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in read-only-exemptions.test.ts")),
    ),
  };
});

const { startServer, httpPort } = ephemeralServerFixture();

describe("the read-only exemption list", () => {
  it("the exempt set is exactly this list", () => {
    expect(READ_ONLY_EXEMPTIONS.map(({ method, path, boxes }) => [method, path, boxes])).toEqual([
      ["POST", "/api/box/retire", ["fenced"]],
      ["POST", "/management-api/promote", ["mirror", "fenced"]],
      ["POST", "/management-api/promote/preparation", ["mirror", "fenced"]],
      ["POST", "/api/node/peer-status", ["mirror", "fenced"]],
      ["POST", "/api/node/membership", ["mirror", "fenced"]],
      ["POST", "/api/node/handover/offer", ["mirror"]],
    ]);
    for (const row of READ_ONLY_EXEMPTIONS) expect(row.authenticates.trim()).not.toBe("");
  });

  it("exempts a row only on the boxes it names, and only for its method and exact path", () => {
    const mirror = { mirror: true, fenced: false };
    const fenced = { mirror: false, fenced: true };
    expect(isReadOnlyExempt({ method: "POST", path: "/api/box/retire" }, fenced)).toBe(true);
    expect(isReadOnlyExempt({ method: "POST", path: "/api/box/retire" }, mirror)).toBe(false);
    for (const box of [mirror, fenced]) {
      expect(isReadOnlyExempt({ method: "POST", path: "/api/node/peer-status" }, box)).toBe(true);
      expect(isReadOnlyExempt({ method: "PUT", path: "/api/node/peer-status" }, box)).toBe(false);
      expect(isReadOnlyExempt({ method: "POST", path: "/api/node/peer-status/x" }, box)).toBe(
        false,
      );
      expect(isReadOnlyExempt({ method: "POST", path: "/management-api/catalogues" }, box)).toBe(
        false,
      );
    }
    expect(
      isReadOnlyExempt(
        { method: "POST", path: "/management-api/promote" },
        { mirror: false, fenced: false },
      ),
    ).toBe(false);
  });

  describe("a row holding :operationId", () => {
    const mirror = { mirror: true, fenced: false };
    const ROWS = [
      {
        method: "POST",
        path: "/api/node/handover/:operationId/activate",
        boxes: ["mirror"],
        authenticates: "named by this test",
      },
    ] as const;
    const exempt = (path: string, method = "POST", box = mirror) =>
      isReadOnlyExempt({ method, path }, box, ROWS);

    it("passes any one non-empty segment in that place", () => {
      expect(exempt("/api/node/handover/a/activate")).toBe(true);
      expect(exempt("/api/node/handover/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/activate")).toBe(true);
    });

    it("refuses another number of segments, an empty one and an unlisted suffix", () => {
      for (const path of [
        "/api/node/handover/a/b/activate",
        "/api/node/handover/activate",
        "/api/node/handover//activate",
        "/api/node/handover/a",
        "/api/node/handover/a/activate/",
        "/api/node/handover/a/activate/x",
        "/api/node/handover/a/relinquish",
        "/api/other/handover/a/activate",
      ]) {
        expect([path, exempt(path)]).toEqual([path, false]);
      }
    });

    it("still answers to the row's method and boxes", () => {
      expect(exempt("/api/node/handover/a/activate", "PUT")).toBe(false);
      expect(exempt("/api/node/handover/a/activate", "POST", { mirror: false, fenced: true })).toBe(
        false,
      );
    });

    it("holds only that one name as a parameter: any other colon segment is literal", () => {
      const rows = [{ ...ROWS[0], path: "/api/node/:other/activate" }];
      const box = mirror;
      expect(isReadOnlyExempt({ method: "POST", path: "/api/node/a/activate" }, box, rows)).toBe(
        false,
      );
      expect(
        isReadOnlyExempt({ method: "POST", path: "/api/node/:other/activate" }, box, rows),
      ).toBe(true);
    });
  });

  it("a row with no parameter is still an exact match", () => {
    const box = { mirror: true, fenced: false };
    expect(isReadOnlyExempt({ method: "POST", path: "/api/node/peer-status/" }, box)).toBe(false);
    expect(isReadOnlyExempt({ method: "POST", path: "/api/node/membership" }, box)).toBe(true);
  });
});

// Disables `fiscal-none` so a trading or mirror boot does not refuse `module.fiscal_slot_ambiguous`.
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-exemptions-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const ORIGIN_NODE_ID = "77777777-7777-4777-8777-777777777777";
const MAIN_BOX = { nodeId: "66666666-6666-4666-8666-666666666666", ...generateNodeKeyPair() };
const MIRROR_OPERATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY_ENV = {
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// The same credentials key boot loads, so the key sealed here is the one boot unseals.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: KEY_ENV.WAITRON_CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

let migrationsRoot: string;
const openStores: VenueDatabase[] = [];
const venueDirs: string[] = [];
let mirror: { dir: string; nodeId: string };
let fenced: { dir: string; nodeId: string };
let midHandover: { dir: string; nodeId: string; node: NodeDatabase };
let spare: { dir: string; nodeId: string; node: NodeDatabase; offer: unknown };

async function seededVenue(): Promise<[string, string, Database, NodeDatabase]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-exemptions-venue-"));
  venueDirs.push(directory);
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  const db = store.venue;
  await seedVenue(db);
  const nodeId = await seedNode(db);
  await stampDeployment(db, "preproduction");
  // Every box holds its own node key; without one peer-status refuses before reading the query.
  await establishNodeIdentity({ ownerDb: db, node: store.node, ring: RING }, nodeId);
  return [directory, nodeId, db, store.node];
}

/** `readNodeMembership` does not verify the signature, so a placeholder is fine. */
function sellOnlyChart(nodeId: string): SignedMembershipDocument {
  return {
    body: { term: 5, nodes: [{ nodeId, contactUrl: "", standing: "sell-only" }] },
    signerNodeId: nodeId,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

async function linkMirror(node: NodeDatabase, nodeId: string): Promise<void> {
  await writeMirrorLink(node, nodeId, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "mirror-box.local",
    boxCaPem: mintSelfSignedServerCert({
      hostnames: ["mirror-box.local"],
      ipAddresses: [],
      now: new Date(),
    }).caCertPem,
    originNodeId: ORIGIN_NODE_ID,
  });
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-exemptions-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  const [mDir, mId, mDb, mNode] = await seededVenue();
  mirror = { dir: mDir, nodeId: mId };
  await setNodeMode({ venue: mDb, node: mNode }, mId, "mirror");
  await linkMirror(mNode, mId);
  await beginHandover(
    { node: mNode, nodeId: mId },
    {
      operationId: MIRROR_OPERATION_ID,
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
      sourceNodeId: mId,
      destinationNodeId: ORIGIN_NODE_ID,
      membership: { term: 1, digest: "a".repeat(64) },
    },
    "source",
  );

  // A mirror partway through taking over as the main box.
  const [hDir, hId, hDb, hNode] = await seededVenue();
  await setNodeMode({ venue: hDb, node: hNode }, hId, "mirror");
  await linkMirror(hNode, hId);
  const handingStore = { node: hNode, nodeId: hId };
  await beginHandover(
    handingStore,
    {
      operationId: MIRROR_OPERATION_ID,
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
      sourceNodeId: ORIGIN_NODE_ID,
      destinationNodeId: hId,
      membership: { term: 1, digest: "a".repeat(64) },
    },
    "destination",
  );
  await advanceHandover(handingStore, MIRROR_OPERATION_ID, "copy_accepted", {});
  await advanceHandover(handingStore, MIRROR_OPERATION_ID, "filing_assumed", {});
  midHandover = { dir: hDir, nodeId: hId, node: hNode };

  // A second mirror with no open operation, holding a chart that names the main box.
  const [sDir, sId, sDb, sNode] = await seededVenue();
  await setNodeMode({ venue: sDb, node: sNode }, sId, "mirror");
  await linkMirror(sNode, sId);
  const spareKey = await readNodeIdentityKey(sNode, RING, sId);
  const chartBody: MembershipDocumentBody = {
    term: 3,
    nodes: [
      {
        nodeId: MAIN_BOX.nodeId,
        contactUrl: "https://main-box.example",
        standing: "serving-primary",
      },
      { nodeId: sId, contactUrl: "https://spare-box.example", standing: "serving-secondary" },
    ],
  };
  const chart: SignedMembershipDocument = {
    body: chartBody,
    signerNodeId: sId,
    signature: signDocumentBody(chartBody, spareKey),
    endorsements: [endorseKey(MAIN_BOX.nodeId, MAIN_BOX.publicKey, sId, spareKey)],
  };
  await writeNodeMembership(sDb, chart);
  const tenant = await readTenant(sDb);
  spare = {
    dir: sDir,
    nodeId: sId,
    node: sNode,
    offer: signEnvelope(
      "stepdown",
      {
        binding: {
          operationId: MIRROR_OPERATION_ID,
          scenario: "controlled",
          venue: { country: tenant!.country, taxId: tenant!.taxId, environment: "preproduction" },
          sourceNodeId: MAIN_BOX.nodeId,
          destinationNodeId: sId,
          membership: {
            term: 3,
            digest: sha256Hex(canonicalize(chart as unknown as CanonicalValue)),
          },
        },
        authorisedBy: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
      MAIN_BOX,
    ),
  };

  // A held chart marking this box sell-only: boot fences it and mounts the read-only gate.
  const [fDir, fId, fDb, fNode] = await seededVenue();
  fenced = { dir: fDir, nodeId: fId };
  await setSingletonRole({ venue: fDb, node: fNode }, fId, "primary");
  await writeNodeMembership(fDb, sellOnlyChart(fId));
}, 180_000);

afterAll(async () => {
  while (openStores.length > 0) await openStores.pop()?.close();
  for (const directory of [...venueDirs, migrationsRoot])
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

async function waitForFirstPass(server: { health: { lastPassAt: unknown } }): Promise<void> {
  for (let i = 0; i < 200 && server.health.lastPassAt == null; i += 1) await delay(50);
  expect(server.health.lastPassAt).not.toBeNull();
}

async function post(base: string, path: string): Promise<{ status: number; code: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = (await response.json()) as { error?: { code?: unknown } };
  return { status: response.status, code: body.error?.code };
}

async function readStatus(
  base: string,
  operationId: string,
): Promise<{ status: number; signerNodeId: unknown; state: unknown }> {
  const response = await fetch(`${base}/api/node/handover/${operationId}`);
  const answer = (await response.json()) as {
    signerNodeId?: unknown;
    body?: { state?: unknown };
  };
  return {
    status: response.status,
    signerNodeId: answer.signerNodeId,
    state: answer.body?.state,
  };
}

/** The membership route answers a body holding no chart with a bare refusal, not an error code. */
async function handEmptyChart(base: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}/api/node/membership`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return { status: response.status, body: await response.json() };
}

const GATED = { status: 403, code: "node.read_only" };
// Preparation's own HTTPS check refuses a plain-HTTP call before it reads the body.
const PREPARATION_REFUSAL = { status: 403, code: "authorization.not_permitted" };

describe("each listed route is reached on a real read-only start, and nothing else is", () => {
  it("on a mirror", async () => {
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: mirror.dir,
      WAITRON_NODE_ID: mirror.nodeId,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await waitForFirstPass(server);
      expect({
        promote: await post(base, "/management-api/promote"),
        preparation: await post(base, "/management-api/promote/preparation"),
        peerStatus: await post(base, "/api/node/peer-status"),
        membership: await handEmptyChart(base),
        offer: await post(base, "/api/node/handover/offer"),
        // Listed for a fenced box only.
        retire: await post(base, "/api/box/retire"),
        unlisted: await post(base, "/management-api/catalogues"),
        // A GET: the gate never refuses it, and this box's own id finds this box's row.
        statusRead: await readStatus(base, MIRROR_OPERATION_ID),
      }).toEqual({
        promote: { status: 401, code: "password.invalid" },
        preparation: PREPARATION_REFUSAL,
        peerStatus: { status: 400, code: "handover.request_invalid" },
        membership: { status: 200, body: { accepted: false } },
        offer: { status: 400, code: "handover.request_invalid" },
        retire: GATED,
        unlisted: GATED,
        statusRead: { status: 200, signerNodeId: mirror.nodeId, state: "prepared" },
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a mirror partway through a handover refuses an ordinary promote, and it stays a mirror", async () => {
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: midHandover.dir,
      WAITRON_NODE_ID: midHandover.nodeId,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await waitForFirstPass(server);
      const before = await readHandoverOperation(
        midHandover.node,
        midHandover.nodeId,
        MIRROR_OPERATION_ID,
      );
      const response = await fetch(`${base}/management-api/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldNodeNeutralised: true, breakGlass: "any secret" }),
      });
      expect([response.status, await response.json()]).toEqual([
        409,
        {
          error: {
            code: "handover.operation_in_progress",
            params: { operationId: MIRROR_OPERATION_ID },
          },
        },
      ]);
      // A plain-HTTP preparation is still turned away first, and learns no operation's id.
      expect(await post(base, "/management-api/promote/preparation")).toEqual(PREPARATION_REFUSAL);
      expect(before).toMatchObject({ state: "filing_assumed" });
      expect(
        await readHandoverOperation(midHandover.node, midHandover.nodeId, MIRROR_OPERATION_ID),
      ).toEqual(before);
      expect(await readNodeMode(midHandover.node, midHandover.nodeId)).toMatchObject({
        mode: "mirror",
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a valid offer on a mirror records `prepared`", async () => {
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: spare.dir,
      WAITRON_NODE_ID: spare.nodeId,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await waitForFirstPass(server);
      const response = await fetch(`${base}/api/node/handover/offer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(spare.offer),
      });
      const answer = (await response.json()) as { body?: { state?: unknown } };
      expect({ status: response.status, state: answer.body?.state }).toEqual({
        status: 200,
        state: "prepared",
      });
      const row = await readHandoverOperation(spare.node, spare.nodeId, MIRROR_OPERATION_ID);
      expect(row).toMatchObject({
        role: "destination",
        state: "prepared",
        sourceNodeId: MAIN_BOX.nodeId,
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("on a fenced box", async () => {
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: fenced.dir,
      WAITRON_NODE_ID: fenced.nodeId,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await waitForFirstPass(server);
      expect({
        retire: await post(base, "/api/box/retire"),
        promote: await post(base, "/management-api/promote"),
        preparation: await post(base, "/management-api/promote/preparation"),
        peerStatus: await post(base, "/api/node/peer-status"),
        membership: await handEmptyChart(base),
        // Listed for a mirror only.
        offer: await post(base, "/api/node/handover/offer"),
        unlisted: await post(base, "/management-api/catalogues"),
      }).toEqual({
        retire: { status: 401, code: "management_session.required" },
        promote: { status: 401, code: "password.invalid" },
        preparation: PREPARATION_REFUSAL,
        peerStatus: { status: 400, code: "handover.request_invalid" },
        membership: { status: 200, body: { accepted: false } },
        offer: GATED,
        unlisted: GATED,
      });
    } finally {
      await server.close();
    }
  }, 60_000);
});
