import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodes, readNodeMembership, stampDeployment, writeNodeMembership } from "@waitron/db";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import { signEnvelope } from "@waitron/handover";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverRestriction } from "@waitron/node-db";
import type { StartedServer, StartServerSeams } from "./boot.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import type { PeerStatusBody } from "./peer-status-api.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

// The fiscal drain files nothing; these cases look only at how the box starts.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => ({
      ...actual.fiscalSlot(...args),
      drain: () => Promise.resolve(emptyDrainResult()),
    }),
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const OWN_URL = "https://box.example";
const SPARE = { nodeId: "00000000-0000-4000-8000-0000000000cc", ...generateNodeKeyPair() };

let server: StartedServer | undefined;
let peer: Server | undefined;
const scratch: string[] = [];

afterEach(async () => {
  try {
    if (server !== undefined) await server.close();
    if (peer !== undefined) await new Promise((done) => peer!.close(done));
  } finally {
    server = undefined;
    peer = undefined;
    for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
  }
});

/** SPARE's side: a status signed with its key, echoing the box's nonce; `box` is the asker's id. */
async function startPeer(answer: (box: string) => Partial<PeerStatusBody>) {
  peer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const query = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        signerNodeId: string;
        body: { nonce: string };
      };
      const body = {
        nonce: query.body.nonce,
        heldMembership: null,
        restriction: null,
        openOperation: null,
        requestedOperation: null,
        ...answer(query.signerNodeId),
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(signEnvelope("status", body as never, SPARE)));
    });
  });
  peer.listen(0, "127.0.0.1");
  await once(peer, "listening");
  const address = peer.address();
  if (address === null || typeof address === "string") throw new Error("no peer address");
  return `http://127.0.0.1:${address.port}`;
}

interface Booted {
  nodeId: string;
  lines: Record<string, unknown>[];
  acceptingSales: unknown;
}

/**
 * Sets up a main box whose held chart lists SPARE at `spareUrl`, with SPARE's `nodes` row only when
 * `joined`, then starts it. `chart` signs a further chart with SPARE's key.
 */
async function boot(
  suite: VenueDb,
  options: { spareUrl: string; joined: boolean; pinned?: boolean; seams?: StartServerSeams },
): Promise<Booted> {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  const nodeId = venue.cfg.nodeId;
  const ring = loadKeyRing(KEY_ENV);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  await stampDeployment(suite.db, "preproduction");
  if (options.joined) {
    const [own] = await suite.db
      .select({ locationId: nodes.locationId })
      .from(nodes)
      .where(eq(nodes.id, nodeId));
    await suite.db.insert(nodes).values({
      id: SPARE.nodeId,
      locationId: own!.locationId,
      name: "Spare",
      publicKey: SPARE.publicKey,
    });
    // Stands in for A947 3b's join step, which must make the chart vouch for a joined box's key.
    if (options.pinned !== false) await pinMainBoxKey(suite.node, nodeId, SPARE);
  }
  const body: MembershipDocumentBody = {
    term: 1,
    nodes: [
      { nodeId, contactUrl: OWN_URL, standing: "serving-primary" },
      { nodeId: SPARE.nodeId, contactUrl: options.spareUrl, standing: "serving-secondary" },
    ],
  };
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: nodeId,
    signature: signDocumentBody(body, await readNodeIdentityKey(suite.node, ring, nodeId)),
    endorsements: [],
  });
  const dir = await mkdtemp(join(tmpdir(), "waitron-boot-start-check-"));
  scratch.push(dir);
  const migrationsRoot = join(dir, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await writeFile(join(dir, "modules.json"), JSON.stringify({ modules: { "fiscal-none": false } }));
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const env: Record<string, string> = {
    ...KEY_ENV,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_STATE_DIR: dir,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    WAITRON_MAX_TICK_MS: "600000",
    WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
  };
  const lines: Record<string, unknown>[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      try {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Not a log line.
      }
    }
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    server = await startServer(env, env, options.seams);
  } finally {
    process.stdout.write = original;
  }
  const answer = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
  const { acceptingSales } = (await answer.json()) as { acceptingSales: unknown };
  return { nodeId, lines, acceptingSales };
}

function startChecks(lines: Record<string, unknown>[]) {
  return lines
    .filter((l) => l.event === "handover.start_check")
    .map(({ result, peers }) => ({ result, peers }));
}

function spareChart(
  term: number,
  entries: [string, NodeStanding, string][],
): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term,
    nodes: entries.map(([nodeId, standing, contactUrl]) => ({ nodeId, standing, contactUrl })),
  };
  return {
    body,
    signerNodeId: SPARE.nodeId,
    signature: signDocumentBody(body, SPARE.privateKey),
    endorsements: [],
  };
}

describe("the start check on a real start", () => {
  const suite = useVenueDb({ migrations });

  it("a seeded main box whose chart lists an adopted, unfinished spare starts selling", async () => {
    const booted = await boot(suite, { spareUrl: OWN_URL, joined: false });
    expect(booted.acceptingSales).toBe(true);
    expect(startChecks(booted.lines)).toEqual([{ result: "proceed", peers: [] }]);
  }, 60_000);

  it("control: with the spare's nodes row the box counts it; at this box's own address it is never asked, so it counts as silent", async () => {
    const booted = await boot(suite, { spareUrl: OWN_URL, joined: true });
    expect(startChecks(booted.lines)).toEqual([
      {
        result: "wait",
        peers: [{ nodeId: SPARE.nodeId, answer: "S", counted: true, why: "own_address" }],
      },
    ]);
  }, 60_000);

  it("a joined peer that has taken over this box's work: the box records the restriction and starts restricted", async () => {
    const url = await startPeer((box) => ({
      openOperation: {
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "destination",
        scenario: "controlled",
        state: "copy_accepted",
        sourceNodeId: box,
        destinationNodeId: SPARE.nodeId,
      },
    }));
    const booted = await boot(suite, { spareUrl: url, joined: true });
    expect(booted.acceptingSales).toBe(false);
    expect(startChecks(booted.lines)).toEqual([
      { result: "superseded", peers: [{ nodeId: SPARE.nodeId, answer: "F", counted: true }] },
    ]);
    expect(await readHandoverRestriction(suite.node, booted.nodeId)).toMatchObject({
      kind: "superseded",
      successorNodeId: SPARE.nodeId,
      operationId: null,
      membershipTerm: 1,
    });
    const health = await fetch(`http://127.0.0.1:${httpPort()}/health`);
    expect(await health.json()).toEqual({ ok: true, tradingAvailable: false });
  }, 60_000);

  it("a joined peer holding a newer chart that fences this box: the chart is held and the box starts restricted", async () => {
    const url = await startPeer((box) => ({
      heldMembership: spareChart(2, [
        [box, "sell-only", OWN_URL],
        [SPARE.nodeId, "serving-primary", "https://spare.example"],
      ]),
    }));
    const booted = await boot(suite, { spareUrl: url, joined: true });
    expect(booted.acceptingSales).toBe(false);
    expect((await readNodeMembership(suite.db))?.body.term).toBe(2);
    expect(await readHandoverRestriction(suite.node, booted.nodeId)).toMatchObject({
      kind: "superseded",
      successorNodeId: SPARE.nodeId,
      membershipTerm: 2,
    });
  }, 60_000);

  it("a newer fencing chart naming no main box: no restriction, and the start goes on fenced by it (Ruling R7)", async () => {
    const url = await startPeer((box) => ({
      heldMembership: spareChart(2, [
        [box, "sell-only", OWN_URL],
        [SPARE.nodeId, "serving-secondary", "https://spare.example"],
      ]),
    }));
    const booted = await boot(suite, { spareUrl: url, joined: true });
    expect(startChecks(booted.lines)).toEqual([
      { result: "superseded", peers: [{ nodeId: SPARE.nodeId, answer: "F", counted: true }] },
    ]);
    expect(booted.acceptingSales).toBe(false);
    expect((await readNodeMembership(suite.db))?.body.term).toBe(2);
    expect(await readHandoverRestriction(suite.node, booted.nodeId)).toBeNull();
  }, 60_000);

  it("a joined spare whose key the main box does not hold: its answer cannot be checked, so the check waits (and today the start goes on)", async () => {
    let asked = 0;
    const url = await startPeer(() => {
      asked += 1;
      return {};
    });
    const booted = await boot(suite, { spareUrl: url, joined: true, pinned: false });
    expect(asked).toBe(1);
    expect(startChecks(booted.lines)).toEqual([
      {
        result: "wait",
        peers: [{ nodeId: SPARE.nodeId, answer: "S", counted: true, why: "not_verified" }],
      },
    ]);
    // Ruling R1: a wait goes on as before until the waiting start exists.
    expect(booted.acceptingSales).toBe(true);
  }, 60_000);

  it("the seam's superseded with a successor takes the restricted start", async () => {
    const booted = await boot(suite, {
      spareUrl: OWN_URL,
      joined: false,
      seams: {
        peerCheck: () => Promise.resolve({ result: "superseded", successorNodeId: SPARE.nodeId }),
      },
    });
    expect(booted.acceptingSales).toBe(false);
    expect(await readHandoverRestriction(suite.node, booted.nodeId)).toMatchObject({
      kind: "superseded",
      successorNodeId: SPARE.nodeId,
    });
  }, 60_000);
});
