import { hashPassword, hashPin, persons } from "@waitron/identity";
import type { Hono } from "hono";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  openVenueDatabase,
  stampDeployment,
  withTransaction,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { locationId as brandLocationId } from "@waitron/shared";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  readContentLanguages,
  writeContentLanguages,
} from "@waitron/catalogue";
import { runTunnelClient } from "@waitron/tunnel";
import { startServer, type StartedServer } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { buildConfigurationBundle, encodeConfigurationBundle } from "./configuration-transfer.js";
import { provisionVenue, venueModuleConfig } from "./provision.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, signPointer } from "@waitron/stream";
import { loadTillConfig } from "./till-config.js";
import type { TillConfig } from "./till-config.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { loadBoxEnv } from "./box-env.js";
import { offerProducts } from "./testing/zone-offers.js";
import { freePort, freePorts } from "./testing/free-ports.js";
import {
  TRADING_STATE_DIR,
  KEY_ENV,
  seedSharedVenue,
  copyMigrationsRoot,
  freshVenue,
  awaitListening,
  httpsVia,
  POLL_TRIES,
  POLL_INTERVAL_MS,
  poll,
  withCapturedStdout,
  withMockedKill,
  provisionVenueBody,
  parseEnvLines,
  waitForEvent,
  startFakeSmtp,
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
          "undici fetch disabled in boot.setup-routes.test.ts — see the comment above this mock",
        ),
      ),
    ),
  };
});

/**
 * `boot.ts` imports `runTunnelClient` directly, with no injection seam. The tunnel tests observe the
 * call through this spy, which calls through to the real client so `close()`'s teardown runs for
 * real.
 */
vi.mock("@waitron/tunnel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/tunnel")>();
  return {
    ...actual,
    runTunnelClient: vi.fn(actual.runTunnelClient),
  };
});

/**
 * Every bucket call the setup routes make is wrapped by `boundObjectStore`. This passes through to
 * the real wrapper, shortening its bound only while a test sets `bucketBound.timeoutMs`, so a test
 * can point a route at a bucket that never answers and see the route give up.
 */
const bucketBound = vi.hoisted(() => ({ timeoutMs: undefined as number | undefined }));
vi.mock("./bounded-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bounded-store.js")>();
  return {
    ...actual,
    boundObjectStore: (store: Parameters<typeof actual.boundObjectStore>[0], timeoutMs?: number) =>
      actual.boundObjectStore(store, bucketBound.timeoutMs ?? timeoutMs),
  };
});

/**
 * Passes through to the real `mountManagementApi`, keeping the app the latest boot mounted it on so a
 * test can send it a request in-process.
 */
const managementMount = vi.hoisted(() => ({ app: undefined as Hono | undefined }));
vi.mock("./management-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./management-api.js")>();
  return {
    ...actual,
    mountManagementApi: (...args: Parameters<typeof actual.mountManagementApi>) => {
      managementMount.app = args[0];
      return actual.mountManagementApi(...args);
    },
  };
});

/**
 * Passes through to the real credential reads, holding a read of the mail settings inside its
 * transaction for `delayMs` while a test sets it.
 */
const mailSettingsRead = vi.hoisted(() => ({ delayMs: undefined as number | undefined }));
vi.mock("@waitron/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/credentials")>();
  return {
    ...actual,
    tryGetCredential: async (...args: Parameters<typeof actual.tryGetCredential>) => {
      const delayMs = mailSettingsRead.delayMs;
      if (delayMs !== undefined && args[2].purpose === "email.smtp") {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return actual.tryGetCredential(...args);
    },
  };
});

// The tunnel spy is one shared module mock, so its calls accumulate across tests.
beforeEach(() => {
  vi.mocked(runTunnelClient).mockClear();
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

describe("startServer — background listeners and sinks that fail or close", () => {
  it("logs a tunnel client that rejects, and still closes cleanly", async () => {
    vi.mocked(runTunnelClient).mockImplementationOnce(() =>
      Promise.reject(new Error("tunnel client gave up")),
    );
    await withCapturedStdout(async (lines) => {
      const port = await freePort();
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
        WAITRON_TUNNEL_RELAY_URL: "tcp://127.0.0.1:1",
        WAITRON_TUNNEL_BOX_ID: "box-rejecting",
        WAITRON_TUNNEL_TOKEN: "tunnel-secret",
      });
      try {
        await awaitListening(port);
        expect(await waitForEvent(lines, "tunnel.worker_rejected")).toMatchObject({
          errorCode: "unknown",
          level: "error",
        });
      } finally {
        await expect(server.close()).resolves.toBeUndefined();
      }
    });
  }, 60_000);

  it("serves the plain-HTTP landing page beside a trading boot that holds a minted leaf, and closes it with the server", async () => {
    const [port, landingPort] = await freePorts(2);
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-landing-"));
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
    });
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_LANDING_PORT: String(landingPort),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
    });
    try {
      await awaitListening(landingPort);
      const page = await fetch(`http://127.0.0.1:${landingPort}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toMatch(/^text\/html/);
      expect(await page.text()).toContain("/ca.crt");
      // The listener reads the boot's own state directory: it hands out the CA minted above.
      const ca = await fetch(`http://127.0.0.1:${landingPort}/ca.crt`);
      expect(ca.status).toBe(200);
      expect(await ca.text()).toBe(await readFile(join(stateDir, "tls", "ca.crt"), "utf8"));
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
    await expect(fetch(`http://127.0.0.1:${landingPort}/`)).rejects.toThrow();
  }, 60_000);

  it("warns once on stdout when the log directory cannot be written, and keeps serving", async () => {
    await withCapturedStdout(async (lines) => {
      const port = await freePort();
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
        // Under a non-directory, so the sink's directory can never be created.
        WAITRON_LOG_DIR: "/dev/null/waitron-logs",
      });
      try {
        await awaitListening(port);
        expect(await waitForEvent(lines, "log.file_unavailable")).toMatchObject({
          level: "warn",
        });
        expect((await fetch(`http://127.0.0.1:${port}/api/node`)).status).toBe(200);
        expect(
          lines.filter((line) => line.includes('"event":"log.file_unavailable"')),
        ).toHaveLength(1);
      } finally {
        await server.close();
      }
    });
  }, 60_000);

  it("writes an answered password reset's token and reads the mail settings before close() closes the venue store, then sends its email", async () => {
    const smtp = await startFakeSmtp();
    const venue = await freshVenue();
    try {
      const db = venue.store.venue;
      await seedTradingVenue(db);
      await db.insert(persons).values({
        displayName: "Reset Person",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("resetPass123"),
        email: "reset-person@example.test",
        role: "staff",
      });
      await withTransaction(db, (tx) =>
        putCredential(tx, loadKeyRing(KEY_ENV), {
          purpose: "email.smtp",
          value: {
            url: `smtp://127.0.0.1:${smtp.port}`,
            from: "Waitron <no-reply@example.test>",
          },
        }),
      );
      const port = await freePort();
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: venue.directory,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      });
      try {
        await awaitListening(port);
        mailSettingsRead.delayMs = 50;
        // In-process, so close() starts before the reset's work does.
        const response = await managementMount.app!.request("/management-api/password-reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "reset-person@example.test" }),
        });
        expect(response.status).toBe(202);
        await server.close();
        await vi.waitFor(() => expect(smtp.messages).toHaveLength(1), {
          timeout: POLL_TRIES * POLL_INTERVAL_MS,
        });
        expect(smtp.messages[0]).toMatch(/^To: reset-person@example\.test$/m);
      } finally {
        mailSettingsRead.delayMs = undefined;
        await server.close();
      }
    } finally {
      await smtp.close();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("startServer — setup-mode routes that hand work to the boot's own wiring", () => {
  const ES_MODULE_CONFIG = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "ES-common");

  /** The same venue `provisionVenueBody` describes, with the admin secrets already hashed — the
   * shape `provisionVenue` takes behind the endpoint. */
  function hashedVenueRequest(taxId: string) {
    const { admin, ...venue } = provisionVenueBody(taxId);
    return {
      ...venue,
      admin: {
        displayName: admin.displayName,
        pinHash: hashPin(admin.pin),
        passwordHash: hashPassword(admin.password),
        email: admin.email,
      },
    };
  }

  /** A setup-mode boot over a venue directory, with the restart intercepted and the minted CA
   * trusted; `use` runs while it serves. `extraPortCount` more ports are drawn beside the server's own, so none of
   * them is the server's port. */
  async function withSetupBoot(
    directory: string,
    env: Record<string, string>,
    use: (ctx: {
      post: (path: string, init: RequestInit) => Promise<Response>;
      kills: { pid: number; signal: string | number | undefined }[];
      stateDir: string;
      extraPorts: number[];
    }) => Promise<void>,
    { extraPortCount = 0 } = {},
  ): Promise<void> {
    const [port, ...drawn] = await freePorts(1 + extraPortCount);
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-routes-"));
    try {
      await withMockedKill(async (kills) => {
        const server = await startServer({
          WAITRON_VENUE_DIR: directory,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0",
          ...env,
        });
        const { via, close } = httpsVia(await readFile(join(stateDir, "tls", "ca.crt")));
        try {
          await use({
            post: (path, init) =>
              fetch(`https://127.0.0.1:${port}${path}`, { ...via, method: "POST", ...init }),
            kills,
            stateDir,
            extraPorts: drawn,
          });
        } finally {
          await close();
          await server.close();
        }
      });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }

  it("finishes a provision whose venue had already committed, re-using that venue rather than minting another", async () => {
    const venue = await freshVenue();
    const precommittedStateDir = await mkdtemp(join(tmpdir(), "waitron-boot-precommitted-"));
    try {
      const committed = await provisionVenue(
        {
          ownerDb: venue.store.venue,
          moduleConfig: ES_MODULE_CONFIG,
          database: venue.directory,
          stateDir: precommittedStateDir,
        },
        { environment: "preproduction", venue: hashedVenueRequest("60000010W") },
      );

      await withSetupBoot(venue.directory, {}, async ({ post, kills, stateDir }) => {
        const response = await post("/setup-api/provision", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "demo", venue: provisionVenueBody("60000010W") }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ provisioned: true, restarting: true });
        const trading = parseEnvLines(await readFile(join(stateDir, "trading.env"), "utf8"));
        expect(trading.WAITRON_TILL_NODE_ID).toBe(committed.nodeId);
        expect(trading).not.toHaveProperty("WAITRON_TILL_TILL_ID");
        await poll(() => (kills.length > 0 ? kills.length : undefined));
        expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
      });
      const nodeCount = await venue.store.venue.execute<{ n: number }>(
        sql`select cast(count(*) as int) as n from nodes`,
      );
      expect(nodeCount.rows[0]!.n).toBe(1);
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(precommittedStateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("provisions no till, and the trading start that follows sells from a paired device with no WAITRON_TILL_TILL_ID", async () => {
    const venue = await freshVenue();
    const keptStateDir = await mkdtemp(join(tmpdir(), "waitron-boot-no-till-state-"));
    try {
      let trading: Record<string, string> = {};
      await withSetupBoot(venue.directory, {}, async ({ post, kills, stateDir }) => {
        const response = await post("/setup-api/provision", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "prepare", venue: provisionVenueBody("60000011A") }),
        });
        expect(response.status, await response.clone().text()).toBe(200);
        await poll(() => (kills.length > 0 ? kills.length : undefined));
        // The setup boot's state folder holds the keys the venue was sealed with; it is removed
        // when the setup boot closes, so the trading start runs from a copy.
        await cp(stateDir, keptStateDir, { recursive: true });
        trading = parseEnvLines(await readFile(join(stateDir, "trading.env"), "utf8"));
      });
      expect(trading).not.toHaveProperty("WAITRON_TILL_TILL_ID");
      const deviceRows = await venue.store.venue.execute<{ n: number }>(
        sql`select cast(count(*) as int) as n from devices`,
      );
      expect(deviceRows.rows[0]!.n).toBe(0);

      const cfg: TillConfig = {
        ...loadTillConfig(trading),
        simplifiedInvoiceLimit: null,
      };
      const [profile] = await venue.store.venue
        .select({ id: deviceProfiles.id })
        .from(deviceProfiles)
        .where(eq(deviceProfiles.formFactor, "till"));
      const paired = await enrolDeviceForTest(venue.store.venue, cfg, {
        name: "Barra",
        profileId: profile!.id,
      });
      const [admin] = await venue.store.venue
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));
      const offer = await withTransaction(venue.store.venue, async (tx) => {
        const catalogue = await createCatalogue(tx, { name: "Carta" });
        const drinks = await createCategory(tx, { name: "Bebidas" });
        const water = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: drinks.id,
          name: "Agua",
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
        });
        await assignCatalogueToLocation(tx, brandLocationId(cfg.locationId), catalogue.id);
        const offers = await offerProducts(tx, { locationId: cfg.locationId });
        return offers.offerFor(water.id);
      });

      const port = await freePort();
      const server = await startServer(
        await loadBoxEnv(
          {
            WAITRON_STATE_DIR: keptStateDir,
            WAITRON_VENUE_DIR: venue.directory,
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_HTTP_PORT: String(port),
            WAITRON_HTTP_LANDING_PORT: "0",
          },
          keptStateDir,
        ),
      );
      const { via, close } = httpsVia(await readFile(join(keptStateDir, "tls", "ca.crt")));
      try {
        const base = `https://127.0.0.1:${port}`;
        const deviceCookie = `${DEVICE_COOKIE}=${paired.deviceId}.${paired.token}`;
        const login = await fetch(`${base}/api/session`, {
          ...via,
          method: "POST",
          headers: { "content-type": "application/json", cookie: deviceCookie },
          body: JSON.stringify({ personId: admin!.id, pin: "1234" }),
        });
        expect(login.status, await login.clone().text()).toBe(200);
        const cookies = `${login.headers.get("set-cookie")!.split(";")[0]!}; ${deviceCookie}`;
        const sale = await fetch(`${base}/api/sales`, {
          ...via,
          method: "POST",
          headers: { "content-type": "application/json", cookie: cookies },
          body: JSON.stringify({
            lines: [{ menuItemId: offer, quantity: "1" }],
            tender: { method: "cash", amount: "2.00" },
          }),
        });
        expect(sale.status, await sale.clone().text()).toBe(200);
        const recorded = await venue.store.venue.execute<{ source: string; device_id: string }>(
          sql`select source, device_id from sales`,
        );
        expect(recorded.rows).toEqual([{ source: "device", device_id: paired.deviceId }]);
      } finally {
        await close();
        await server.close();
      }
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(keptStateDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("validates a restore artifact before staging it, refusing one the recovery key cannot open", async () => {
    const venue = await freshVenue();
    try {
      await withSetupBoot(venue.directory, {}, async ({ post, kills, stateDir }) => {
        const response = await post("/setup-api/restore", {
          headers: {
            "content-type": "application/octet-stream",
            "x-waitron-recovery-key": "not-the-key-that-sealed-it",
            "x-waitron-restore-environment": "preproduction",
          },
          body: new Uint8Array(
            encryptArtifact(
              packArchive([{ name: "manifest.json", bytes: Buffer.from("{}") }]),
              "the key that really sealed it",
            ),
          ),
        });
        const body = (await response.json()) as { error?: { code: string } };
        expect(response.status).toBe(422);
        expect(body.error?.code).toBe("recovery.passphrase_invalid");
        await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(kills).toEqual([]);
      });
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  /** A bucket address that accepts connections and never answers. */
  async function withSilentBucket(use: (endpoint: string) => Promise<void>): Promise<void> {
    const sockets = new Set<import("node:net").Socket>();
    const silent = createServer((socket) => sockets.add(socket));
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    bucketBound.timeoutMs = 300;
    try {
      await use(`http://127.0.0.1:${(silent.address() as AddressInfo).port}`);
    } finally {
      bucketBound.timeoutMs = undefined;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => silent.close(resolve));
    }
  }

  const SILENT_BUCKET = {
    region: "eu-west-1",
    bucket: "venue-copy",
    prefix: "",
    accessKeyId: "AKIA",
    secretAccessKey: "secret-0123456789",
  };

  it("refuses a pasted kit it cannot read, and gives up on a bucket that never answers, staging nothing", async () => {
    const venue = await freshVenue();
    try {
      await withSilentBucket(async (endpoint) => {
        await withSetupBoot(venue.directory, {}, async ({ post, kills, stateDir }) => {
          const unreadable = await post("/setup-api/restore-bucket", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kit: "not a recovery kit", environment: "preproduction" }),
          });
          expect(unreadable.status).toBe(400);
          expect(await unreadable.json()).toEqual({
            error: { code: "backup.stream_kit_invalid", params: { reason: "not_found" } },
          });
          const kit = encodeRecoveryKit({
            version: 1,
            venueId: "c0000000-0000-4000-8000-000000000002",
            bucket: { ...SILENT_BUCKET, endpoint },
            recoveryKey: "recovery-key-one-strong",
            pointerSignerPublicKey: "unused",
          });
          const response = await post("/setup-api/restore-bucket", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kit, environment: "preproduction" }),
            signal: AbortSignal.timeout(20_000),
          });
          expect(response.status).toBe(502);
          expect(await response.json()).toMatchObject({
            error: { code: "backup.stream_request_failed", params: { name: "TimedOut" } },
          });
          await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
            code: "ENOENT",
          });
          expect(kills).toEqual([]);
        });
      });
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps a refusing bucket's own error name out of the answer and the log unless it is listed", async () => {
    const venue = await freshVenue();
    const logDir = await mkdtemp(join(tmpdir(), "waitron-boot-bucket-name-logs-"));
    // XML-escaped on the wire; the client decodes it back to the markup.
    let refusal = "";
    const bucket = createHttpServer((_request, response) => {
      response.writeHead(403, { "content-type": "application/xml" });
      response.end(
        `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${refusal}</Code><Message>no</Message></Error>`,
      );
    });
    await new Promise<void>((resolve) => bucket.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(bucket.address() as AddressInfo).port}`;
    const kit = encodeRecoveryKit({
      version: 1,
      venueId: "c0000000-0000-4000-8000-000000000002",
      bucket: { ...SILENT_BUCKET, endpoint },
      recoveryKey: "recovery-key-one-strong",
      pointerSignerPublicKey: "unused",
    });
    try {
      await withCapturedStdout(async (lines) => {
        await withSetupBoot(
          venue.directory,
          { WAITRON_LOG_DIR: logDir },
          async ({ post, kills, stateDir }) => {
            const restore = async (code: string) => {
              refusal = code;
              const response = await post("/setup-api/restore-bucket", {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ kit, environment: "preproduction" }),
              });
              expect(response.status).toBe(502);
              return response.text();
            };
            for (const code of [
              "ProviderSpecificRefusal",
              "sk_live_0123456789abcdefSECRET",
              "&lt;script&gt;alert(1)&lt;/script&gt;",
            ]) {
              const body = await restore(code);
              expect(JSON.parse(body)).toMatchObject({
                error: {
                  code: "backup.stream_request_failed",
                  params: { status: 403, name: "other" },
                },
              });
              for (const raw of ["ProviderSpecificRefusal", "sk_live_", "script"]) {
                expect(body).not.toContain(raw);
              }
            }
            expect(JSON.parse(await restore("AccessDenied"))).toMatchObject({
              error: { params: { status: 403, name: "AccessDenied" } },
            });
            await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
              code: "ENOENT",
            });
            expect(kills).toEqual([]);
          },
        );
        const logged = [lines.join("\n"), await readFile(join(logDir, "waitron.log"), "utf8")];
        for (const text of logged) {
          const refusals = text
            .split("\n")
            .filter((line) => line.includes('"event":"backup.stream_request_failed"'));
          expect(refusals.map((line) => (JSON.parse(line) as { name: string }).name)).toEqual([
            "other",
            "other",
            "other",
            "AccessDenied",
          ]);
          for (const raw of ["ProviderSpecificRefusal", "sk_live_", "script"]) {
            expect(text).not.toContain(raw);
          }
        }
      });
    } finally {
      await new Promise((resolve) => bucket.close(resolve));
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(logDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps a key the bucket lists outside the folder asked for out of the answer and the log", async () => {
    const venue = await freshVenue();
    const logDir = await mkdtemp(join(tmpdir(), "waitron-boot-bucket-key-logs-"));
    const venueId = "c0000000-0000-4000-8000-000000000002";
    const nodeId = "d0000000-0000-4000-8000-000000000003";
    const signer = generateNodeKeyPair();
    const pointer = JSON.stringify(
      signPointer(
        {
          venueId,
          term: 0,
          nodeId,
          generation: `gen-0-${nodeId}-20260923T090000Z`,
          writtenAt: "2026-09-23T09:00:05.000Z",
        },
        signer.privateKey,
      ),
    );
    let stray = "";
    const bucket = createHttpServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://bucket");
      if (url.searchParams.get("list-type") === "2") {
        response.writeHead(200, { "content-type": "application/xml" });
        response.end(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${stray}</Key><LastModified>2026-09-23T10:00:00.000Z</LastModified></Contents></ListBucketResult>`,
        );
      } else if (url.pathname.endsWith("/current.json")) {
        response.writeHead(200, { "content-type": "application/json", etag: '"p1"' });
        response.end(pointer);
      } else {
        response.writeHead(404, { "content-type": "application/xml" });
        response.end(
          `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>no</Message></Error>`,
        );
      }
    });
    await new Promise<void>((resolve) => bucket.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(bucket.address() as AddressInfo).port}`;
    const kit = encodeRecoveryKit({
      version: 1,
      venueId,
      bucket: { ...SILENT_BUCKET, endpoint },
      recoveryKey: "recovery-key-one-strong",
      pointerSignerPublicKey: signer.publicKey,
    });
    const raws = ["StrayProviderFolder", "sk_live_", "script"];
    try {
      await withCapturedStdout(async (lines) => {
        await withSetupBoot(
          venue.directory,
          { WAITRON_LOG_DIR: logDir },
          async ({ post, kills, stateDir }) => {
            for (const key of [
              "elsewhere/StrayProviderFolder/a.ltx",
              "elsewhere/sk_live_0123456789abcdefSECRET",
              // XML-escaped on the wire; the client decodes it back to the markup.
              "elsewhere/&lt;script&gt;alert(1)&lt;/script&gt;",
            ]) {
              stray = key;
              const response = await post("/setup-api/restore-bucket", {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ kit, environment: "preproduction" }),
              });
              expect(response.status).toBe(400);
              const body = await response.text();
              expect(JSON.parse(body)).toEqual({
                error: {
                  code: "backup.stream_name_invalid",
                  params: { field: "listedKey", value: "other" },
                },
              });
              for (const raw of [...raws, "elsewhere"]) expect(body).not.toContain(raw);
            }
            await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
              code: "ENOENT",
            });
            expect(kills).toEqual([]);
          },
        );
        const logged = [lines.join("\n"), await readFile(join(logDir, "waitron.log"), "utf8")];
        for (const text of logged) {
          const refusals = text
            .split("\n")
            .filter((line) => line.includes('"event":"backup.stream_name_invalid"'));
          expect(
            refusals
              .map((line) => JSON.parse(line) as { field: string; value: string })
              .map(({ field, value }) => ({ field, value })),
          ).toEqual([
            { field: "listedKey", value: "other" },
            { field: "listedKey", value: "other" },
            { field: "listedKey", value: "other" },
          ]);
          for (const raw of [...raws, "elsewhere"]) expect(text).not.toContain(raw);
        }
      });
    } finally {
      await new Promise((resolve) => bucket.close(resolve));
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(logDir, { recursive: true, force: true });
    }
  }, 60_000);

  // An archive whose database holds bucket settings may be a copy of a server still selling, so
  // staging it checks that server's bucket first.
  it("asks whether the old server is gone when an archive's bucket never answers, staging nothing", async () => {
    const venue = await freshVenue();
    const source = await freshVenue();
    const vaultKey = Buffer.alloc(32, 5).toString("base64");
    try {
      await withSilentBucket(async (endpoint) => {
        await withTransaction(source.store.venue, (tx) =>
          putCredential(
            tx,
            loadKeyRing({
              WAITRON_CREDENTIALS_KEY: vaultKey,
              WAITRON_CREDENTIALS_KEY_VERSION: "1",
            }),
            {
              purpose: STREAM_PURPOSE,
              value: streamSettingsPayload({
                venueId: "c0000000-0000-4000-8000-000000000002",
                bucket: { ...SILENT_BUCKET, endpoint },
              }),
            },
          ),
        );
        const dump = join(await mkdtemp(join(tmpdir(), "waitron-boot-archive-")), "venue.db");
        await source.store.venue.archiveTo(dump);
        const artifact = encryptArtifact(
          packArchive([
            {
              name: "manifest.json",
              bytes: Buffer.from(
                JSON.stringify({
                  manifestVersion: 1,
                  createdAt: "2026-09-23T09:00:00.000Z",
                  environment: "preproduction",
                  modules: {},
                }),
              ),
            },
            { name: "db.dump", bytes: await readFile(dump) },
            {
              name: "secrets/secrets.env",
              bytes: Buffer.from(
                `WAITRON_CREDENTIALS_KEY=${vaultKey}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
              ),
            },
            {
              name: "secrets/trading.env",
              bytes: Buffer.from(
                [
                  "WAITRON_TILL_NODE_ID=c0000000-0000-4000-8000-000000000008",
                  "WAITRON_TILL_SERIES_ID=c0000000-0000-4000-8000-000000000004",
                  "WAITRON_TILL_LOCATION_ID=c0000000-0000-4000-8000-000000000002",
                  "",
                ].join("\n"),
              ),
            },
          ]),
          "the archive's recovery key",
        );
        await rm(dirname(dump), { recursive: true, force: true });
        await withSetupBoot(venue.directory, {}, async ({ post, kills, stateDir }) => {
          const response = await post("/setup-api/restore", {
            headers: {
              "content-type": "application/octet-stream",
              "x-waitron-recovery-key": "the archive's recovery key",
              "x-waitron-restore-environment": "preproduction",
            },
            body: new Uint8Array(artifact),
            signal: AbortSignal.timeout(20_000),
          });
          expect(response.status).toBe(409);
          expect(await response.json()).toEqual({
            error: { code: "restore.stream_source_unchecked", params: { reason: "bucket" } },
          });
          await expect(readFile(join(stateDir, "restore-request.json"))).rejects.toMatchObject({
            code: "ENOENT",
          });
          expect(kills).toEqual([]);
        });
      });
    } finally {
      await venue.store.close();
      await source.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(source.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses to adopt from a primary it cannot reach", async () => {
    const venue = await freshVenue();
    try {
      await withSetupBoot(
        venue.directory,
        {},
        async ({ post, kills, extraPorts: [unreachable] }) => {
          const response = await post("/setup-api/adopt", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              primaryUrl: `http://127.0.0.1:${unreachable}`,
              credential: { personId: "33333333-3333-4333-8333-333333333333", password: "x" },
            }),
          });
          const body = (await response.json()) as { error?: { code: string } };
          expect(response.status).toBe(502);
          expect(body.error?.code).toBe("mirror.bundle_fetch_failed");
          expect(kills).toEqual([]);
        },
        { extraPortCount: 1 },
      );
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("stages the reset of an adopt that stopped partway and requests a restart", async () => {
    const venue = await freshVenue();
    const personId = "33333333-3333-4333-8333-333333333333";
    const operationId = "44444444-4444-4444-8444-444444444444";
    try {
      await withSetupBoot(venue.directory, {}, async ({ post, kills, stateDir }) => {
        await writeFile(
          join(stateDir, "setup-operation.json"),
          JSON.stringify({
            version: 1,
            id: operationId,
            kind: "adopt",
            requestHash: "a-request",
            phase: "venue_committed",
            data: { resetProof: { personId, passwordHash: hashPassword("the-password") } },
            updatedAt: "2026-09-26T00:00:00.000Z",
          }),
        );
        const response = await post("/setup-api/reset-incomplete-adopt", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ personId, password: "the-password" }),
        });
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ resetStaged: true, restarting: true });
        expect(JSON.parse(await readFile(join(stateDir, "reset-request.json"), "utf8"))).toEqual({
          version: 1,
          operationId,
        });
        await poll(() => (kills.length > 0 ? kills.length : undefined));
        expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
      });
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses an adopt into a database stamped for another environment without locking setup", async () => {
    const venue = await freshVenue();
    const bundle = {
      designated: {
        locationId: "22222222-2222-4222-8222-222222222222",
        nodeId: "44444444-4444-4444-8444-444444444444",
        seriesId: "55555555-5555-4555-8555-555555555555",
      },
      tenant: { country: "ES", taxId: "80000001K" },
      primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "fixture-ca",
      relayUrl: "https://relay.example",
      accountKey: Buffer.alloc(32, 9).toString("base64"),
      reservedIdentity: {
        modules: {},
        series: [],
        endorsement: {
          nodeId: "66666666-6666-4666-8666-666666666666",
          publicKey: "fixture-key",
          endorsedBy: "44444444-4444-4444-8444-444444444444",
          signature: "fixture-signature",
        },
      },
      moduleOverrides: {},
    };
    const primary = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(bundle));
    });
    await new Promise<void>((resolve) => primary.listen(0, "127.0.0.1", resolve));
    const primaryUrl = `http://127.0.0.1:${(primary.address() as AddressInfo).port}`;
    const adoptBody = (password: string) =>
      JSON.stringify({
        primaryUrl,
        credential: { personId: "33333333-3333-4333-8333-333333333333", password },
      });
    try {
      await withSetupBoot(venue.directory, {}, async ({ post, kills }) => {
        // Stamped after boot, as a live provision refused inside `applyVenue` leaves it on a
        // preproduction host; boot itself refuses a database stamped for another environment.
        await stampDeployment(venue.store.venue, "production");
        const expected = {
          error: {
            code: "deployment.already_stamped",
            params: { stamped: "production", requested: "preproduction" },
          },
        };
        for (const password of ["first", "second"]) {
          const response = await post("/setup-api/adopt", {
            headers: { "content-type": "application/json" },
            body: adoptBody(password),
          });
          expect(response.status).toBe(409);
          expect(await response.json()).toEqual(expected);
        }
        expect(kills).toEqual([]);
      });
    } finally {
      await new Promise((resolve) => primary.close(resolve));
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("stages a prepared configuration and imports it into the venue a live provision mints", async () => {
    const TAX_ID = "60000011A";
    const PASSPHRASE = "a long enough export passphrase";
    const modules = enabledModules(ALL_MODULES, ES_MODULE_CONFIG);
    const source = await freshVenue();
    const target = await freshVenue();
    const sourceStateDir = await mkdtemp(join(tmpdir(), "waitron-boot-config-source-"));
    try {
      const sourceIds = await provisionVenue(
        {
          ownerDb: source.store.venue,
          moduleConfig: ES_MODULE_CONFIG,
          database: source.directory,
          stateDir: sourceStateDir,
        },
        { environment: "preproduction", venue: hashedVenueRequest(TAX_ID) },
      );
      await withTransaction(source.store.venue, (tx) =>
        writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "fr"] }),
      );
      const [exporter] = await source.store.venue.select({ id: persons.id }).from(persons);
      const artifact = encodeConfigurationBundle(
        await buildConfigurationBundle(
          source.store.venue,
          { ...sourceIds, sourceOperatorId: exporter!.id },
          modules,
          new Date(),
          await schemaVersionsByModule(source.store.venue, modules),
        ),
        PASSPHRASE,
      );
      const live = (taxId: string) =>
        JSON.stringify({
          mode: "live",
          configurationImport: true,
          venue: provisionVenueBody(taxId),
        });

      await withSetupBoot(target.directory, { WAITRON_ENV: "dev" }, async ({ post, kills }) => {
        const json = { "content-type": "application/json" };
        const unstaged = await post("/setup-api/provision", { headers: json, body: live(TAX_ID) });
        expect(unstaged.status).toBe(400);
        expect(await unstaged.json()).toEqual({
          error: { code: "setup.request_invalid", params: { field: "configurationImport" } },
        });

        const staged = await post("/setup-api/configuration", {
          headers: {
            "content-type": "application/octet-stream",
            "x-waitron-export-passphrase": PASSPHRASE,
          },
          body: new Uint8Array(artifact),
        });
        expect(staged.status).toBe(200);
        expect(((await staged.json()) as { venue: { taxId: string } }).venue.taxId).toBe(TAX_ID);

        const otherBusiness = await post("/setup-api/provision", {
          headers: json,
          body: live("60000012G"),
        });
        expect(otherBusiness.status).toBe(400);
        expect(await otherBusiness.json()).toEqual({
          error: { code: "setup.request_invalid", params: { field: "configurationImport" } },
        });

        const provisioned = await post("/setup-api/provision", {
          headers: json,
          body: live(TAX_ID),
        });
        const [department] = target.store.venue.all<{ id: string }>(
          sql`select id from departments where active = 1`,
        );
        expect(await provisioned.json()).toEqual({
          provisioned: true,
          restarting: true,
          openingHours: { departmentId: department!.id },
        });
        await poll(() => (kills.length > 0 ? kills.length : undefined));
        expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
      });

      const imported = await withTransaction(target.store.venue, (tx) =>
        readContentLanguages(tx, "es"),
      );
      expect(imported).toEqual({ defaultLanguage: "es", languages: ["es", "fr"] });
    } finally {
      await source.store.close();
      await target.store.close();
      await rm(source.directory, { recursive: true, force: true });
      await rm(target.directory, { recursive: true, force: true });
      await rm(sourceStateDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("imports a configuration export into the venue of a new taxpayer, which keeps its own identity and series", async () => {
    const OLD_TAX_ID = "60000011A";
    const NEW_TAX_ID = "60000012G";
    const PASSPHRASE = "a long enough export passphrase";
    const modules = enabledModules(ALL_MODULES, ES_MODULE_CONFIG);
    const source = await freshVenue();
    const target = await freshVenue();
    const sourceStateDir = await mkdtemp(join(tmpdir(), "waitron-boot-new-taxpayer-source-"));
    try {
      const sourceIds = await provisionVenue(
        {
          ownerDb: source.store.venue,
          moduleConfig: ES_MODULE_CONFIG,
          database: source.directory,
          stateDir: sourceStateDir,
        },
        { environment: "preproduction", venue: hashedVenueRequest(OLD_TAX_ID) },
      );
      await withTransaction(source.store.venue, (tx) =>
        writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "fr"] }),
      );
      await source.store.venue.execute(
        sql`update locations set invoice_locales = '["es-ES","en-GB"]'`,
      );
      const [exporter] = await source.store.venue.select({ id: persons.id }).from(persons);
      const artifact = encodeConfigurationBundle(
        await buildConfigurationBundle(
          source.store.venue,
          { ...sourceIds, sourceOperatorId: exporter!.id },
          modules,
          new Date(),
          await schemaVersionsByModule(source.store.venue, modules),
        ),
        PASSPHRASE,
      );
      const newTaxpayer = (taxId: string) => {
        const body = provisionVenueBody(taxId);
        return JSON.stringify({
          mode: "live",
          configurationImport: true,
          newTaxpayer: true,
          venue: {
            ...body,
            legalName: "Nueva Empresa SL",
            taxpayerDomicile: "Calle Nueva 3, 28013 Madrid",
            location: { ...body.location, operationDescription: "Comida para llevar" },
            seriesCode: "B",
            fullSeriesCode: "FB",
            rectificativeSeriesCode: "RB",
          },
        });
      };

      await withSetupBoot(target.directory, { WAITRON_ENV: "dev" }, async ({ post, kills }) => {
        const json = { "content-type": "application/json" };
        const staged = await post("/setup-api/configuration", {
          headers: {
            "content-type": "application/octet-stream",
            "x-waitron-export-passphrase": PASSPHRASE,
          },
          body: new Uint8Array(artifact),
        });
        expect(staged.status).toBe(200);

        // Typed in lower case with a hyphen, the old tax ID still normalises to the bundle's.
        const sameTaxId = await post("/setup-api/provision", {
          headers: json,
          body: newTaxpayer("60000011-a"),
        });
        expect(sameTaxId.status).toBe(400);
        expect(await sameTaxId.json()).toEqual({
          error: { code: "setup.request_invalid", params: { field: "taxId" } },
        });

        const provisioned = await post("/setup-api/provision", {
          headers: json,
          body: newTaxpayer(NEW_TAX_ID),
        });
        expect(provisioned.status, await provisioned.clone().text()).toBe(200);
        await poll(() => (kills.length > 0 ? kills.length : undefined));
        expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
      });

      expect(
        target.store.venue.all(
          sql`select country, tax_id, legal_name, taxpayer_domicile from tenants`,
        ),
      ).toEqual([
        {
          country: "ES",
          tax_id: NEW_TAX_ID,
          legal_name: "Nueva Empresa SL",
          taxpayer_domicile: "Calle Nueva 3, 28013 Madrid",
        },
      ]);
      expect(
        target.store.venue.all(
          sql`select code from invoice_series where retired_at is null order by code`,
        ),
      ).toEqual([{ code: "B" }, { code: "FB" }, { code: "RB" }]);
      expect(
        target.store.venue.all(sql`select operation_description, invoice_locales from locations`),
      ).toEqual([{ operation_description: "Comida para llevar", invoice_locales: '["es-ES"]' }]);
      const imported = await withTransaction(target.store.venue, (tx) =>
        readContentLanguages(tx, "es"),
      );
      expect(imported).toEqual({ defaultLanguage: "es", languages: ["es", "fr"] });
    } finally {
      await source.store.close();
      await target.store.close();
      await rm(source.directory, { recursive: true, force: true });
      await rm(target.directory, { recursive: true, force: true });
      await rm(sourceStateDir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("startServer — the configuration export route in trading mode", () => {
  it.each([
    ["prepare", 401],
    ["live", 401],
    ["demo", 404],
    [undefined, 404],
  ] as const)(
    "onboarding intent %s answers the export route with %s",
    async (intent, status) => {
      const venue = await freshVenue();
      const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-export-route-state-"));
      let server: StartedServer | undefined;
      try {
        await seedTradingVenue(venue.store.venue);
        await venue.store.close();
        await writeFile(
          join(stateDir, "modules.json"),
          JSON.stringify({ modules: { "fiscal-none": false } }),
        );
        const port = await freePort();
        server = await startServer({
          ...KEY_ENV,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_VENUE_DIR: venue.directory,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          // A live intent is accepted only on a production or development box (`config.ts`).
          WAITRON_ENV: intent === "live" ? "dev" : "preproduction",
          ...(intent === undefined ? {} : { WAITRON_ONBOARDING_INTENT: intent }),
        });
        await awaitListening(port);
        const response = await fetch(
          `http://127.0.0.1:${port}/management-api/configuration-export`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ passphrase: "a long enough export passphrase" }),
          },
        );
        expect(response.status).toBe(status);
      } finally {
        // A listener that never bound rejects its close; the original error is the one to report.
        await server?.close().catch(() => {});
        await venue.store.close();
        await rm(venue.directory, { recursive: true, force: true });
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
