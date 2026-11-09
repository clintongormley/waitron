import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nodes,
  readNodeMembership,
  stampDeployment,
  writeNodeMembership,
  withTransaction,
  withNodeTransaction,
} from "@waitron/db";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, putCredential, sealNodeSigningKeyTx } from "@waitron/credentials";
import { Hono } from "hono";
import { persons, startManagementSession } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { FakeLitestream } from "@waitron/stream/testing/fake-litestream.js";
import { SwitchableStore } from "@waitron/stream/testing/switchable-store.js";
import { readPointer, venuePrefix } from "@waitron/stream";
import { mountStreamApi } from "./stream-api.js";
import { createTurns } from "./backup-turns.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { StreamHost, STREAM_PURPOSE } from "./stream-host.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { ALL_MODULES } from "./modules.js";
import { standbyContract, allocatedStandbyModules } from "./testing/allocated-contract.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { signEnvelope } from "@waitron/handover";
import {
  generateNodeKeyPair,
  buildNextMembershipDocument,
  signDocumentBody,
  type MembershipDocumentBody,
  type NodeStanding,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodeHandoverEvents, readHandoverRestriction } from "@waitron/node-db";
import type { StartedServer, StartServerSeams } from "./boot.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import type { PeerStatusBody } from "./peer-status-api.js";
import type { StartPeerCheckOutcome } from "./start-peer-check.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";
import { listener } from "./testing/ephemeral-listener.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, startConfiguredServer, httpPort } =
  ephemeralServerFixture();

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

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return { ...actual, ALL_MODULES: [...actual.ALL_MODULES] };
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
const suite = useVenueDb({ migrations });
const spareSuite = useVenueDb({ migrations });

afterEach(async () => {
  listener.configured = false;
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
  /** The environment the box started with, to start the same box again. */
  env: Record<string, string>;
  lines: Record<string, unknown>[];
  acceptingSales: unknown;
}

/**
 * Sets up a main box whose held chart lists SPARE at `spareUrl`, with SPARE's `nodes` row only when
 * `joined`, then starts it. `chart` signs a further chart with SPARE's key.
 */
async function boot(
  suite: VenueDb,
  options: {
    spareUrl: string;
    joined: boolean;
    pinned?: boolean;
    enrolled?: boolean;
    beforeStart?: (nodeId: string) => Promise<void>;
    seams?: StartServerSeams;
    /** A fixed HTTP port, bound as given rather than replaced by an ephemeral one. */
    port?: number;
  },
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
    ...(options.port === undefined ? {} : { WAITRON_HTTP_PORT: String(options.port) }),
  };
  if (options.enrolled) {
    await mkdir(join(dir, "tls"), { recursive: true });
    const ca = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: [],
      now: new Date(),
    });
    await writeFile(join(dir, "tls", "ca.crt"), ca.caCertPem);
    await writeFile(join(dir, "tls", "ca.key"), ca.caKeyPem);
    const [admin] = await suite.db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.role, "admin"));
    const fixture = await standbyContract(
      suite.db,
      { nodeId },
      SPARE.nodeId,
      [
        { code: "A", purpose: "standard" },
        { code: "FF", purpose: "full" },
        { code: "R", purpose: "rectificative" },
      ],
      admin!.id,
    );
    const held = fixture.request("reserve");
    const app = new Hono();
    mountMirrorBundleApi(app, {
      appDb: suite.db,
      node: suite.node,
      ring,
      stateDir: dir,
      relayUrl: "https://relay.example",
      boxHostname: "waitron.local",
      designated: { nodeId },
      accountKey: Buffer.alloc(32, 9).toString("base64"),
      credentialKeyRing: TOTP_KEY_RING,
    });
    const original = [...ALL_MODULES];
    (ALL_MODULES as WaitronModule[]).splice(
      0,
      ALL_MODULES.length,
      ...allocatedStandbyModules(original, fixture),
    );
    try {
      const response = await app.request("/management-api/mirror-bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personId: admin!.id,
          password: "dashPass123",
          standbyNodeId: SPARE.nodeId,
          standbyPublicKey: SPARE.publicKey,
          standbyContactUrl: options.spareUrl,
          moduleOperation: { binding: held.binding, input: held.input },
        }),
      });
      expect(response.status, JSON.stringify(await response.json())).toBe(200);
    } finally {
      (ALL_MODULES as WaitronModule[]).splice(0, ALL_MODULES.length, ...original);
    }
  }
  await options.beforeStart?.(nodeId);
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
    server =
      options.port === undefined
        ? await startServer(env, env, options.seams)
        : await startConfiguredServer(env, env, options.seams);
    // The fixture honours a fixed port only during the call; the normal start after a wait binds
    // later, so the case keeps it honoured until its own end.
    if (options.port !== undefined) listener.configured = true;
  } finally {
    process.stdout.write = original;
  }
  // A configured listener may still be binding when the start returns.
  const { acceptingSales } = await vi.waitFor(async () => {
    const answer = await fetch(`http://127.0.0.1:${options.port ?? httpPort()}/api/node`);
    return (await answer.json()) as { acceptingSales: unknown };
  });
  return { nodeId, env, lines, acceptingSales };
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
  it.each(["before", "after"])(
    "a returning enrolled main stops when the spare publishes %s carry-on",
    async (when) => {
      const bucket = new SwitchableStore(() => new Date());
      const litestream = new FakeLitestream();
      let publisher: StreamHost | undefined;
      let publishCopy!: () => Promise<void>;
      const restarted = vi.fn();
      try {
        const booted = await boot(suite, {
          spareUrl: "https://spare.example",
          joined: true,
          pinned: false,
          enrolled: true,
          seams: {
            peerCheck: async () => ({
              result: "wait",
              successorNodeId: null,
              waitingOn: [SPARE.nodeId],
            }),
            waitingStart: { intervalMs: 60_000, secure: () => true },
            stream: { store: bucket, mainCheckIntervalMs: 5 },
            stepdown: { mount: () => {}, restart: restarted },
          },
          beforeStart: async (nodeId) => {
            const settings = {
              venueId: "returning-main",
              endpoint: "-",
              region: "eu-west-1",
              bucket: "copies",
              prefix: "-",
              accessKeyId: "test",
              secretAccessKey: "test-secret",
            };
            await withTransaction(suite.db, (tx) =>
              putCredential(tx, loadKeyRing(KEY_ENV), { purpose: STREAM_PURPOSE, value: settings }),
            );
            const held = (await readNodeMembership(suite.db))!;
            await writeNodeMembership(
              spareSuite.db,
              buildNextMembershipDocument({
                heldDocument: held,
                nodes: [
                  { nodeId, contactUrl: OWN_URL, standing: "sell-only" },
                  {
                    nodeId: SPARE.nodeId,
                    contactUrl: "https://spare.example",
                    standing: "serving-primary",
                  },
                ],
                signerNodeId: SPARE.nodeId,
                signerPrivateKey: SPARE.privateKey,
              }),
            );
            await withNodeTransaction(spareSuite.node, (tx) =>
              sealNodeSigningKeyTx(tx, loadKeyRing(KEY_ENV), SPARE.nodeId, SPARE.privateKey),
            );
            let recoveryKey: string | undefined;
            publisher = new StreamHost({
              db: spareSuite.db,
              node: spareSuite.node,
              ring: loadKeyRing(KEY_ENV),
              nodeId: SPARE.nodeId,
              venueDir: dirname(
                spareSuite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file,
              ),
              stateDir: scratch[0]!,
              litestreamBin: "litestream",
              log: () => {},
              now: () => new Date(),
              isPrimary: () => true,
              readRecoveryKey: async () => recoveryKey,
              refreshSealedState: async () => "sealed",
              store: bucket,
              spawn: litestream.spawn,
            });
            const [admin] = await suite.db.select().from(persons).where(eq(persons.role, "admin"));
            await spareSuite.db.insert(persons).values(admin!);
            const session = await withTransaction(spareSuite.db, (tx) =>
              startManagementSession(tx, { personId: admin!.id }),
            );
            const streamApp = new Hono();
            mountStreamApi(
              streamApp,
              {
                db: spareSuite.db,
                ring: loadKeyRing(KEY_ENV),
                stream: publisher,
                venueId: "returning-main",
                isPrimary: () => true,
                isManagedByEnvironment: () => false,
                loadedArchives: () => [],
                readRecoveryKey: async () => recoveryKey,
                writeRecoveryKey: async (key) => {
                  recoveryKey = key;
                },
                sealedState: { refresh: async () => "sealed" },
                probe: async () => ({ ok: true }),
                prepareEncryption: async () => ({ ok: true }),
                turns: createTurns(),
              },
              () => {},
            );
            // Stream Save stands in for A947 3b-5's backup.env provisioning, not promotion itself.
            const saved = await streamApp.request("/api/backup/stream", {
              method: "PUT",
              headers: {
                "content-type": "application/json",
                cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
              },
              body: JSON.stringify({
                endpoint: "",
                region: settings.region,
                bucket: settings.bucket,
                prefix: "",
                accessKeyId: settings.accessKeyId,
                secretAccessKey: settings.secretAccessKey,
              }),
            });
            expect(saved.status, await saved.text()).toBe(200);
            expect(recoveryKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
            await vi.waitFor(() => expect(litestream.running()).toBeDefined());
            publishCopy = async () => {
              const generation = (publisher!.status() as { generation: string }).generation;
              bucket.upload(
                `${venuePrefix("returning-main")}${generation}/0000/0000000000000001-0000000000000001.ltx`,
              );
              await vi.waitFor(
                async () =>
                  expect((await readPointer(bucket, "returning-main"))?.pointer.body).toMatchObject(
                    { nodeId: SPARE.nodeId, term: 3 },
                  ),
                { timeout: 10_000 },
              );
            };
            if (when === "before") await publishCopy();
          },
        });
        expect(booted.acceptingSales).toBe(false);
        const carried = await fetch(`http://127.0.0.1:${httpPort()}/carry-on`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            email: "owner@example.test",
            password: "dashPass123",
            switchedOff: "yes",
            noOtherRecovery: "yes",
          }),
        });
        if (when === "before") {
          expect(carried.status).toBe(409);
          expect(await carried.text()).toContain("https://spare.example");
          expect(await suite.node.select().from(nodeHandoverEvents)).toEqual([]);
          expect(await readHandoverRestriction(suite.node, booted.nodeId)).toBeNull();
        } else {
          expect(carried.status).toBe(200);
          await carried.text();
          await vi.waitFor(
            async () => {
              const node = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
              expect(await node.json()).toMatchObject({ acceptingSales: true });
            },
            { timeout: 30_000 },
          );
          await publishCopy();
          await vi.waitFor(async () =>
            expect(await readHandoverRestriction(suite.node, booted.nodeId)).toMatchObject({
              kind: "superseded",
              successorNodeId: SPARE.nodeId,
              membershipTerm: 3,
            }),
          );
          await vi.waitFor(() => expect(restarted).toHaveBeenCalledOnce(), { timeout: 30_000 });
          await server!.close();
          server = undefined;
          beforeServerStarts();
          server = await startServer(booted.env, booted.env);
          const node = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
          expect(await node.json()).toMatchObject({ acceptingSales: false });
        }
      } finally {
        await publisher?.stop();
      }
    },
    60_000,
  );

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

  it("a joined spare whose key the main box does not hold: its answer cannot be checked, so the box waits", async () => {
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
    expect(booted.acceptingSales).toBe(false);
    const page = await fetch(`http://127.0.0.1:${httpPort()}/`, {
      headers: { "accept-language": "en-GB" },
    });
    expect(await page.text()).toContain("<h1>This box is waiting for Spare</h1>");
  }, 60_000);

  describe("while it waits", () => {
    const restart = vi.fn();
    afterEach(() => restart.mockReset());
    const waitThen = (...later: StartPeerCheckOutcome[]) => {
      const peerCheck = vi.fn<() => Promise<StartPeerCheckOutcome>>().mockResolvedValueOnce({
        result: "wait",
        successorNodeId: null,
        waitingOn: [SPARE.nodeId],
      });
      for (const outcome of later) peerCheck.mockResolvedValueOnce(outcome);
      // Nothing further: a re-ask after the last answer the case gave would be a fault.
      peerCheck.mockRejectedValue(new Error("asked after the wait ended"));
      return peerCheck;
    };
    const seams = (peerCheck: () => Promise<StartPeerCheckOutcome>): StartServerSeams => ({
      peerCheck,
      waitingStart: { intervalMs: 5 },
      stepdown: { mount: () => {}, restart },
    });
    const acceptingSales = async () =>
      (
        (await (await fetch(`http://127.0.0.1:${httpPort()}/api/node`)).json()) as {
          acceptingSales: unknown;
        }
      ).acceptingSales;

    it("restarts when a peer answers: the start goes on to sell, and the waiting page and timer are gone", async () => {
      const peerCheck = waitThen(
        { result: "wait", successorNodeId: null },
        { result: "proceed", successorNodeId: null },
      );
      const booted = await boot(suite, {
        spareUrl: OWN_URL,
        joined: true,
        seams: seams(peerCheck),
      });
      expect(booted.acceptingSales).toBe(false);
      await vi.waitFor(async () => expect(await acceptingSales()).toBe(true), { timeout: 30_000 });
      const page = await fetch(`http://127.0.0.1:${httpPort()}/`);
      expect(await page.text()).not.toContain("This box is waiting for");
      const health = (await (
        await fetch(`http://127.0.0.1:${httpPort()}/health`)
      ).json()) as Record<string, unknown>;
      expect(health.tradingAvailable).toBeUndefined();
      await new Promise((done) => setTimeout(done, 50));
      expect(peerCheck).toHaveBeenCalledTimes(3);
    }, 60_000);

    it("the next start asks the peers again", async () => {
      const wait: StartPeerCheckOutcome = {
        result: "wait",
        successorNodeId: null,
        waitingOn: [SPARE.nodeId],
      };
      const first = vi.fn(() => Promise.resolve(wait));
      const booted = await boot(suite, {
        spareUrl: OWN_URL,
        joined: true,
        seams: { ...seams(first), waitingStart: { intervalMs: 60_000, secure: () => true } },
      });
      expect(booted.acceptingSales).toBe(false);
      const carried = await fetch(`http://127.0.0.1:${httpPort()}/carry-on`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          email: "owner@example.test",
          password: "dashPass123",
          switchedOff: "yes",
          noOtherRecovery: "yes",
        }),
      });
      expect(carried.status).toBe(200);
      await vi.waitFor(async () => expect(await acceptingSales()).toBe(true), { timeout: 30_000 });
      expect(first).toHaveBeenCalledTimes(1);
      expect(await suite.node.select().from(nodeHandoverEvents)).toMatchObject([
        { kind: "carried_on_without_peer", detail: { peerNodeIds: [SPARE.nodeId], chartTerm: 1 } },
      ]);

      await server!.close();
      server = undefined;
      const second = vi.fn(() => Promise.resolve(wait));
      beforeServerStarts();
      server = await startServer(booted.env, booted.env, {
        ...seams(second),
        waitingStart: { intervalMs: 60_000 },
      });
      expect(second).toHaveBeenCalledTimes(1);
      expect(await acceptingSales()).toBe(false);
      const page = await fetch(`http://127.0.0.1:${httpPort()}/`);
      expect(await page.text()).toContain("This box is waiting for Spare");
    }, 60_000);

    it("the waiting start refuses a carry-on from another port of the box's address, and takes its own pages'", async () => {
      const booted = await boot(suite, {
        spareUrl: OWN_URL,
        joined: true,
        seams: { ...seams(waitThen()), waitingStart: { intervalMs: 60_000, secure: () => true } },
      });
      expect(booted.acceptingSales).toBe(false);
      const carryOnFrom = async (origin: string, site: string) => {
        const response = await fetch(`http://127.0.0.1:${httpPort()}/carry-on`, {
          method: "POST",
          headers: {
            cookie: `waitron_management_session=${randomUUID()}`,
            origin,
            "sec-fetch-site": site,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "",
        });
        const text = await response.text();
        return { status: response.status, refused: text.includes("management.origin_refused") };
      };
      expect(await carryOnFrom(`http://127.0.0.1:${httpPort() + 1}`, "same-site")).toEqual({
        status: 403,
        refused: true,
      });
      expect(await carryOnFrom(`http://127.0.0.1:${httpPort()}`, "same-origin")).toMatchObject({
        refused: false,
      });
      expect(await carryOnFrom("https://dashboard.example", "cross-site")).toMatchObject({
        refused: false,
      });
      expect(await acceptingSales()).toBe(false);
    }, 60_000);

    it("on a fixed port, the normal start binds the port the waiting start released", async () => {
      const [port] = await freePorts(1);
      await boot(suite, {
        spareUrl: OWN_URL,
        joined: true,
        port: port!,
        seams: seams(waitThen({ result: "proceed", successorNodeId: null })),
      });
      await vi.waitFor(
        async () => {
          const node = await fetch(`http://127.0.0.1:${port}/api/node`);
          expect(((await node.json()) as { acceptingSales: unknown }).acceptingSales).toBe(true);
        },
        { timeout: 30_000 },
      );
    }, 60_000);

    it("a step after the wait that fails rejects fullyStarted with its error", async () => {
      let answer: () => void = () => {};
      const peerCheck = waitThen();
      peerCheck.mockReturnValueOnce(
        new Promise((done) => (answer = () => done({ result: "proceed", successorNodeId: null }))),
      );
      await boot(suite, { spareUrl: OWN_URL, joined: true, seams: seams(peerCheck) });
      expect(server!.fullyStarted).toBeDefined();
      // The first node.db read after the wait is the mirror link's.
      suite.node.run(sql`alter table node_mirror_link rename to node_mirror_link_aside`);
      try {
        answer();
        await expect(server!.fullyStarted).rejects.toThrow(/node_mirror_link/);
      } finally {
        suite.node.run(sql`alter table node_mirror_link_aside rename to node_mirror_link`);
      }
    }, 60_000);

    it("a re-ask that answers superseded with a successor records the restriction and starts restricted", async () => {
      const booted = await boot(suite, {
        spareUrl: OWN_URL,
        joined: true,
        seams: seams(waitThen({ result: "superseded", successorNodeId: SPARE.nodeId })),
      });
      await vi.waitFor(
        async () =>
          expect(await readHandoverRestriction(suite.node, booted.nodeId)).toMatchObject({
            kind: "superseded",
            successorNodeId: SPARE.nodeId,
          }),
        { timeout: 30_000 },
      );
      await vi.waitFor(async () => {
        const page = await fetch(`http://127.0.0.1:${httpPort()}/`);
        expect(await page.text()).toContain("This box no longer runs the venue");
      });
      expect(await acceptingSales()).toBe(false);
    }, 60_000);

    it("a peer's newer chart that fences it, sent to the waiting start, records the restriction and restarts", async () => {
      const booted = await boot(suite, {
        spareUrl: OWN_URL,
        joined: true,
        seams: { ...seams(waitThen()), waitingStart: { intervalMs: 60_000 } },
      });
      expect(booted.acceptingSales).toBe(false);
      const sent = await fetch(`http://127.0.0.1:${httpPort()}/api/node/membership`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document: spareChart(2, [
            [booted.nodeId, "sell-only", OWN_URL],
            [SPARE.nodeId, "serving-primary", "https://spare.example"],
          ]),
        }),
      });
      expect(await sent.json()).toEqual({ accepted: true });
      expect(await readHandoverRestriction(suite.node, booted.nodeId)).toMatchObject({
        kind: "superseded",
        successorNodeId: SPARE.nodeId,
        membershipTerm: 2,
      });
      await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    }, 60_000);
  });

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
