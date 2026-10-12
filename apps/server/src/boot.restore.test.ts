import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { X509Certificate } from "node:crypto";
import { connect as tlsConnect } from "node:tls";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  nodeSealedState,
  openVenueDatabase,
  readNodeMembership,
  setDeploymentMode,
  writeMirrorConfig,
  writeNodeMembership,
  stampDeployment,
  withTransaction,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { establishNodeIdentity } from "./node-identity.js";
import { REBUILD_MARKER } from "./rebuild-first-start.js";
import { unsealNodeState } from "./sealed-state.js";
import { STREAM_PURPOSE } from "./stream-host.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { freePort, freePorts } from "./testing/free-ports.js";
import { readRecoveryState } from "./recovery-state.js";
import {
  TILL_ENV,
  TRADING_STATE_DIR,
  KEY_ENV,
  seedSharedVenue,
  copyMigrationsRoot,
  freshVenue,
  awaitListening,
  httpsVia,
  fetchHealthOk,
  type LogLine,
  withCapturedStdout,
  withMockedKill,
  waitForEvent,
  seedTradingVenue,
} from "./testing/boot-harness.js";

/**
 * `undici`'s `fetch` rejects here as it does in `boot.test.ts`, so no boot in this file reaches the
 * network through it; `Agent` passes through untouched. The global `fetch` this file uses against its
 * own server is Node's built-in one, which this mock does not replace.
 */
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(
        new Error(
          "undici fetch disabled in boot.restore.test.ts — see the comment above this mock",
        ),
      ),
    ),
  };
});

/**
 * The shared, migrated venue directory every boot below points `WAITRON_VENUE_DIR` at, plus the
 * suite's own open handle on it. The suite migrates it, not boot, because the identity rows have to
 * exist before boot reads them.
 */
let migrationsRoot: string;
let sharedVenueDir: string;
let sharedStore: VenueDatabase;
let sharedDb: Database;

beforeAll(async () => {
  sharedVenueDir = await mkdtemp(join(tmpdir(), "waitron-boot-venue-"));
  await applyMigrations(sharedVenueDir, migrationOptionsFor(manifestSets(), null));
  sharedStore = await openVenueDatabase(sharedVenueDir);
  sharedDb = sharedStore.venue;
  await seedSharedVenue(sharedDb);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-boot-migrations-"));
  await copyMigrationsRoot(migrationsRoot);
}, 180_000);

// A `beforeAll` that threw before a `mkdtemp` returned must not add an `rm(undefined)` failure beside
// the real one.
afterAll(async () => {
  if (sharedStore !== undefined) await sharedStore.close();
  if (sharedVenueDir !== undefined) await rm(sharedVenueDir, { recursive: true, force: true });
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  await rm(TRADING_STATE_DIR, { recursive: true, force: true });
});

/** The certificate the listener on `port` presents to a client that trusts `ca`. */
async function servedCertificate(port: number, ca: Buffer): Promise<X509Certificate> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ port, host: "127.0.0.1", ca, servername: "localhost" }, () => {
      const certificate = socket.getPeerX509Certificate();
      socket.destroy();
      if (certificate === undefined) reject(new Error("no certificate presented"));
      else resolve(certificate);
    });
    socket.once("error", reject);
  });
}

describe("startServer, against a migrated venue directory", () => {
  it("locks this node's state files into the venue database at a trading start", async () => {
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-sealed-"));
    const key = "boot-recovery-key-0123";
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
    });
    // The one required file `ensureBoxSecrets` does not write; only its presence matters here.
    await writeFile(join(stateDir, "trading.env"), "WAITRON_TILL_NODE_ID=boot-sealed\n");
    const server = await startServer(
      {
        ...KEY_ENV,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      },
      // The raw process env, which boot merges over the state files when it reads the key.
      { WAITRON_BACKUP_RECOVERY_KEY: key },
    );
    const { via, close } = httpsVia(await readFile(join(stateDir, "tls", "ca.crt")));
    try {
      // Listening, so `close()` below has a listener to shut.
      await fetchHealthOk(`https://127.0.0.1:${port}/health`, via);
      const rows = await sharedDb
        .select({ sealed: nodeSealedState.sealed })
        .from(nodeSealedState)
        .where(eq(nodeSealedState.nodeId, TILL_ENV.WAITRON_TILL_NODE_ID));
      expect(rows).toHaveLength(1);
      const entries = unsealNodeState(rows[0]!.sealed, key);
      expect(entries.map((e) => e.name)).toEqual([
        "manifest.json",
        ...RECOVERY_FILES.map((rel) => `secrets/${rel}`),
        "secrets/modules.json",
      ]);
    } finally {
      await server.close();
      await close();
      await sharedDb.delete(nodeSealedState);
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("raises the sealed-state alert when the start's refresh of that row fails", async () => {
    const venue = await freshVenue();
    const db = venue.store.venue;
    await seedTradingVenue(db);
    const [admin] = await db
      .insert(persons)
      .values({
        displayName: "Sealed Admin",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
        email: "sealed-admin@example.test",
        role: "admin",
      })
      .returning({ id: persons.id });
    const session = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: admin!.id }),
    );
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-sealed-failed-"));
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
    });
    // No `trading.env`: one of the files the row must carry is missing, so the refresh fails.
    const server = await startServer(
      {
        ...KEY_ENV,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: venue.directory,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      },
      { WAITRON_BACKUP_RECOVERY_KEY: "boot-recovery-key-0123" },
    );
    const { via, close } = httpsVia(await readFile(join(stateDir, "tls", "ca.crt")));
    try {
      await fetchHealthOk(`https://127.0.0.1:${port}/health`, via);
      const response = await fetch(`https://127.0.0.1:${port}/management-api/alerts`, {
        ...via,
        headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { alerts: { code: string }[] };
      expect(body.alerts.map((alert) => alert.code)).toContain("backup.sealed_state_failed");
    } finally {
      await server.close();
      await close();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  // Boot's wiring of the first start after a restore (rebuild-first-start.ts): the listener must
  // read the certificate AFTER the first start re-issues it, and the contact address must be this
  // machine's advertised origin.
  it("finishes a restore at its first trading start: it serves a certificate for this machine's addresses and signs the next term", async () => {
    const venue = await freshVenue();
    const db = venue.store.venue;
    await seedTradingVenue(db);
    const ring = loadKeyRing(KEY_ENV);
    await establishNodeIdentity({ ownerDb: db, ring }, TILL_ENV.WAITRON_TILL_NODE_ID);
    await seedTermZeroMembership(
      { db, ring },
      TILL_ENV.WAITRON_TILL_NODE_ID,
      "https://old-box.example",
    );
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-first-start-"));
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
      listIpv4: () => ["192.168.1.10"],
    });
    await writeFile(
      join(stateDir, REBUILD_MARKER),
      JSON.stringify({ version: 1, source: "archive" }),
    );
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venue.directory,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_BOX_ADDRESSES: "10.1.2.3",
      WAITRON_ADVERTISED_ORIGIN: "https://box.example.test",
    });
    try {
      await awaitListening(port);
      const served = await servedCertificate(port, await readFile(join(stateDir, "tls", "ca.crt")));
      expect(served.subjectAltName).toContain("IP Address:10.1.2.3");
      expect(served.subjectAltName).not.toContain("192.168.1.10");
      expect(existsSync(join(stateDir, REBUILD_MARKER))).toBe(false);
      const held = await readNodeMembership(db);
      expect(held!.body.term).toBe(1);
      expect(held!.body.nodes).toEqual([
        {
          nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
          contactUrl: "https://box.example.test",
          standing: "serving-primary",
        },
      ]);
    } finally {
      await server.close();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  // The marker is written here rather than by a real restore: both restores leave the same file
  // through `writeValidated` (restore.ts), differing only in `source`.
  it.each(["archive", "stream"] as const)(
    "refuses to start after a %s restore whose membership document no longer matches its signature",
    async (source) => {
      const venue = await freshVenue();
      const db = venue.store.venue;
      await seedTradingVenue(db);
      const ring = loadKeyRing(KEY_ENV);
      await establishNodeIdentity({ ownerDb: db, ring }, TILL_ENV.WAITRON_TILL_NODE_ID);
      await seedTermZeroMembership(
        { db, ring },
        TILL_ENV.WAITRON_TILL_NODE_ID,
        "https://old-box.example",
      );
      const held = (await readNodeMembership(db))!;
      const intruder = {
        nodeId: "c0000000-0000-4000-8000-00000000000f",
        contactUrl: "https://intruder.example",
        standing: "serving-secondary" as const,
      };
      await writeNodeMembership(db, {
        ...held,
        body: { ...held.body, nodes: [...held.body.nodes, intruder] },
      });
      const tampered = await readNodeMembership(db);
      const port = await freePort();
      const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-first-start-refused-"));
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { "fiscal-none": false } }),
      );
      await ensureBoxSecrets({
        stateDir,
        hostnames: ["waitron.local", "localhost"],
        now: () => new Date(),
        listIpv4: () => ["192.168.1.10"],
      });
      const leafBefore = await readFile(join(stateDir, "tls", "server.crt"));
      await writeFile(join(stateDir, REBUILD_MARKER), JSON.stringify({ version: 1, source }));
      try {
        await expect(
          startServer({
            ...KEY_ENV,
            WAITRON_STATE_DIR: stateDir,
            WAITRON_VENUE_DIR: venue.directory,
            WAITRON_HTTP_PORT: String(port),
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_ENV: "preproduction",
            WAITRON_BOX_ADDRESSES: "10.1.2.3",
          }),
        ).rejects.toMatchObject({
          code: "restore.membership_invalid",
          params: { reason: "bad_signature" },
        });
        expect(await readNodeMembership(db)).toEqual(tampered);
        expect(await readFile(join(stateDir, "tls", "server.crt"))).toEqual(leafBefore);
        expect(existsSync(join(stateDir, REBUILD_MARKER))).toBe(true);
      } finally {
        await venue.store.close();
        await rm(venue.directory, { recursive: true, force: true });
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  // Damage rather than a wrong signature: the stored text is not JSON, or it is JSON that is not a
  // document. With a peer configured, the held document is also read before the peer is asked. The
  // fenced case would otherwise come up read-only and put off its restore's signature check, as a
  // mirror does.
  it.each([
    { damage: "unreadable JSON", document: "{not json", withPeer: false, asMirror: false },
    { damage: "unreadable JSON", document: "{not json", withPeer: true, asMirror: false },
    { damage: "unreadable JSON", document: "{not json", withPeer: false, asMirror: true },
    {
      damage: "a machine list that is not a list",
      document: "list",
      withPeer: false,
      asMirror: false,
    },
    { damage: "the JSON value null", document: "null", withPeer: false, asMirror: false },
    {
      damage: "a fencing standing and a key no document has",
      document: "fenced",
      withPeer: false,
      asMirror: false,
    },
  ])(
    "refuses a restore whose membership document holds $damage with restore.membership_invalid (peer: $withPeer, mirror: $asMirror)",
    async ({ document, withPeer, asMirror }) => {
      const venue = await freshVenue();
      const db = venue.store.venue;
      await seedTradingVenue(db);
      const ring = loadKeyRing(KEY_ENV);
      await establishNodeIdentity({ ownerDb: db, ring }, TILL_ENV.WAITRON_TILL_NODE_ID);
      await seedTermZeroMembership(
        { db, ring },
        TILL_ENV.WAITRON_TILL_NODE_ID,
        "https://old-box.example",
      );
      const held = (await readNodeMembership(db))!;
      const stored =
        document === "list"
          ? JSON.stringify({
              ...held,
              body: { ...held.body, nodes: { first: held.body.nodes[0] } },
            })
          : document === "fenced"
            ? JSON.stringify({
                ...held,
                body: {
                  ...held.body,
                  nodes: held.body.nodes.map((n) => ({ ...n, standing: "sell-only" })),
                },
                extra: true,
              })
            : document;
      await db.execute(sql`update node_membership set document = ${stored} where id = 1`);
      // Demoting a fenced node writes its role, and so does making one a mirror: `requireStamp`
      // refuses both on an unstamped database.
      if (document === "fenced" || asMirror) await stampDeployment(db, "preproduction");
      if (asMirror) await setDeploymentMode(db, TILL_ENV.WAITRON_TILL_NODE_ID, "mirror");
      const [port, deadPeerPort] = await freePorts(2);
      if (withPeer) {
        await writeMirrorConfig(db, TILL_ENV.WAITRON_TILL_NODE_ID, {
          relayUrl: `http://127.0.0.1:${deadPeerPort}`,
          boxHostname: "waitron.local",
          boxCaPem: "unused",
          originNodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        });
      }
      const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-first-start-damaged-"));
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { "fiscal-none": false } }),
      );
      await ensureBoxSecrets({
        stateDir,
        hostnames: ["waitron.local", "localhost"],
        now: () => new Date(),
        listIpv4: () => ["192.168.1.10"],
      });
      const leafBefore = await readFile(join(stateDir, "tls", "server.crt"));
      await writeFile(
        join(stateDir, REBUILD_MARKER),
        JSON.stringify({ version: 1, source: "stream" }),
      );
      try {
        await expect(
          startServer({
            ...KEY_ENV,
            WAITRON_STATE_DIR: stateDir,
            WAITRON_VENUE_DIR: venue.directory,
            WAITRON_HTTP_PORT: String(port),
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_ENV: "preproduction",
            WAITRON_BOX_ADDRESSES: "10.1.2.3",
          }),
        ).rejects.toMatchObject({
          code: "restore.membership_invalid",
          params: { reason: "malformed" },
        });
        const [row] = (
          await db.execute<{ document: string }>(
            sql`select document from node_membership where id = 1`,
          )
        ).rows;
        expect(row?.document).toBe(stored);
        expect(await readFile(join(stateDir, "tls", "server.crt"))).toEqual(leafBefore);
        expect(existsSync(join(stateDir, REBUILD_MARKER))).toBe(true);
      } finally {
        await venue.store.close();
        await rm(venue.directory, { recursive: true, force: true });
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("keeps selling when a restore's first start fails, and raises restore.first_start_failed", async () => {
    const venue = await freshVenue();
    const db = venue.store.venue;
    await seedTradingVenue(db);
    const [admin] = await db
      .insert(persons)
      .values({
        displayName: "First Start Admin",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
        email: "first-start-admin@example.test",
        role: "admin",
      })
      .returning({ id: persons.id });
    const session = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: admin!.id }),
    );
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-first-start-failed-"));
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
    });
    await writeFile(
      join(stateDir, REBUILD_MARKER),
      JSON.stringify({ version: 1, source: "stream" }),
    );
    // A bucket copy set up, and no membership document: a copy that tried to start would read off
    // with the reason `no_membership`, so `first_start_pending` shows it was held first.
    await withTransaction(db, (tx) =>
      putCredential(tx, loadKeyRing(KEY_ENV), {
        purpose: STREAM_PURPOSE,
        value: {
          venueId: "venue-1",
          endpoint: "https://127.0.0.1:1",
          region: "eu-south-2",
          bucket: "venue-copies",
          prefix: "-",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secret-example",
        },
      }),
    );
    const [server, failed] = await withCapturedStdout(async (lines) => {
      const started = await startServer({
        ...KEY_ENV,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: venue.directory,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      });
      return [started, await waitForEvent(lines, "restore.first_start_failed")] as const;
    });
    const { via, close } = httpsVia(await readFile(join(stateDir, "tls", "ca.crt")));
    try {
      // Nothing listens on the bucket's port, so reading its pointer fails before any term is signed.
      expect(failed.errorCode).toBe("backup.stream_request_failed");
      const health = await fetchHealthOk(`https://127.0.0.1:${port}/health`, via);
      expect(health.status).toBe(200);
      expect(((await health.json()) as { stream: unknown }).stream).toEqual({
        state: "off",
        reason: "first_start_pending",
        stateSince: expect.any(String),
      });
      const node = await fetch(`https://127.0.0.1:${port}/api/node`, via);
      expect(node.status).toBe(200);
      expect(await node.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        acceptingSales: true,
      });
      const response = await fetch(`https://127.0.0.1:${port}/management-api/alerts`, {
        ...via,
        headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { alerts: { code: string }[] };
      expect(body.alerts.map((alert) => alert.code)).toContain("restore.first_start_failed");
      expect(body.alerts.map((alert) => alert.code)).not.toContain("backup.stream_stopped");
      expect(existsSync(join(stateDir, REBUILD_MARKER))).toBe(true);
    } finally {
      await server.close();
      await close();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  for (const [what, drop] of [
    ["raises append_only.triggers_restored when a start put back a dropped trigger", true],
    ["raises no append_only.triggers_restored for an untouched venue", false],
  ] as const) {
    it(
      what,
      async () => {
        const venue = await freshVenue();
        const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-triggers-restored-"));
        let server: StartedServer | undefined;
        let close = async () => {};
        try {
          const db = venue.store.venue;
          await seedTradingVenue(db);
          const [admin] = await db
            .insert(persons)
            .values({
              displayName: "Restored Trigger Admin",
              pinHash: hashPin("1234"),
              passwordHash: hashPassword("dashPass123"),
              email: "restored-trigger-admin@example.test",
              role: "admin",
            })
            .returning({ id: persons.id });
          const session = await withTransaction(db, (tx) =>
            startManagementSession(tx, { personId: admin!.id }),
          );
          await venue.store.close();
          if (drop) {
            const raw = new DatabaseSync(join(venue.directory, "venue.db"), { timeout: 5000 });
            try {
              raw.exec("drop trigger sales_append_only_delete");
            } finally {
              raw.close();
            }
          }
          await writeFile(
            join(stateDir, "modules.json"),
            JSON.stringify({ modules: { "fiscal-none": false } }),
          );
          await ensureBoxSecrets({
            stateDir,
            hostnames: ["waitron.local", "localhost"],
            now: () => new Date(),
          });
          const port = await freePort();
          server = await startServer({
            ...KEY_ENV,
            WAITRON_STATE_DIR: stateDir,
            WAITRON_VENUE_DIR: venue.directory,
            WAITRON_HTTP_PORT: String(port),
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_ENV: "preproduction",
          });
          const https = httpsVia(await readFile(join(stateDir, "tls", "ca.crt")));
          close = https.close;
          await (await fetchHealthOk(`https://127.0.0.1:${port}/health`, https.via)).body?.cancel();
          const response = await fetch(`https://127.0.0.1:${port}/management-api/alerts`, {
            ...https.via,
            headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
          });
          expect(response.status).toBe(200);
          const body = (await response.json()) as { alerts: { code: string; severity: string }[] };
          const restored = body.alerts.filter(
            (alert) => alert.code === "append_only.triggers_restored",
          );
          expect(restored).toEqual(drop ? [expect.objectContaining({ severity: "warning" })] : []);
        } finally {
          await server?.close().catch(() => {});
          await close();
          await venue.store.close();
          await rm(venue.directory, { recursive: true, force: true });
          await rm(stateDir, { recursive: true, force: true });
        }
      },
      60_000,
    );
  }
});

describe("startServer — the append-only watch in trading mode", () => {
  const INTERVAL_MS = 50;
  const UPDATE = "sales_append_only_update";

  /** A seeded trading venue of its own, so a tampered trigger reaches no other test. */
  async function startWatched() {
    const venue = await freshVenue();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-append-only-state-"));
    const cleanup = async () => {
      await rm(venue.directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    };
    let server: StartedServer | undefined;
    try {
      await seedTradingVenue(venue.store.venue);
      await venue.store.close();
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { "fiscal-none": false } }),
      );
      const port = await freePort();
      server = await startServer(
        {
          ...KEY_ENV,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_VENUE_DIR: venue.directory,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "preproduction",
        },
        {},
        { appendOnlyWatch: { intervalMs: INTERVAL_MS } },
      );
      await awaitListening(port);
    } catch (error) {
      // A listener that never bound rejects its close; the original error is the one to report.
      await server?.close().catch(() => {});
      await venue.store.close();
      await cleanup();
      throw error;
    }
    return {
      server,
      stateDir,
      cleanup,
      /** The timeout lets the DDL wait out a boot duty's write rather than fail SQLITE_BUSY. */
      tamper: (statements: string) => {
        const raw = new DatabaseSync(join(venue.directory, "venue.db"), { timeout: 5_000 });
        try {
          raw.exec(statements);
        } finally {
          raw.close();
        }
      },
    };
  }

  for (const [what, statements, refusedTriggers] of [
    [
      "replaced",
      `drop trigger ${UPDATE}; create trigger ${UPDATE} before update on sales begin select 1; end;`,
      { missing: [], altered: [UPDATE] },
    ],
    ["dropped", `drop trigger ${UPDATE};`, { missing: [UPDATE], altered: [] }],
  ] as const) {
    it(`keeps an untouched box trading, then stops it and records the refusal for the next start when a trigger is ${what}`, async () => {
      await withMockedKill(async (kills) => {
        const box = await startWatched();
        try {
          await delay(INTERVAL_MS * 5);
          expect(kills).toEqual([]);

          box.tamper(statements);
          await vi.waitFor(() => expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]), {
            timeout: 5_000,
          });
          expect(await readRecoveryState(box.stateDir)).toMatchObject({
            refused: true,
            level: "recovery",
            lastErrorCode: "append_only.triggers_changed",
            refusedTriggers,
          });
          // The file the recovery page's log tail reads (`resolveLogDir`, beside the state folder).
          const logged = (await readFile(join(box.stateDir, "logs", "waitron.log"), "utf8"))
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as LogLine & Record<string, unknown>);
          expect(logged).toContainEqual(
            expect.objectContaining({ level: "error", event: "append_only.triggers_changed" }),
          );
        } finally {
          await box.server.close();
          await box.cleanup();
        }
      });
    }, 60_000);
  }

  it("stops watching once the server is closed", async () => {
    await withMockedKill(async (kills) => {
      const box = await startWatched();
      try {
        await box.server.close();
        // A watch left running reads the closed store, which throws, so it logs and never refuses.
        const lines = await withCapturedStdout(async (captured) => {
          box.tamper(`drop trigger ${UPDATE};`);
          await delay(INTERVAL_MS * 5);
          return captured;
        });
        expect(kills).toEqual([]);
        expect(lines.filter((line) => line.includes('"event":"append_only.'))).toEqual([]);
      } finally {
        await box.cleanup();
      }
    });
  }, 60_000);
});
