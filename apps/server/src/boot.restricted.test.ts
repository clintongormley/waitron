import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readNodeMembership, withNodeTransaction } from "@waitron/db";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import { signEnvelope, verifyEnvelope } from "@waitron/handover";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
} from "@waitron/membership";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverRestriction, recordHandoverRestrictionTx } from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { StartedServer, StartServerSeams } from "./boot.js";
import { ensureBoxSecrets } from "./box-secrets.js";
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
    beforeStart?: () => Promise<void>;
    tls?: boolean;
  },
): Promise<{ port: number; venue: Venue }> {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  await options.beforeStart?.();
  const nodeId = venue.cfg.nodeId;
  const ring = loadKeyRing(KEY_ENV);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  await seedTermZeroMembership(
    { db: suite.db, node: suite.node, ring },
    nodeId,
    "https://box.example",
  );
  await pinMainBoxKey(suite.node, nodeId, MAIN_BOX);
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
    return { port: httpPort(), venue };
  }
  server = await startServer(env, env, options.seams);
  await vi.waitFor(
    async () => {
      expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
    },
    { timeout: 10_000 },
  );
  return { port: httpPort(), venue };
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
          { nonce: "c".repeat(20), atMs: 1, operationId: FINAL_COPY_OP },
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
