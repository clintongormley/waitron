import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { publishRestoreFlow } from "./restore-flow.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { nodeDumpEntry } from "./testing/node-copy.js";
import { spawn } from "node:child_process";
import { ownedHourSetup } from "../test/owned-hour-setup.js";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Hono } from "hono";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  openVenueDatabase,
  stampDeployment,
  venueLocationId,
  withTransaction,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import { savePrivacyContact } from "@waitron/provisioning";
import { SETUP_CLOCK_STEP_FILE } from "@waitron/store";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
  readContentLanguages,
  writeContentLanguages,
} from "@waitron/catalogue";
import type { StartedServer, StartServerSeams } from "./boot.js";
import { lookupBoxName, type MdnsQuerySocket } from "./box-lookup.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { fakeMdnsSocket } from "./testing/fake-mdns-socket.js";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { buildConfigurationBundle, encodeConfigurationBundle } from "./configuration-transfer.js";
import { provisionAllocatedTestVenue as provisionVenue } from "./testing/allocated-provision.js";
import { venueModuleConfig } from "./provision.js";
import { readModuleConfig } from "./module-config.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";
import { generateNodeKeyPair } from "@waitron/membership";
import { encodeRecoveryKit, signPointer } from "@waitron/stream";
import { loadTillAppSettings } from "./till-config.js";
import { loadNodeIdentity } from "./node-config.js";
import type { TradingContext } from "./trading-context.js";
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
  fetchHealthOk,
} from "./testing/boot-harness.js";
import { createHourTestClock, type HourTestClock } from "./testing/hour-test-clock.js";
import { clockServiceAnswer, synchronisedBoxHost } from "./testing/synchronised-box-host.js";
import * as bootHarness from "./testing/boot-harness.js";
import { PAIR_BUNDLE_FIELDS } from "./testing/pair-bundle.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort, startConfiguredServer } =
  ephemeralServerFixture();

// The setup refusal needs a stamp written after boot; its fixture shares the server's write queue.
vi.mock("./setup-api.js", async (original) => {
  const actual = await original<typeof import("./setup-api.js")>();
  return {
    ...actual,
    mountSetup: (...args: Parameters<typeof actual.mountSetup>) => {
      const [app, deps] = args;
      app.post("/__test/stamp-deployment", async (c) => {
        await withTransaction(deps.db!, () => stampDeployment(deps.db!, "production"));
        return c.body(null, 204);
      });
      return actual.mountSetup(...args);
    },
  };
});

/** The options boot hands the setup start's restore preparation. */
const recovery = vi.hoisted(() => ({
  options: undefined as
    | Parameters<typeof import("./recovery-preparation.js").createSetupRecoveryPreparation>[0]
    | undefined,
}));
vi.mock("./recovery-preparation.js", async (original) => {
  const actual = await original<typeof import("./recovery-preparation.js")>();
  return {
    ...actual,
    createSetupRecoveryPreparation: (
      options: Parameters<typeof actual.createSetupRecoveryPreparation>[0],
    ) => {
      recovery.options = options;
      return actual.createSetupRecoveryPreparation(options);
    },
  };
});

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
    const server = await startConfiguredServer({
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
        await awaitListening(httpPort());
        expect(await waitForEvent(lines, "log.file_unavailable")).toMatchObject({
          level: "warn",
        });
        expect((await fetch(`http://127.0.0.1:${httpPort()}/api/node`)).status).toBe(200);
        expect(
          lines.filter((line) => line.includes('"event":"log.file_unavailable"')),
        ).toHaveLength(1);
      } finally {
        await server.close();
      }
    });
  }, 60_000);

  it("queues an answered reset before close and sends it after the next start", async () => {
    const smtp = await startFakeSmtp();
    beforeServerStarts();
    const venue = await freshVenue();
    try {
      const db = venue.store.venue;
      await seedTradingVenue(db);
      await seedPersons(db, {
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
      const serverEnv = {
        ...KEY_ENV,
        WAITRON_VENUE_DIR: venue.directory,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      };
      let server = await startServer(serverEnv);
      try {
        await awaitListening(httpPort());
        mailSettingsRead.delayMs = 50;
        // In-process, so close() starts before the reset's work does.
        const response = await managementMount.app!.request("/management-api/password-reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "reset-person@example.test" }),
        });
        expect(response.status).toBe(202);
        await server.close();
        expect(db.all(sql`select status from outgoing_mail`)).toEqual([{ status: "pending" }]);
        expect(smtp.messages).toEqual([]);
        mailSettingsRead.delayMs = undefined;
        server = await startServer(serverEnv);
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });
  async function withSetupBoot(
    directory: string,
    env: Record<string, string>,
    use: (ctx: {
      post: (path: string, init: RequestInit) => Promise<Response>;
      get: (path: string) => Promise<Response>;
      kills: { pid: number; signal: string | number | undefined }[];
      stateDir: string;
      extraPorts: number[];
      /** The server's clock, unless `seams` brings its own. */
      testClock: HourTestClock;
    }) => Promise<void>,
    {
      extraPortCount = 0,
      beforeStart,
      onStarted,
      seams = {},
    }: {
      extraPortCount?: number;
      beforeStart?: (stateDir: string) => Promise<void>;
      onStarted?: (server: StartedServer) => void;
      seams?: StartServerSeams;
    } = {},
  ): Promise<void> {
    const [port, ...drawn] = await freePorts(1 + extraPortCount);
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-routes-"));
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-16T11:40:00Z") });
    const clockStart = performance.now();
    vi.spyOn(Date, "now").mockImplementation(
      () => Date.parse("2026-10-16T11:40:00Z") + Math.trunc(performance.now() - clockStart),
    );
    const release = await import("@waitron/fiscal-verifactu/src/hour-release.js");
    const releaseSpy = vi.spyOn(release, "readHourRelease").mockReturnValue({
      instantMs: Date.parse("2026-10-15T00:00:00Z"),
      committedAt: "2026-10-15T00:00:00.000Z",
      sourceCommit: "a".repeat(40),
      generator: "scripts/generate-hour-release.mjs:v1",
      generatorSha256: "b".repeat(64),
    });
    const testClock = createHourTestClock(Date.parse("2026-10-16T11:40:00Z"));
    const internet = await import("@waitron/fiscal-verifactu/src/hour-clock-internet.js");
    const internetSpy = vi
      .spyOn(internet, "observeInternetHourClock")
      .mockImplementation(async () => ({
        source: "internet",
        result: "usable",
        instantMs: testClock.wall(),
        uncertaintyMs: 500,
        wallStartedMs: testClock.wall(),
        wallFinishedMs: testClock.wall(),
        monotonicStartedMs: testClock.monotonic(),
        monotonicFinishedMs: testClock.monotonic(),
      }));
    try {
      await beforeStart?.(stateDir);
      await withMockedKill(async (kills) => {
        const start = extraPortCount > 0 ? startConfiguredServer : startServer;
        const server = await start(
          {
            WAITRON_VENUE_DIR: directory,
            WAITRON_HTTP_PORT: String(port),
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_STATE_DIR: stateDir,
            WAITRON_ENV: "preproduction",
            WAITRON_HTTP_LANDING_PORT: "0",
            ...env,
          },
          {},
          { testClock, ...seams },
        );
        onStarted?.(server);
        let closeTls: (() => Promise<void>) | undefined;
        try {
          if (extraPortCount > 0) await awaitListening(port!);
          const { via, close } = httpsVia(await readFile(join(stateDir, "tls", "ca.crt")));
          closeTls = close;
          await use({
            post: async (path, init) => {
              if (path === "/setup-api/provision" && typeof init.body === "string") {
                const body = JSON.parse(init.body);
                if (body.mode === "live") {
                  const owned = await ownedHourSetup(
                    (input, options) => fetch(input, { ...options, ...via }),
                    `https://127.0.0.1:${httpPort()}`,
                    body.venue,
                    body.venue.admin.password,
                    body.configurationImport === true
                      ? { configurationImport: true, newTaxpayer: body.newTaxpayer === true }
                      : undefined,
                    testClock,
                  );
                  const {
                    venue: _,
                    configurationImport: __,
                    newTaxpayer: ___,
                    ...publication
                  } = body;
                  void _;
                  void __;
                  void ___;
                  const headers = new Headers(init.headers);
                  for (const [name, value] of Object.entries(owned.headers))
                    headers.set(name, value);
                  init = { ...init, headers, body: JSON.stringify(publication) };
                }
              }
              return fetch(`https://127.0.0.1:${httpPort()}${path}`, {
                ...via,
                method: "POST",
                ...init,
              });
            },
            get: (path) => fetch(`https://127.0.0.1:${httpPort()}${path}`, via),
            kills,
            stateDir,
            extraPorts: drawn,
            testClock,
          });
        } finally {
          try {
            await closeTls?.();
          } finally {
            await server.close();
          }
        }
      });
    } finally {
      internetSpy.mockRestore();
      releaseSpy.mockRestore();
      vi.useRealTimers();
      await rm(stateDir, { recursive: true, force: true });
    }
  }

  it("A1251 closes the setup server when listener readiness refuses", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const refused = new Error("setup listener readiness refused");
    const ready = bootHarness.awaitListening;
    const readiness = vi.spyOn(bootHarness, "awaitListening").mockImplementation(async (port) => {
      await ready(port);
      throw refused;
    });
    let server: StartedServer | undefined;
    const use = vi.fn();
    try {
      await expect(
        withSetupBoot(venue.directory, {}, use, {
          extraPortCount: 1,
          onStarted: (started) => {
            server = started;
          },
        }),
      ).rejects.toBe(refused);
      expect(use).not.toHaveBeenCalled();
      expect(() => beforeServerStarts()).not.toThrow();
    } finally {
      readiness.mockRestore();
      try {
        await server?.close();
      } finally {
        await venue.store.close();
        await rm(venue.directory, { recursive: true, force: true });
      }
    }
  });

  it("the setup and restore pages set the box's clock through the setup start's own setter", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const boxHost = { ...synchronisedBoxHost(), setClock: vi.fn() };
    try {
      await withSetupBoot(
        venue.directory,
        {},
        async ({ post, stateDir }) => {
          const json = { "content-type": "application/json" };
          const claimed = await post("/setup-api/first-setup/claim", {
            headers: json,
            body: JSON.stringify({ venue: provisionVenueBody("60000010W") }),
          });
          expect(claimed.status).toBe(200);
          const claim = await claimed.json();
          const headers = {
            ...json,
            "X-Waitron-Setup-Owner": claim.capability,
            "X-Waitron-Setup-Attempt": claim.state.attemptId,
            "X-Waitron-Setup-Revision": String(claim.state.revision),
            "X-Waitron-Setup-Generation": String(claim.state.ownerGeneration),
          };
          const prepare = async (proposal: unknown) =>
            (
              await (
                await post("/setup-api/first-setup/preparation", {
                  headers,
                  body: JSON.stringify({ module: "fiscal-verifactu", proposal }),
                })
              ).json()
            ).preparation;
          const challenge = await prepare({ action: "clock-challenge" });
          // Only the setter answers `synchronised`: the module alone answers host_unavailable.
          expect(
            await prepare({
              action: "set-clock",
              browser: { challengeId: challenge.id, instantMs: Date.now() + 3_600_000 },
            }),
          ).toEqual({ status: "refused", reason: "synchronised" });
          // Only the setter answers `stale`, here for a reading taken at the epoch.
          expect(
            await recovery.options!.setBoxClock!(
              {
                offsetMs: 3_600_000,
                agreesWithinMs: 30_000,
                measuredAt: { wallMs: 0, monoMs: 0 },
                reading: { boxAt: "", witnessAt: "", uncertaintyMs: 0 },
              },
              async () => null,
            ),
          ).toEqual({ status: "refused", reason: "stale" });
          expect(boxHost.setClock).not.toHaveBeenCalled();
          await expect(readFile(join(stateDir, SETUP_CLOCK_STEP_FILE))).rejects.toMatchObject({
            code: "ENOENT",
          });
        },
        { seams: { boxHost, requestFromBox: () => false } },
      );
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  });

  it("refuses to finish a restore while a clock step's note cannot be written, and writes it on the next try", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const clock = createHourTestClock(Date.parse("2026-10-16T11:40:00Z"));
    const boxHost = {
      clockStatus: async () => clockServiceAnswer(false),
      setClock: async ({ targetMs }: { targetMs: number }) => {
        const beforeMs = clock.wall();
        clock.set(targetMs);
        return { available: true as const, beforeMs, afterMs: clock.wall() };
      },
    };
    const restore = (post: (path: string, init: RequestInit) => Promise<Response>) =>
      post("/setup-api/restore", {
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
    try {
      await withSetupBoot(
        venue.directory,
        {},
        async ({ post, kills, stateDir }) => {
          const notePath = join(stateDir, SETUP_CLOCK_STEP_FILE);
          // A folder where the note goes, so writing it fails.
          await mkdir(notePath);
          expect(
            await recovery.options!.setBoxClock!(
              {
                offsetMs: 3_600_000,
                agreesWithinMs: 30_000,
                measuredAt: { wallMs: clock.wall(), monoMs: clock.monotonic() },
                reading: { boxAt: "", witnessAt: "", uncertaintyMs: 0 },
              },
              async () => null,
            ),
          ).toEqual({ status: "set" });

          const refused = await restore(post);
          expect(refused.status).toBe(500);
          expect(((await refused.json()) as { error?: { code: string } }).error?.code).toBe(
            "setup.clock_step_unsaved",
          );
          expect(kills).toEqual([]);

          await rm(notePath, { recursive: true });
          const retried = await restore(post);
          // Past the note, the restore goes on to refuse the copy for its own reason.
          expect(((await retried.json()) as { error?: { code: string } }).error?.code).toBe(
            "recovery.passphrase_invalid",
          );
          const entries = JSON.parse(await readFile(notePath, "utf8")) as {
            params: { stepMs: number; source: string };
          }[];
          expect(entries).toHaveLength(1);
          expect(entries[0]!.params.source).toBe("setup");
          expect(kills).toEqual([]);
        },
        { seams: { boxHost, testClock: clock, requestFromBox: () => false } },
      );
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses to finish a live first setup while a clock step's note cannot be written, and writes it on the next try", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const server: { clock?: HourTestClock } = {};
    const boxHost = {
      clockStatus: async () => clockServiceAnswer(false),
      setClock: async ({ targetMs }: { targetMs: number }) => {
        const beforeMs = server.clock!.wall();
        server.clock!.set(targetMs);
        return { available: true as const, beforeMs, afterMs: server.clock!.wall() };
      },
    };
    const sent = vi.spyOn(globalThis, "fetch");
    try {
      await withSetupBoot(
        venue.directory,
        // A development box, so a live setup needs no tax agency certificate.
        { WAITRON_ENV: "dev" },
        async ({ post, kills, stateDir, testClock }) => {
          server.clock = testClock;
          const notePath = join(stateDir, SETUP_CLOCK_STEP_FILE);
          await mkdir(notePath);
          // A step a little over a second, so the hour setup's own clocks still agree.
          expect(
            await recovery.options!.setBoxClock!(
              {
                offsetMs: 1_500,
                agreesWithinMs: 0,
                measuredAt: { wallMs: testClock.wall(), monoMs: testClock.monotonic() },
                reading: { boxAt: "", witnessAt: "", uncertaintyMs: 0 },
              },
              async () => null,
            ),
          ).toEqual({ status: "set" });

          const refused = await post("/setup-api/provision", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "live", venue: provisionVenueBody("60000014Y") }),
          });
          expect(refused.status, await refused.clone().text()).toBe(500);
          expect(((await refused.json()) as { error?: { code: string } }).error?.code).toBe(
            "setup.clock_step_unsaved",
          );
          expect(kills).toEqual([]);

          await rm(notePath, { recursive: true });
          const [url, init] = sent.mock.calls
            .filter(([input]) => String(input).endsWith("/setup-api/provision"))
            .at(-1)!;
          const retried = await fetch(url, init);
          expect(retried.status, await retried.clone().text()).toBe(200);
          await poll(() => (kills.length > 0 ? kills.length : undefined));
          const entries = JSON.parse(await readFile(notePath, "utf8")) as {
            params: { source: string };
          }[];
          expect(entries).toHaveLength(1);
          expect(entries[0]!.params.source).toBe("setup");
        },
        { seams: { boxHost, requestFromBox: () => false } },
      );
    } finally {
      sent.mockRestore();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("the setup start's ask timer stops when the server closes", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    let asks = 0;
    const querySocket = (): MdnsQuerySocket => {
      let onError: ((err: Error) => void) | undefined;
      return {
        on: ((event: string, handler: (err: Error) => void) => {
          if (event === "error") onError = handler;
        }) as MdnsQuerySocket["on"],
        query: () => {
          asks += 1;
          queueMicrotask(() => onError?.(new Error("bind EADDRINUSE 0.0.0.0:5353")));
        },
        destroy: (cb) => cb?.(),
      };
    };
    const mdns = fakeMdnsSocket();
    const random = vi.fn(() => 0);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      await withSetupBoot(
        venue.directory,
        { WAITRON_HTTP_HOST: "0.0.0.0" },
        async () => {
          await vi.waitFor(() => expect(random).toHaveBeenCalledTimes(1));
          // The ask failed, so the box cannot know nobody else holds the name.
          mdns.query("waitron.local");
          expect(mdns.answers()).toEqual([]);
        },
        {
          seams: {
            mdnsQuerySocket: querySocket,
            mdnsSocket: () => mdns.socket,
            setupAskRandom: random,
          },
        },
      );
      const scheduled = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === 30_000);
      expect(scheduled).toBeGreaterThanOrEqual(0);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[scheduled]!.value);
      expect(asks).toBe(1);
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("the setup start takes an answer from its configured box address for its own", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const configured = "203.0.113.7";
    const querySocket = (): MdnsQuerySocket => {
      const handlers: {
        response?: (r: { answers: { name: string; type: string; data: unknown }[] }) => void;
        error?: (err: Error) => void;
      } = {};
      return {
        on: ((event: "response" | "error", handler: never) => {
          handlers[event] = handler;
        }) as MdnsQuerySocket["on"],
        query: () => {
          queueMicrotask(() => {
            handlers.response?.({
              answers: [{ name: "waitron.local", type: "A", data: configured }],
            });
          });
        },
        destroy: (cb) => cb?.(),
      };
    };
    const mdns = fakeMdnsSocket();
    const random = vi.fn(() => 0);
    try {
      await withSetupBoot(
        venue.directory,
        { WAITRON_HTTP_HOST: "0.0.0.0", WAITRON_BOX_ADDRESSES: configured },
        async () => {
          // The ask ends at its two-second limit.
          await vi.waitFor(() => expect(random).toHaveBeenCalledTimes(1), { timeout: 10_000 });
          mdns.query("waitron.local");
          expect(mdns.answers().map(({ name, data }) => ({ name, data }))).toEqual([
            { name: "waitron.local", data: configured },
          ]);
          // So does every later call this box makes to another box by name.
          await expect(
            lookupBoxName("waitron.local", { timeoutMs: 20, makeSocket: querySocket }),
          ).rejects.toMatchObject({ code: "mirror.peer_unresolved" });
        },
        {
          seams: {
            mdnsQuerySocket: querySocket,
            mdnsSocket: () => mdns.socket,
            setupAskRandom: random,
          },
        },
      );
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("finishes a provision whose venue had already committed, re-using that venue rather than minting another", async () => {
    beforeServerStarts();
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
        expect(trading.WAITRON_NODE_ID).toBe(committed.nodeId);
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
    beforeServerStarts();
    const venue = await freshVenue();
    const keptStateDir = await mkdtemp(join(tmpdir(), "waitron-boot-no-till-state-"));
    try {
      let trading: Record<string, string> = {};
      await withSetupBoot(venue.directory, {}, async ({ post, kills, stateDir }) => {
        const response = await post("/setup-api/provision", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "prepare",
            venue: provisionVenueBody("60000011A"),
            email: {
              server: "smtp.example.test",
              port: 587,
              encryption: "starttls",
              from: "venue@example.test",
            },
          }),
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

      const cfg: TradingContext = {
        locale: "es-ES",
        ...loadNodeIdentity(trading),
        ...loadTillAppSettings(trading),
        simplifiedInvoiceLimit: null,
      };
      const venueId = await venueLocationId(venue.store.venue);
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
        .where(eq(persons.email, "admin@waitron.dev"));
      const offer = await withTransaction(venue.store.venue, async (tx) => {
        const catalogue = await createCatalogue(tx, {
          name: `Boot setup routes menu ${venueId}`,
        });
        const drinks = await createCategory(tx, { name: "Bebidas" });
        const water = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: drinks.id,
          name: "Agua",
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
        });
        await assignCatalogueToVenue(tx, catalogue.id);
        const offers = await offerProducts(tx, { locationId: venueId });
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
        const base = `https://127.0.0.1:${httpPort()}`;
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

  function expectThrowawayVenue(db: Database, taxId: string): void {
    expect(db.all(sql`select numero_instalacion from registro_sif`)).toEqual([
      { numero_instalacion: "0CNNW" },
    ]);
    expect(
      db.all(sql`select taxpayer_nif, environment, allocation_key from fiscal_allocations`),
    ).toEqual([
      {
        taxpayer_nif: taxId,
        environment: "preproduction",
        allocation_key: expect.stringMatching(/^throwaway-/),
      },
    ]);
    expect(db.all(sql`select code, purpose from invoice_series order by code`)).toEqual([
      { code: "A-0CNNW", purpose: "standard" },
      { code: "FF-0CNNW", purpose: "full" },
      { code: "R-0CNNW", purpose: "rectificative" },
    ]);
    expect(db.all(sql`select environment from deployment`)).toEqual([
      { environment: "preproduction" },
    ]);
  }

  it("sets up Demo on a preproduction box with no supplied allocation, and the box restarts into trading", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const keptStateDir = await mkdtemp(join(tmpdir(), "waitron-boot-throwaway-state-"));
    try {
      await withSetupBoot(
        venue.directory,
        { WAITRON_ENV: "preproduction" },
        async ({ post, kills, stateDir }) => {
          const response = await post("/setup-api/provision", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "demo",
              venue: {
                ...provisionVenueBody("60000012G"),
                staffLanguage: "en",
                admin: { ...provisionVenueBody("60000012G").admin, locale: "es-ES" },
              },
            }),
          });
          expect(response.status, await response.clone().text()).toBe(200);
          expect(await response.json()).toEqual({ provisioned: true, restarting: true });
          await poll(() => (kills.length > 0 ? kills.length : undefined));
          expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
          await cp(stateDir, keptStateDir, { recursive: true });
        },
      );
      expectThrowawayVenue(venue.store.venue, "60000012G");
      expect(
        venue.store.venue.all(sql`
        select s.name from service_steps s join departments d on d.id = s.department_id
        where d.is_default = 1 order by s.position
      `),
      ).toEqual(["Set up", "Take order", "Anything else?"].map((name) => ({ name })));
      expect(
        venue.store.venue.all(sql`
        select name, kitchen_name from products where json_extract(customer_name, '$.en') = 'Ham croquettes'
      `),
      ).toEqual([{ name: "Croquettes", kitchen_name: "HAM CROQUETTES · TAPAS" }]);

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
        await fetchHealthOk(`https://127.0.0.1:${httpPort()}/health`, via);
        // A trading boot does not mount the setup surface: the path falls through to a non-JSON
        // answer rather than setup's status.
        const status = await fetch(`https://127.0.0.1:${httpPort()}/setup-api/status`, via);
        expect(status.headers.get("content-type") ?? "").not.toContain("application/json");
      } finally {
        await close();
        await server.close();
      }
      expectThrowawayVenue(venue.store.venue, "60000012G");
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(keptStateDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("reports the process USB origin in fresh setup status", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    try {
      await withSetupBoot(
        venue.directory,
        { WAITRON_INSTALLATION_ORIGIN: "usb" },
        async ({ get }) => {
          const status = await get("/setup-api/status");
          expect(status.status).toBe(200);
          expect(await status.json()).toMatchObject({
            provisioned: false,
            installationOrigin: "usb",
          });
        },
      );
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("refuses Demo with no supplied allocation on a WAITRON_ENV=production box, writing nothing and staying in setup", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    try {
      await withSetupBoot(
        venue.directory,
        {
          WAITRON_ENV: "production",
          WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
          WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
        },
        async ({ post, get, kills, stateDir }) => {
          const response = await post("/setup-api/provision", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "demo", venue: provisionVenueBody("60000013M") }),
          });
          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({
            error: {
              code: "setup.mode_not_allowed",
              params: { environment: "production" },
            },
          });
          const status = await get("/setup-api/status");
          expect(status.status).toBe(200);
          expect(await status.json()).toMatchObject({
            provisioned: false,
            environment: "production",
            needs: ["venue"],
          });
          await expect(readFile(join(stateDir, "trading.env"))).rejects.toMatchObject({
            code: "ENOENT",
          });
          expect(kills).toEqual([]);
        },
      );
      for (const table of [
        "deployment",
        "tenants",
        "nodes",
        "registro_sif",
        "fiscal_allocations",
        "invoice_series",
      ]) {
        expect(venue.store.venue.all(sql.raw(`select * from ${table}`)), table).toEqual([]);
      }
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("validates a restore artifact before staging it, refusing one the recovery key cannot open", async () => {
    beforeServerStarts();
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
        await expect(readFile(join(stateDir, "flows/restore/record.json"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(kills).toEqual([]);
      });
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("removes a decrypted copy a restore page left staged before the box stopped", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const leftover = (stateDir: string) =>
      join(stateDir, "scratch/restore", "staged-recovery", "archive-validate-left");
    try {
      await withSetupBoot(
        venue.directory,
        {},
        async ({ stateDir }) => {
          await expect(readdir(dirname(leftover(stateDir)))).rejects.toMatchObject({
            code: "ENOENT",
          });
        },
        {
          beforeStart: async (stateDir) => {
            await mkdir(leftover(stateDir), { recursive: true });
            await writeFile(join(leftover(stateDir), "venue.db"), "decrypted venue");
          },
        },
      );
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("removes the working folder a killed bucket restore left in the state folder", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const leftover = (stateDir: string) => join(stateDir, "scratch", "stream-restore-left");
    try {
      await withSetupBoot(
        venue.directory,
        {},
        async ({ stateDir }) => {
          await expect(readdir(leftover(stateDir))).rejects.toMatchObject({ code: "ENOENT" });
        },
        {
          beforeStart: async (stateDir) => {
            await mkdir(leftover(stateDir), { recursive: true });
            await writeFile(join(leftover(stateDir), "venue.db"), "downloaded venue");
          },
        },
      );
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("leaves a staged decrypted copy for the next start when this one fails before holding the venue folder", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-staged-early-"));
    const leftover = join(stateDir, "scratch/restore", "staged-recovery", "archive-validate-left");
    try {
      await mkdir(leftover, { recursive: true });
      await writeFile(join(leftover, "venue.db"), "decrypted venue");
      await expect(
        startServer(
          {
            WAITRON_VENUE_DIR: join(stateDir, "venue"),
            WAITRON_STATE_DIR: stateDir,
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_ENV: "preproduction",
            WAITRON_HTTP_PORT: String(await freePort()),
            WAITRON_HTTP_LANDING_PORT: "0",
            WAITRON_SETUP_APP_DIR: join(stateDir, "no-such-app"),
          },
          {},
        ),
      ).rejects.toMatchObject({
        code: "server.config_invalid",
        params: { variable: "WAITRON_SETUP_APP_DIR" },
      });
      expect(await readdir(dirname(leftover))).toEqual(["archive-validate-left"]);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("leaves a running process's staged copy alone when a second start is refused the venue folder", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-staged-second-"));
    const venueDir = join(stateDir, "venue");
    const staged = join(stateDir, "scratch/restore", "staged-recovery", "live-staged-copy");
    await mkdir(venueDir, { recursive: true });
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, "venue.db"), "decrypted venue in use by the first process");
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const {DatabaseSync}=require("node:sqlite");const c=new DatabaseSync(${JSON.stringify(join(venueDir, "venue.lock"))});c.exec("begin immediate");process.stdout.write("held\\n");setInterval(()=>{},1000);`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((resolve) => holder.stdout!.once("data", () => resolve()));
      await expect(
        startServer(
          {
            WAITRON_VENUE_DIR: venueDir,
            WAITRON_STATE_DIR: stateDir,
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_ENV: "preproduction",
            WAITRON_HTTP_PORT: String(await freePort()),
            WAITRON_HTTP_LANDING_PORT: "0",
          },
          {},
        ),
      ).rejects.toMatchObject({ code: "provisioning.database_in_use" });
      expect(await readdir(dirname(staged))).toEqual(["live-staged-copy"]);
    } finally {
      holder.kill("SIGKILL");
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("replaces a waiting restore and deletes setup validation's plaintext copy", async () => {
    beforeServerStarts();
    const venue = await freshVenue();
    const source = await freshVenue();
    await source.store.venue.insert(persons).values({
      displayName: "Backup administrator",
      role: "admin",
      passwordHash: hashPassword("fixture-restore-password"),
    });
    const dumpDir = await mkdtemp(join(tmpdir(), "waitron-boot-validation-copy-"));
    try {
      const dump = join(dumpDir, "venue.db");
      await source.store.venue.archiveTo(dump);
      const artifact = encryptArtifact(
        packArchive([
          {
            name: "manifest.json",
            bytes: Buffer.from(
              JSON.stringify({
                manifestVersion: 1,
                createdAt: "2026-10-12T00:00:00.000Z",
                environment: "preproduction",
                modules: {},
              }),
            ),
          },
          { name: "db.dump", bytes: await readFile(dump) },
          await nodeDumpEntry(source.store.node, dumpDir),
          {
            name: "secrets/trading.env",
            bytes: Buffer.from(
              ["WAITRON_NODE_ID=c0000000-0000-4000-8000-000000000008", ""].join("\n"),
            ),
          },
        ]),
        "validation-key",
      );
      await withSetupBoot(venue.directory, {}, async ({ post, stateDir, kills }) => {
        await publishRestoreFlow(
          stateDir,
          { version: 1, phase: "staged", request: { version: 1, environment: "preproduction" } },
          async (dir) => {
            await writeFile(join(dir, "artifact"), "earlier archive");
            await writeFile(join(dir, "key"), "earlier key");
          },
        );
        const response = await post("/setup-api/restore", {
          headers: {
            "content-type": "application/octet-stream",
            "x-waitron-recovery-key": "validation-key",
            "x-waitron-restore-environment": "preproduction",
            "x-waitron-old-box-gone": "1",
          },
          body: new Uint8Array(artifact),
        });
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ restoreStaged: true, restarting: true });
        expect(await readdir(join(stateDir, "scratch/restore"))).toEqual([]);
        expect(await readFile(join(stateDir, "flows/restore/artifact"))).toEqual(artifact);
        expect(await readFile(join(stateDir, "flows/restore/key"), "utf8")).toBe("validation-key");
        await poll(() => (kills.length > 0 ? kills.length : undefined));
        expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
      });
    } finally {
      await venue.store.close();
      await source.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(source.directory, { recursive: true, force: true });
      await rm(dumpDir, { recursive: true, force: true });
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
    beforeServerStarts();
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
          await expect(readFile(join(stateDir, "flows/restore/record.json"))).rejects.toMatchObject(
            {
              code: "ENOENT",
            },
          );
          expect(kills).toEqual([]);
        });
      });
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps a refusing bucket's own error name out of the answer and the log unless it is listed", async () => {
    beforeServerStarts();
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
            await expect(
              readFile(join(stateDir, "flows/restore/record.json")),
            ).rejects.toMatchObject({
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
    beforeServerStarts();
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
            await expect(
              readFile(join(stateDir, "flows/restore/record.json")),
            ).rejects.toMatchObject({
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
    beforeServerStarts();
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
            await nodeDumpEntry(source.store.node, dirname(dump)),
            {
              name: "secrets/secrets.env",
              bytes: Buffer.from(
                `WAITRON_CREDENTIALS_KEY=${vaultKey}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
              ),
            },
            {
              name: "secrets/trading.env",
              bytes: Buffer.from(
                ["WAITRON_NODE_ID=c0000000-0000-4000-8000-000000000008", ""].join("\n"),
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
          await expect(readFile(join(stateDir, "flows/restore/record.json"))).rejects.toMatchObject(
            {
              code: "ENOENT",
            },
          );
          expect(await readdir(join(stateDir, "scratch/restore"))).toEqual([]);
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
    beforeServerStarts();
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
    beforeServerStarts();
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
    beforeServerStarts();
    const venue = await freshVenue();
    const bundle = {
      designated: {
        nodeId: "44444444-4444-4444-8444-444444444444",
      },
      tenant: { country: "ES", taxId: "80000001K" },
      primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "fixture-ca",
      ...PAIR_BUNDLE_FIELDS,
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
      primaryPublicKey: "fixture-primary-key",
      credentialsRing: { key: Buffer.alloc(32, 8).toString("base64"), version: 1 },
      backupSettings: null,
      boxCaKeyPem: "fixture-ca-key",
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
        const stamped = await post("/__test/stamp-deployment", {});
        expect(stamped.status).toBe(204);
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
      await withTransaction(source.store.venue, async (tx) => {
        await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "fr"] });
        await savePrivacyContact(tx, {
          privacyNoticeUrl: "https://example.com/privacy",
          privacyEmail: "privacy@example.com",
        });
      });
      const [exporter] = await source.store.venue.select({ id: persons.id }).from(persons);
      const artifact = encodeConfigurationBundle(
        await buildConfigurationBundle(
          source.store.venue,
          { ...sourceIds, sourceOperatorId: exporter!.id },
          modules,
          new Date(),
          await schemaVersionsByModule(source.store, modules),
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
        const unstaged = await post("/setup-api/first-setup/claim", {
          headers: json,
          body: JSON.stringify({
            venue: provisionVenueBody(TAX_ID),
            configurationImport: true,
          }),
        });
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

        const otherBusiness = await post("/setup-api/first-setup/claim", {
          headers: json,
          body: JSON.stringify({
            venue: provisionVenueBody("60000012G"),
            configurationImport: true,
          }),
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
      expect(
        target.store.venue.all(sql`select privacy_notice_url, privacy_email from tenants`),
      ).toEqual([
        { privacy_notice_url: "https://example.com/privacy", privacy_email: "privacy@example.com" },
      ]);
    } finally {
      await source.store.close();
      await target.store.close();
      await rm(source.directory, { recursive: true, force: true });
      await rm(target.directory, { recursive: true, force: true });
      await rm(sourceStateDir, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([
    [
      "stages the export a running Spanish box's own export route hands out",
      () => ES_MODULE_CONFIG,
      200,
      { venue: { taxId: "60000011A" } },
    ],
    [
      "imports an export with workforce-es off, leaving it on and empty",
      () =>
        venueModuleConfig(
          parseModuleConfig({ modules: { "workforce-es": false } }, ALL_MODULES),
          "ES-common",
        ),
      200,
      { venue: { taxId: "60000011A" } },
    ],
  ] as const)(
    "%s",
    async (_label, sourceModules, status, answer) => {
      const TAX_ID = "60000011A";
      const PASSPHRASE = "a long enough export passphrase";
      const source = await freshVenue();
      const target = await freshVenue();
      const sourceStateDir = await mkdtemp(join(tmpdir(), "waitron-boot-config-route-source-"));
      let server: StartedServer | undefined;
      try {
        const sourceIds = await provisionVenue(
          {
            ownerDb: source.store.venue,
            moduleConfig: sourceModules(),
            database: source.directory,
            stateDir: sourceStateDir,
          },
          { environment: "preproduction", venue: hashedVenueRequest(TAX_ID) },
        );
        const [admin] = await source.store.venue
          .select({ id: persons.id })
          .from(persons)
          .where(eq(persons.email, "admin@waitron.dev"));
        const session = await withTransaction(source.store.venue, async (tx) => {
          const session = await startManagementSession(tx, { personId: admin!.id });
          await setFreshManagementSignIn(tx, session.token);
          return session;
        });
        await source.store.close();
        beforeServerStarts();
        const port = await freePort();
        server = await startServer({
          ...KEY_ENV,
          WAITRON_STATE_DIR: sourceStateDir,
          WAITRON_VENUE_DIR: source.directory,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_NODE_ID: sourceIds.nodeId,
          WAITRON_ENV: "preproduction",
          WAITRON_ONBOARDING_INTENT: "prepare",
        });
        await awaitListening(httpPort());
        const exported = await fetch(
          `http://127.0.0.1:${httpPort()}/management-api/configuration-export`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
            },
            body: JSON.stringify({ passphrase: PASSPHRASE }),
          },
        );
        expect(exported.status, await exported.clone().text()).toBe(200);
        const artifact = new Uint8Array(await exported.arrayBuffer());
        await server.close();
        server = undefined;

        await withSetupBoot(
          target.directory,
          { WAITRON_ENV: "dev" },
          async ({ post, stateDir, kills }) => {
            const staged = await post("/setup-api/configuration", {
              headers: {
                "content-type": "application/octet-stream",
                "x-waitron-export-passphrase": PASSPHRASE,
              },
              body: artifact,
            });
            expect(await staged.json()).toMatchObject(answer);
            expect(staged.status).toBe(status);
            if (
              !enabledModules(ALL_MODULES, sourceModules()).some(
                (module) => module.name === "staffing",
              )
            ) {
              const provisioned = await post("/setup-api/provision", {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  mode: "live",
                  configurationImport: true,
                  venue: provisionVenueBody(TAX_ID),
                }),
              });
              expect(await provisioned.json()).toMatchObject({
                provisioned: true,
                restarting: true,
              });
              expect(provisioned.status).toBe(200);
              await poll(() => (kills.length > 0 ? kills.length : undefined));
              expect(
                enabledModules(ALL_MODULES, await readModuleConfig(stateDir)).map(
                  (module) => module.name,
                ),
              ).toEqual(expect.arrayContaining(["workforce-es", "staffing"]));
              expect(target.store.venue.all(sql`select * from convenio_config`)).toEqual([]);
              expect(target.store.venue.all(sql`select * from staff_roles`)).toEqual([]);
              expect(target.store.venue.all(sql`select * from staffing_days`)).toEqual([]);
            }
          },
        );
      } finally {
        await server?.close();
        await target.store.close();
        await rm(source.directory, { recursive: true, force: true });
        await rm(target.directory, { recursive: true, force: true });
        await rm(sourceStateDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

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
      await withTransaction(source.store.venue, async (tx) => {
        await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "fr"] });
        await savePrivacyContact(tx, {
          privacyNoticeUrl: "https://example.com/privacy",
          privacyEmail: "privacy@example.com",
        });
      });
      await source.store.venue.execute(
        sql`update settings set doc = json_set(doc, '$.invoiceLocales', json('["es-ES","en-GB"]')) where module = 'venue'`,
      );
      const [exporter] = await source.store.venue.select({ id: persons.id }).from(persons);
      const artifact = encodeConfigurationBundle(
        await buildConfigurationBundle(
          source.store.venue,
          { ...sourceIds, sourceOperatorId: exporter!.id },
          modules,
          new Date(),
          await schemaVersionsByModule(source.store, modules),
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

            operationDescription: "Comida para llevar",
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
        const sameTaxId = await post("/setup-api/first-setup/claim", {
          headers: json,
          body: JSON.stringify({
            ...JSON.parse(newTaxpayer("60000011-a")),
            mode: undefined,
          }),
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
        target.store.venue.all(sql`select privacy_notice_url, privacy_email from tenants`),
      ).toEqual([
        { privacy_notice_url: "https://example.com/privacy", privacy_email: "privacy@example.com" },
      ]);
      expect(
        target.store.venue.all(
          sql`select code from invoice_series where retired_at is null order by code`,
        ),
      ).toEqual([{ code: "B-0CNNY" }, { code: "FB-0CNNY" }, { code: "RB-0CNNY" }]);
      expect(
        target.store.venue.all(
          sql`select json_extract(settings.doc, '$.operationDescription') as operation_description, json_extract(doc, '$.invoiceLocales') as invoice_locales from locations cross join settings where settings.module = 'venue'`,
        ),
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
      beforeServerStarts();
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
        await awaitListening(httpPort());
        const response = await fetch(
          `http://127.0.0.1:${httpPort()}/management-api/configuration-export`,
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
