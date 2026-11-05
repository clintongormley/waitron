import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readNodeMembership,
  readTenant,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import {
  envelopeDigest,
  sha256Hex,
  signEnvelope,
  type HandoverBinding,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  advanceHandoverOperationTx,
  appendHandoverEventTx,
  readHandoverEvent,
  readHandoverOperation,
  setNodeMode,
  writeMirrorLink,
} from "@waitron/node-db";
import type { StartedServer } from "./boot.js";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { imageMigrationsDigest, readOfferSettings } from "./handover-manifest.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

const migrations = migrationOptionsFor(manifestSets(), null);
const MAIN_BOX = { nodeId: "00000000-0000-4000-8000-0000000000bb", ...generateNodeKeyPair() };
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LATER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTHORISER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const suite = useVenueDb({ migrations });

let server: StartedServer | undefined;
let mainBox: Server | undefined;
let scratch: string | undefined;
/** Each chart the stand-in old box was handed, as sent. */
let charts: string[] = [];
let stallChartPost = false;
let chartPostClosed: Promise<void> | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  stallChartPost = false;
  chartPostClosed = undefined;
  await new Promise<void>((resolve) => {
    mainBox?.closeAllConnections();
    if (mainBox === undefined) resolve();
    else mainBox.close(() => resolve());
  });
  mainBox = undefined;
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
});

/** The old box, reduced to its signed status: it reports every operation it is asked of abandoned. */
async function startMainBox(
  self: () => string,
  state: string,
): Promise<{ url: string; asked: string[]; posts: string[] }> {
  const asked: string[] = [];
  const posts: string[] = [];
  charts = [];
  mainBox = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      if (req.url === "/api/node/membership") {
        charts.push(raw);
        chartPostClosed = new Promise((resolve) => req.socket.once("close", () => resolve()));
        if (stallChartPost) return;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ accepted: true }));
        return;
      }
      if (req.url!.endsWith("/indicator")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(signEnvelope("final-state", { not: "an indicator" }, MAIN_BOX)));
        return;
      }
      if (req.url!.endsWith("/final-copy")) {
        res.setHeader("content-length", "1");
        res.end("x");
        return;
      }
      if (req.url!.endsWith("/acceptance")) {
        const acceptance = JSON.parse(raw) as SignedHandoverEnvelope<{
          binding: CanonicalValue;
          indicatorDigest: string;
        }>;
        posts.push(raw);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify(
            signEnvelope(
              "relinquishment",
              {
                binding: acceptance.body.binding,
                indicatorDigest: acceptance.body.indicatorDigest,
                acceptanceDigest: envelopeDigest(acceptance),
                filingAssignedTo: self(),
                authorisedBy: AUTHORISER,
              },
              MAIN_BOX,
            ),
          ),
        );
        return;
      }
      const { nonce, operationId } = (
        JSON.parse(raw) as { body: { nonce: string; operationId: string } }
      ).body;
      asked.push(operationId);
      const body = {
        heldMembership: null,
        restriction: null,
        openOperation: null,
        requestedOperation: {
          operationId,
          role: "source",
          scenario: "controlled",
          state,
          sourceNodeId: MAIN_BOX.nodeId,
          destinationNodeId: self(),
        },
        nonce,
      };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(signEnvelope("status", body, MAIN_BOX)));
    });
  });
  await new Promise<void>((resolve) => mainBox!.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(mainBox.address() as AddressInfo).port}`, asked, posts };
}

async function boot(
  mode: "mirror" | "primary",
  mainBoxState = "abandoned",
  beforeStart: (nodeId: string, ownKey: string) => Promise<void> = async () => {},
  inStateFolder: (stateDir: string) => Promise<void> = async () => {},
) {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  const nodeId = venue.cfg.nodeId;
  const ring = loadKeyRing(KEY_ENV);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const own = await readNodeIdentityKey(suite.node, ring, nodeId);
  await pinMainBoxKey(suite.node, nodeId, MAIN_BOX);
  const { url, asked, posts } = await startMainBox(() => nodeId, mainBoxState);
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: [
      { nodeId: MAIN_BOX.nodeId, contactUrl: url, standing: "serving-primary" },
      { nodeId, contactUrl: "https://spare.example", standing: "serving-secondary" },
    ],
  };
  const held: SignedMembershipDocument = {
    body,
    signerNodeId: MAIN_BOX.nodeId,
    signature: signDocumentBody(body, MAIN_BOX.privateKey),
    endorsements: [
      endorseKey(nodeId, nodeSigningPublicKey(own), MAIN_BOX.nodeId, MAIN_BOX.privateKey),
    ],
  };
  await writeNodeMembership(suite.db, held);
  await stampDeployment(suite.db, "preproduction");
  const tenant = (await readTenant(suite.db))!;
  const binding = (operationId: string): HandoverBinding => ({
    operationId,
    scenario: "controlled",
    venue: { country: tenant.country, taxId: tenant.taxId, environment: "preproduction" },
    sourceNodeId: MAIN_BOX.nodeId,
    destinationNodeId: nodeId,
    membership: {
      term: 3,
      digest: sha256Hex(canonicalize(held as unknown as CanonicalValue)),
    },
  });
  await beginHandover({ node: suite.node, nodeId }, binding(OP), "destination");
  await beforeStart(nodeId, own);
  await setNodeMode({ venue: suite.db, node: suite.node }, nodeId, mode);
  await writeMirrorLink(suite.node, nodeId, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "box.local",
    boxCaPem: mintSelfSignedServerCert({
      hostnames: ["box.local"],
      ipAddresses: [],
      now: new Date(),
    }).caCertPem,
    originNodeId: MAIN_BOX.nodeId,
  });

  scratch = await mkdtemp(join(tmpdir(), "waitron-boot-destination-"));
  const migrationsRoot = join(scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await writeFile(
    join(scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  await inStateFolder(scratch);
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const env: Record<string, string> = {
    ...KEY_ENV,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    WAITRON_MAX_TICK_MS: "600000",
    WAITRON_MIN_TICK_MS: "200",
  };
  server = await startServer(env, env, {
    peerCheck: async () => ({ result: "proceed", successorNodeId: null }),
    stepdown: { mount: () => {}, restart: () => {} },
  });
  return { nodeId, asked, posts, binding };
}

const operation = (nodeId: string, operationId: string) =>
  readHandoverOperation(suite.node, nodeId, operationId);

describe("the spare's handover duty in a full start", () => {
  it("a mirror reads its open operation at boot, and an offer wakes it for the next", async () => {
    const { nodeId, asked, binding } = await boot("mirror");
    await vi.waitFor(async () => expect((await operation(nodeId, OP))?.state).toBe("abandoned"), {
      timeout: 15_000,
    });
    expect(asked).toEqual([OP]);

    const answer = await fetch(`http://127.0.0.1:${httpPort()}/api/node/handover/offer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signEnvelope(
          "stepdown",
          {
            binding: binding(LATER_OP) as unknown as CanonicalValue,
            authorisedBy: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            settings: (await readOfferSettings(
              scratch!,
              loadKeyRing(KEY_ENV),
              "handover.settings_unreadable",
            )) as unknown as CanonicalValue,
            imageMigrations: imageMigrationsDigest(null),
          },
          MAIN_BOX,
        ),
      ),
    });
    expect(answer.status).toBe(200);
    await vi.waitFor(
      async () => expect((await operation(nodeId, LATER_OP))?.state).toBe("abandoned"),
      { timeout: 15_000 },
    );
    expect(asked).toEqual([OP, LATER_OP]);
  }, 120_000);

  it("a real start compares what it fetches, and waits on a refusal", async () => {
    const { nodeId } = await boot("mirror", "source_stepped_down");
    // Failing case, with boot passing no comparison: the row stays with no reason.
    await vi.waitFor(
      async () =>
        expect((await operation(nodeId, OP))?.waitingReason).toBe("handover.indicator_mismatch"),
      { timeout: 15_000 },
    );
    expect((await operation(nodeId, OP))?.state).toBe("prepared");
  }, 120_000);

  it("a real start at copy_accepted posts the stored acceptance and records filing_assumed", async () => {
    const { nodeId, posts } = await boot(
      "mirror",
      "source_stepped_down",
      async (id, ownKey) => {
        const store = { node: suite.node, nodeId: id };
        const row = (await readHandoverOperation(suite.node, id, OP))!;
        await withNodeTransaction(suite.node, (tx) =>
          appendHandoverEventTx(tx, {
            nodeId: id,
            operationId: OP,
            kind: "offer",
            detail: {},
            envelope: canonicalize({ body: { authorisedBy: AUTHORISER } }),
          }),
        );
        const acceptance = signEnvelope(
          "acceptance",
          {
            binding: row.binding as CanonicalValue,
            indicatorDigest: "d".repeat(64),
            acceptedAtMs: 1,
          },
          { nodeId: id, privateKey: ownKey },
        );
        await advanceHandover(store, OP, "copy_accepted", {}, acceptance);
      },
      async (stateDir) => {
        const accepted = acceptedCopyPath(stateDir, OP);
        await mkdir(dirname(accepted), { recursive: true });
        await writeFile(accepted, "the accepted copy");
      },
    );
    // Failing case, with the duty reading only `prepared`: nothing is posted and the row stays.
    await vi.waitFor(
      async () => expect((await operation(nodeId, OP))?.state).toBe("filing_assumed"),
      { timeout: 15_000 },
    );
    const stored = await readHandoverEvent(suite.node, nodeId, OP, "copy_accepted");
    expect(posts).toEqual([stored!.envelope]);
  }, 120_000);

  it("a box that is not a mirror leaves the same operation alone and asks nothing", async () => {
    const { nodeId, asked } = await boot("primary");
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Failing case: the old box asked about OP, and the operation closed on a selling box.
    expect(asked).toEqual([]);
    expect((await operation(nodeId, OP))?.state).toBe("prepared");
  }, 120_000);

  const activated = async (id: string) => {
    await withNodeTransaction(suite.node, (tx) =>
      advanceHandoverOperationTx(tx, id, OP, "activated", null),
    );
  };

  it("a start that is not a mirror, at activated, hands the old box the chart it holds, once", async () => {
    const { nodeId } = await boot("primary", "abandoned", activated);
    await vi.waitFor(() => expect(charts).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Failing case, with the call left out of boot: no chart arrives.
    expect(charts).toEqual([JSON.stringify({ document: await readNodeMembership(suite.db) })]);
    expect((await operation(nodeId, OP))?.state).toBe("activated");
  }, 120_000);

  it("a mirror at activated hands over no chart", async () => {
    await boot("mirror", "abandoned", activated);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(charts).toEqual([]);
  }, 120_000);

  it("an old box that never answers holds up neither the start nor its answer, and a close ends the post", async () => {
    stallChartPost = true;
    await boot("primary", "abandoned", activated);
    await vi.waitFor(() => expect(charts).toHaveLength(1));
    // The post is still unanswered, and its limit is 30 seconds away.
    let postOpen = true;
    void chartPostClosed!.then(() => (postOpen = false));
    const answer = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
    expect(await answer.json()).toMatchObject({ acceptingSales: true });
    // Failing case, with the start waiting for the post: the post has ended by the time it returns.
    expect(postOpen).toBe(true);
    const closing = server!.close();
    server = undefined;
    // Failing case, with the duty left out of the table: the close leaves the socket open.
    await Promise.race([
      chartPostClosed,
      closing
        .then(() => new Promise((resolve) => setTimeout(resolve, 1000)))
        .then(() => {
          throw new Error("the close left the post running");
        }),
    ]);
    await closing;
  }, 120_000);
});
