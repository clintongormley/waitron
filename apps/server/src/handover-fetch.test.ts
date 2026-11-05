import {
  createServer as createHttpServer,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createSecureContext } from "node:tls";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  nodeSigningPublicKey,
  type KeyRing,
} from "@waitron/credentials";
import { sha256Hex, signEnvelope, type HandoverBinding } from "@waitron/handover";
import {
  endorseKey,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
} from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import {
  NODE_MIGRATIONS,
  readHandoverEvent,
  readHandoverOperation,
  recordHandoverRestrictionTx,
  setNodeMode,
  writeMirrorLink,
} from "@waitron/node-db";
import type { ErrorCode } from "@waitron/shared";
import type { CaptureDeps } from "./handover-capture.js";
import type { CompareOutcome } from "./handover-compare.js";
import {
  receivedCopyPath,
  startHandoverDestinationDuty,
  usableBase,
  type DestinationDutyDeps,
} from "./handover-destination-duty.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import { abandonHandover, advanceHandover, beginHandover, waitHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { boxDownload } from "./mirror-bundle-fetch.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

const chartReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@waitron/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/db")>();
  return {
    ...real,
    readNodeMembership: (...args: Parameters<typeof real.readNodeMembership>) => {
      chartReads.count += 1;
      return real.readNodeMembership(...args);
    },
  };
});
vi.mock("./handover-store.js", { spy: true });
vi.mock("node:fs/promises", { spy: true });

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x6).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TICK_MS = 20;
// Long enough for several ticks of the duty to have run.
const SEVERAL_TICKS_MS = 200;

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

let scratch: string;
const closers: (() => Promise<unknown>)[] = [];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "waitron-handover-fetch-"));
});
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
  await rm(scratch, { recursive: true, force: true });
});

const logLines: unknown[][] = [];
const log: Logger = (...line: unknown[]) => void logLines.push(line);
beforeEach(() => {
  logLines.length = 0;
});

type Intercept = (url: string, handle: RequestListener) => RequestListener;

/**
 * The two boxes share one database, as `handover-source-api.test.ts`'s do: every row here is keyed
 * by the box it belongs to. `listen` serves the real routes, and `routes` picks which are mounted.
 */
async function rig({ mode = "mirror" as "mirror" | "primary" } = {}) {
  const db = suite.db;
  await seedVenue(db);
  await stampDeployment(db, "preproduction");
  const m1 = await seedNode(db);
  const m2 = await seedNode(db);
  for (const nodeId of [m1, m2])
    await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
  const m1Key = await readNodeIdentityKey(suite.node, RING, m1);
  const m2Key = await readNodeIdentityKey(suite.node, RING, m2);

  async function holdChart(m1Url: string) {
    const body: MembershipDocumentBody = {
      term: 3,
      nodes: [
        { nodeId: m1, contactUrl: m1Url, standing: "serving-primary" },
        { nodeId: m2, contactUrl: "https://box-1", standing: "serving-secondary" },
      ],
    };
    await writeNodeMembership(db, {
      body,
      signerNodeId: m1,
      signature: signDocumentBody(body, m1Key),
      endorsements: [endorseKey(m2, nodeSigningPublicKey(m2Key), m1, m1Key)],
    });
  }
  await holdChart("http://127.0.0.1:1");
  await pinMainBoxKey(suite.node, m2, { nodeId: m1, publicKey: nodeSigningPublicKey(m1Key) });

  const binding = (operationId: string): HandoverBinding => ({
    operationId,
    scenario: "controlled",
    venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
    sourceNodeId: m1,
    destinationNodeId: m2,
    membership: { term: 3, digest: "a".repeat(64) },
  });
  const m1Store = { node: suite.node, nodeId: m1 };
  const m2Store = { node: suite.node, nodeId: m2 };
  await beginHandover(m1Store, binding(OP), "source");
  await beginHandover(m2Store, binding(OP), "destination");
  await setNodeMode({ venue: db, node: suite.node }, m2, mode);

  // Plain http ignores the pin; the TLS cases write their own link.
  await writeMirrorLink(suite.node, m2, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "box.local",
    boxCaPem: "no certificate",
    originNodeId: m1,
  });

  const stateDir = join(scratch, "m2");
  await mkdir(stateDir, { recursive: true });
  const m1StateDir = join(scratch, "m1");
  await mkdir(m1StateDir, { recursive: true });
  const captureDeps: CaptureDeps = {
    venue: db,
    node: suite.node,
    stateDir: m1StateDir,
    ring: RING,
    nodeId: m1,
    modules: MODULES as readonly WaitronModule[],
  };
  const peerDeps = { db, node: suite.node, ring: RING, nodeId: m1 };

  /** M1's running answers: its status always, the copy routes as in its restricted start only. */
  function m1App({ restricted }: { restricted: boolean }): Hono {
    const app = new Hono();
    mountPeerStatusApi(app, peerDeps, () => {});
    if (restricted) mountHandoverSourceApi(app, captureDeps, () => {});
    return app;
  }

  const requests: string[] = [];
  /** Serves `app` on loopback; `intercept` can replace the answer to any one request. */
  async function listen(app: Hono, intercept?: Intercept): Promise<string> {
    const real = getRequestListener(app.fetch);
    const server = createHttpServer((req, res) => {
      requests.push(req.url!);
      (intercept?.(req.url!, real) ?? real)(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closers.push(() => closeServer(server));
    await holdChart(url);
    return url;
  }

  async function stepDownM1() {
    await advanceHandover(m1Store, OP, "source_stepped_down", {});
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: m1,
        operationId: OP,
        kind: "handed-over",
        successorNodeId: m2,
        membershipTerm: 3,
      }),
    );
  }

  const deps: DestinationDutyDeps = {
    db,
    node: suite.node,
    ring: RING,
    nodeId: m2,
    stateDir,
    venueDir: stateDir,
    log,
    restart: () => {},
    tickMs: TICK_MS,
    accept: null,
  };
  async function start(overrides: Partial<DestinationDutyDeps> = {}) {
    const duty = await startHandoverDestinationDuty({ ...deps, ...overrides });
    if (duty !== undefined) closers.push(() => duty.stop());
    return duty;
  }
  const m2Row = async () => (await readHandoverOperation(suite.node, m2, OP))!;
  const received = () => receivedCopyPath(stateDir, OP);
  const statusReads = () => requests.filter((url) => url === "/api/node/peer-status").length;
  const copyReads = () => requests.filter((url) => url.endsWith("/final-copy")).length;

  return {
    db,
    m1,
    m2,
    m1Key,
    m2Key,
    m1Store,
    m2Store,
    m1App,
    listen,
    holdChart,
    stepDownM1,
    start,
    m2Row,
    received,
    requests,
    statusReads,
    copyReads,
    stateDir,
    binding,
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, SEVERAL_TICKS_MS));

describe("the spare fetches the old box's final copy", () => {
  it("fetches once M1's restricted start answers, through the real routes", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.start({ compare });
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );

    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));

    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const copy = await readFile(r.received());
    const [operation, indicator, path] = compare.mock.calls[0] as unknown as [
      { operationId: string },
      { kind: string; signerNodeId: string; body: { snapshot: { sha256: string; bytes: number } } },
      string,
    ];
    expect(operation.operationId).toBe(OP);
    expect(path).toBe(r.received());
    expect(indicator.signerNodeId).toBe(r.m1);
    expect(copy.length).toBe(indicator.body.snapshot.bytes);
    expect(sha256Hex(copy)).toBe(indicator.body.snapshot.sha256);
    expect((await r.m2Row()).state).toBe("prepared");
    expect((await r.m2Row()).waitingReason).toBeNull();
    expect(existsSync(`${r.received()}.partial`)).toBe(false);
  });

  it("a fetched file is not fetched again, and M1's status is still read", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    await r.start({ compare });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const before = r.statusReads();
    await settle();
    expect(r.copyReads()).toBe(1);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(r.statusReads()).toBeGreaterThan(before);
  });

  it("removes a file an earlier attempt left before it fetches, even when M1 then refuses", async () => {
    const r = await rig();
    const folder = join(r.stateDir, "handover", OP);
    await mkdir(folder, { recursive: true });
    await writeFile(r.received(), "an older attempt");
    await writeFile(`${r.received()}.partial`, "older still");
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url.endsWith("/final-copy")
        ? (_req, res) => {
            res.statusCode = 409;
            res.end(JSON.stringify({ error: { code: "handover.final_copy_changed", params: {} } }));
          }
        : real,
    );
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.final_copy_changed"),
    );
    expect(await readdir(folder)).toEqual([]);
  });

  it("a partial download is discarded and fetched again", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.stepDownM1();
    let cut = 0;
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url.endsWith("/final-copy") && cut++ === 0
        ? (_req, res) => {
            res.writeHead(200, { "content-length": "1000" });
            res.write("only the start", () => res.destroy());
          }
        : real,
    );
    await r.start({ compare });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(r.copyReads()).toBe(2);
    const [, indicator] = compare.mock.calls[0] as unknown as [
      unknown,
      { body: { snapshot: { bytes: number } } },
    ];
    expect((await stat(r.received())).size).toBe(indicator.body.snapshot.bytes);
  });

  it("a server that goes silent mid-file is given up on and fetched again", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.stepDownM1();
    let stalled = 0;
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url.endsWith("/final-copy") && stalled++ === 0
        ? (_req, res) => {
            res.writeHead(200, { "content-length": "1000" });
            res.write("the start, then nothing");
          }
        : real,
    );
    await r.start({ compare, silenceLimitMs: 100 });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(r.copyReads()).toBe(2);
  });

  it("a download thrown after the file reached its final name counts as no file", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.stepDownM1();
    let gone = false;
    await r.listen(r.m1App({ restricted: true }), (_url, real) =>
      gone ? (_req, res) => void res.destroy() : real,
    );
    const download = vi.fn(async (...args: Parameters<typeof boxDownload>) => {
      await boxDownload(...args);
      expect(existsSync(r.received())).toBe(true);
      gone = true;
      throw new Error("the folder could not be flushed");
    });
    await r.start({ compare, download });
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await settle();
    // M1 no longer answers, so no later attempt's own clean-up is what removed it.
    expect(download).toHaveBeenCalledTimes(1);
    expect(existsSync(r.received())).toBe(false);
    expect(compare).not.toHaveBeenCalled();
    expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable");
  });

  it("after such a throw the next attempt fetches the file again", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    let first = true;
    const download = vi.fn(async (...args: Parameters<typeof boxDownload>) => {
      const answer = await boxDownload(...args);
      if (first) {
        first = false;
        throw new Error("the folder could not be flushed");
      }
      return answer;
    });
    await r.start({ compare, download });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(download).toHaveBeenCalledTimes(2);
    expect((await r.m2Row()).waitingReason).toBeNull();
  });

  it("runs one download at a time, however often it is woken", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.stepDownM1();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url.endsWith("/final-copy") ? (req, res) => void held.then(() => real(req, res)) : real,
    );
    const duty = (await r.start({ compare }))!;
    await vi.waitFor(() => expect(r.copyReads()).toBe(1), { timeout: 10_000 });
    duty.wake();
    duty.wake();
    await settle();
    expect(r.copyReads()).toBe(1);
    release();
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(r.copyReads()).toBe(1);
  });

  it("a stop during a download ends it, leaves no partial file and records no wait", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url.endsWith("/final-copy")
        ? (_req, res) => {
            res.writeHead(200, { "content-length": "1000" });
            res.write("the start, then nothing");
          }
        : real,
    );
    const duty = (await r.start())!;
    await vi.waitFor(() => expect(existsSync(`${r.received()}.partial`)).toBe(true), {
      timeout: 10_000,
    });
    await duty.stop();
    expect(existsSync(`${r.received()}.partial`)).toBe(false);
    expect((await r.m2Row()).waitingReason).toBeNull();
  });
});

describe("the spare trusts only the box its link pins", () => {
  async function tlsBox(
    r: Awaited<ReturnType<typeof rig>>,
    app: Hono,
    material: ReturnType<typeof mintSelfSignedServerCert>,
  ) {
    const real = getRequestListener(app.fetch);
    const server = createHttpsServer(
      { key: material.serverKeyPem, cert: material.serverCertPem },
      (req, res) => {
        r.requests.push(req.url!);
        real(req, res);
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => closeServer(server as unknown as Server));
    const url = `https://localhost:${(server.address() as AddressInfo).port}`;
    await r.holdChart(url);
  }
  const mint = () =>
    mintSelfSignedServerCert({ hostnames: ["localhost"], ipAddresses: [], now: new Date() });

  it("fetches over TLS from a box under the pinned authority", async () => {
    const r = await rig();
    const material = mint();
    await writeMirrorLink(suite.node, r.m2, {
      relayUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: material.caCertPem,
      originNodeId: r.m1,
    });
    await r.stepDownM1();
    await tlsBox(r, r.m1App({ restricted: true }), material);
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.start({ compare });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 30_000 });
    expect(existsSync(r.received())).toBe(true);
  }, 60_000);

  it("takes nothing from a box under another authority: no request arrives, no file", async () => {
    const r = await rig();
    await writeMirrorLink(suite.node, r.m2, {
      relayUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: mint().caCertPem,
      originNodeId: r.m1,
    });
    await r.stepDownM1();
    await tlsBox(r, r.m1App({ restricted: true }), mint());
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.start({ compare });
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    await settle();
    expect(r.requests).toEqual([]);
    expect(compare).not.toHaveBeenCalled();
    expect(existsSync(r.received())).toBe(false);
  }, 60_000);

  it.each([
    ["indicator", ["pinned"], "/api/node/peer-status"],
    ["final copy", ["pinned", "pinned"], "/indicator"],
  ])(
    "takes no %s from another authority, once the status read before it passed the pin",
    async (_label, pinnedConnections, lastSeen) => {
      const r = await rig();
      const pinned = mint();
      const other = mint();
      await writeMirrorLink(suite.node, r.m2, {
        relayUrl: "http://127.0.0.1:1/",
        boxHostname: "box.local",
        boxCaPem: pinned.caCertPem,
        originNodeId: r.m1,
      });
      await r.stepDownM1();
      const contexts = pinnedConnections.map(() => pinned);
      const real = getRequestListener(r.m1App({ restricted: true }).fetch);
      // Each request is its own connection (`agent: false`), so each can show its own certificate.
      const server = createHttpsServer(
        {
          key: pinned.serverKeyPem,
          cert: pinned.serverCertPem,
          SNICallback: (_name, done) => {
            const material = contexts.shift() ?? other;
            done(
              null,
              createSecureContext({ key: material.serverKeyPem, cert: material.serverCertPem }),
            );
          },
        },
        (req, res) => {
          r.requests.push(req.url!);
          real(req, res);
        },
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      closers.push(() => closeServer(server as unknown as Server));
      await r.holdChart(`https://localhost:${(server.address() as AddressInfo).port}`);
      const compare = vi.fn(async () => ({ ok: true as const }));
      await r.start({ compare });
      await vi.waitFor(() => expect(r.requests.at(-1)).toContain(lastSeen), { timeout: 30_000 });
      await settle();
      expect(r.requests.length).toBe(pinnedConnections.length);
      expect(compare).not.toHaveBeenCalled();
      expect(existsSync(r.received())).toBe(false);
    },
    60_000,
  );

  it.each([
    ["https://box.local:8443/", "https://box.local:8443"],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["http://localhost:8080/", "http://localhost:8080"],
    ["http://192.168.1.5:8080", undefined],
    ["http://box.local", undefined],
    ["not an address", undefined],
    ["", undefined],
    [undefined, undefined],
  ])(
    "the address %s is usable as %s, since plain http would make the pin protect nothing",
    (url, base) => {
      expect(usableBase(url)).toBe(base);
    },
  );

  it("a box with no mirror link keeps it waiting, with nothing sent", async () => {
    const r = await rig();
    await r.listen(r.m1App({ restricted: false }));
    suite.node.run(sql`delete from node_mirror_link where node_id = ${r.m2}`);
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    expect(r.requests).toEqual([]);
  });

  it("a chart with no address for M1 keeps it waiting, with nothing sent", async () => {
    const r = await rig();
    await r.holdChart("");
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    expect(r.requests).toEqual([]);
  });
});

describe("M1's status decides whether the spare stays", () => {
  it("M1's status reporting the operation abandoned closes M2's and removes its folder", async () => {
    const r = await rig();
    const folder = join(r.stateDir, "handover", OP);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "received.db.partial"), "left over");
    await abandonHandover(r.m1Store, OP, { code: "handover.destination_unreachable", params: {} });
    await r.listen(r.m1App({ restricted: false }));
    await r.start();
    await vi.waitFor(async () => expect((await r.m2Row()).state).toBe("abandoned"));
    expect(existsSync(folder)).toBe(false);
    expect(await readHandoverEvent(suite.node, r.m2, OP, "abandoned")).not.toBeNull();
    const reads = r.statusReads();
    await settle();
    expect(r.statusReads()).toBe(reads);
    expect(r.copyReads()).toBe(0);
  });

  it("a folder that cannot be removed is logged, and the operation still closes", async () => {
    const r = await rig();
    await abandonHandover(r.m1Store, OP, { code: "handover.destination_unreachable", params: {} });
    await r.listen(r.m1App({ restricted: false }));
    vi.mocked(rm).mockRejectedValueOnce(new Error("the folder is held"));
    await r.start();
    await vi.waitFor(async () => expect((await r.m2Row()).state).toBe("abandoned"));
    expect(JSON.stringify(logLines)).toContain("the folder is held");
  });

  it("a folder that can never be removed does not hold the operation open", async () => {
    const r = await rig();
    await abandonHandover(r.m1Store, OP, { code: "handover.destination_unreachable", params: {} });
    await r.listen(r.m1App({ restricted: false }));
    vi.mocked(rm).mockRejectedValue(new Error("the folder is held"));
    try {
      await r.start();
      await vi.waitFor(async () => expect((await r.m2Row()).state).toBe("abandoned"));
    } finally {
      vi.mocked(rm).mockReset();
    }
  });

  it("a restricted M1 that reports abandoned closes M2's too", async () => {
    const r = await rig();
    await abandonHandover(r.m1Store, OP, { code: "handover.superseded_during_start", params: {} });
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: r.m1,
        operationId: null,
        kind: "superseded",
        successorNodeId: r.m2,
        membershipTerm: 4,
      }),
    );
    await r.listen(r.m1App({ restricted: true }));
    await r.start();
    await vi.waitFor(async () => expect((await r.m2Row()).state).toBe("abandoned"));
    expect(r.copyReads()).toBe(0);
  });

  it("a read landing between M1's prepared and its stepdown keeps M2 waiting, and the fetch then succeeds", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.listen(r.m1App({ restricted: false }));
    await r.start({ compare });
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.not_stepped_down"),
    );
    await settle();
    expect((await r.m2Row()).state).toBe("prepared");

    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect((await r.m2Row()).state).toBe("prepared");
  });

  it("M1's status showing a restriction keeps M2 from closing", async () => {
    const r = await rig();
    await r.stepDownM1();
    // Status alone: the copy routes answer nothing, so only the restriction is in view.
    await r.listen(r.m1App({ restricted: false }));
    await r.start();
    await vi.waitFor(() => expect(r.statusReads()).toBeGreaterThan(1));
    await settle();
    expect((await r.m2Row()).state).toBe("prepared");
  });

  it("M1 holding no record of the operation keeps M2 waiting", async () => {
    const r = await rig();
    await r.listen(r.m1App({ restricted: false }), (url, real) =>
      url === "/api/node/peer-status" ? statusFor(r, { requestedOperation: null }) : real,
    );
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.operation_unknown"),
    );
    expect((await r.m2Row()).state).toBe("prepared");
  });

  it("a refused status read is followed through to the code the box's copy route gives", async () => {
    const r = await rig();
    // M1 can verify no query from a box its stored keys and chart do not vouch for.
    await r.stepDownM1();
    const app = r.m1App({ restricted: true });
    await r.listen(app, (url, real) =>
      url === "/api/node/peer-status"
        ? (_req, res) => {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: { code: "handover.peer_unknown", params: {} } }));
          }
        : url.endsWith("/indicator")
          ? (_req, res) => {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: { code: "handover.peer_unknown", params: {} } }));
            }
          : real,
    );
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.peer_unknown"),
    );
  });

  it("an answer that is not a refusal this duty knows waits as unreachable", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: false }));
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
  });

  it("an indicator that is not JSON is not fetched past", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url.endsWith("/indicator") ? (_req, res) => void res.end("not json") : real,
    );
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    expect(r.copyReads()).toBe(0);
  });

  it("an indicator past its limit is given up on, and one with room to spare is not", async () => {
    const r = await rig();
    await r.stepDownM1();
    let size = 5 * 1024 * 1024;
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url.endsWith("/indicator")
        ? (_req, res) => void res.end(JSON.stringify("x".repeat(size)))
        : real,
    );
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.start({ compare });
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    await settle();
    expect(r.copyReads()).toBe(0);

    size = 3 * 1024 * 1024;
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
  });

  it.each([
    ["another operation's id", (s: Reported) => ({ ...s, operationId: OTHER_OP })],
    [
      "a status naming another destination",
      (s: Reported) => ({ ...s, destinationNodeId: OTHER_OP }),
    ],
    ["a status naming another source", (s: Reported) => ({ ...s, sourceNodeId: OTHER_OP })],
    ["the destination's role", (s: Reported) => ({ ...s, role: "destination" })],
    ["another scenario", (s: Reported) => ({ ...s, scenario: "emergency" })],
    ["a missing field", (s: Reported) => ({ ...s, sourceNodeId: undefined })],
  ])("a signed abandoned status with %s does not close M2", async (_label, alter) => {
    const r = await rig();
    const reported = alter({
      operationId: OP,
      role: "source",
      scenario: "controlled",
      state: "abandoned",
      sourceNodeId: r.m1,
      destinationNodeId: r.m2,
    } as Reported);
    await r.listen(r.m1App({ restricted: false }), (url, real) =>
      url === "/api/node/peer-status"
        ? statusFor(r, { requestedOperation: reported as unknown as CanonicalValue })
        : real,
    );
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    await settle();
    expect((await r.m2Row()).state).toBe("prepared");
    expect(r.copyReads()).toBe(0);
  });

  it.each([
    // Passes the shape check, since this state fits a source in an emergency.
    ["another scenario", { scenario: "emergency", state: "source_superseded" }],
    ["a state no box records", { state: "nonsense" }],
    ["a state no source records", { state: "copy_accepted" }],
  ])("a signed status with %s is not fetched past", async (_label, parts) => {
    const r = await rig();
    await r.stepDownM1();
    const reported = {
      operationId: OP,
      role: "source",
      scenario: "controlled",
      sourceNodeId: r.m1,
      destinationNodeId: r.m2,
      ...parts,
    };
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url === "/api/node/peer-status"
        ? statusFor(r, { requestedOperation: reported as unknown as CanonicalValue })
        : real,
    );
    await r.start({ compare });
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    await settle();
    expect(r.copyReads()).toBe(0);
    expect(compare).not.toHaveBeenCalled();
  });

  it("a status signed by the wrong box does not close M2", async () => {
    const r = await rig();
    await r.listen(r.m1App({ restricted: false }), (url, real) =>
      url === "/api/node/peer-status"
        ? statusFor(
            r,
            {
              requestedOperation: {
                operationId: OP,
                role: "source",
                scenario: "controlled",
                state: "abandoned",
                sourceNodeId: r.m1,
                destinationNodeId: r.m2,
              },
            },
            { nodeId: r.m2, privateKey: r.m2Key },
          )
        : real,
    );
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    expect((await r.m2Row()).state).toBe("prepared");
  });
});

type Reported = Record<string, unknown> & { sourceNodeId: string };

/** A correctly signed status from M1 (or `signer`) with the given parts, echoing the query's nonce. */
function statusFor(
  r: Awaited<ReturnType<typeof rig>>,
  parts: Record<string, CanonicalValue>,
  signer: { nodeId: string; privateKey: string } = { nodeId: r.m1, privateKey: r.m1Key },
): RequestListener {
  return (req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const { nonce } = (JSON.parse(raw) as { body: { nonce: string } }).body;
      const body = {
        heldMembership: null,
        restriction: null,
        openOperation: null,
        requestedOperation: null,
        nonce,
        ...parts,
      };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(signEnvelope("status", body, signer)));
    });
  };
}

describe("what the duty works on", () => {
  it("stops when the operation leaves prepared", async () => {
    const r = await rig();
    await r.listen(r.m1App({ restricted: false }));
    const duty = (await r.start())!;
    await vi.waitFor(() => expect(r.statusReads()).toBeGreaterThan(0));
    await advanceHandover(r.m2Store, OP, "copy_accepted", {});
    await settle();
    const reads = r.statusReads();
    await settle();
    expect(r.statusReads()).toBe(reads);
    // Asleep, not ended: an offer can still give it work.
    duty.wake();
    await settle();
    expect(r.statusReads()).toBe(reads);
  });

  it("is woken by a new operation it found no work for at its start", async () => {
    const r = await rig();
    await advanceHandover(r.m2Store, OP, "abandoned", {});
    await r.listen(r.m1App({ restricted: false }));
    const duty = (await r.start())!;
    await settle();
    expect(r.statusReads()).toBe(0);
    await beginHandover(r.m2Store, r.binding(OTHER_OP), "destination");
    await settle();
    expect(r.statusReads()).toBe(0);
    duty.wake();
    await vi.waitFor(() => expect(r.statusReads()).toBeGreaterThan(0));
  });

  it("leaves a destination operation on a box that is not a mirror alone, and logs it", async () => {
    const r = await rig({ mode: "primary" });
    await writeFile(join(r.stateDir, "venue-marker"), "the live data");
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const duty = await r.start();
    await settle();
    // Failing case: the started duty, its status reads and a received file.
    expect(duty).toBeUndefined();
    expect(r.requests).toEqual([]);
    expect(existsSync(r.received())).toBe(false);
    expect(JSON.stringify(logLines)).toContain("handover-destination.not_a_mirror");
  });

  it("logs nothing on a box already activated: that is where a destination's operation stays", async () => {
    const r = await rig({ mode: "primary" });
    for (const state of ["copy_accepted", "filing_assumed", "activated"] as const) {
      await advanceHandover(r.m2Store, OP, state, {});
    }
    expect(await r.start()).toBeUndefined();
    expect(JSON.stringify(logLines)).not.toContain("handover-destination.not_a_mirror");
  });

  it("starts no duty and logs nothing on another box with no destination operation", async () => {
    const r = await rig({ mode: "primary" });
    await advanceHandover(r.m2Store, OP, "abandoned", {});
    expect(await r.start()).toBeUndefined();
    expect(JSON.stringify(logLines)).not.toContain("handover-destination.not_a_mirror");
  });

  it("a box promoted while the duty runs fetches nothing more", async () => {
    const r = await rig();
    await r.listen(r.m1App({ restricted: false }));
    await r.start();
    await vi.waitFor(() => expect(r.statusReads()).toBeGreaterThan(0));
    await setNodeMode({ venue: r.db, node: suite.node }, r.m2, "primary");
    await settle();
    const reads = r.statusReads();
    await settle();
    expect(r.statusReads()).toBe(reads);
    expect(JSON.stringify(logLines)).toContain("handover-destination.not_a_mirror");
  });

  it("leaves a source operation on this box alone", async () => {
    const r = await rig();
    await advanceHandover(r.m2Store, OP, "abandoned", {});
    await beginHandover(r.m2Store, r.binding(OTHER_OP), "source");
    await r.listen(r.m1App({ restricted: false }));
    await r.start();
    await settle();
    expect(r.requests).toEqual([]);
  });

  it("leaves an emergency operation alone", async () => {
    const r = await rig();
    await advanceHandover(r.m2Store, OP, "abandoned", {});
    await beginHandover(
      r.m2Store,
      { ...r.binding(OTHER_OP), scenario: "emergency" },
      "destination",
    );
    await r.listen(r.m1App({ restricted: false }));
    await r.start();
    await settle();
    expect(r.requests).toEqual([]);
  });

  it("writes a waiting reason only when it changes", async () => {
    const r = await rig();
    await r.listen(r.m1App({ restricted: false }));
    vi.mocked(waitHandover).mockClear();
    await r.start();
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.not_stepped_down"),
    );
    await settle();
    expect(vi.mocked(waitHandover).mock.calls.map((call) => call[2])).toEqual([
      "handover.not_stepped_down",
    ]);
  });

  it("a failed pass is logged and the next one still runs", async () => {
    const r = await rig();
    await r.listen(r.m1App({ restricted: false }));
    let first = true;
    const compare = vi.fn(async () => {
      if (first) {
        first = false;
        throw new Error("a stand-in failure");
      }
      return { ok: true as const };
    });
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    await r.start({ compare });
    await vi.waitFor(() => expect(JSON.stringify(logLines)).toContain("a stand-in failure"), {
      timeout: 10_000,
    });
    const reads = r.statusReads();
    await vi.waitFor(() => expect(r.statusReads()).toBeGreaterThan(reads));
  });
});

describe("a stop or a changed row while a request is out", () => {
  it("a stop landing during the status read sends nothing more, and the stop returns", async () => {
    const r = await rig();
    await r.stepDownM1();
    let releaseStatus = () => {};
    const statusHeld = new Promise<void>((resolve) => (releaseStatus = resolve));
    const neverAnswered: ServerResponse[] = [];
    await r.listen(r.m1App({ restricted: true }), (url, real) => {
      if (url === "/api/node/peer-status") {
        return (req, res) => void statusHeld.then(() => real(req, res));
      }
      if (url.endsWith("/indicator")) return (_req, res) => void neverAnswered.push(res);
      return real;
    });
    const duty = (await r.start())!;
    await vi.waitFor(() => expect(r.statusReads()).toBe(1));

    const stopped = duty.stop().then(() => "stopped");
    releaseStatus();
    const outcome = await Promise.race([
      stopped,
      new Promise((resolve) => setTimeout(() => resolve("still running"), 3_000)),
    ]);
    for (const res of neverAnswered) res.destroy();

    expect(outcome).toBe("stopped");
    expect(r.requests).toEqual(["/api/node/peer-status"]);
    expect((await r.m2Row()).waitingReason).toBeNull();
  });

  it("a compare is handed the row as it stands, not as the pass first read it", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.start({ compare });
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const [operation] = compare.mock.calls[0] as unknown as [{ waitingReason: string | null }];
    expect(operation.waitingReason).toBeNull();
  });

  it("an operation replaced during the status read is not fetched", async () => {
    const r = await rig();
    await r.stepDownM1();
    let releaseStatus = () => {};
    const statusHeld = new Promise<void>((resolve) => (releaseStatus = resolve));
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url === "/api/node/peer-status"
        ? (req, res) => void statusHeld.then(() => real(req, res))
        : real,
    );
    await r.start();
    await vi.waitFor(() => expect(r.statusReads()).toBe(1));
    await advanceHandover(r.m2Store, OP, "replaced", {});
    releaseStatus();
    await settle();
    expect(r.requests).toEqual(["/api/node/peer-status"]);
    expect((await r.m2Row()).waitingReason).toBeNull();
  });

  /** A real download that runs `after` once the whole file sits at its final name. */
  const downloadThen = (after: () => Promise<unknown>) =>
    vi.fn(async (...args: Parameters<typeof boxDownload>) => {
      const answer = await boxDownload(...args);
      await after();
      return answer;
    });

  it("an operation replaced during the download is not compared, and its folder goes", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const compare = vi.fn(async () => ({ ok: true as const }));
    const download = downloadThen(() => advanceHandover(r.m2Store, OP, "replaced", {}));
    await r.start({ compare, download });
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await vi.waitFor(() => expect(existsSync(join(r.stateDir, "handover", OP))).toBe(false), {
      timeout: 10_000,
    });
    await settle();
    expect(compare).not.toHaveBeenCalled();
    expect(await r.m2Row()).toMatchObject({ state: "replaced", waitingReason: null });
  });

  it("a box promoted during the download compares nothing and keeps no copy", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const compare = vi.fn(async () => ({ ok: true as const }));
    const download = downloadThen(() =>
      setNodeMode({ venue: r.db, node: suite.node }, r.m2, "primary"),
    );
    await r.start({ compare, download });
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await settle();
    expect(compare).not.toHaveBeenCalled();
    expect(existsSync(r.received())).toBe(false);
  });

  it("a stop during a comparison ends it by its signal, and that is not logged as a fault", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    let release = () => {};
    const compare = vi.fn<NonNullable<DestinationDutyDeps["compare"]>>(
      (_operation, _indicator, _path, { signal }) =>
        new Promise((_resolve, reject) => {
          release = () => reject(new Error("released"));
          signal?.addEventListener("abort", () => reject(new Error("stopping")));
        }),
    );
    const duty = (await r.start({ compare }))!;
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    logLines.length = 0;
    const stopped = duty.stop().then(() => "stopped");
    const answer = await Promise.race([
      stopped,
      new Promise((resolve) => setTimeout(() => resolve("still comparing"), 1000)),
    ]);
    release();
    await stopped;
    // Failing case, a comparison told no signal: "still comparing".
    expect(answer).toBe("stopped");
    expect(logLines.filter((line) => line[1] === "handover-destination.pass_failed")).toEqual([]);
  });

  it("a stop landing after the file is whole compares nothing and keeps no copy", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const compare = vi.fn(async () => ({ ok: true as const }));
    let stopping: Promise<void> | undefined;
    const duty = (await r.start({
      compare,
      download: downloadThen(async () => {
        stopping = duty.stop();
      }),
    }))!;
    await vi.waitFor(() => expect(stopping).toBeDefined(), { timeout: 10_000 });
    await stopping;
    expect(compare).not.toHaveBeenCalled();
    expect(existsSync(r.received())).toBe(false);
  });

  it.each([
    [
      "throws",
      async () => {
        throw new Error("the connection was lost");
      },
    ],
    ["is refused", async () => ({ status: 409, text: "{}" })],
  ])(
    "an operation replaced during a download that %s gets no waiting reason",
    async (_label, outcome) => {
      const r = await rig();
      await r.stepDownM1();
      await r.listen(r.m1App({ restricted: true }));
      const download = vi.fn(async () => {
        await advanceHandover(r.m2Store, OP, "replaced", {});
        return outcome();
      });
      await r.start({ download: download as typeof boxDownload });
      await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1), { timeout: 10_000 });
      await settle();
      expect(await r.m2Row()).toMatchObject({ state: "replaced", waitingReason: null });
    },
  );
});

describe("the folder of an operation that closed", () => {
  it("an operation replaced after its file was fetched loses its folder", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.start({ compare });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await settle();
    // Control: an open operation's file stays through several passes.
    expect(existsSync(r.received())).toBe(true);
    await advanceHandover(r.m2Store, OP, "replaced", {});
    await vi.waitFor(() => expect(existsSync(join(r.stateDir, "handover", OP))).toBe(false));
  });

  it("a start removes what a closed destination operation left, and nothing else", async () => {
    const r = await rig();
    const folderOf = (name: string) => join(r.stateDir, "handover", name);
    const fill = async (name: string) => {
      await mkdir(folderOf(name), { recursive: true });
      await writeFile(join(folderOf(name), "received.db"), "a whole venue");
    };
    const THIRD_OP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const NO_ROW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await advanceHandover(r.m2Store, OP, "replaced", {});
    await beginHandover(r.m2Store, r.binding(OTHER_OP), "destination");
    await advanceHandover(r.m2Store, OTHER_OP, "abandoned", {});
    await beginHandover(r.m2Store, r.binding(THIRD_OP), "source");
    await advanceHandover(r.m2Store, THIRD_OP, "abandoned", {});
    await Promise.all([OP, OTHER_OP, THIRD_OP, NO_ROW].map(fill));
    await r.start();
    await vi.waitFor(() => expect(existsSync(folderOf(OTHER_OP))).toBe(false));
    expect(existsSync(folderOf(OP))).toBe(false);
    // A source's folder is its capture, and a folder with no row is nothing this duty knows.
    expect(existsSync(folderOf(THIRD_OP))).toBe(true);
    expect(existsSync(folderOf(NO_ROW))).toBe(true);
  });

  it("a closed operation's folder that cannot be removed is logged, and the next wake tries again", async () => {
    const r = await rig();
    await advanceHandover(r.m2Store, OP, "replaced", {});
    const folder = join(r.stateDir, "handover", OP);
    await mkdir(folder, { recursive: true });
    vi.mocked(rm).mockRejectedValueOnce(new Error("the folder is held"));
    const duty = (await r.start())!;
    await vi.waitFor(() => expect(JSON.stringify(logLines)).toContain("the folder is held"));
    expect(existsSync(folder)).toBe(true);
    duty.wake();
    await vi.waitFor(() => expect(existsSync(folder)).toBe(false));
  });
});

describe("the chart", () => {
  it("is read once a pass while the old box is asked for its status", async () => {
    const r = await rig();
    const atEachAsk: number[] = [];
    await r.listen(new Hono(), (url, real) => {
      if (url === "/api/node/peer-status") atEachAsk.push(chartReads.count);
      return real;
    });
    await r.start();
    await vi.waitFor(() => expect(atEachAsk.length).toBeGreaterThan(3), { timeout: 10_000 });
    const betweenAsks = atEachAsk.slice(1, 4).map((reads, index) => reads - atEachAsk[index]!);
    // Failing case, the address and the key each reading it: 2 between each ask.
    expect(betweenAsks).toEqual([1, 1, 1]);
  });
});

describe("a compare that throws", () => {
  it("is tried again on the same file, which is not fetched again, until it succeeds", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    let failures = 2;
    const compare = vi.fn(async () => {
      if (failures-- > 0) throw new Error("a stand-in failure");
      return { ok: true as const };
    });
    await r.start({ compare, compareRetryMs: TICK_MS });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(3), { timeout: 10_000 });
    const reads = r.statusReads();
    await vi.waitFor(() => expect(r.statusReads()).toBeGreaterThan(reads + 2));
    expect(compare).toHaveBeenCalledTimes(3);
    expect(r.copyReads()).toBe(1);
    expect(existsSync(r.received())).toBe(true);
    const [first, , last] = compare.mock.calls as unknown as unknown[][];
    expect(last![1]).toEqual(first![1]);
    expect(last![2]).toBe(r.received());
  });

  it("is not tried again before its limit, however often the duty ticks or is woken", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const compare = vi.fn(async () => {
      throw new Error("a stand-in failure");
    });
    const duty = (await r.start({ compare }))!;
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    duty.wake();
    await settle();
    duty.wake();
    await settle();
    expect(compare).toHaveBeenCalledTimes(1);
    expect(r.copyReads()).toBe(1);
  });

  const refusing = (reason: ErrorCode, detail: CanonicalValue = {}) =>
    ({ ok: false, reason, detail }) as const;

  it("a refusal the limit holds comes round again at sixty seconds, and not a moment before", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    let clock = 1000;
    const compare = vi.fn(async () => refusing("handover.backup_settings_differ"));
    await r.start({ compare, monotonicNow: () => clock });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    clock += 59_999;
    await settle();
    expect(compare).toHaveBeenCalledTimes(1);
    clock += 1;
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(2));
    await settle();
    expect(compare).toHaveBeenCalledTimes(2);
    expect(r.copyReads()).toBe(1);
  });

  it("a throw is held to the same sixty seconds", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    let clock = 1000;
    const compare = vi.fn(async () => {
      throw new Error("a stand-in failure");
    });
    await r.start({ compare, monotonicNow: () => clock });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    clock += 59_999;
    await settle();
    expect(compare).toHaveBeenCalledTimes(1);
    clock += 1;
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(2));
  });

  it.each(["handover.copy_mismatch", "handover.copy_damaged"] as const)(
    "%s discards the file and fetches again on the next tick, whatever the limit",
    async (reason) => {
      const r = await rig();
      await r.stepDownM1();
      await r.listen(r.m1App({ restricted: true }));
      let refuseAgain = true;
      const held: boolean[] = [];
      const compare = vi.fn(async (_operation: unknown, _indicator: unknown, path: string) => {
        held.push(existsSync(path));
        return refuseAgain ? refusing(reason) : { ok: true as const };
      });
      // No tick of its own, so nothing can fetch again before the file's absence is read.
      const duty = (await r.start({ compare, monotonicNow: () => 1000, tickMs: 3_600_000 }))!;
      await vi.waitFor(async () => expect((await r.m2Row()).waitingReason).toBe(reason), {
        timeout: 10_000,
      });
      expect(existsSync(r.received())).toBe(false);
      const ticking = setInterval(() => duty.wake(), TICK_MS);
      onTestFinished(() => clearInterval(ticking));
      await vi.waitFor(() => expect(r.copyReads()).toBeGreaterThan(1), { timeout: 10_000 });
      await vi.waitFor(() => expect(compare.mock.calls.length).toBeGreaterThan(1));
      refuseAgain = false;
      await vi.waitFor(async () => expect((await r.m2Row()).waitingReason).toBeNull(), {
        timeout: 10_000,
      });
      expect(held.every(Boolean)).toBe(true);
      await vi.waitFor(() => expect(existsSync(r.received())).toBe(true));
    },
  );

  it.each([
    "handover.indicator_untrusted",
    "handover.indicator_mismatch",
    "provisioning.database_ahead",
    "handover.modules_differ",
    "handover.chain_broken",
    "handover.copy_check_failed",
    "handover.backup_settings_differ",
    "handover.key_ring_mismatch",
    "handover.destination_settings_unreadable",
    "handover.preparation_state_too_large",
    "handover.summary_mismatch",
    "handover.summary_unreadable",
    "handover.copy_lacks_destination",
    "handover.authoriser_not_permitted",
  ] as const)("%s keeps the file and writes its reason once", async (reason) => {
    vi.mocked(waitHandover).mockClear();
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const compare = vi.fn(async () => refusing(reason, { field: "a detail" }));
    await r.start({ compare, compareRetryMs: TICK_MS });
    await vi.waitFor(() => expect(compare.mock.calls.length).toBeGreaterThan(3), {
      timeout: 10_000,
    });
    expect(await r.m2Row()).toMatchObject({ state: "prepared", waitingReason: reason });
    expect(existsSync(r.received())).toBe(true);
    expect(r.copyReads()).toBe(1);
    const writes = vi.mocked(waitHandover).mock.calls.filter(([, , written]) => written === reason);
    expect(writes).toHaveLength(1);
    expect(JSON.stringify(logLines)).toContain("a detail");
  });

  it("a refusal that gives way to another writes the new reason, and success clears it", async () => {
    vi.mocked(waitHandover).mockClear();
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const answers: CompareOutcome[] = [
      refusing("handover.backup_settings_differ"),
      refusing("handover.modules_differ"),
      { ok: true },
    ];
    const compare = vi.fn(async () => answers.shift()!);
    await r.start({ compare, compareRetryMs: TICK_MS });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(3), { timeout: 10_000 });
    await vi.waitFor(async () => expect((await r.m2Row()).waitingReason).toBeNull());
    await settle();
    expect(compare).toHaveBeenCalledTimes(3);
    expect(r.copyReads()).toBe(1);
    expect(existsSync(r.received())).toBe(true);
    expect(vi.mocked(waitHandover).mock.calls.map(([, , written]) => written)).toEqual([
      "handover.backup_settings_differ",
      "handover.modules_differ",
      null,
    ]);
  });

  it("a copy accepted with no reason standing writes no reason", async () => {
    vi.mocked(waitHandover).mockClear();
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.start({ compare });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await settle();
    expect(vi.mocked(waitHandover)).not.toHaveBeenCalled();
  });

  it("an operation closed while its reason is being cleared is not compared, and keeps no file", async () => {
    const r = await rig();
    const compare = vi.fn(async () => ({ ok: true as const }));
    await r.start({ compare });
    await vi.waitFor(async () =>
      expect((await r.m2Row()).waitingReason).toBe("handover.source_unreachable"),
    );
    // Failing case: compare is told `prepared` while the stored row says `replaced`.
    vi.mocked(waitHandover).mockImplementationOnce(async (deps, operationId, reason) => {
      expect(reason).toBeNull();
      await advanceHandover(deps, operationId, "replaced", {});
    });
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    await vi.waitFor(async () => expect((await r.m2Row()).state).toBe("replaced"), {
      timeout: 10_000,
    });
    await settle();
    expect(compare).not.toHaveBeenCalled();
    expect(existsSync(r.received())).toBe(false);
  });

  it("an operation closed during a compare that refuses gets no reason", async () => {
    const r = await rig();
    await r.stepDownM1();
    await r.listen(r.m1App({ restricted: true }));
    const compare = vi.fn(async () => {
      await advanceHandover(r.m2Store, OP, "replaced", {});
      return refusing("handover.modules_differ");
    });
    await r.start({ compare });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await settle();
    expect(await r.m2Row()).toMatchObject({ state: "replaced", waitingReason: null });
  });

  it("M1's abandoned still closes the operation while a compare keeps failing", async () => {
    const r = await rig();
    await r.stepDownM1();
    let reportAbandoned = false;
    await r.listen(r.m1App({ restricted: true }), (url, real) =>
      url === "/api/node/peer-status" && reportAbandoned
        ? statusFor(r, {
            requestedOperation: {
              operationId: OP,
              role: "source",
              scenario: "controlled",
              state: "abandoned",
              sourceNodeId: r.m1,
              destinationNodeId: r.m2,
            },
          })
        : real,
    );
    const compare = vi.fn(async () => {
      throw new Error("a stand-in failure");
    });
    await r.start({ compare });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    reportAbandoned = true;
    await vi.waitFor(async () => expect((await r.m2Row()).state).toBe("abandoned"));
    expect(existsSync(join(r.stateDir, "handover", OP))).toBe(false);
  });
});
