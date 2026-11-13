import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodes, stampDeployment, writeNodeMembership } from "@waitron/db";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing } from "@waitron/credentials";
import { emptyDrainResult } from "@waitron/fiscal";
import {
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readNodeModeRow } from "@waitron/node-db";
import { RESTORE_FLOW_DIR } from "@waitron/store";
import type { StartedServer } from "./boot.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { fakeMdnsSocket } from "./testing/fake-mdns-socket.js";
import { listener } from "./testing/ephemeral-listener.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const drain = vi.hoisted(() => vi.fn());

vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => ({
      ...actual.fiscalSlot(...args),
      drain: () => {
        drain();
        return Promise.resolve(emptyDrainResult());
      },
    }),
  };
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

const migrations = migrationOptionsFor(manifestSets(), null);
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const SPARE_ID = "00000000-0000-4000-8000-0000000000cc";

let server: StartedServer | undefined;
let mainBox: { server: Server; sockets: Socket[] } | undefined;
const scratch: string[] = [];
const suite = useVenueDb({ migrations });

afterEach(async () => {
  listener.configured = false;
  drain.mockClear();
  try {
    if (server !== undefined) await server.close();
    if (mainBox !== undefined) {
      for (const socket of mainBox.sockets) socket.destroy();
      await new Promise((done) => mainBox!.server.close(done));
    }
  } finally {
    server = undefined;
    mainBox = undefined;
    for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
  }
});

/** The main box's address: it records every connection and answers none. */
async function silentMainBox(): Promise<string> {
  const sockets: Socket[] = [];
  const listening = createServer((socket) => sockets.push(socket));
  listening.listen(0, "127.0.0.1");
  await once(listening, "listening");
  mainBox = { server: listening, sockets };
  const address = listening.address();
  if (address === null || typeof address === "string") throw new Error("no main box address");
  return `https://127.0.0.1:${address.port}`;
}

/** The environment a start of `nodeId` over `suite`'s two files reads. */
async function startEnv(db: VenueDb, nodeId: string): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-boot-node-state-missing-"));
  scratch.push(dir);
  const migrationsRoot = join(dir, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await writeFile(join(dir, "modules.json"), JSON.stringify({ modules: { "fiscal-none": false } }));
  const database = db.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  return {
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
    WAITRON_HTTP_HOST: "0.0.0.0",
  };
}

/** Starts the box, collecting the JSON log lines it writes meanwhile. */
async function start(
  env: Record<string, string>,
  mdns: ReturnType<typeof fakeMdnsSocket>,
): Promise<{ lines: Record<string, unknown>[]; started: Promise<StartedServer> }> {
  beforeServerStarts();
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
  const started = startServer(env, env, { mdnsSocket: () => mdns.socket });
  const settled = started.then(
    (s) => (server = s),
    () => undefined,
  );
  void settled.finally(() => (process.stdout.write = original));
  await settled;
  return { lines, started };
}

function venueAnswered(mdns: ReturnType<typeof fakeMdnsSocket>): boolean {
  try {
    mdns.query("waitron.local");
  } catch {
    // No responder took the socket.
  }
  return mdns.answered().includes("waitron.local");
}

/** Over HTTPS once the box serves its own leaf, which this test does not trust. */
async function acceptingSales(tls = false): Promise<unknown> {
  const url = `${tls ? "https" : "http"}://127.0.0.1:${httpPort()}/api/node`;
  const text = await new Promise<string>((resolve, reject) => {
    const request = (tls ? httpsGet : httpGet)(url, { rejectUnauthorized: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    request.on("error", reject);
  });
  return (JSON.parse(text) as { acceptingSales: unknown }).acceptingSales;
}

describe("a box that lost its own node.db", () => {
  it("a spare whose node.db is lost refuses to start with node.state_missing, files nothing and answers no venue name", async () => {
    // A joined spare's copy of the venue: the main box's data and chart, both boxes' `nodes` rows,
    // and a fresh node.db, since the lost one held this box's mode and signing key.
    const venue = await setupVenue(suite.db);
    const mainId = venue.cfg.nodeId;
    const main = generateNodeKeyPair();
    await suite.db.update(nodes).set({ publicKey: main.publicKey }).where(eq(nodes.id, mainId));
    await suite.db.insert(nodes).values({
      id: SPARE_ID,
      name: "Spare",
      publicKey: generateNodeKeyPair().publicKey,
    });
    await stampDeployment(suite.db, "preproduction");
    const mainUrl = await silentMainBox();
    const body: MembershipDocumentBody = {
      term: 2,
      nodes: [
        { nodeId: mainId, contactUrl: mainUrl, standing: "serving-primary" },
        { nodeId: SPARE_ID, contactUrl: "https://spare.example", standing: "serving-secondary" },
      ],
    };
    await writeNodeMembership(suite.db, {
      body,
      signerNodeId: mainId,
      signature: signDocumentBody(body, main.privateKey),
      endorsements: [],
    });
    expect(await readNodeModeRow(suite.node, SPARE_ID)).toBeNull();

    const mdns = fakeMdnsSocket();
    const { lines, started } = await start(await startEnv(suite, SPARE_ID), mdns);

    await expect(started).rejects.toMatchObject({ code: "node.state_missing" });
    expect(drain).not.toHaveBeenCalled();
    expect(lines.filter((l) => l.event === "handover.start_check")).toEqual([]);
    expect(venueAnswered(mdns)).toBe(false);
  }, 60_000);

  it("a first box with no mode row still starts as the sole primary", async () => {
    const venue = await setupVenue(suite.db);
    const nodeId = venue.cfg.nodeId;
    const ring = loadKeyRing(KEY_ENV);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
    await stampDeployment(suite.db, "preproduction");
    const body: MembershipDocumentBody = {
      term: 1,
      nodes: [{ nodeId, contactUrl: "https://box.example", standing: "serving-primary" }],
    };
    await writeNodeMembership(suite.db, {
      body,
      signerNodeId: nodeId,
      signature: signDocumentBody(body, await readNodeIdentityKey(suite.node, ring, nodeId)),
      endorsements: [],
    });
    expect(await readNodeModeRow(suite.node, nodeId)).toBeNull();

    const mdns = fakeMdnsSocket();
    const { started } = await start(await startEnv(suite, nodeId), mdns);

    await expect(started).resolves.toBeDefined();
    expect(await acceptingSales()).toBe(true);
    expect(venueAnswered(mdns)).toBe(true);
  }, 60_000);

  it("a box holding its signing key but no mode row, fenced by its held chart, starts fenced rather than refusing", async () => {
    // A first box has no mode row until a fenced start demotes it; a chart it holds that lists it
    // sell-only fences it.
    // The chart lists no other box, so the start check has nobody to wait for.
    const venue = await setupVenue(suite.db);
    const nodeId = venue.cfg.nodeId;
    const ring = loadKeyRing(KEY_ENV);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
    await stampDeployment(suite.db, "preproduction");
    const body: MembershipDocumentBody = {
      term: 2,
      nodes: [{ nodeId, contactUrl: "https://box.example", standing: "sell-only" }],
    };
    await writeNodeMembership(suite.db, {
      body,
      signerNodeId: nodeId,
      signature: signDocumentBody(body, await readNodeIdentityKey(suite.node, ring, nodeId)),
      endorsements: [],
    });
    expect(await readNodeModeRow(suite.node, nodeId)).toBeNull();

    const mdns = fakeMdnsSocket();
    const { started } = await start(await startEnv(suite, nodeId), mdns);

    await expect(started).resolves.toBeDefined();
    expect(await acceptingSales()).toBe(false);
    expect(await readNodeModeRow(suite.node, nodeId)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
  }, 60_000);

  it("a box with no row that the chart does not list starts", async () => {
    const venue = await setupVenue(suite.db);
    const nodeId = venue.cfg.nodeId;
    const ring = loadKeyRing(KEY_ENV);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
    await stampDeployment(suite.db, "preproduction");
    const other = generateNodeKeyPair();
    const otherId = "00000000-0000-4000-8000-0000000000dd";
    const body: MembershipDocumentBody = {
      term: 1,
      nodes: [
        { nodeId: otherId, contactUrl: "https://other.example", standing: "serving-primary" },
      ],
    };
    await writeNodeMembership(suite.db, {
      body,
      signerNodeId: otherId,
      signature: signDocumentBody(body, other.privateKey),
      endorsements: [],
    });
    expect(await readNodeModeRow(suite.node, nodeId)).toBeNull();

    const mdns = fakeMdnsSocket();
    const { started } = await start(await startEnv(suite, nodeId), mdns);

    await expect(started).resolves.toBeDefined();
  }, 60_000);

  it("a restored box with a rebuild marker and a fresh node.db starts", async () => {
    // A restore keeps the backup's own node id and its chart, which names that id serving primary;
    // it puts back the node's key, not its mode row.
    const venue = await setupVenue(suite.db);
    const nodeId = venue.cfg.nodeId;
    const ring = loadKeyRing(KEY_ENV);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
    await stampDeployment(suite.db, "preproduction");
    const body: MembershipDocumentBody = {
      term: 3,
      nodes: [{ nodeId, contactUrl: "https://box.example", standing: "serving-primary" }],
    };
    await writeNodeMembership(suite.db, {
      body,
      signerNodeId: nodeId,
      signature: signDocumentBody(body, await readNodeIdentityKey(suite.node, ring, nodeId)),
      endorsements: [],
    });
    expect(await readNodeModeRow(suite.node, nodeId)).toBeNull();
    const env = await startEnv(suite, nodeId);
    const ca = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: [],
      now: new Date(),
    });
    await mkdir(join(env.WAITRON_STATE_DIR!, "tls"), { recursive: true });
    await writeFile(join(env.WAITRON_STATE_DIR!, "tls", "ca.crt"), ca.caCertPem);
    await writeFile(join(env.WAITRON_STATE_DIR!, "tls", "ca.key"), ca.caKeyPem);
    const flow = join(env.WAITRON_STATE_DIR!, RESTORE_FLOW_DIR);
    await mkdir(flow, { recursive: true });
    await writeFile(
      join(flow, "record.json"),
      JSON.stringify({ version: 1, phase: "first-start", firstStart: { source: "archive" } }),
    );

    const mdns = fakeMdnsSocket();
    const { lines, started } = await start(env, mdns);

    await expect(started).resolves.toBeDefined();
    expect(await acceptingSales(true)).toBe(true);
    expect(lines.some((l) => l.event === "restore.first_start_done")).toBe(true);
  }, 60_000);
});
