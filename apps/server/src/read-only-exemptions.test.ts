import { persons, hashPassword, startManagementSession } from "@waitron/identity";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  openVenueDatabase,
  withTransaction,
  readNodeMembership,
  readTenant,
  stampDeployment,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
  type VenueDatabase,
  withNodeTransaction,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  appendHandoverEventTx,
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
import { mintBreakGlassSecret } from "./break-glass.js";
import { imageMigrationsDigest, readOfferSettings } from "./handover-manifest.js";
import { advanceHandover, beginHandover, HANDOVER_EVENT } from "./handover-store.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { READ_ONLY_EXEMPTIONS, isReadOnlyExempt, pathMatches } from "./read-only-exemptions.js";

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
      ["POST", "/api/box/restart", ["fenced"]],
      ["POST", "/management-api/session/me/fresh-sign-in", ["fenced"]],
      ["POST", "/management-api/session/me/fresh-sign-in/passkey-options", ["fenced"]],
      ["POST", "/management-api/promote", ["mirror", "fenced"]],
      ["POST", "/management-api/promote/preparation", ["mirror", "fenced"]],
      ["POST", "/api/node/peer-status", ["mirror", "fenced"]],
      ["POST", "/api/node/membership", ["mirror", "fenced"]],
      ["POST", "/api/node/handover/offer", ["mirror"]],
      ["POST", "/api/node/handover/:operationId/preparation", ["mirror"]],
      ["POST", "/api/node/handover/:operationId/activate", ["mirror"]],
      ["POST", "/api/node/handover/emergency/declare", ["mirror"]],
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
    const exempt = (path: string, method = "POST", box = mirror) =>
      isReadOnlyExempt({ method, path }, box);

    it("passes any one non-empty segment in that place", () => {
      expect(exempt("/api/node/handover/a/preparation")).toBe(true);
      expect(exempt("/api/node/handover/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/preparation")).toBe(
        true,
      );
    });

    it("refuses another number of segments, an empty one and an unlisted suffix", () => {
      for (const path of [
        "/api/node/handover/a/b/preparation",
        "/api/node/handover/preparation",
        "/api/node/handover//preparation",
        "/api/node/handover/a",
        "/api/node/handover/a/preparation/",
        "/api/node/handover/a/preparation/x",
        "/api/node/handover/a/relinquish",
        "/api/other/handover/a/preparation",
      ]) {
        expect([path, exempt(path)]).toEqual([path, false]);
      }
    });

    it("refuses a segment still holding an escape, which the router would decode to a slash", () => {
      for (const path of [
        "/api/node/handover/a%2Fb/preparation",
        "/api/node/handover/%2F/preparation",
        "/api/node/handover/..%2F..%2Fmembership/preparation",
        "/api/node/handover/a%252Fb/preparation",
      ]) {
        expect([path, exempt(path)]).toEqual([path, false]);
      }
    });

    it("still answers to the row's method and boxes", () => {
      expect(exempt("/api/node/handover/a/preparation", "PUT")).toBe(false);
      expect(
        exempt("/api/node/handover/a/preparation", "POST", { mirror: false, fenced: true }),
      ).toBe(false);
    });

    it("holds only that one name as a parameter: any other colon segment is literal", () => {
      expect(pathMatches("/api/node/:other/activate", "/api/node/a/activate")).toBe(false);
      expect(pathMatches("/api/node/:other/activate", "/api/node/:other/activate")).toBe(true);
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
let fencedProof: { dir: string; nodeId: string; token: string; db: Database };
let midHandover: { dir: string; nodeId: string; node: NodeDatabase; breakGlass: string };
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
    originUrl: "http://127.0.0.1:1/",
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
  await withNodeTransaction(hNode, (tx) =>
    appendHandoverEventTx(tx, {
      nodeId: hId,
      operationId: MIRROR_OPERATION_ID,
      kind: HANDOVER_EVENT.copyPlaced,
      detail: {},
      envelope: null,
    }),
  );
  const breakGlass = await mintBreakGlassSecret({ venue: hDb, node: hNode }, hId);
  midHandover = { dir: hDir, nodeId: hId, node: hNode, breakGlass };

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
        settings: (await readOfferSettings(
          STATE_ROOT,
          RING,
          "handover.settings_unreadable",
        )) as unknown as CanonicalValue,
        imageMigrations: imageMigrationsDigest(null),
      },
      MAIN_BOX,
    ),
  };

  // A held chart marking this box sell-only: boot fences it and mounts the read-only gate.
  const [fDir, fId, fDb, fNode] = await seededVenue();
  fenced = { dir: fDir, nodeId: fId };
  await setSingletonRole({ venue: fDb, node: fNode }, fId, "primary");
  await writeNodeMembership(fDb, sellOnlyChart(fId));
  const [proofDir, proofId, proofDb, proofNode] = await seededVenue();
  await setSingletonRole({ venue: proofDb, node: proofNode }, proofId, "primary");
  const key = await readNodeIdentityKey(proofNode, RING, proofId);
  const proofBody: MembershipDocumentBody = {
    term: 5,
    nodes: [
      { nodeId: proofId, contactUrl: "", standing: "sell-only" },
      { nodeId: MAIN_BOX.nodeId, contactUrl: "https://carrier.test", standing: "serving-primary" },
    ],
  };
  await writeNodeMembership(proofDb, {
    body: proofBody,
    signerNodeId: proofId,
    signature: signDocumentBody(proofBody, key),
    endorsements: [],
  });
  const token = await withTransaction(proofDb, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({
        displayName: "Proof Manager",
        role: "manager",
        passwordHash: hashPassword("correct password"),
        pinHash: "unused",
      })
      .returning();
    return (await startManagementSession(tx, { personId: person!.id })).token;
  });
  fencedProof = { dir: proofDir, nodeId: proofId, token, db: proofDb };
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

async function post(
  base: string,
  path: string,
  method = "POST",
): Promise<{ status: number; code: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method,
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
        handoverPreparation: await post(
          base,
          `/api/node/handover/${MIRROR_OPERATION_ID}/preparation`,
        ),
        handoverActivate: await post(base, `/api/node/handover/${MIRROR_OPERATION_ID}/activate`),
        peerStatus: await post(base, "/api/node/peer-status"),
        membership: await handEmptyChart(base),
        offer: await post(base, "/api/node/handover/offer"),
        // Listed for a fenced box only.
        retire: await post(base, "/api/box/retire"),
        restart: await post(base, "/api/box/restart"),
        unlisted: await post(base, "/management-api/catalogues"),
        startHandover: await post(base, "/management-api/handover"),
        // A GET: the gate never refuses it, and this box's own id finds this box's row.
        statusRead: await readStatus(base, MIRROR_OPERATION_ID),
      }).toEqual({
        promote: { status: 401, code: "password.invalid" },
        preparation: PREPARATION_REFUSAL,
        handoverPreparation: PREPARATION_REFUSAL,
        handoverActivate: PREPARATION_REFUSAL,
        peerStatus: { status: 400, code: "handover.request_invalid" },
        membership: { status: 200, body: { accepted: false } },
        offer: { status: 400, code: "handover.request_invalid" },
        retire: GATED,
        restart: GATED,
        unlisted: GATED,
        startHandover: GATED,
        statusRead: { status: 200, signerNodeId: mirror.nodeId, state: "prepared" },
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("near misses of the operation id row answer node.read_only on a mirror", async () => {
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: mirror.dir,
      WAITRON_NODE_ID: mirror.nodeId,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    const id = MIRROR_OPERATION_ID;
    try {
      await waitForFirstPass(server);
      for (const [path, method] of [
        [`/api/node/handover/${id}/extra/preparation`, "POST"],
        [`/api/node/handover/${id}/preparation/extra`, "POST"],
        [`/api/node/handover/${id}/relinquish`, "POST"],
        [`/api/node/handover/${id}/preparation`, "PUT"],
        [`/api/node/handover/${id}/preparation`, "DELETE"],
        ["/api/node/handover/a%2Fb/preparation", "POST"],
        ["/api/node/handover/..%2F..%2Fmembership/preparation", "POST"],
        [`/api/node/handover/${id}/extra/activate`, "POST"],
        [`/api/node/handover/${id}/activate/extra`, "POST"],
        [`/api/node/handover/${id}/activated`, "POST"],
        [`/api/node/handover/${id}/activate`, "PUT"],
        [`/api/node/handover/${id}/activate`, "DELETE"],
        ["/api/node/handover/a%2Fb/activate", "POST"],
        ["/api/node/handover/..%2F..%2Fmembership/activate", "POST"],
      ] as const) {
        expect([path, method, await post(base, path, method)]).toEqual([path, method, GATED]);
      }
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
        body: JSON.stringify({ oldNodeNeutralised: true, breakGlass: midHandover.breakGlass }),
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
      // No credentials over plain HTTP: the usual refusal, naming no operation.
      expect(await post(base, "/management-api/promote")).toEqual({
        status: 401,
        code: "password.invalid",
      });
      // The real shape of M2: a real start's status read serves a destination's operation.
      expect(await readStatus(base, MIRROR_OPERATION_ID)).toEqual({
        status: 200,
        signerNodeId: midHandover.nodeId,
        state: "filing_assumed",
      });
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
        restart: await post(base, "/api/box/restart"),
        promote: await post(base, "/management-api/promote"),
        preparation: await post(base, "/management-api/promote/preparation"),
        peerStatus: await post(base, "/api/node/peer-status"),
        membership: await handEmptyChart(base),
        // Listed for a mirror only.
        offer: await post(base, "/api/node/handover/offer"),
        handoverPreparation: await post(
          base,
          `/api/node/handover/${MIRROR_OPERATION_ID}/preparation`,
        ),
        handoverActivate: await post(base, `/api/node/handover/${MIRROR_OPERATION_ID}/activate`),
        unlisted: await post(base, "/management-api/catalogues"),
        startHandover: await post(base, "/management-api/handover"),
      }).toEqual({
        retire: { status: 401, code: "management_session.required" },
        restart: { status: 401, code: "management_session.required" },
        promote: { status: 401, code: "password.invalid" },
        preparation: PREPARATION_REFUSAL,
        peerStatus: { status: 400, code: "handover.request_invalid" },
        membership: { status: 200, body: { accepted: false } },
        offer: GATED,
        handoverPreparation: GATED,
        handoverActivate: GATED,
        unlisted: GATED,
        startHandover: GATED,
      });
    } finally {
      await server.close();
    }
  }, 60_000);
});

it("a real fenced start can prove its existing session and retire, while wrong proof changes nothing", async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({
    ...KEY_ENV,
    WAITRON_VENUE_DIR: fencedProof.dir,
    WAITRON_NODE_ID: fencedProof.nodeId,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_ORIGIN: base,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
  });
  const send = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${httpPort()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: base,
        cookie: `waitron_management_session=${fencedProof.token}`,
      },
      body: JSON.stringify(body),
    });
  try {
    const refused = await send("/api/box/retire", {});
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "management_session.proof_required" },
    });
    const wrong = await send("/management-api/session/me/fresh-sign-in", {
      method: "password",
      password: "wrong",
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: { code: "password.invalid" } });
    expect((await readNodeMembership(fencedProof.db))!.body.term).toBe(5);
    const good = await send("/management-api/session/me/fresh-sign-in", {
      method: "password",
      password: "correct password",
    });
    expect(good.status).toBe(204);
    const retired = await send("/api/box/retire", {});
    expect(retired.status).toBe(200);
    expect(await retired.json()).toEqual({ evicted: true, term: 6 });
  } finally {
    await server.close();
  }
}, 60_000);
