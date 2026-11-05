import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  nodes,
  readNodeMembership,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { signEnvelope, verifyEnvelope } from "@waitron/handover";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import {
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
} from "@waitron/membership";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  readHandoverEvent,
  readHandoverOperation,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { StartedServer, StartServerSeams } from "./boot.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { beginHandover } from "./handover-store.js";
import { awaitListening, httpsVia } from "./testing/boot-harness.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import type { PeerStatusBody } from "./peer-status-api.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

// The fiscal drain files nothing. `boot.restricted-quiet.test.ts` counts the real one's passes.
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

const MIN_TICK_MS = 200;
const MAIN_BOX = { nodeId: "00000000-0000-4000-8000-0000000000bb", ...generateNodeKeyPair() };
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

let server: StartedServer | undefined;
let scratch: string | undefined;

async function stop(): Promise<void> {
  try {
    if (server !== undefined) await server.close();
  } finally {
    server = undefined;
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
}

async function boot(
  suite: VenueDb,
  options: {
    restricted: boolean;
    seams?: StartServerSeams;
    beforeStart?: (venue: Venue) => Promise<void>;
    /** Runs once the box has its identity and first chart, so it can sign another. */
    beforeListening?: (nodeId: string, privateKey: string) => Promise<void>;
    tls?: boolean;
  },
): Promise<{ port: number; venue: Venue; env: Record<string, string> }> {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  await options.beforeStart?.(venue);
  const nodeId = venue.cfg.nodeId;
  const ring = loadKeyRing(KEY_ENV);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  await seedTermZeroMembership(
    { db: suite.db, node: suite.node, ring },
    nodeId,
    "https://box.example",
  );
  await pinMainBoxKey(suite.node, nodeId, MAIN_BOX);
  await options.beforeListening?.(nodeId, await readNodeIdentityKey(suite.node, ring, nodeId));
  if (options.restricted) {
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId,
        operationId: null,
        kind: "superseded",
        successorNodeId: "00000000-0000-4000-8000-0000000000aa",
        membershipTerm: 1,
      }),
    );
  }
  scratch = await mkdtemp(join(tmpdir(), "waitron-boot-restricted-"));
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
    WAITRON_MIN_TICK_MS: String(MIN_TICK_MS),
    WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
  };
  if (options.tls === true) {
    await ensureBoxSecrets({ stateDir: scratch, hostnames: ["localhost"], now: () => new Date() });
    server = await startServer(env, env, options.seams);
    await awaitListening(httpPort());
    return { port: httpPort(), venue, env };
  }
  server = await startServer(env, env, options.seams);
  await vi.waitFor(
    async () => {
      expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
    },
    { timeout: 10_000 },
  );
  return { port: httpPort(), venue, env };
}

const FINAL_COPY_OP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Asks for the final copy's indicator of an operation this box never held, as the main box. */
async function askForIndicator(port: number): Promise<{ status: number; code: unknown }> {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/node/handover/${FINAL_COPY_OP}/indicator`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signEnvelope(
          "query",
          { nonce: "c".repeat(20), atMs: 1, operationId: FINAL_COPY_OP, purpose: "indicator" },
          MAIN_BOX,
        ),
      ),
    },
  );
  const text = await response.text();
  let code: unknown = null;
  try {
    code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code ?? null;
  } catch {
    // A route that is not mounted answers no JSON.
  }
  return { status: response.status, code };
}

async function readStatusOfUnknown(port: number): Promise<{ status: number; code: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}/api/node/handover/${FINAL_COPY_OP}`);
  const text = await response.text();
  let code: unknown = null;
  try {
    code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code ?? null;
  } catch {
    // A route that is not mounted answers no JSON.
  }
  return { status: response.status, code };
}

describe("a box holding a handover restriction starts restricted", () => {
  // Every case here only reads, so they share one start.
  const suite = useVenueDb({ migrations, resetPerTest: false });
  let started: { port: number; venue: Venue } | undefined;
  const start = () => {
    if (started === undefined) throw new Error("the restricted start did not finish");
    return started;
  };

  beforeAll(async () => {
    started = await boot(suite, { restricted: true });
  }, 60_000);

  afterAll(stop);

  it("answers acceptingSales: false with its node id and term", async () => {
    const { port, venue } = start();
    const response = await fetch(`http://127.0.0.1:${port}/api/node`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nodeId: venue.cfg.nodeId,
      term: 0,
      acceptingSales: false,
    });
  }, 60_000);

  it("answers /health healthy, saying it takes no sales", async () => {
    const { port } = start();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, tradingAvailable: false });
  }, 60_000);

  it("answers a peer's signed query with its restriction", async () => {
    const { port, venue } = start();
    const nonce = "q".repeat(20);
    const response = await fetch(`http://127.0.0.1:${port}/api/node/peer-status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signEnvelope("query", { nonce, atMs: 1 }, MAIN_BOX)),
    });
    expect(response.status).toBe(200);
    const boxKey = nodeSigningPublicKey(
      await readNodeIdentityKey(suite.node, loadKeyRing(KEY_ENV), venue.cfg.nodeId),
    );
    const verified = verifyEnvelope<PeerStatusBody>(await response.json(), "status", (id) =>
      id === venue.cfg.nodeId ? boxKey : undefined,
    );
    if (!verified.valid) throw new Error(`the answer did not verify: ${verified.reason}`);
    expect(verified.body).toMatchObject({
      nonce,
      restriction: {
        kind: "superseded",
        successorNodeId: "00000000-0000-4000-8000-0000000000aa",
        operationId: null,
      },
      openOperation: null,
      requestedOperation: null,
    });
  }, 60_000);

  it("serves the final copy's routes", async () => {
    expect(await askForIndicator(start().port)).toEqual({
      status: 404,
      code: "handover.operation_unknown",
    });
  }, 60_000);

  it("serves the handover status read, with no sign-in", async () => {
    expect(await readStatusOfUnknown(start().port)).toEqual({
      status: 404,
      code: "handover.operation_unknown",
    });
  }, 60_000);

  it("is handed a chart through its own route, and answers only that it was not accepted", async () => {
    const { port } = start();
    const response = await fetch(`http://127.0.0.1:${port}/api/node/membership`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200,
      body: { accepted: false },
    });
  }, 60_000);

  it("refuses a till sign-in", async () => {
    const { port } = start();
    const response = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "1234" }),
    });
    expect([403, 404]).toContain(response.status);
  }, 60_000);

  it("mounts no dashboard, till, print or device route", async () => {
    const { port, venue } = start();
    const probes: [string, string][] = [
      ["GET", "/management-api/alerts"],
      ["GET", "/management-api/catalogue-settings"],
      ["DELETE", "/api/session"],
      ["GET", "/api/device/active-profile"],
      ["POST", "/api/device/enrol"],
      ["GET", "/print-api/agent/jobs"],
    ];
    for (const [method, path] of probes) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { cookie: venue.managerCookie, origin: "https://dashboard.example" },
      });
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
  }, 60_000);

  it("serves its own page, naming the successor, at the address a person opens", async () => {
    const { port } = start();
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { "Accept-Language": "en-GB" },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<h1>This box no longer runs the venue</h1>");
    expect(html).toContain(
      "The box taking over the venue is <strong>00000000-0000-4000-8000-0000000000aa</strong>.",
    );
  }, 60_000);
});

describe("a full start's stepdown, through its test seam", () => {
  const suite = useVenueDb({ migrations });

  afterEach(stop);

  it("a full start does not serve the final copy's routes", async () => {
    const { port } = await boot(suite, { restricted: false });
    const answer = await askForIndicator(port);
    expect(answer.status).toBe(404);
    expect(answer.code).not.toBe("handover.operation_unknown");
    const acceptance = await fetch(
      `http://127.0.0.1:${port}/api/node/handover/${FINAL_COPY_OP}/acceptance`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(acceptance.status).toBe(404);
    expect(await acceptance.text()).not.toContain("handover.");
  }, 60_000);

  it("a full start answers the handover status read", async () => {
    const { port } = await boot(suite, { restricted: false });
    expect(await readStatusOfUnknown(port)).toEqual({
      status: 404,
      code: "handover.operation_unknown",
    });
  }, 60_000);

  it("a full start that is not a mirror refuses a signed handover offer as not a spare", async () => {
    const { port, venue } = await boot(suite, { restricted: false });
    const response = await fetch(`http://127.0.0.1:${port}/api/node/handover/offer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signEnvelope(
          "stepdown",
          {
            binding: {
              operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              scenario: "controlled",
              venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
              sourceNodeId: MAIN_BOX.nodeId,
              destinationNodeId: venue.cfg.nodeId,
              membership: { term: 1, digest: "a".repeat(64) },
            },
            authorisedBy: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            settings: { backupSettings: null, moduleSettings: null, ringVersions: [1] },
            imageMigrations: "a".repeat(64),
          },
          MAIN_BOX,
        ),
      ),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "handover.not_a_spare",
    );
  }, 60_000);

  const handoverRequest = (cookie: string): RequestInit => ({
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      destinationNodeId: "00000000-0000-4000-8000-0000000000cc",
      signIn: { method: "password", password: "correct horse" },
    }),
  });

  const adminCookie = async (): Promise<string> => {
    const { token } = await openManagementSession(suite.db, "admin");
    return `${MANAGEMENT_COOKIE}=${token}`;
  };

  /** Asks over the real TLS listener, trusting the authority this box minted. */
  const startHandoverSecurely = async (
    port: number,
    cookie: string,
  ): Promise<{ status: number; code: string }> => {
    const { via, close } = httpsVia(await readFile(join(scratch!, "tls", "ca.crt")));
    try {
      const response = await fetch(`https://127.0.0.1:${port}/management-api/handover`, {
        ...via,
        ...handoverRequest(cookie),
      });
      const body = (await response.json()) as { error: { code: string } };
      return { status: response.status, code: body.error.code };
    } finally {
      await close();
    }
  };

  it("a full start refuses a handover over plain HTTP, even from an administrator", async () => {
    let cookie = "";
    const { port } = await boot(suite, {
      restricted: false,
      beforeStart: async () => {
        cookie = await adminCookie();
      },
    });
    const response = await fetch(
      `http://127.0.0.1:${port}/management-api/handover`,
      handoverRequest(cookie),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "authorization.not_permitted",
    );
  }, 60_000);

  it("a full start refuses a handover from a person without node.promote", async () => {
    const { port, venue } = await boot(suite, { restricted: false, tls: true });
    expect(await startHandoverSecurely(port, venue.managerCookie)).toEqual({
      status: 403,
      code: "authorization.not_permitted",
    });
  }, 60_000);

  it("a full start with Veri*Factu enabled takes a handover as far as checking the destination", async () => {
    let cookie = "";
    const { port } = await boot(suite, {
      restricted: false,
      tls: true,
      beforeStart: async () => {
        cookie = await adminCookie();
      },
    });
    expect(await startHandoverSecurely(port, cookie)).toEqual({
      status: 409,
      code: "handover.destination_not_spare",
    });
  }, 60_000);

  it("a retry of a handover the start closed gets a refusal with a code, on a real start", async () => {
    let cookie = "";
    const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const { port, venue } = await boot(suite, {
      restricted: false,
      tls: true,
      beforeStart: async ({ cfg: { nodeId } }) => {
        cookie = await adminCookie();
        await beginHandover(
          { node: suite.node, nodeId },
          {
            operationId,
            scenario: "controlled",
            venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
            sourceNodeId: nodeId,
            destinationNodeId: "00000000-0000-4000-8000-0000000000cc",
            membership: { term: 0, digest: "a".repeat(64) },
          },
          "source",
        );
      },
    });

    const refused = { status: 409, code: "handover.restarted_before_stepdown" };
    expect(await startHandoverSecurely(port, cookie)).toEqual(refused);
    expect(await startHandoverSecurely(port, cookie)).toEqual(refused);

    const nodeId = venue.cfg.nodeId;
    expect((await readHandoverOperation(suite.node, nodeId, operationId))?.state).toBe("abandoned");
    expect(await readHandoverRestriction(suite.node, nodeId)).toBeNull();
  }, 60_000);

  describe("a controlled handover on real starts", () => {
    const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const OTHER_BOX_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const SPARE = { nodeId: "00000000-0000-4000-8000-0000000000cc", ...generateNodeKeyPair() };
    const OTHER_BOX = "00000000-0000-4000-8000-0000000000dd";

    let spare: Server | undefined;
    let spareUrl = "";

    afterEach(async () => {
      if (spare !== undefined) await new Promise((done) => spare!.close(done));
      spare = undefined;
      suite.node.run(sql`drop trigger if exists refuse_restriction`);
      suite.node.run(sql`drop trigger if exists refuse_abandoned`);
    });

    /** Answers the query and the offer as a spare does, under the key the chart endorses. */
    async function listenAsSpare(duringOffer?: () => Promise<void>): Promise<void> {
      spare = createServer((request, response) => {
        let text = "";
        request.on("data", (chunk: Buffer) => (text += chunk.toString()));
        request.on("end", async () => {
          const { body } = JSON.parse(text) as {
            body: {
              nonce?: string;
              binding?: { operationId: string; sourceNodeId: string };
            };
          };
          if (body.binding !== undefined) await duringOffer?.();
          const held = await readNodeMembership(suite.db);
          const answer: CanonicalValue =
            body.binding === undefined
              ? {
                  nonce: body.nonce!,
                  heldMembership: held as unknown as CanonicalValue,
                  restriction: null,
                  openOperation: null,
                  requestedOperation: null,
                }
              : {
                  operationId: body.binding.operationId,
                  role: "destination",
                  scenario: "controlled",
                  state: "prepared",
                  sourceNodeId: body.binding.sourceNodeId,
                  destinationNodeId: SPARE.nodeId,
                  waitingReason: null,
                };
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify(
              signEnvelope("status", answer, {
                nodeId: SPARE.nodeId,
                privateKey: SPARE.privateKey,
              }),
            ),
          );
        });
      });
      await new Promise<void>((done) => spare!.listen(0, "127.0.0.1", done));
      spareUrl = `http://127.0.0.1:${(spare.address() as AddressInfo).port}`;
    }

    const holdChartNamingSpare = async (nodeId: string, privateKey: string): Promise<void> => {
      const body: MembershipDocumentBody = {
        term: 1,
        nodes: [
          { nodeId, contactUrl: "https://box.example", standing: "serving-primary" },
          { nodeId: SPARE.nodeId, contactUrl: spareUrl, standing: "serving-secondary" },
        ],
      };
      await writeNodeMembership(suite.db, {
        body,
        signerNodeId: nodeId,
        signature: signDocumentBody(body, privateKey),
        endorsements: [endorseKey(SPARE.nodeId, SPARE.publicKey, nodeId, privateKey)],
      });
    };

    const overTls = async (
      port: number,
      path: string,
      init: RequestInit = {},
    ): Promise<{ status: number; body: unknown }> => {
      const { via, close } = httpsVia(await readFile(join(scratch!, "tls", "ca.crt")));
      try {
        const response = await fetch(`https://127.0.0.1:${port}${path}`, { ...via, ...init });
        return { status: response.status, body: await response.json().catch(() => null) };
      } finally {
        await close();
      }
    };

    /** The row a spare has once it finished joining: its key signs a chart, and a start asks it. */
    const addSpareRow = async (nodeId: string): Promise<void> => {
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
    };

    const startOnce = async (restart: () => void, beforeStart?: () => void) => {
      let cookie = "";
      const started = await boot(suite, {
        restricted: false,
        tls: true,
        seams: { stepdown: { restart, mount: () => {} } },
        beforeStart: async () => {
          cookie = await adminCookie();
          await stampDeployment(suite.db, "preproduction");
          beforeStart?.();
        },
        beforeListening: async (nodeId, privateKey) => {
          await holdChartNamingSpare(nodeId, privateKey);
          await addSpareRow(nodeId);
        },
      });
      return { ...started, cookie };
    };

    const startAgain = async (
      env: Record<string, string>,
      whileStopped?: () => void | Promise<void>,
    ): Promise<number> => {
      await server!.close();
      await whileStopped?.();
      beforeServerStarts();
      server = await startServer(env, env);
      await awaitListening(httpPort());
      return httpPort();
    };

    /** A term-2 chart, signed by the spare, handed to the box through its own route. */
    const handChart = async (
      port: number,
      chartNodes: MembershipDocumentBody["nodes"],
    ): Promise<void> => {
      const body: MembershipDocumentBody = { term: 2, nodes: chartNodes };
      const document = {
        body,
        signerNodeId: SPARE.nodeId,
        signature: signDocumentBody(body, SPARE.privateKey),
        endorsements: (await readNodeMembership(suite.db))!.endorsements,
      };
      expect(
        await overTls(port, "/api/node/membership", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ document }),
        }),
      ).toEqual({ status: 200, body: { accepted: true } });
    };

    /** A start whose spare hands it `chartNodes` while the offer is waiting for an answer. */
    const startHandedChartDuringOffer = async (
      restart: () => void,
      chartNodes: (nodeId: string) => MembershipDocumentBody["nodes"],
    ) => {
      let port = 0;
      let nodeId = "";
      await listenAsSpare(() => handChart(port, chartNodes(nodeId)));
      const started = await startOnce(restart);
      port = started.port;
      nodeId = started.venue.cfg.nodeId;
      return { ...started, nodeId };
    };

    const replacedBySpare =
      () =>
      (nodeId: string): MembershipDocumentBody["nodes"] => [
        { nodeId, contactUrl: "https://box.example", standing: "evicted" },
        { nodeId: SPARE.nodeId, contactUrl: spareUrl, standing: "serving-primary" },
      ];

    const refuseAbandonedEvent = () => {
      suite.node.run(
        sql`create trigger refuse_abandoned before insert on node_handover_events
            when new.kind = 'abandoned'
            begin select raise(abort, 'the write fails here'); end`,
      );
    };

    const SUPERSEDED = {
      status: 409,
      body: { error: { code: "handover.superseded_during_start" } },
    };

    it("a newer chart during the offer refuses the start, and the restricted start closes the operation", async () => {
      const restart = vi.fn();
      const { port, nodeId, env, cookie } = await startHandedChartDuringOffer(
        restart,
        replacedBySpare(),
      );

      expect(
        await overTls(port, "/management-api/handover", handoverRequest(cookie)),
      ).toMatchObject(SUPERSEDED);
      await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });
      expect((await readHandoverOperation(suite.node, nodeId, OP))?.state).toBe("prepared");

      const restrictedPort = await startAgain(env);

      expect((await readHandoverOperation(suite.node, nodeId, OP))?.state).toBe("abandoned");
      expect((await readHandoverEvent(suite.node, nodeId, OP, "abandoned"))?.detail).toEqual({
        code: "handover.superseded_during_start",
        params: {},
      });
      expect(await readHandoverRestriction(suite.node, nodeId)).toMatchObject({
        operationId: null,
        kind: "superseded",
        successorNodeId: SPARE.nodeId,
      });
      expect(await overTls(restrictedPort, "/api/node")).toMatchObject({
        status: 200,
        body: { acceptingSales: false },
      });
      const read = await overTls(restrictedPort, `/api/node/handover/${OP}`);
      expect(read).toMatchObject({
        status: 200,
        body: { body: { operationId: OP, state: "abandoned" } },
      });
      expect((read.body as { body: object }).body).not.toHaveProperty("handoverPage");
      const nonce = "s".repeat(20);
      expect(
        await overTls(restrictedPort, "/api/node/peer-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            signEnvelope("query", { nonce, atMs: 1, operationId: OP, purpose: "status" }, MAIN_BOX),
          ),
        }),
      ).toMatchObject({
        status: 200,
        body: { body: { nonce, openOperation: null, requestedOperation: { state: "abandoned" } } },
      });
    }, 90_000);

    it("a restricted start whose closing write fails still comes up, and a later one closes the operation", async () => {
      const restart = vi.fn();
      const { port, nodeId, env, cookie } = await startHandedChartDuringOffer(
        restart,
        replacedBySpare(),
      );
      await overTls(port, "/management-api/handover", handoverRequest(cookie));
      await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });

      const refusedPort = await startAgain(env, refuseAbandonedEvent);

      expect(await overTls(refusedPort, "/api/node")).toMatchObject({
        status: 200,
        body: { acceptingSales: false },
      });
      expect(await overTls(refusedPort, `/api/node/handover/${OP}`)).toMatchObject({
        status: 200,
        body: { body: { state: "prepared" } },
      });

      const nextPort = await startAgain(env, () => {
        suite.node.run(sql`drop trigger refuse_abandoned`);
      });

      expect((await readHandoverOperation(suite.node, nodeId, OP))?.state).toBe("abandoned");
      expect(await overTls(nextPort, `/api/node/handover/${OP}`)).toMatchObject({
        status: 200,
        body: { body: { state: "abandoned" } },
      });
    }, 120_000);

    it("a newer chart naming no main box during the offer is refused, never answered with the page", async () => {
      const restart = vi.fn();
      const { port, nodeId, env, cookie } = await startHandedChartDuringOffer(restart, (id) => [
        { nodeId: id, contactUrl: "https://box.example", standing: "sell-only" },
        { nodeId: SPARE.nodeId, contactUrl: spareUrl, standing: "serving-secondary" },
      ]);

      expect(
        await overTls(port, "/management-api/handover", handoverRequest(cookie)),
      ).toMatchObject(SUPERSEDED);
      await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });
      expect((await readHandoverOperation(suite.node, nodeId, OP))?.state).toBe("prepared");
      expect(await readHandoverRestriction(suite.node, nodeId)).toBeNull();

      const nextPort = await startAgain(env);

      expect(await overTls(nextPort, "/api/node")).toMatchObject({
        status: 200,
        body: { acceptingSales: false },
      });
      expect(await overTls(nextPort, `/api/node/handover/${OP}`)).toMatchObject({
        status: 200,
        body: { body: { state: "abandoned" } },
      });
      expect(
        await overTls(nextPort, "/management-api/handover", handoverRequest(cookie)),
      ).toMatchObject({ status: 403, body: { error: { code: "node.read_only" } } });
    }, 90_000);

    it("a stepdown whose write fails, with a joined spare: the next start sells once it answers, and waits while it is silent", async () => {
      await listenAsSpare();
      const restart = vi.fn();
      const { port, venue, env, cookie } = await startOnce(restart, () => {
        suite.node.run(
          sql`create trigger refuse_restriction before insert on node_handover_restriction
              begin select raise(abort, 'the write fails here'); end`,
        );
      });
      const nodeId = venue.cfg.nodeId;
      await overTls(port, "/management-api/handover", handoverRequest(cookie));
      await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });

      const nextPort = await startAgain(env, async () => {
        suite.node.run(sql`drop trigger refuse_restriction`);
      });

      expect((await readHandoverOperation(suite.node, nodeId, OP))?.state).toBe("abandoned");
      expect(await overTls(nextPort, "/api/node")).toMatchObject({
        status: 200,
        body: { acceptingSales: true },
      });
      const nonce = "j".repeat(20);
      expect(
        await overTls(nextPort, "/api/node/peer-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            signEnvelope("query", { nonce, atMs: 1, operationId: OP, purpose: "status" }, SPARE),
          ),
        }),
      ).toMatchObject({
        status: 200,
        body: { body: { nonce, requestedOperation: { state: "abandoned" } } },
      });

      await new Promise((done) => spare!.close(done));
      spare = undefined;
      const silentPort = await startAgain(env);

      expect(await overTls(silentPort, "/api/node")).toMatchObject({
        status: 200,
        body: { acceptingSales: false },
      });
      expect(
        await overTls(silentPort, "/api/node/peer-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            signEnvelope("query", { nonce, atMs: 1, operationId: OP, purpose: "status" }, SPARE),
          ),
        }),
      ).toMatchObject({
        status: 200,
        body: { body: { nonce, requestedOperation: { state: "abandoned" } } },
      });
    }, 120_000);

    it("answers the page and restarts, and the restricted start answers a retry from its own row", async () => {
      await listenAsSpare();
      const restart = vi.fn();
      const { port, venue, env, cookie } = await startOnce(restart);
      const nodeId = venue.cfg.nodeId;

      expect(await overTls(port, "/management-api/handover", handoverRequest(cookie))).toEqual({
        status: 200,
        body: { handoverPage: `${spareUrl}/handover/${OP}` },
      });
      await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });
      expect((await readHandoverOperation(suite.node, nodeId, OP))?.state).toBe(
        "source_stepped_down",
      );
      expect(await readHandoverRestriction(suite.node, nodeId)).toMatchObject({
        operationId: OP,
        kind: "handed-over",
        successorNodeId: SPARE.nodeId,
      });

      await beginHandover(
        { node: suite.node, nodeId: OTHER_BOX },
        {
          operationId: OTHER_BOX_OP,
          scenario: "controlled",
          venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
          sourceNodeId: OTHER_BOX,
          destinationNodeId: SPARE.nodeId,
          membership: { term: 1, digest: "a".repeat(64) },
        },
        "source",
      );
      const restrictedPort = await startAgain(env);

      const retry = await overTls(restrictedPort, `/api/node/handover/${OP}`);
      expect(retry.status).toBe(200);
      const key = nodeSigningPublicKey(
        await readNodeIdentityKey(suite.node, loadKeyRing(KEY_ENV), nodeId),
      );
      const verdict = verifyEnvelope<{ state: string; handoverPage: string }>(
        retry.body,
        "status",
        (id) => (id === nodeId ? key : undefined),
      );
      expect(verdict).toMatchObject({
        valid: true,
        signerNodeId: nodeId,
        body: {
          operationId: OP,
          state: "source_stepped_down",
          handoverPage: `${spareUrl}/handover/${OP}`,
        },
      });

      expect(await overTls(restrictedPort, `/api/node/handover/${OTHER_BOX_OP}`)).toMatchObject({
        status: 404,
        body: { error: { code: "handover.operation_unknown" } },
      });
      const post = await overTls(
        restrictedPort,
        "/management-api/handover",
        handoverRequest(cookie),
      );
      expect(post.status).toBe(404);
    }, 90_000);

    it("a stepdown whose write fails restarts the box as a normal one, whose start leaves it `abandoned`", async () => {
      await listenAsSpare();
      const restart = vi.fn();
      const { port, venue, env, cookie } = await startOnce(restart, () => {
        suite.node.run(
          sql`create trigger refuse_restriction before insert on node_handover_restriction
              begin select raise(abort, 'the write fails here'); end`,
        );
      });
      const nodeId = venue.cfg.nodeId;

      expect(await overTls(port, "/management-api/handover", handoverRequest(cookie))).toEqual({
        status: 500,
        body: { error: { code: "server.internal" } },
      });
      await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });
      expect((await readHandoverOperation(suite.node, nodeId, OP))?.state).toBe("prepared");
      expect(await readHandoverRestriction(suite.node, nodeId)).toBeNull();

      suite.node.run(sql`drop trigger refuse_restriction`);
      const nextPort = await startAgain(env);

      expect((await readHandoverOperation(suite.node, nodeId, OP))?.state).toBe("abandoned");
      expect(await overTls(nextPort, `/api/node/handover/${OP}`)).toMatchObject({
        status: 200,
        body: { body: { operationId: OP, state: "abandoned" } },
      });
      expect(
        await overTls(nextPort, "/management-api/handover", handoverRequest(cookie)),
      ).toMatchObject({
        status: 409,
        body: { error: { code: "handover.restarted_before_stepdown" } },
      });
    }, 90_000);
  });

  it("a full start answers a peer's signed query", async () => {
    const { port, venue } = await boot(suite, { restricted: false });
    const nonce = "f".repeat(20);
    const response = await fetch(`http://127.0.0.1:${port}/api/node/peer-status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signEnvelope("query", { nonce, atMs: 1 }, MAIN_BOX)),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      purpose: "waitron.handover.status.v1",
      signerNodeId: venue.cfg.nodeId,
      body: { nonce, restriction: null, openOperation: null, requestedOperation: null },
    });
  }, 60_000);

  it("answers the caller, then closes and restarts, with the restriction on disk", async () => {
    const restart = vi.fn();
    let nodeId = "";
    const seams: StartServerSeams = {
      stepdown: {
        restart,
        mount: (app, stepDown) =>
          app.post("/test-stepdown", async (c) =>
            c.json(
              await stepDown({
                binding: {
                  operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  scenario: "emergency",
                  venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
                  sourceNodeId: nodeId,
                  destinationNodeId: "00000000-0000-4000-8000-0000000000aa",
                  membership: { term: 1, digest: "a".repeat(64) },
                },
                kind: "superseded",
                self: c,
              }),
            ),
          ),
      },
    };
    const { port, venue } = await boot(suite, { restricted: false, seams });
    nodeId = venue.cfg.nodeId;
    const answer = await fetch(`http://127.0.0.1:${port}/test-stepdown`, { method: "POST" });
    expect(await answer.json()).toEqual({ restarting: true, replayed: false });
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(await readHandoverRestriction(suite.node, nodeId)).toMatchObject({
      kind: "superseded",
    });
    // The graceful close ran before the restart: the listener no longer answers.
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  }, 60_000);

  it("handed a newer chart that fences it, answers, then closes and restarts restricted", async () => {
    const restart = vi.fn();
    const successor = "00000000-0000-4000-8000-0000000000cc";
    const { port, venue } = await boot(suite, {
      restricted: false,
      seams: { stepdown: { restart, mount: () => {} } },
    });
    const nodeId = venue.cfg.nodeId;
    const body: MembershipDocumentBody = {
      term: 1,
      nodes: [
        { nodeId, contactUrl: "https://box.example", standing: "sell-only" },
        { nodeId: successor, contactUrl: "https://next.example", standing: "serving-primary" },
      ],
    };
    const document = {
      body,
      signerNodeId: nodeId,
      signature: signDocumentBody(
        body,
        await readNodeIdentityKey(suite.node, loadKeyRing(KEY_ENV), nodeId),
      ),
      endorsements: [],
    };
    const answer = await fetch(`http://127.0.0.1:${port}/api/node/membership`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document }),
    });
    expect(await answer.json()).toEqual({ accepted: true });
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(await readNodeMembership(suite.db)).toEqual(document);
    expect(await readHandoverRestriction(suite.node, nodeId)).toMatchObject({
      kind: "superseded",
      successorNodeId: successor,
      operationId: null,
      membershipTerm: 1,
    });
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  }, 60_000);

  it("does not wait for the request that asked for it", async () => {
    let restarted!: () => void;
    const restart = vi.fn(() => restarted());
    const restarting = new Promise<void>((done) => (restarted = done));
    let nodeId = "";
    const { port, venue } = await boot(suite, {
      restricted: false,
      seams: {
        stepdown: {
          restart,
          // This route keeps running until the restart, so a stepdown that counted it would wait
          // the whole admitted-work limit before restarting.
          mount: (app, stepDown) =>
            app.post("/test-stepdown", async (c) => {
              const result = await stepDown({
                binding: {
                  operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  scenario: "emergency",
                  venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
                  sourceNodeId: nodeId,
                  destinationNodeId: "00000000-0000-4000-8000-0000000000aa",
                  membership: { term: 1, digest: "a".repeat(64) },
                },
                kind: "superseded",
                self: c,
              });
              await restarting;
              return c.json(result);
            }),
        },
      },
    });
    nodeId = venue.cfg.nodeId;
    const answer = fetch(`http://127.0.0.1:${port}/test-stepdown`, { method: "POST" }).catch(
      () => undefined,
    );
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    server = undefined;
    await answer;
  }, 60_000);
});
