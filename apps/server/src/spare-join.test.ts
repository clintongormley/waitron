import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { Server as NetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deletePairLinkTx,
  loadKeyRing,
  sealNodeSigningKeyTx,
  writePairLinkTx,
  type KeyRing,
} from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  insertReservedNodeTx,
  nodes,
  withNodeTransaction,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import {
  buildNextMembershipDocument,
  endorseKey,
  generateNodeKeyPair,
  verifyEndorsement,
} from "@waitron/membership";
import { NODE_MIGRATIONS, readPairLink, type PairLink } from "@waitron/node-db";
import { TLS_CLIENT_CERT_FILE, TLS_CLIENT_KEY_FILE, TLS_DIR } from "@waitron/store";
import { checkPeersAtStart } from "./boot-peer-check.js";
import { caCertPath } from "./box-secrets.js";
import {
  issueClientCert,
  mintSelfSignedServerCert,
  reissueServerLeaf,
} from "./self-signed-cert.js";
import { runSpareJoin, type SpareJoinDeps } from "./spare-join.js";
import { startStoreListener, type StoreListener } from "./spare-pipe.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xe).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const MAIN = "node-main";
const SPARE = "node-spare";
const OTHER_SPARE = "node-spare-2";
const PAIR = { accessKeyId: "waitron0123456789abcdef", secretAccessKey: "ab".repeat(32) };

describe("runSpareJoin", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS], timeoutMs: 60_000 });
  let db: Database;
  let stateDir: string;
  const mainKeys = generateNodeKeyPair();
  const spareKeys = generateNodeKeyPair();
  const otherKeys = generateNodeKeyPair();
  let logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  let running: { controller: AbortController; done: Promise<void> } | undefined;

  beforeAll(async () => {
    db = suite.db;
    stateDir = await mkdtemp(join(tmpdir(), "waitron-spare-join-"));
  });

  afterAll(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    logs = [];
    await withNodeTransaction(suite.node, (tx) =>
      sealNodeSigningKeyTx(tx, RING, MAIN, mainKeys.privateKey),
    );
    await db.insert(nodes).values({
      id: MAIN,
      name: "Bar Pepe",
      filingModule: "none",
      taxModule: "tax-es",
      publicKey: mainKeys.publicKey,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    running?.controller.abort();
    await running?.done;
    running = undefined;
  });

  async function link(peerNodeId: string, peerPublicKey: string, storeUrl = "https://spare:7443") {
    await withNodeTransaction(suite.node, (tx) =>
      writePairLinkTx(tx, RING, MAIN, {
        role: "streams",
        state: "pending",
        peerNodeId,
        peerPublicKey,
        storeUrl,
        venueId: "venue-7",
        ...PAIR,
      }),
    );
  }

  const nodeRow = async (id: string) =>
    (await db.select().from(nodes).where(eq(nodes.id, id)))[0] ?? null;

  function run(overrides: Partial<SpareJoinDeps> = {}) {
    const controller = new AbortController();
    const reload = vi.fn(async () => {});
    const done = runSpareJoin({
      db,
      node: suite.node,
      ring: RING,
      nodeId: MAIN,
      stateDir,
      stream: { reload },
      intervalMs: 5_000,
      log: (level, event, fields) => logs.push({ level, event, fields }),
      signal: controller.signal,
      ...overrides,
    });
    running = { controller, done };
    return { reload, stop: async () => (controller.abort(), done) };
  }

  it("writes the spare's row and starts streaming once its store answers", async () => {
    await link(SPARE, spareKeys.publicKey);
    const answers = [false, true];
    const probed: PairLink[] = [];
    const probe = vi.fn(async (target: PairLink) => {
      probed.push(target);
      return answers.shift() ?? true;
    });
    const r = run({ probe, intervalMs: 1 });
    await vi.waitFor(() => expect(r.reload).toHaveBeenCalledTimes(1));
    await r.stop();

    expect(probed[0]).toMatchObject({ peerNodeId: SPARE, state: "pending", venueId: "venue-7" });
    const row = await nodeRow(SPARE);
    expect(row).toMatchObject({
      id: SPARE,
      name: "Bar Pepe (standby)",
      filingModule: "none",
      taxModule: "tax-es",
      publicKey: spareKeys.publicKey,
    });
    expect(row!.endorsement).toEqual(
      endorseKey(SPARE, spareKeys.publicKey, MAIN, mainKeys.privateKey),
    );
    expect(verifyEndorsement(row!.endorsement!, mainKeys.publicKey)).toBe(true);
    expect((await readPairLink(suite.node, MAIN))?.state).toBe("streaming");
    expect(logs.map((l) => l.event)).toContain("spare.joined");
  });

  it("a pending spare whose store never answers is not a counted peer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await link(SPARE, spareKeys.publicKey);
    const probe = vi.fn(async () => false);
    const r = run({ probe });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(probe).toHaveBeenCalledTimes(7);
    await r.stop();
    vi.useRealTimers();

    const joined = async (id: string) => (await nodeRow(id)) !== null;
    expect(await joined(SPARE)).toBe(false);
    const held = buildNextMembershipDocument({
      heldDocument: null,
      minTerm: 1,
      nodes: [
        { nodeId: MAIN, contactUrl: "https://main.example", standing: "serving-primary" },
        { nodeId: SPARE, contactUrl: "https://spare.example", standing: "serving-secondary" },
      ],
      signerNodeId: MAIN,
      signerPrivateKey: mainKeys.privateKey,
      endorsements: [endorseKey(SPARE, spareKeys.publicKey, MAIN, mainKeys.privateKey)],
    });
    const result = await checkPeersAtStart({
      held,
      nodeId: MAIN,
      ownOrigin: "https://main.example",
      joined,
      activatedFrom: new Set(),
      ask: async () => null,
      accept: async () => {
        throw new Error("no chart to accept");
      },
      openOperation: false,
    });
    expect(result).toBe("proceed");
    expect((await readPairLink(suite.node, MAIN))?.state).toBe("pending");
    expect(r.reload).not.toHaveBeenCalled();
  });

  it("a crash after the row and before the link is repaired by the next run", async () => {
    await link(SPARE, spareKeys.publicKey);
    const endorsement = endorseKey(SPARE, spareKeys.publicKey, MAIN, mainKeys.privateKey);
    await withTransaction(db, (tx) =>
      insertReservedNodeTx(tx, {
        id: SPARE,
        name: "Bar Pepe (standby)",
        filingModule: "none",
        taxModule: "tax-es",
        publicKey: spareKeys.publicKey,
        endorsement,
      }),
    );
    const r = run({ probe: async () => true, intervalMs: 1 });
    await vi.waitFor(() => expect(r.reload).toHaveBeenCalledTimes(1));
    await r.stop();

    expect(await db.select().from(nodes).where(eq(nodes.id, SPARE))).toHaveLength(1);
    expect((await nodeRow(SPARE))?.endorsement).toEqual(endorsement);
    expect((await readPairLink(suite.node, MAIN))?.state).toBe("streaming");
  });

  it("refuses a spare whose row holds another key, and leaves its link pending", async () => {
    await link(SPARE, spareKeys.publicKey);
    await withTransaction(db, (tx) =>
      insertReservedNodeTx(tx, {
        id: SPARE,
        name: "Bar Pepe (standby)",
        filingModule: "none",
        taxModule: "tax-es",
        publicKey: otherKeys.publicKey,
        endorsement: endorseKey(SPARE, otherKeys.publicKey, MAIN, mainKeys.privateKey),
      }),
    );
    const probe = vi.fn(async () => true);
    const r = run({ probe, intervalMs: 1 });
    await vi.waitFor(() => expect(logs.map((l) => l.event)).toContain("spare.join_key_mismatch"));
    await r.stop();

    expect(logs.find((l) => l.event === "spare.join_key_mismatch")).toMatchObject({
      level: "error",
      fields: { peerNodeId: SPARE },
    });
    expect(logs.filter((l) => l.event === "spare.join_key_mismatch")).toHaveLength(1);
    expect((await nodeRow(SPARE))?.publicKey).toBe(otherKeys.publicKey);
    expect((await readPairLink(suite.node, MAIN))?.state).toBe("pending");
    expect(r.reload).not.toHaveBeenCalled();
  });

  it("a second join's link replaces a pending one", async () => {
    await link(SPARE, spareKeys.publicKey);
    const probe = vi.fn(async (target: PairLink) => target.peerNodeId === OTHER_SPARE);
    const r = run({ probe, intervalMs: 1 });
    await vi.waitFor(() => expect(probe).toHaveBeenCalled());
    await link(OTHER_SPARE, otherKeys.publicKey, "https://spare-2:7443");
    await vi.waitFor(() => expect(r.reload).toHaveBeenCalledTimes(1));
    await r.stop();

    expect(await nodeRow(SPARE)).toBeNull();
    expect((await nodeRow(OTHER_SPARE))?.publicKey).toBe(otherKeys.publicKey);
    expect(await readPairLink(suite.node, MAIN)).toMatchObject({
      peerNodeId: OTHER_SPARE,
      state: "streaming",
    });
  });

  it("a link replaced while the probe ran leaves no row", async () => {
    await link(SPARE, spareKeys.publicKey);
    const probed: string[] = [];
    const probe = vi.fn(async (target: PairLink) => {
      probed.push(target.peerNodeId);
      if (target.peerNodeId === SPARE) {
        await link(OTHER_SPARE, otherKeys.publicKey, "https://spare-2:7443");
        return true;
      }
      return false;
    });
    const r = run({ probe, intervalMs: 1 });
    // The pass after the first probe has ended once the next one probes, or once a join reloads.
    await vi.waitFor(() =>
      expect(probe.mock.calls.length + r.reload.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    await r.stop();

    expect(probed[0]).toBe(SPARE);
    expect(await nodeRow(SPARE)).toBeNull();
    expect(await nodeRow(OTHER_SPARE)).toBeNull();
    expect(await readPairLink(suite.node, MAIN)).toMatchObject({
      peerNodeId: OTHER_SPARE,
      state: "pending",
    });
    expect(r.reload).not.toHaveBeenCalled();
  });

  it("keeps asking after a pass that fails", async () => {
    await link(SPARE, spareKeys.publicKey);
    const probe = vi
      .fn<(link: PairLink) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("probe broke"))
      .mockResolvedValue(true);
    const r = run({ probe, intervalMs: 1 });
    await vi.waitFor(() => expect(r.reload).toHaveBeenCalledTimes(1));
    await r.stop();

    expect(logs.find((l) => l.event === "spare.join_failed")?.level).toBe("warn");
    expect((await readPairLink(suite.node, MAIN))?.state).toBe("streaming");
  });

  describe("the probe through the store pipe", () => {
    let listener: StoreListener | undefined;
    let upstream: Server | undefined;

    /** The servers listening now that were not when it was called. A closed server stops
     *  `listening` at once, where Node's public resource list keeps it for a moment. */
    function openedServers(): () => NetServer[] {
      const servers = () =>
        (process as unknown as { _getActiveHandles(): unknown[] })
          ._getActiveHandles()
          .filter((handle): handle is NetServer => handle instanceof NetServer && handle.listening);
      const before = new Set(servers());
      return () => servers().filter((server) => !before.has(server));
    }

    afterEach(async () => {
      await listener?.close();
      await new Promise((resolve) => (upstream ? upstream.close(resolve) : resolve(undefined)));
      listener = undefined;
      upstream = undefined;
    });

    it("a store nobody answers is no join", async () => {
      await mkdir(join(stateDir, TLS_DIR), { recursive: true });
      await writeFile(caCertPath(stateDir), "not reached");
      await link(SPARE, spareKeys.publicKey, "https://box-5c21.waitron.local:7443");
      const r = run({
        storeLookup: async () => {
          throw new AppError("mirror.peer_unresolved", {});
        },
        intervalMs: 60_000,
      });
      await vi.waitFor(
        () => expect(logs.map((l) => l.event)).toContain("spare.store_probe_refused"),
        { timeout: 10_000 },
      );
      await r.stop();

      expect(logs.find((l) => l.event === "spare.store_probe_refused")?.fields).toEqual({
        reason: "backup.stream_request_failed",
      });
      expect(await nodeRow(SPARE)).toBeNull();
      expect((await readPairLink(suite.node, MAIN))?.state).toBe("pending");
    });

    it("a store that stays silent is warned about once, however often it is asked", async () => {
      await mkdir(join(stateDir, TLS_DIR), { recursive: true });
      await writeFile(caCertPath(stateDir), "not reached");
      await link(SPARE, spareKeys.publicKey, "https://box-5c21.waitron.local:7443");
      let lookups = 0;
      const r = run({
        storeLookup: async () => {
          lookups += 1;
          throw new AppError("mirror.peer_unresolved", {});
        },
        intervalMs: 1,
      });
      // One probe makes at most three requests (the bucket client's `maxAttempts`), each looking
      // the name up once, so ten lookups span at least four probes.
      await vi.waitFor(() => expect(lookups).toBeGreaterThanOrEqual(10), { timeout: 10_000 });
      await r.stop();

      expect(logs.filter((l) => l.event === "stream.spare_store_refused")).toEqual([
        {
          level: "warn",
          event: "stream.spare_store_refused",
          fields: { reason: "mirror.peer_unresolved" },
        },
      ]);
      expect(logs.filter((l) => l.event === "spare.store_probe_refused")).toHaveLength(1);
    });

    it("stopping leaves no pipe listening", async () => {
      await mkdir(join(stateDir, TLS_DIR), { recursive: true });
      await writeFile(caCertPath(stateDir), "not reached");
      await link(SPARE, spareKeys.publicKey, "https://box-5c21.waitron.local:7443");
      const opened = openedServers();
      const r = run({
        storeLookup: async () => {
          throw new AppError("mirror.peer_unresolved", {});
        },
        intervalMs: 60_000,
      });
      await vi.waitFor(
        () => expect(logs.map((l) => l.event)).toContain("spare.store_probe_refused"),
        { timeout: 10_000 },
      );
      expect(opened()).toHaveLength(1);
      await r.stop();

      expect(opened()).toHaveLength(0);
    });

    it("a link replaced or removed closes its pipe", async () => {
      await mkdir(join(stateDir, TLS_DIR), { recursive: true });
      await writeFile(caCertPath(stateDir), "not reached");
      await link(SPARE, spareKeys.publicKey, "https://box-5c21.waitron.local:7443");
      const opened = openedServers();
      const asked: string[] = [];
      const r = run({
        storeLookup: async (hostname) => {
          asked.push(hostname);
          throw new AppError("mirror.peer_unresolved", {});
        },
        intervalMs: 1,
      });
      await vi.waitFor(() => expect(asked).toContain("box-5c21.waitron.local"), {
        timeout: 10_000,
      });
      await link(OTHER_SPARE, otherKeys.publicKey, "https://box-9d04.waitron.local:7443");
      await vi.waitFor(() => expect(asked).toContain("box-9d04.waitron.local"), {
        timeout: 10_000,
      });
      expect(opened()).toHaveLength(1);

      await withNodeTransaction(suite.node, (tx) => deletePairLinkTx(tx, MAIN));
      await vi.waitFor(() => expect(opened()).toHaveLength(0));
      await r.stop();
    });

    it("asks the spare's store with the pair's key, and an answer refusing it is no join", async () => {
      const now = new Date();
      const venue = mintSelfSignedServerCert({
        hostnames: ["waitron.local"],
        ipAddresses: [],
        now,
      });
      const leaf = reissueServerLeaf({
        caCertPem: venue.caCertPem,
        caKeyPem: venue.caKeyPem,
        hostnames: ["box-5c21.waitron.local"],
        ipAddresses: ["127.0.0.1"],
        now,
      });
      const client = issueClientCert({
        caCertPem: venue.caCertPem,
        caKeyPem: venue.caKeyPem,
        hostname: "box-7f3a.waitron.local",
        now,
      });
      await mkdir(join(stateDir, TLS_DIR), { recursive: true });
      await writeFile(caCertPath(stateDir), venue.caCertPem);
      await writeFile(join(stateDir, TLS_CLIENT_CERT_FILE), client.clientCertPem);
      await writeFile(join(stateDir, TLS_CLIENT_KEY_FILE), client.clientKeyPem);
      await writeFile(join(stateDir, "spare.pem"), leaf.serverCertPem + leaf.serverKeyPem);
      const seen: IncomingMessage[] = [];
      upstream = createHttpServer((req, res) => {
        seen.push(req);
        res.writeHead(403, { "content-type": "application/xml" });
        res.end(
          '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>no</Message></Error>',
        );
      });
      await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
      listener = await startStoreListener({
        port: 0,
        host: "127.0.0.1",
        certFile: join(stateDir, "spare.pem"),
        keyFile: join(stateDir, "spare.pem"),
        caFile: caCertPath(stateDir),
        peerHostname: "box-7f3a.waitron.local",
        upstreamPort: (upstream.address() as AddressInfo).port,
        log: () => {},
      });
      await link(SPARE, spareKeys.publicKey, `https://box-5c21.waitron.local:${listener.port}`);

      const r = run({
        storeLookup: async () => ({ addresses: ["127.0.0.1"], remembered: false }),
        intervalMs: 60_000,
      });
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 10_000 });
      await vi.waitFor(() =>
        expect(logs.map((l) => l.event)).toContain("spare.store_probe_refused"),
      );
      await r.stop();

      expect(seen[0]!.url).toMatch(/^\/waitron\/waitron-probe\//);
      expect(seen[0]!.headers.authorization).toContain(`Credential=${PAIR.accessKeyId}/`);
      expect(logs.find((l) => l.event === "spare.store_probe_refused")?.fields).toEqual({
        reason: "access_denied",
      });
      expect(await nodeRow(SPARE)).toBeNull();
      expect((await readPairLink(suite.node, MAIN))?.state).toBe("pending");
      expect(r.reload).not.toHaveBeenCalled();
    });
  });
});
