import { uploadImage } from "@waitron/media";
import { samplePreparedImage } from "@waitron/media/testing/sample-image.js";
import {
  hashPassword,
  hashPin,
  hashSessionToken,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { randomUUID, X509Certificate } from "node:crypto";
import { createConnection, createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { connect as tlsConnect } from "node:tls";
import type { AddressInfo } from "node:net";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";
import {
  captureError,
  deviceProfiles,
  locations,
  nodes,
  nodeSealedState,
  openVenueDatabase,
  readDeploymentEnvironment,
  readMembershipTrustSet,
  readNodeMembership,
  setDeploymentMode,
  writeMirrorConfig,
  writeNodeMembership,
  stampDeployment,
  tenants,
  tills,
  withTransaction,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { deleteCredential, loadKeyRing, putCredential } from "@waitron/credentials";
import { emptyDrainResult } from "@waitron/fiscal";
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import {
  applyMigrations,
  appliedSchemaVersion,
  expectedSchemaVersion,
  manifestSets,
  migrationOptionsFor,
} from "@waitron/migrations";
import { enabledModules, orderedMigrationSets, parseModuleConfig } from "@waitron/module";
import { readContentLanguages, writeContentLanguages } from "@waitron/catalogue";
import { runTunnelClient } from "@waitron/tunnel";
import {
  DEFAULT_MIGRATIONS_ROOT,
  MAX_UPLOAD_BYTES,
  startServer,
  type StartedServer,
} from "./boot.js";
import { listBoxIpv4 } from "./box-reach.js";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { buildConfigurationBundle, encodeConfigurationBundle } from "./configuration-transfer.js";
import { provisionVenue, venueModuleConfig } from "./provision.js";
import { DUTY_BUDGET_MS } from "./health.js";
import { DRAIN_DUTY } from "./pass.js";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { ensureBoxSecrets, tightenTlsDir } from "./box-secrets.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { establishNodeIdentity } from "./node-identity.js";
import { REBUILD_MARKER } from "./rebuild-first-start.js";
import { unsealNodeState } from "./sealed-state.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";
import { encodeRecoveryKit } from "@waitron/stream";
import { RECOVERY_FILES } from "./state-secrets.js";
import { loadTillConfig } from "./till-config.js";
import type { TillConfig } from "./till-config.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEV_DEVICE_HEADER } from "./device-session.js";
import type { Turns } from "./backup-turns.js";
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";

/**
 * The one test below that provisions a usable `fiscal.aeat` credential needs the AEAT transport to
 * build a real mTLS `Agent`, and `startServer` has no seam to point it at a test double. Mocking
 * `undici`'s `fetch` keeps that SOAP POST inside this process; `Agent` passes through untouched, so
 * the test's `Agent.prototype.close` spy observes a genuine pool. The global `fetch` this file
 * uses against its own server is Node's built-in one, which this mock does not replace.
 */
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(
        new Error("undici fetch disabled in boot.test.ts — see this file's own header comment"),
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
 * Passes through to the real queue that `boot.ts` builds, counting the bodies routes hand it and the
 * bodies it starts, and holding every started body on `gate` while a test sets one.
 */
const backupQueue = vi.hoisted(() => ({
  gate: undefined as Promise<void> | undefined,
  handed: 0,
  started: 0,
}));
vi.mock("./backup-turns.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backup-turns.js")>();
  return {
    ...actual,
    createTurns: (): Turns => {
      const turns = actual.createTurns();
      return (body) => {
        backupQueue.handed += 1;
        return turns(async () => {
          backupQueue.started += 1;
          await backupQueue.gate;
          return body();
        });
      };
    },
  };
});

/**
 * `boot.ts` imports `tightenTlsDir` directly, with no injection seam. This spy calls through to the
 * real one, so a test can make the trading start's call refuse without touching `ensureBoxSecrets`,
 * which calls its own module's copy.
 */
vi.mock("./box-secrets.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./box-secrets.js")>();
  return {
    ...actual,
    tightenTlsDir: vi.fn(actual.tightenTlsDir),
  };
});

// The tunnel spy is one shared module mock, so its calls accumulate across tests.
beforeEach(() => {
  vi.mocked(runTunnelClient).mockClear();
});

/**
 * `startServer` end to end: the field mapping in `boot.ts` — `config.scheduler.*` into
 * `SchedulerDeps`, `minTickMs`/`maxTickMs`, `onPass` into `recordPass`, the `settlementLagMs`
 * conditional spread, the migrations-root default — and the whole `close()` sequence.
 *
 * A passing pass alone does not pin `minTickMs`/`maxTickMs`: `loop.ts` runs the first pass before
 * any sleep. The first test therefore captures boot's stdout and asserts the logged `loop.sleeping`
 * line's `sleepMs`, which `sleepMsFor` derives from `maxTickMs` alone when nothing is due.
 *
 * The suite owns a venue DIRECTORY, because boot needs one and `useVenueDb` does not expose its own.
 * The suite's handle stays open across the file; reads beside a running server are safe in
 * write-ahead mode. A suite write beside a running server can make the server's pending-card-payment
 * sweep log `resolve_pending.failed` with `database is locked`; nothing here depends on that sweep.
 */
// The till's fiscal identity. Boot's trading branch requires a till, so every trading boot carries
// these through `KEY_ENV`; `beforeAll` seeds the tenant, location and node they name, which boot reads
// at startup.
const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};
// Resolves the fiscal slot to Veri*Factu: `ALL_MODULES` holds two fiscal-slot members, so the
// default-on set would refuse `module.fiscal_slot_ambiguous`. A test needing a different set overrides
// `WAITRON_STATE_DIR` after the `...KEY_ENV` spread.
const TRADING_STATE_DIR = mkdtempSync(join(tmpdir(), "waitron-boot-trading-state-"));
writeFileSync(
  join(TRADING_STATE_DIR, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const KEY_ENV = {
  // Keeps the plain-HTTP landing listener (default port 80, privileged) out of every boot test.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: TRADING_STATE_DIR,
  // Required by `loadConfig` in production.
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  ...TILL_ENV,
};

/**
 * The shared, migrated venue directory every boot below points `WAITRON_VENUE_DIR` at, plus the
 * suite's own open handle on it. The suite migrates it, not boot, because the identity rows have to
 * exist before boot reads them.
 */
let migrationsRoot: string;
let sharedVenueDir: string;
let sharedStore: VenueDatabase;
let sharedDb: Database;

/**
 * A venue directory this process cannot open, for the tests whose refusal must fire before any
 * storage is touched. An absent path would not do: `openVenueStore` creates its directory.
 */
const UNOPENABLE_VENUE_DIR = "/dev/null/venue";

beforeAll(async () => {
  sharedVenueDir = await mkdtemp(join(tmpdir(), "waitron-boot-venue-"));
  await applyMigrations(sharedVenueDir, migrationOptionsFor(manifestSets(), null));
  sharedStore = await openVenueDatabase(sharedVenueDir);
  sharedDb = sharedStore.venue;

  // `startServer` reads the location's `order_flow` at boot (`readOrderFlow`), so the location must
  // exist. A distinctive NIF (90M base) stays clear of every other seed generator.
  await sharedDb
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90000000K", legalName: "Boot Till SL" });
  await sharedDb.insert(locations).values({
    id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Barra",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta en establecimiento",
  });
  // `startServer` reads `nodes.filing_module` at boot (`readFilingModule`) and cross-checks it
  // against the enabled fiscal module.
  await sharedDb.insert(nodes).values({
    id: TILL_ENV.WAITRON_TILL_NODE_ID,
    locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Boot Till",
    filingModule: "verifactu",
  });
  await sharedDb.insert(tills).values({
    id: TILL_ENV.WAITRON_TILL_TILL_ID,
    locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Boot Till",
  });

  // `boot.ts`'s default migrations root exists only beside the bundle, where
  // `scripts/copy-migrations.mjs` builds it; this builds the same layout for `WAITRON_MIGRATIONS_DIR`.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-boot-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
}, 180_000);

// A `beforeAll` that threw before a `mkdtemp` returned must not add an `rm(undefined)` failure beside
// the real one.
afterAll(async () => {
  if (sharedStore !== undefined) await sharedStore.close();
  if (sharedVenueDir !== undefined) await rm(sharedVenueDir, { recursive: true, force: true });
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  await rm(TRADING_STATE_DIR, { recursive: true, force: true });
});

/**
 * A fresh, migrated venue directory and an open handle on it, for the provision tests:
 * `provisionVenue` stamps the `deployment` singleton and mints a venue, which would pollute the
 * shared directory every other test boots against.
 */
async function freshVenue(): Promise<{ directory: string; store: VenueDatabase }> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-boot-provision-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  return { directory, store: await openVenueDatabase(directory) };
}

/** An OS-assigned port, released before use: `WAITRON_HTTP_PORT` rejects `"0"`. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * Waits until `port` accepts a TCP connection. `startServer` resolves before its listener has bound,
 * and closing an unbound server rejects with `ERR_SERVER_NOT_RUNNING`.
 */
async function awaitListening(port: number): Promise<void> {
  for (let i = 0; i < POLL_TRIES; i += 1) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (up) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`the listener never bound 127.0.0.1:${port} within the poll budget`);
}

/** A `fetch` init that trusts `ca` for an HTTPS dial against a self-signed leaf. */
function httpsVia(ca: string | Buffer): {
  via: RequestInit & { dispatcher: Agent };
  close: () => Promise<void>;
} {
  const dispatcher = new Agent({ connect: { ca } });
  return {
    via: { dispatcher } as RequestInit & { dispatcher: Agent },
    close: () => dispatcher.close(),
  };
}

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

/** Polls `predicate` for its first defined result, or `undefined` once the budget is spent. */
const POLL_TRIES = 200;
const POLL_INTERVAL_MS = 50;

async function poll<T>(predicate: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < POLL_TRIES; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(POLL_INTERVAL_MS);
  }
  return undefined;
}

/**
 * GETs a `/health` URL until it answers 200: `/health` answers 503 until each duty's first clean
 * pass (`health.ts`), which a slow runner can still be waiting on.
 */
async function fetchHealthOk(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < POLL_TRIES; i += 1) {
    try {
      const r = await fetch(url, init);
      if (r.status === 200) return r;
      // An unconsumed body pins its connection, and across POLL_TRIES that would starve the pool.
      await r.body?.cancel();
    } catch (error) {
      // A connection error before the listener is up is the not-ready condition being polled for.
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `/health did not return 200 within the poll budget (${POLL_TRIES} x ${POLL_INTERVAL_MS}ms): ${url}${
      lastError === undefined ? "" : ` (last error: ${String(lastError)})`
    }`,
  );
}

async function waitForPass(state: { lastPassAt: Date | null }): Promise<void> {
  await poll(() => state.lastPassAt ?? undefined);
  expect(state.lastPassAt).not.toBeNull();
}

/** `boot.ts`'s listen-failure handler exits from `process.stdout.write`'s completion callback, a
 * later tick than the logged line, so a test polls for the exit. */
async function waitForExit(exits: readonly (number | undefined)[]): Promise<void> {
  await poll(() => (exits.length === 0 ? undefined : exits.length));
  expect(exits.length).toBeGreaterThan(0);
}

interface LogLine {
  event: string;
  [key: string]: unknown;
}

/**
 * `boot.ts` logs to `process.stdout.write` with no injection seam. Every chunk is still forwarded to
 * the real writer; `fn` sees the captured lines live as they arrive.
 */
async function withCapturedStdout<T>(fn: (lines: string[]) => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    lines.push(...String(chunk).split("\n").filter(Boolean));
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    return await fn(lines);
  } finally {
    process.stdout.write = original;
  }
}

/** Records `process.exit` calls instead of letting the listen-failure handler end the worker. */
async function withMockedExit<T>(fn: (exits: (number | undefined)[]) => Promise<T>): Promise<T> {
  const original = process.exit;
  const exits: (number | undefined)[] = [];
  process.exit = ((code?: number) => {
    exits.push(code);
    return undefined as never;
  }) as typeof process.exit;
  try {
    return await fn(exits);
  } finally {
    process.exit = original;
  }
}

/**
 * Records `process.kill` calls instead of letting the setup branch's default `requestRestart`
 * SIGTERM this process.
 */
async function withMockedKill<T>(
  fn: (kills: { pid: number; signal: string | number | undefined }[]) => Promise<T>,
): Promise<T> {
  const original = process.kill;
  const kills: { pid: number; signal: string | number | undefined }[] = [];
  process.kill = ((pid: number, signal?: string | number) => {
    kills.push({ pid, signal });
    return true;
  }) as typeof process.kill;
  try {
    return await fn(kills);
  } finally {
    process.kill = original;
  }
}

/** A valid ES-common venue body for `POST /setup-api/provision`, with plaintext admin secrets (the
 * endpoint hashes them). */
function provisionVenueBody(taxId: string) {
  return {
    country: "ES",
    taxId,
    legalName: "Deli Test SL",
    location: {
      name: "Sala principal",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Administradora",
      pin: "1234",
      password: "dashPass123",
      email: "admin@waitron.dev",
    },
  };
}

/** Parses a `KEY=value` env file, splitting on the FIRST `=` so a value's own `=` survives. */
function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/** The first captured line naming `event`, waiting for it to arrive rather than assuming it already
 * has — `lines` is being appended to concurrently by the loop running in the background. */
async function waitForEvent(lines: readonly string[], event: string): Promise<LogLine> {
  const found = await poll(() => {
    for (const line of lines) {
      let parsed: LogLine | undefined;
      try {
        parsed = JSON.parse(line) as LogLine;
      } catch {
        continue; // Not a JSON line — this logger only ever writes JSON, but don't assume it here.
      }
      if (parsed.event === event) return parsed;
    }
    return undefined;
  });
  if (found === undefined) {
    throw new Error(
      `expected a "${event}" log line within the wait window, saw: ${lines.join("\n")}`,
    );
  }
  return found;
}

async function assertPassiveManagementReads(port: number): Promise<void> {
  const [person] = await sharedDb
    .insert(persons)
    .values({ displayName: "Passive read probe", pinHash: hashPin("1234"), role: "manager" })
    .returning({ id: persons.id });
  const personId = person!.id;
  try {
    const session = await withTransaction(sharedDb, (tx) =>
      startManagementSession(tx, { personId }),
    );
    // Backdated in JavaScript, in the `toISOString()` spelling `@waitron/identity`'s own writers of
    // this column use, which is what makes the keepalive's staleness comparison a time ordering.
    const BACKDATE_MS = 10 * 60_000;
    const age = async (): Promise<string> => {
      const staleSeenAt = new Date(Date.now() - BACKDATE_MS).toISOString();
      return (
        await sharedDb.execute<{ seen: string }>(
          sql`update management_sessions set last_seen_at = ${staleSeenAt} where token_hash = ${hashSessionToken(session.token)} returning last_seen_at as seen`,
        )
      ).rows[0]!.seen;
    };
    const seen = async (): Promise<string> =>
      (
        await sharedDb.execute<{ seen: string }>(
          sql`select last_seen_at as seen from management_sessions where token_hash = ${hashSessionToken(session.token)}`,
        )
      ).rows[0]!.seen;
    const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    const before = await age();
    const cloud = await fetch(`http://127.0.0.1:${port}/management-api/cloud/status`, {
      headers: { cookie },
    });
    expect(cloud.status).toBe(200);
    expect(await cloud.json()).toMatchObject({ configured: false, state: "not_connected" });
    expect(await seen()).toBe(before);
    const passive = await fetch(`http://127.0.0.1:${port}/management-api/printers`, {
      headers: { cookie, "x-waitron-live": "1" },
    });
    expect(passive.status).toBe(200);
    await passive.text();
    expect(await seen()).toBe(before);
    const normal = await fetch(`http://127.0.0.1:${port}/management-api/printers`, {
      headers: { cookie },
    });
    expect(normal.status).toBe(200);
    await normal.text();
    expect(await seen()).not.toBe(before);
    const beforeMutation = await age();
    const mutation = await fetch(
      `http://127.0.0.1:${port}/management-api/printer-discovery/start`,
      {
        method: "POST",
        headers: { cookie, "x-waitron-live": "1", origin: "https://dashboard.example.com" },
      },
    );
    expect(mutation.status).toBe(200);
    await mutation.text();
    expect(await seen()).not.toBe(beforeMutation);
  } finally {
    await sharedDb.execute(sql`delete from management_sessions where person_id = ${personId}`);
    await sharedDb.execute(sql`delete from persons where id = ${personId}`);
  }
}

describe("startServer, against a migrated venue directory", () => {
  it("boots and serves local requests when a saved Cloud replacement cannot be resumed", async () => {
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-replacement-"));
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    await writeFile(join(stateDir, "cloud-replacement.json"), "corrupt", { mode: 0o600 });
    let server: StartedServer | undefined;
    try {
      server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_CLOUD_ORIGIN: "https://cloud.example.test",
      });
      const response = await fetchHealthOk(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
    } finally {
      await server?.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  });
  it("boots, pins the tick-clamp mapping, folds settlementLagMs, threads environment, runs a pass, serves /health and shuts down cleanly", async () => {
    const port = await freePort();
    // Read back below to show the rotating file sink is wired into `startServer`.
    const logDir = await mkdtemp(join(tmpdir(), "waitron-boot-logs-"));
    const [server, sleeping, listening] = await withCapturedStdout(async (lines) => {
      const started = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_LOG_DIR: logDir,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        // Distinctive and far apart, so a swapped mapping shows as 1000 rather than 94327.
        WAITRON_MIN_TICK_MS: "1000",
        WAITRON_MAX_TICK_MS: "94327",
        // Within [minTickMs, maxTickMs] only to satisfy `loadConfig`; nothing due is seeded, so it
        // plays no part in `sleeping.sleepMs`.
        WAITRON_SKIP_RETRY_MS: "9000",
        WAITRON_SETTLEMENT_LAG_MS: "1000",
        // The non-default value: `preproduction` is also what a hardcoded argument would produce.
        WAITRON_ENV: "production",
      });
      // `loop.ts` logs `loop.sleeping` after `onPass` runs, so this also shows the first pass done.
      const event = await waitForEvent(lines, "loop.sleeping");
      const listeningEvent = await waitForEvent(lines, "server.listening");
      return [started, event, listeningEvent] as const;
    });

    try {
      // With nothing due, both duties report `nextDueAt: null`, for which `sleepMsFor` returns
      // `maxTickMs` verbatim.
      expect(sleeping.sleepMs).toBe(94327);

      // Pins that `config.environment` reaches boot's runtime, not only `loadConfig`'s return value.
      expect(listening.environment).toBe("production");
      expect(listening.port).toBe(port);

      expect(server.health.startedAt).toBeInstanceOf(Date);
      expect(server.health.lastPassAt).not.toBeNull();
      expect(
        Object.values(server.health.duties).every((duty) => duty.consecutiveFailures === 0),
      ).toBe(true);

      const response = await fetchHealthOk(`http://127.0.0.1:${port}/health`);
      const body = (await response.json()) as { ok: boolean; venueHolder: unknown };
      expect(body.ok).toBe(true);
      // The booted server holds its own venue folder, so it reports itself, from the holder file.
      expect(body.venueHolder).toMatchObject({ stale: false });

      // `GET /api/staff` needs no session and, with no staff seeded, answers `[]`; a 404 would mean
      // `mountTillApi` never ran.
      const staff = await fetch(`http://127.0.0.1:${port}/api/staff`);
      expect(staff.status).toBe(200);
      // `requestIdMiddleware` wraps the routes mounted after it.
      expect(staff.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(await staff.json()).toEqual([]);
      await assertPassiveManagementReads(port);

      // Fully gated, so 401 rather than 404; a 404 would mean `mountCatalogueApi` never ran.
      const catalogues = await fetch(`http://127.0.0.1:${port}/management-api/catalogues`);
      expect(catalogues.status).toBe(401);
      expect((await catalogues.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });

      const recipe = await fetch(
        `http://127.0.0.1:${port}/management-api/products/${randomUUID()}/recipe`,
      );
      expect(recipe.status).toBe(404);

      // A 404 would mean `mountRecoveryBundleApi` never ran; a 200, that a secret download is ungated.
      const recovery = await fetch(`http://127.0.0.1:${port}/api/box/recovery-bundle`, {
        method: "POST",
      });
      expect(recovery.status).toBe(401);
      expect((await recovery.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });

      // `server.listening` is an `info` event, so the file half of the tee'd logger appended it.
      expect(existsSync(join(logDir, "waitron.log"))).toBe(true);
      const logText = await readFile(join(logDir, "waitron.log"), "utf8");
      expect(logText).toContain('"event":"server.listening"');

      // Trading mode ran boot's one `applyMigrations`, before the mode branch. A consistency check:
      // `beforeAll` pre-migrated this directory, so the from-empty proof is the setup-mode
      // fresh-database test below.
      for (const set of orderedMigrationSets(ALL_MODULES)) {
        const expected = expectedSchemaVersion(set, migrationsRoot);
        // `fiscal-none` owns an EMPTY migration set (it has no tables), so its version is legitimately
        // 0; every other set ships migrations, so `> 0` is the control that a real set was measured.
        if (set.name === "fiscal-none") expect(expected).toBe(0);
        else expect(expected).toBeGreaterThan(0);
        expect(await appliedSchemaVersion(sharedDb, set)).toBe(expected);
      }
    } finally {
      await server.close();
      await rm(logDir, { recursive: true, force: true });
    }

    await expect(server.close()).resolves.toBeUndefined();

    // The listener actually closed: a request against the same port now fails to connect rather
    // than hanging or succeeding against a server that never really stopped.
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  }, 60_000);

  it("boots in setup mode over HTTPS from a minted self-signed cert, serves /setup-api/status, refuses plain HTTP, and does not mount the trading routes", async () => {
    // Setup mode: no `WAITRON_TILL_*` ids and no credentials key. Boot still migrates, but mounts only
    // /health and the unauthenticated setup surface, over HTTPS from a cert it mints
    // (`ensureBoxSecrets`). `WAITRON_STATE_DIR` is required here: without it `ensureBoxSecrets` would
    // write into `boot.ts`'s from-source default (`apps/server/src/state`) and pollute the checkout.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-state-"));
    const server = await startServer({
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
    });
    // The leaf carries `127.0.0.1` as an IP SAN, so a loopback dial verifies against the minted CA.
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const { via, close } = httpsVia(ca);
    try {
      // `config.environment` threads through the setup branch into `mountSetup`.
      const publicStatus = await fetch(`https://127.0.0.1:${port}/public/availability`, via);
      expect(publicStatus.status).toBe(503);
      expect(await publicStatus.json()).toEqual({ available: false });
      const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, via);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
      });

      // The placeholder shell answers any unclaimed path (200 HTML) over HTTPS too.
      const root = await fetch(`https://127.0.0.1:${port}/`, via);
      expect(root.status).toBe(200);
      expect(root.headers.get("content-type")).toContain("text/html");
      expect(await root.text()).toMatch(/set ?up/i);

      // /health still answers (503: a setup box runs no duty loop); only that it answers is asserted.
      const health = await fetch(`https://127.0.0.1:${port}/health`, via);
      expect(health.status).toBeLessThan(600);

      // The trading routes are not mounted: /api/staff falls to the setup catch-all's HTML, not the
      // trading roster's JSON.
      const staff = await fetch(`https://127.0.0.1:${port}/api/staff`, via);
      expect(staff.status).toBe(200);
      expect(staff.headers.get("content-type")).toContain("text/html");
      expect(await staff.text()).toMatch(/set ?up/i);

      expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toMatch(
        /WAITRON_CREDENTIALS_KEY=/,
      );

      // A plain-HTTP dial to the TLS port is torn down.
      await expect(fetch(`http://127.0.0.1:${port}/setup-api/status`)).rejects.toThrow();
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
    }
    // The probe trusts the box's CA, so a still-listening server would answer rather than reject; a
    // CA-blind fetch would reject either way.
    await expect(server.close()).resolves.toBeUndefined();
    const afterClose = httpsVia(ca);
    try {
      await expect(fetch(`https://127.0.0.1:${port}/health`, afterClose.via)).rejects.toThrow();
    } finally {
      await afterClose.close();
    }
  }, 60_000);

  it("boots in trading mode over HTTPS from the box's minted leaf and refuses plain HTTP", async () => {
    // A box never sets `WAITRON_TLS_*`, so trading must fall back to the minted leaf; plain HTTP there
    // gives every phone and till already trusting the box a handshake error. The state dir carries a
    // real minted leaf, the shape a box has after one setup boot.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-trading-tls-"));
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
      // Override the shared TRADING_STATE_DIR with this box's own dir — the one holding the leaf.
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
    });
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const { via, close } = httpsVia(ca);
    try {
      const health = await fetchHealthOk(`https://127.0.0.1:${port}/health`, via);
      expect(health.status).toBe(200);

      const trust = await fetch(`https://127.0.0.1:${port}/setup/trust`, via);
      expect(trust.status).toBe(200);
      expect(await trust.text()).toContain("to this Waitron server");
      for (const path of ["/ca.crt", "/setup-api/ca.crt"]) {
        const download = await fetch(`https://127.0.0.1:${port}${path}`, via);
        expect(download.status).toBe(200);
        expect(await download.text()).toBe(ca.toString());
      }
      expect((await fetch(`https://127.0.0.1:${port}/setup-api/discovery`, via)).status).toBe(404);

      // The control: a plain-HTTP dial to the same port is torn down.
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  describe("a trading start and the box's tls folder", () => {
    async function tradingStateDir(prefix: string): Promise<string> {
      const stateDir = await mkdtemp(join(tmpdir(), prefix));
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { "fiscal-none": false } }),
      );
      return stateDir;
    }

    function startTrading(stateDir: string, port: number) {
      return startServer(
        {
          ...KEY_ENV,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_VENUE_DIR: sharedVenueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0",
        },
        {},
      );
    }

    function tightenFailures(lines: readonly string[]): string[] {
      return lines.filter((line) => {
        try {
          return (JSON.parse(line) as LogLine).event === "tls.tighten_failed";
        } catch {
          return false;
        }
      });
    }

    it("makes a group- and world-readable tls folder owner-only", async () => {
      const port = await freePort();
      const stateDir = await tradingStateDir("waitron-boot-tls-mode-");
      await ensureBoxSecrets({ stateDir, hostnames: ["localhost"], now: () => new Date() });
      await chmod(join(stateDir, "tls"), 0o755);
      const server = await startTrading(stateDir, port);
      try {
        expect((await stat(join(stateDir, "tls"))).mode & 0o777).toBe(0o700);
      } finally {
        await server.close();
        await rm(stateDir, { recursive: true, force: true });
      }
    }, 60_000);

    it("leaves a linked tls folder, and the folder it points to, as it found them, and still serves", async () => {
      await withCapturedStdout(async (lines) => {
        const port = await freePort();
        const stateDir = await tradingStateDir("waitron-boot-tls-link-");
        const elsewhere = await mkdtemp(join(tmpdir(), "waitron-boot-tls-elsewhere-"));
        await ensureBoxSecrets({
          stateDir: elsewhere,
          hostnames: ["localhost"],
          now: () => new Date(),
        });
        await chmod(join(elsewhere, "tls"), 0o755);
        await symlink(join(elsewhere, "tls"), join(stateDir, "tls"));
        const server = await startTrading(stateDir, port);
        const { via, close } = httpsVia(await readFile(join(elsewhere, "tls", "ca.crt")));
        try {
          expect((await fetchHealthOk(`https://127.0.0.1:${port}/health`, via)).status).toBe(200);
          expect((await lstat(join(stateDir, "tls"))).isSymbolicLink()).toBe(true);
          expect((await stat(join(elsewhere, "tls"))).mode & 0o777).toBe(0o755);
          expect(tightenFailures(lines)).toEqual([]);
        } finally {
          await server.close();
          await close();
          await rm(stateDir, { recursive: true, force: true });
          await rm(elsewhere, { recursive: true, force: true });
        }
      });
    }, 60_000);

    it("creates no tls folder on a box that has none, and logs no failure for it", async () => {
      await withCapturedStdout(async (lines) => {
        const port = await freePort();
        const stateDir = await tradingStateDir("waitron-boot-tls-none-");
        const server = await startTrading(stateDir, port);
        try {
          expect((await fetchHealthOk(`http://127.0.0.1:${port}/health`)).status).toBe(200);
          expect(existsSync(join(stateDir, "tls"))).toBe(false);
          expect(tightenFailures(lines)).toEqual([]);
        } finally {
          await server.close();
          await rm(stateDir, { recursive: true, force: true });
        }
      });
    }, 60_000);

    it.each([
      ["rejects", (refusal: Error) => vi.mocked(tightenTlsDir).mockRejectedValueOnce(refusal)],
      [
        "throws before it returns",
        (refusal: Error) =>
          vi.mocked(tightenTlsDir).mockImplementationOnce(() => {
            throw refusal;
          }),
      ],
    ])(
      "logs a failure to tighten it and keeps serving, when the call %s",
      async (_, refuse) => {
        await withCapturedStdout(async (lines) => {
          const port = await freePort();
          const stateDir = await tradingStateDir("waitron-boot-tls-refused-");
          await mkdir(join(stateDir, "tls"));
          refuse(
            Object.assign(new Error(`EPERM: operation not permitted, ${stateDir}`), {
              code: "EPERM",
            }),
          );
          const server = await startTrading(stateDir, port);
          try {
            expect((await fetchHealthOk(`http://127.0.0.1:${port}/health`)).status).toBe(200);
            const line = await waitForEvent(lines, "tls.tighten_failed");
            expect(line).toMatchObject({ level: "warn", errno: "EPERM" });
            expect(JSON.stringify(line)).not.toContain(stateDir);
          } finally {
            await server.close();
            await rm(stateDir, { recursive: true, force: true });
          }
        });
      },
      60_000,
    );
  });

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
    await writeFile(join(stateDir, "trading.env"), "WAITRON_TILL_TILL_ID=boot-sealed\n");
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
  // fenced case would otherwise come up read-only and put off its restore's checks, as a mirror does.
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
      if (withPeer) {
        await writeMirrorConfig(db, TILL_ENV.WAITRON_TILL_NODE_ID, {
          relayUrl: `http://127.0.0.1:${await freePort()}`,
          boxHostname: "waitron.local",
          boxCaPem: "unused",
          originNodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        });
      }
      const port = await freePort();
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

  // The only suite that observes boot's own wiring of the advertised addresses
  // (`box-secrets.test.ts` injects its own `listIpv4`): the override must reach both the leaf on disk
  // and `mountDiscovery`'s deps.
  it("setup mode mints the leaf for WAITRON_BOX_ADDRESSES and serves it as the discovery address", async () => {
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-box-addresses-"));
    // A private address inside the box CA's permitted name space that this host is unlikely to hold,
    // so the negative assertion below shows the override, not a resolved interface, is in the SAN.
    const override = "10.1.2.3";
    const server = await startServer({
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
      WAITRON_BOX_ADDRESSES: override,
    });
    try {
      const leaf = new X509Certificate(await readFile(join(stateDir, "tls", "server.crt"), "utf8"));
      const san = leaf.subjectAltName ?? "";
      const ca = await readFile(join(stateDir, "tls", "ca.crt"));
      expect(san).toContain(override);
      // Every address `listBoxIpv4()` finds must be absent, or boot resolved the interfaces despite
      // the override.
      for (const address of listBoxIpv4()) {
        expect(san).not.toContain(address);
      }

      // Discovery reads the override through `mountDiscovery`'s deps, a separate call site from the
      // cert above.
      const { via, close } = httpsVia(ca);
      try {
        const discovery = await fetch(`https://127.0.0.1:${port}/setup-api/discovery`, via);
        expect(discovery.status).toBe(200);
        const body = (await discovery.json()) as { addresses: string[]; qrTarget: string };
        expect(body.addresses).toEqual([override]);
        expect(body.qrTarget).toBe(`https://${override}:${port}`);
      } finally {
        await close();
      }
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode migrates every module set from an EMPTY database — boot is the sole migrator (SP-1a)", async () => {
    // Boot alone must migrate every module set. The other boot tests share a directory this suite
    // migrated, so their journals are populated whether or not boot's migration ran; this one starts
    // from an empty directory. Setup mode needs no seeded venue, so it is the mode that can boot a
    // fresh database, and the deployment probe that runs before migrations reads `null` on it.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-empty-state-"));
    const venueDir = await mkdtemp(join(tmpdir(), "waitron-boot-empty-venue-"));
    let server: StartedServer | undefined;
    let probe: VenueDatabase | undefined;
    try {
      server = await startServer({
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_ENV: "preproduction",
        WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
      });

      probe = await openVenueDatabase(venueDir);
      // `expected > 0` is the control: an empty journal would make `0 === 0` pass. `fiscal-none`
      // ships no migrations, so its version is legitimately 0.
      const sets = orderedMigrationSets(ALL_MODULES);
      expect(sets).toHaveLength(13);
      for (const set of sets) {
        const expected = expectedSchemaVersion(set, migrationsRoot);
        if (set.name === "fiscal-none") expect(expected).toBe(0);
        else expect(expected).toBeGreaterThan(0);
        expect(await appliedSchemaVersion(probe.venue, set)).toBe(expected);
      }
    } finally {
      if (probe !== undefined) await probe.close();
      if (server !== undefined) await server.close();
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("trading mode migrates ONLY the modules.json-enabled sets, skipping a disabled toggleable module (SP-1b)", async () => {
    // A trading boot migrates only the sets `<stateDir>/modules.json` enables. Only an empty directory
    // can show a skip: the shared one already carries every journal. This boot throws after the
    // migration seam (a disabled module, and no seeded venue for `readOrderFlow`), so the assertion is
    // on the resulting journals, not on boot success.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-modules-filter-state-"));
    // `scheduler` is toggleable and owns `__drizzle_migrations_scheduler`.
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { scheduler: false } }),
    );
    const venueDir = await mkdtemp(join(tmpdir(), "waitron-boot-filter-venue-"));
    let server: StartedServer | undefined;
    let probe: VenueDatabase | undefined;
    try {
      try {
        server = await startServer({
          ...KEY_ENV,
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
        });
      } catch {
        // Expected: the throw comes after the migration seam this test asserts.
      }
      probe = await openVenueDatabase(venueDir);
      // A scalar subquery answers one row whose column is NULL when the table is missing, where an
      // empty result would also be what a query selecting nothing at all returns.
      const schedulerReg = await probe.venue.execute<{ reg: string | null }>(
        sql.raw(
          `select (select name from sqlite_master where type = 'table' and name = '__drizzle_migrations_scheduler') as reg`,
        ),
      );
      expect(schedulerReg.rows[0]!.reg).toBeNull();
      // The filter kept every enabled set: `payments` is enabled by default.
      const payments = ALL_MODULES.find((m) => m.name === "payments")!;
      const paymentsExpected = expectedSchemaVersion(payments.migrations, migrationsRoot);
      expect(paymentsExpected).toBeGreaterThan(0);
      expect(await appliedSchemaVersion(probe.venue, payments.migrations)).toBe(paymentsExpected);
      // `enabledModules` never drops `core`, whatever modules.json says.
      const core = ALL_MODULES.find((m) => m.name === "core")!;
      const coreExpected = expectedSchemaVersion(core.migrations, migrationsRoot);
      expect(coreExpected).toBeGreaterThan(0);
      expect(await appliedSchemaVersion(probe.venue, core.migrations)).toBe(coreExpected);
    } finally {
      if (probe !== undefined) await probe.close();
      if (server !== undefined) await server.close();
      await rm(stateDir, { recursive: true, force: true });
      await rm(venueDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("trading mode logs module.reconcile drift naming a soft-disabled module (SP-1b spec §3)", async () => {
    // A module the database has migrated but modules.json no longer enables is `softDisabled`, and
    // boot logs it at `info`. The shared directory is migrated for every module and seeded, so this
    // boot succeeds.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-drift-state-"));
    // `fiscal-none` disabled too, so the fiscal slot resolves to the seeded node's Veri*Factu.
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { scheduler: false, "fiscal-none": false } }),
    );
    let server: StartedServer | undefined;
    try {
      const [started, reconcileLine] = await withCapturedStdout(async (lines) => {
        const s = await startServer({
          ...KEY_ENV,
          WAITRON_VENUE_DIR: sharedVenueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "production",
          WAITRON_MIN_TICK_MS: "50",
          WAITRON_MAX_TICK_MS: "200",
          WAITRON_SKIP_RETRY_MS: "100",
        });
        const found = await waitForEvent(lines, "module.reconcile");
        return [s, found] as const;
      });
      server = started;
      // The listener may not have bound yet, so the close would refuse — see `awaitListening`.
      await awaitListening(port);
      expect(reconcileLine.softDisabled).toEqual(["scheduler"]);
      expect(reconcileLine.toMigrate).toEqual([]);
    } finally {
      if (server !== undefined) await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses a trading boot whose enabled set drops a dependency (identity off, workforce on) BEFORE migrating (SP-1c)", async () => {
    // Boot must refuse an enabled set that is not dependency-complete before `applyMigrations`, not
    // fail mid-migration. `workforce` requires `identity`, and both are toggleable. `...KEY_ENV` keeps
    // this in trading mode; setup mode migrates the full set and never filters.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-depmissing-state-"));
    try {
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { identity: false } }),
      );
      await expect(
        startServer({
          ...KEY_ENV,
          WAITRON_VENUE_DIR: sharedVenueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
        }),
      ).rejects.toMatchObject({
        code: "module.dependency_missing",
        params: { module: "workforce", requires: "identity" },
      });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses a trading boot whose enabled set fills no fiscal slot (fiscal off) — module.fiscal_slot_empty", async () => {
    // The fiscal backend comes from whichever enabled module fills the `fiscal` seat; with neither
    // fiscal-slot member enabled, a trading boot must refuse rather than mount till routes that
    // cannot chain a sale. Disabling only Veri*Factu would leave `fiscal-none` in the slot, and the
    // seeded `verifactu` node would refuse with `fiscal_slot_mismatch` instead.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-fiscaloff-state-"));
    try {
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { "fiscal-verifactu": false, "fiscal-none": false } }),
      );
      await expect(
        startServer({
          ...KEY_ENV,
          WAITRON_VENUE_DIR: sharedVenueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
        }),
      ).rejects.toMatchObject({ code: "module.fiscal_slot_empty" });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode serves the built setup wizard at / end-to-end when WAITRON_SETUP_APP_DIR is configured", async () => {
    // `config.setupAppDir` threads through boot's setup branch into `mountSetup`'s `mountSpa`, so
    // `GET /` serves the built wizard rather than the inline placeholder.
    const wizardApp = mkdtempSync(join(tmpdir(), "waitron-boot-setup-spa-"));
    writeFileSync(join(wizardApp, "index.html"), "<html>setup-wizard-served-e2e</html>");
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-spa-state-"));
    const server = await startServer({
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
      WAITRON_SETUP_APP_DIR: wizardApp,
    });
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const { via, close } = httpsVia(ca);
    try {
      const root = await fetch(`https://127.0.0.1:${port}/`, via);
      expect(root.status).toBe(200);
      expect(root.headers.get("content-type")).toContain("text/html");
      const text = await root.text();
      expect(text).toContain("setup-wizard-served-e2e"); // the built wizard
      expect(text).not.toContain("needs setup"); // NOT the inline placeholder shell

      // The setup API still answers as JSON: the wizard's `mountSpa` catch-all (registered LAST) did not
      // shadow /setup-api/status.
      const publicStatus = await fetch(`https://127.0.0.1:${port}/public/availability`, via);
      expect(publicStatus.status).toBe(503);
      expect(await publicStatus.json()).toEqual({ available: false });
      const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, via);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
      });
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
      rmSync(wizardApp, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
    }
  }, 60_000);

  it("fails the boot LOUDLY when WAITRON_SETUP_APP_DIR is set but holds no index.html, naming the var", async () => {
    // A configured-but-unbuilt wizard dir fails the boot before storage is touched; were the check to
    // run after the stamp probe, the unopenable venue directory would fail with `ENOTDIR` instead.
    const emptyDir = mkdtempSync(join(tmpdir(), "waitron-boot-setup-noindex-"));
    try {
      let caught: unknown;
      try {
        await startServer({
          WAITRON_VENUE_DIR: UNOPENABLE_VENUE_DIR,
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_MIN_TICK_MS: "50",
          WAITRON_MAX_TICK_MS: "200",
          WAITRON_SKIP_RETRY_MS: "100",
          WAITRON_SETUP_APP_DIR: emptyDir,
        });
      } catch (error) {
        caught = error;
      }
      expect(isAppError(caught)).toBe(true);
      expect(isAppError(caught) && caught.code).toBe("server.config_invalid");
      // Names the env var the operator must fix and a reason CODE, never the path itself — the no-leak,
      // name-the-variable discipline every other `server.config_invalid` follows.
      expect(isAppError(caught) && caught.params).toEqual({
        variable: "WAITRON_SETUP_APP_DIR",
        reason: "missing_index_html",
      });
    } finally {
      rmSync(emptyDir, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
    }
  });

  it.each([
    ["preproduction", 500],
    ["production", 503],
  ] as const)(
    "%s setup boot gates the Cloud recovery seat",
    async (environment, expectedStatus) => {
      const port = await freePort();
      const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-cloud-seat-state-"));
      const venueDir = await mkdtemp(join(tmpdir(), "waitron-boot-cloud-seat-venue-"));
      let server: StartedServer | undefined;
      try {
        server = await startServer({
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: environment,
          WAITRON_CLOUD_ORIGIN: "https://cloud.example.test",
          WAITRON_HTTP_LANDING_PORT: "0",
          ...(environment === "production"
            ? {
                WAITRON_MANAGEMENT_RP_ID: "localhost",
                WAITRON_MANAGEMENT_ORIGIN: `https://localhost:${port}`,
              }
            : {}),
        });
        const { via, close } = httpsVia(await readFile(join(stateDir, "tls", "ca.crt")));
        try {
          const response = await fetch(
            `https://127.0.0.1:${port}/setup-api/cloud-recovery/status`,
            via,
          );
          expect(response.status).toBe(expectedStatus);
          const body = await response.json();
          expect(body.error.code).toBe(
            environment === "production" ? "setup.not_ready" : "server.internal",
          );
        } finally {
          await close();
        }
      } finally {
        await server?.close();
        await rm(stateDir, { recursive: true, force: true });
        await rm(venueDir, { recursive: true, force: true });
      }
    },
  );

  it("setup mode serves the discovery JSON, the CA download, and the trust page over HTTPS (slice 3)", async () => {
    // Requests trust the persisted box CA, exercising the real listener and boot route mounting.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-disc-"));
    const server = await startServer({
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
    });
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const { via, close } = httpsVia(ca);
    try {
      // The machine-readable discovery document: this box's hostname plus whether its CA is
      // downloadable. `caDownloadAvailable` is TRUE because the shared setup path minted the box's own
      // self-signed CA at <stateDir>/tls/ca.crt (the file `ca` above was just read from).
      const disc = await fetch(`https://127.0.0.1:${port}/setup-api/discovery`, via);
      expect(disc.status).toBe(200);
      expect(await disc.json()).toMatchObject({
        hostname: "waitron.local",
        caDownloadAvailable: true,
      });

      // The CA download — served as a named attachment so a device can install and trust it.
      const crt = await fetch(`https://127.0.0.1:${port}/setup-api/ca.crt`, via);
      expect(crt.status).toBe(200);
      expect(crt.headers.get("content-disposition")).toContain("waitron-ca.crt");

      // The server-rendered trust page — HTML, self-contained, over HTTPS.
      const trust = await fetch(`https://127.0.0.1:${port}/setup/trust`, via);
      expect(trust.status).toBe(200);
      expect(trust.headers.get("content-type")).toContain("text/html");
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode serves an operator-supplied WAITRON_TLS_* cert while STILL generating its own box secrets", async () => {
    // The operator's `WAITRON_TLS_*` cert is the front door, but `ensureBoxSecrets` runs on every setup
    // boot, so `secrets.env` is still written.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-op-tls-"));
    const certDir = await mkdtemp(join(tmpdir(), "waitron-boot-op-cert-"));
    // Signed by a separate, unconstrained CA, as a real operator's would be. The client trusts only
    // that CA, so a completed handshake shows the operator leaf was served.
    const material = mintMtlsMaterial();
    const certFile = join(certDir, "operator.crt");
    const keyFile = join(certDir, "operator.key");
    await writeFile(certFile, material.serverCertPem);
    await writeFile(keyFile, material.serverKeyPem);

    const server = await startServer({
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_TLS_CERT_FILE: certFile,
      WAITRON_TLS_KEY_FILE: keyFile,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
    });
    const { via, close } = httpsVia(material.caPem);
    try {
      const publicStatus = await fetch(`https://127.0.0.1:${port}/public/availability`, via);
      expect(publicStatus.status).toBe(503);
      expect(await publicStatus.json()).toEqual({ available: false });
      const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, via);
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ provisioned: false });

      // The box still generated its own secrets under operator TLS.
      expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toMatch(
        /WAITRON_CREDENTIALS_KEY=/,
      );

      // The box's own fallback leaf was minted too, so a later boot that drops the operator vars still
      // has a cert to serve.
      expect(existsSync(join(stateDir, "tls", "server.crt"))).toBe(true);
      const discovery = await fetch(`https://127.0.0.1:${port}/setup-api/discovery`, via);
      expect(await discovery.json()).toMatchObject({ caDownloadAvailable: false });
      for (const path of ["/ca.crt", "/setup-api/ca.crt"]) {
        expect((await fetch(`https://127.0.0.1:${port}${path}`, via)).status).toBe(404);
      }
      const help = await fetch(`https://127.0.0.1:${port}/setup/trust`, via);
      expect(await help.text()).not.toContain('download="waitron-ca.crt"');
    } finally {
      await server.close();
      await close();
      await rm(stateDir, { recursive: true, force: true });
      await rm(certDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: rejects when startListening fails (missing operator TLS file)", async () => {
    // `config.tls` names files that do not exist, so `startListening` throws inside the setup branch,
    // after it opened `db`. This suite holds the shared folder itself, so the close is checked in
    // `boot.failed-start.test.ts`; only the rejection is asserted here.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-setup-tls-missing-"));
    try {
      await expect(
        startServer({
          WAITRON_VENUE_DIR: sharedVenueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          // `loadConfig` does not check these paths exist, so the throw comes from reading them.
          WAITRON_TLS_CERT_FILE: join(stateDir, "does-not-exist.crt"),
          WAITRON_TLS_KEY_FILE: join(stateDir, "does-not-exist.key"),
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
        }),
      ).rejects.toThrow();
      // `ensureBoxSecrets` runs before `startListening`, so the secrets exist though the boot rejected.
      expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toMatch(
        /WAITRON_CREDENTIALS_KEY=/,
      );
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: POST /setup-api/provision provisions a demo venue, writes trading.env, stamps preproduction, and requests a restart", async () => {
    // The whole provisioning flow through the real endpoint, on a fresh venue directory:
    // `provisionVenue` stamps the `deployment` singleton and mints a venue, which would pollute the
    // shared one.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-provision-state-"));
    const venue = await freshVenue();
    const check = venue.store.venue;
    try {
      await withMockedKill(async (kills) => {
        const server = await startServer({
          WAITRON_VENUE_DIR: venue.directory,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
          // Distinct from the `managementOrigin` default (`http://localhost:5191`), so the contactUrl
          // assertion below tells the two apart.
          WAITRON_ADVERTISED_ORIGIN: "https://box.deli.test",
        });
        const ca = await readFile(join(stateDir, "tls", "ca.crt"));
        const { via, close } = httpsVia(ca);
        try {
          // A valid DEMO venue, no `aeatCert` (a plain demo box files nothing to AEAT).
          const body = { mode: "demo", venue: provisionVenueBody("60000009R") };
          const response = await fetch(`https://127.0.0.1:${port}/setup-api/provision`, {
            ...via,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(200);
          const json = (await response.json()) as { provisioned: boolean };
          expect(json.provisioned).toBe(true);

          // Parsed, not substring-matched, so a missing key really fails.
          const trading = parseEnvLines(await readFile(join(stateDir, "trading.env"), "utf8"));
          for (const key of [
            "WAITRON_TILL_TILL_ID",
            "WAITRON_TILL_NODE_ID",
            "WAITRON_TILL_SERIES_ID",
            "WAITRON_TILL_LOCATION_ID",
          ]) {
            expect(trading[key]).toBeTruthy();
          }
          expect(trading.WAITRON_ENV).toBe("preproduction");

          expect(await readDeploymentEnvironment(check)).toBe("preproduction");
          const tenants = await check.execute<{ n: number }>(
            sql`select cast(count(*) as int) as n from tenants`,
          );
          expect(tenants.rows[0]!.n).toBe(1);
          const nodes = await check.execute<{ n: number }>(
            sql`select cast(count(*) as int) as n from nodes`,
          );
          expect(nodes.rows[0]!.n).toBe(1);

          // Provisioning established the node's membership identity: its public key makes it the
          // venue's sole trust anchor.
          const trust = await readMembershipTrustSet(check);
          expect(Object.keys(trust)).toHaveLength(1);
          expect(Object.values(trust)[0]).toMatch(/.+/);

          // The term-0 document names this primary at `config.advertisedOrigin`, the origin tills
          // route on, not `managementOrigin`.
          const held = await readNodeMembership(check);
          expect(held?.body.nodes).toEqual([
            {
              nodeId: trading.WAITRON_TILL_NODE_ID,
              contactUrl: "https://box.deli.test",
              standing: "serving-primary",
            },
          ]);

          // The restart is requested after the 200 flushes, as a SIGTERM to this process.
          await poll(() => (kills.length > 0 ? kills.length : undefined));
          expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
        } finally {
          await close();
          await server.close();
        }
      });
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: a DEMO provision carrying an AEAT cert is REFUSED (400) — nothing provisioned or sealed", async () => {
    // The AEAT signing cert is meaningful only for a live ES-common venue, so a demo body carrying one
    // is refused before `provision`: the box never seals a real AEAT cert into a preproduction vault.
    // The cert is well-formed, so the refusal is the not-expected gate, not `validateAeatCert`.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-provision-reject-state-"));
    const venue = await freshVenue();
    const check = venue.store.venue;
    const material = mintMtlsMaterial();
    try {
      await withMockedKill(async (kills) => {
        const server = await startServer({
          WAITRON_VENUE_DIR: venue.directory,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
        });
        const ca = await readFile(join(stateDir, "tls", "ca.crt"));
        const { via, close } = httpsVia(ca);
        try {
          const body = {
            mode: "demo",
            venue: provisionVenueBody("60000011A"),
            aeatCert: {
              pfxBase64: material.clientPfx.toString("base64"),
              passphrase: material.clientPassphrase,
              certKind: "representante",
            },
          };
          const response = await fetch(`https://127.0.0.1:${port}/setup-api/provision`, {
            ...via,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(400);
          const json = (await response.json()) as {
            error: { code: string; params: { field?: string } };
          };
          expect(json.error.code).toBe("setup.request_invalid");
          expect(json.error.params.field).toBe("aeatCert");

          const tenants = await check.execute<{ n: number }>(
            sql`select cast(count(*) as int) as n from tenants`,
          );
          expect(tenants.rows[0]!.n).toBe(0);
          const sealed = await check.execute<{ n: number }>(
            sql`select cast(count(*) as int) as n from tenant_credentials where purpose = 'fiscal.aeat'`,
          );
          expect(sealed.rows[0]!.n).toBe(0);

          await delay(50);
          expect(kills).toEqual([]);
        } finally {
          await close();
          await server.close();
        }
      });
    } finally {
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("setup mode: an accepted fiscal test lets LIVE ES-common seal its certificate, stamp production and restart", async () => {
    // A live ES-common venue files to AEAT, so its cert is expected: an accepted fiscal test
    // authorizes activation, and provisioning seals the cert through the fiscal contribution's
    // `provisioningSecret.seal` seat with the `ring` boot reads back off `secrets.env`. The drain is
    // replaced with one accepted record, so no AEAT call is made.
    //
    // The box boots preproduction, yet the live provision stamps production: `provisionVenue` stamps
    // the endpoint's mode-derived environment, not `config.environment`.
    const port = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-provision-live-seal-state-"));
    const venue = await freshVenue();
    const check = venue.store.venue;
    const material = mintMtlsMaterial();
    const fiscal = ALL_MODULES.find((module) => module.fiscal?.id === "verifactu")!.fiscal!;
    const drain = vi
      .spyOn(fiscal, "drain")
      .mockResolvedValue({ ...emptyDrainResult(), recordsSubmitted: 1, recordsAccepted: 1 });
    try {
      await withMockedKill(async (kills) => {
        const server = await startServer({
          WAITRON_VENUE_DIR: venue.directory,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
        });
        const ca = await readFile(join(stateDir, "tls", "ca.crt"));
        const { via, close } = httpsVia(ca);
        try {
          const body = {
            mode: "live",
            venue: provisionVenueBody("60000013M"),
            aeatCert: {
              pfxBase64: material.clientPfx.toString("base64"),
              passphrase: material.clientPassphrase,
              certKind: "representante",
            },
          };
          const tested = await fetch(`https://127.0.0.1:${port}/setup-api/fiscal-test`, {
            ...via,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          expect(tested.status).toBe(200);
          expect(await tested.json()).toMatchObject({ status: "accepted" });
          const response = await fetch(`https://127.0.0.1:${port}/setup-api/provision`, {
            ...via,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(200);
          const json = (await response.json()) as { provisioned: boolean };
          expect(json.provisioned).toBe(true);

          expect(await readDeploymentEnvironment(check)).toBe("production");

          const sealed = await check.execute<{ n: number }>(
            sql`select cast(count(*) as int) as n from tenant_credentials where purpose = 'fiscal.aeat'`,
          );
          expect(sealed.rows[0]!.n).toBe(1);
          const provisioned = await check.execute<{ id: string }>(
            sql`select cast(id as text) as id from tenants`,
          );
          expect(provisioned.rows).toEqual([{ id: "1" }]);

          await poll(() => (kills.length > 0 ? kills.length : undefined));
          expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]);
        } finally {
          await close();
          await server.close();
        }
      });
    } finally {
      drain.mockRestore();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("boots in trading mode when a venue is bound: mounts the trading API and NOT the setup routes", async () => {
    // A provisioned box mounts the till API and not the setup routes.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });
    try {
      const staff = await fetch(`http://127.0.0.1:${port}/api/staff`);
      expect(staff.status).toBe(200);
      expect(await staff.json()).toEqual([]);

      // A bare 404: no setup routes, and no till SPA catch-all since WAITRON_TILL_APP_DIR is unset.
      const status = await fetch(`http://127.0.0.1:${port}/setup-api/status`);
      expect(status.status).toBe(404);

      // The role probe a till reroutes on. `environment` pins that `config.environment`, not the
      // "preproduction" default, reaches the probe.
      const probe = await fetch(`http://127.0.0.1:${port}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        acceptingSales: true,
        environment: "production",
      });

      // The bucket-copy settings are mounted, behind the manager gate.
      const streamSettings = await fetch(`http://127.0.0.1:${port}/api/backup/stream`);
      expect(streamSettings.status).toBe(401);
      expect(await streamSettings.json()).toMatchObject({
        error: { code: "management_session.required" },
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("trading mode serves public certificate help without setup discovery, alongside trading routes", async () => {
    // No till SPA is configured, so an absent machine-discovery endpoint must return a real 404.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });
    try {
      const disc = await fetch(`http://127.0.0.1:${port}/setup-api/discovery`);
      expect(disc.status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/setup-api/ca.crt`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/setup/trust`)).status).toBe(200);

      const staff = await fetch(`http://127.0.0.1:${port}/api/staff`);
      expect(staff.status).toBe(200);
      expect(await staff.json()).toEqual([]);

      const health = await fetchHealthOk(`http://127.0.0.1:${port}/health`);
      expect((await health.json()) as { ok: boolean }).toMatchObject({ ok: true });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("serves the built till at / and dashboard at /manage when the app dirs are configured, without shadowing the APIs", async () => {
    // The one boot that sets WAITRON_TILL_APP_DIR and WAITRON_DASHBOARD_APP_DIR. Distinctive markers
    // catch a swapped /manage-vs-/ mapping; `boot.spa-mount.test.ts` pins the mount order, and this
    // shows the catch-alls do not shadow /health or /api/staff in a real boot.
    const tillApp = mkdtempSync(join(tmpdir(), "waitron-boot-till-spa-"));
    const dashApp = mkdtempSync(join(tmpdir(), "waitron-boot-dash-spa-"));
    writeFileSync(join(tillApp, "index.html"), "<html>till-spa-root</html>");
    writeFileSync(join(dashApp, "index.html"), "<html>dashboard-spa-root</html>");
    mkdirSync(join(dashApp, "assets"));
    writeFileSync(join(dashApp, "assets", "d-1.js"), "// dashboard-spa-asset");
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_TILL_APP_DIR: tillApp,
      WAITRON_DASHBOARD_APP_DIR: dashApp,
    });
    try {
      const till = await fetch(`http://127.0.0.1:${port}/`);
      expect(till.status).toBe(200);
      expect(till.headers.get("content-type")).toContain("text/html");
      expect(await till.text()).toContain("till-spa-root");

      const dash = await fetch(`http://127.0.0.1:${port}/manage/`);
      expect(dash.status).toBe(200);
      expect(await dash.text()).toContain("dashboard-spa-root");

      for (const [path, marker] of [
        ["/manage/floor/view/plano", "dashboard-spa-root"],
        ["/tabs/counter/menu/lunch", "till-spa-root"],
      ]) {
        const page = await fetch(`http://127.0.0.1:${port}${path}`, {
          headers: { Accept: "text/html" },
        });
        expect(page.status).toBe(200);
        expect(await page.text()).toContain(marker);
      }

      const asset = await fetch(`http://127.0.0.1:${port}/manage/assets/d-1.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("dashboard-spa-asset");

      const health = await fetchHealthOk(`http://127.0.0.1:${port}/health`);
      expect((await health.json()) as { ok: boolean }).toMatchObject({ ok: true });

      const staff = await fetch(`http://127.0.0.1:${port}/api/staff`);
      expect(staff.status).toBe(200);
      expect(await staff.json()).toEqual([]);
    } finally {
      await server.close();
      rmSync(tillApp, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
      rmSync(dashApp, { recursive: true, force: true });
    }
  }, 60_000);

  it("dials the outbound cloud-mirror tunnel to config.httpPort when WAITRON_TUNNEL_* is set, and close() aborts it", async () => {
    // The relay is unreachable, so the real client just backs off; what is asserted is boot's wiring
    // of the call, and that `close()` aborts its signal.
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      // A pool size distinct from the client's own default.
      WAITRON_TUNNEL_RELAY_URL: "tcp://127.0.0.1:1",
      WAITRON_TUNNEL_BOX_ID: "box-mirror-7",
      WAITRON_TUNNEL_TOKEN: "tunnel-secret",
      WAITRON_TUNNEL_POOL_SIZE: "3",
    });
    try {
      expect(runTunnelClient).toHaveBeenCalledTimes(1);
      const deps = vi.mocked(runTunnelClient).mock.calls[0]![0];
      // The box's OWN served port — a paired connection is spliced to the exact listener bound below.
      expect(deps.localPort).toBe(port);
      expect(deps.relayHost).toBe("127.0.0.1");
      expect(deps.relayPort).toBe(1);
      expect(deps.boxId).toBe("box-mirror-7");
      expect(deps.token).toBe("tunnel-secret");
      expect(deps.poolSize).toBe(3); // WAITRON_TUNNEL_POOL_SIZE, threaded through so the knob is live
      // The boot signal, not yet aborted while the host runs.
      expect(deps.signal.aborted).toBe(false);
      // ...and `close()` aborts exactly that signal, which is what tears the client down.
      await server.close();
      expect(deps.signal.aborted).toBe(true);
    } finally {
      await server.close(); // idempotent; guarantees teardown even if an assertion above threw
    }
  }, 60_000);

  it("does not dial the tunnel when WAITRON_TUNNEL_* is unset", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
    });
    try {
      // The listener may not have bound yet, so the close would refuse — see `awaitListening`.
      await awaitListening(port);
      expect(runTunnelClient).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  }, 60_000);

  it("does not schedule the backup sweep when WAITRON_BACKUP_DIR is unset, and boots unaffected", async () => {
    const port = await freePort();
    const [server, disabled] = await withCapturedStdout(async (lines) => {
      const started = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "production",
      });
      const event = await waitForEvent(lines, "backup.disabled");
      return [started, event] as const;
    });
    try {
      // The listener may not have bound yet, so the close would refuse — see `awaitListening`.
      await awaitListening(port);
      expect(disabled.event).toBe("backup.disabled");
    } finally {
      await server.close();
    }
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow(); // listener gone
  }, 60_000);

  it("leaves the live copy off when no bucket is configured, boots unaffected, and stops it on shutdown", async () => {
    const port = await freePort();
    const events = await withCapturedStdout(async (lines) => {
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "production",
      });
      try {
        await waitForEvent(lines, "stream.not_configured");
        await awaitListening(port);
      } finally {
        await server.close();
      }
      return lines.map((line) => /"event":"([^"]+)"/.exec(line)?.[1]);
    });
    expect(events).toContain("stream.not_configured");
    // `server.stopped` is logged only once the venue store has closed.
    const streamStopped = events.indexOf("stream.stopped");
    expect(streamStopped).toBeGreaterThan(-1);
    expect(streamStopped).toBeLessThan(events.indexOf("server.stopped"));
  }, 60_000);

  // Plain off is also /health's default, so only a copy that is set up and not running tells the
  // wiring apart from its absence. This venue holds no membership document, so the copy stops
  // before it runs Litestream or calls the bucket.
  it("reports a bucket copy that is set up but not running on /health", async () => {
    const port = await freePort();
    await withTransaction(sharedDb, (tx) =>
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
    try {
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
      });
      try {
        await awaitListening(port);
        let stream: { state?: string; reason?: string } = {};
        for (let i = 0; i < POLL_TRIES && stream.reason === undefined; i += 1) {
          const body = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
            stream: typeof stream;
          };
          stream = body.stream;
          if (stream.reason === undefined) await delay(POLL_INTERVAL_MS);
        }
        expect(stream).toEqual({
          state: "off",
          reason: "no_membership",
          stateSince: expect.any(String),
        });
      } finally {
        await server.close();
      }
    } finally {
      await withTransaction(sharedDb, (tx) => deleteCredential(tx, { purpose: STREAM_PURPOSE }));
    }
  }, 60_000);

  it("boots without WAITRON_SETTLEMENT_LAG_MS, taking the neutral layer's own default", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      // Within [minTickMs, maxTickMs]: the default (300000) would fail `loadConfig`'s guard here.
      WAITRON_SKIP_RETRY_MS: "100",
    });

    try {
      await waitForPass(server.health);
    } finally {
      // Two concurrent calls: without the idempotency guard, the loser closes the store a second time
      // and throws.
      await Promise.all([server.close(), server.close()]);
    }
  }, 60_000);

  // Exercise the module route through trading boot, including bytes, CORS and rejected names.
  it("serves database image bytes through the public route on a running server", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });

    try {
      const prepared = await samplePreparedImage({ width: 8, format: "png" });
      const imageName = await withTransaction(sharedDb, async (tx) => {
        const result = await uploadImage(
          tx,
          {
            image: prepared,
            names: { en: "Bread", es: "Pan" },
            altText: { en: "A loaf", es: "Una hogaza" },
            labels: [],
          },
          { fallbackLanguage: "es" },
        );
        return result.image.filename;
      });
      const image = await fetch(`http://127.0.0.1:${port}/media/${imageName}`);
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/webp");
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(prepared.bytes);

      // A traversal attempt is refused by the mounted route's own guard.
      const escape = await fetch(
        `http://127.0.0.1:${port}/media/${encodeURIComponent("../../etc/passwd")}`,
      );
      expect(escape.status).toBe(404);

      // CORS covers the media surface too, even though it sits outside `/api/*`: a cross-origin
      // fetch from the venue's own advertised origin gets the Allow-Origin echo, a stranger gets none.
      // `config.advertisedOrigin` falls back to `WAITRON_MANAGEMENT_ORIGIN` here (KEY_ENV), so that is
      // the venue's own origin for this boot.
      const own = "https://dashboard.example.com";
      const corsSelf = await fetch(`http://127.0.0.1:${port}/media/${imageName}`, {
        headers: { origin: own },
      });
      expect(corsSelf.status).toBe(200);
      expect(corsSelf.headers.get("access-control-allow-origin")).toBe(own);
      const corsStranger = await fetch(`http://127.0.0.1:${port}/media/${imageName}`, {
        headers: { origin: "https://evil.example" },
      });
      expect(corsStranger.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await server.close();
    }
  }, 60_000);

  // A bind failure cannot throw out of `startServer`, so it must log a structured code and exit
  // non-zero; and `WAITRON_HTTP_HOST` must reach `serve()`'s `hostname` option.
  describe("a listener that fails to bind", () => {
    it("logs server.listen_failed and exits(1) on EADDRINUSE — the common case, a fixed port already taken", async () => {
      const port = await freePort();
      const occupied = createServer();
      await new Promise<void>((resolve, reject) => {
        occupied.once("error", reject);
        occupied.listen(port, "127.0.0.1", () => resolve());
      });

      await withMockedExit(async (exits) => {
        let started: StartedServer | undefined;
        try {
          const [server, failure] = await withCapturedStdout(async (lines) => {
            const s = await startServer({
              ...KEY_ENV,
              WAITRON_VENUE_DIR: sharedVenueDir,
              WAITRON_HTTP_PORT: String(port),
              WAITRON_MIGRATIONS_DIR: migrationsRoot,
              WAITRON_MIN_TICK_MS: "1000",
              WAITRON_MAX_TICK_MS: "2000",
              // Within [minTickMs, maxTickMs]: the default (300000) would fail `loadConfig`'s guard.
              WAITRON_SKIP_RETRY_MS: "1500",
            });
            const event = await waitForEvent(lines, "server.listen_failed");
            return [s, event] as const;
          });
          started = server;
          expect(failure.port).toBe(port);
          expect(failure.code).toBe("EADDRINUSE");
          await waitForExit(exits);
          // Exactly once: the loop keeps running in the background (nothing aborted it), so a
          // second, spurious exit call here would mean something in the error handler re-fires.
          expect(exits).toEqual([1]);
        } finally {
          // `close()` on a server whose listener never bound rejects.
          if (started !== undefined) await expect(started.close()).rejects.toThrow();
        }
      });

      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }, 60_000);

    it("logs server.listen_failed and exits(1) on an unresolvable WAITRON_HTTP_HOST, proving the value reaches serve()", async () => {
      const port = await freePort();
      await withMockedExit(async (exits) => {
        let started: StartedServer | undefined;
        try {
          const [server, failure] = await withCapturedStdout(async (lines) => {
            const s = await startServer({
              ...KEY_ENV,
              WAITRON_VENUE_DIR: sharedVenueDir,
              WAITRON_HTTP_PORT: String(port),
              // Every other boot binds the default host, so a failure here shows `config.httpHost`
              // reaches `serve()`.
              WAITRON_HTTP_HOST: "not-a-real-hostname.invalid",
              WAITRON_MIGRATIONS_DIR: migrationsRoot,
              WAITRON_MIN_TICK_MS: "1000",
              WAITRON_MAX_TICK_MS: "2000",
              // Within [minTickMs, maxTickMs]: the default (300000) would fail `loadConfig`'s guard.
              WAITRON_SKIP_RETRY_MS: "1500",
            });
            const event = await waitForEvent(lines, "server.listen_failed");
            return [s, event] as const;
          });
          started = server;
          expect(failure.code).toBe("ENOTFOUND");
          await waitForExit(exits);
          expect(exits).toEqual([1]);
        } finally {
          if (started !== undefined) await expect(started.close()).rejects.toThrow();
        }
      });
    }, 60_000);
  });

  it("refuses trading boot when its configured venue is not the database's sole venue", async () => {
    const error = await startServer({
      ...KEY_ENV,
      WAITRON_TILL_LOCATION_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
    }).catch((caught: unknown) => caught);
    expect(isAppError(error) && error.code).toBe("provisioning.second_venue");
  });

  // Pins which config field reaches the drain: a `config.minTickMs` passed as `skipRetryMs` would pass
  // the typecheck and every unit test. A due `envios` row is seeded with no `fiscal.aeat` credential,
  // and the loop's logged sleep is read back. That row would stay due forever in the shared directory,
  // where other tests assert `consecutiveFailures === 0`, so the `finally` deletes it.
  it("sleeps on WAITRON_SKIP_RETRY_MS, not WAITRON_MIN_TICK_MS, for a tenant with due fiscal work and no fiscal.aeat credential", async () => {
    const port = await freePort();
    // `seedPendingEnvios`'s fixed `proximo_intento_en` is in the past, so the row is due at once.
    const seeded = await seedPendingEnvios(sharedDb, {
      count: 1,
      identity: {
        tillId: TILL_ENV.WAITRON_TILL_TILL_ID,
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        nif: "90000000K",
      },
    });

    try {
      const [server, sleeping, skipped] = await withCapturedStdout(async (lines) => {
        const started = await startServer({
          ...KEY_ENV,
          WAITRON_VENUE_DIR: sharedVenueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_MIN_TICK_MS: "1000",
          // Comfortably above the distinctive skip-retry value below, so neither clamp can mask it.
          WAITRON_MAX_TICK_MS: "600000",
          // Preparation intentionally performs no fiscal submissions. Use production here because
          // this test exercises the live drain's missing-credential retry schedule.
          WAITRON_ENV: "production",
          // Distinctive: not `WAITRON_MIN_TICK_MS`'s default, not the scheduler's
          // `DEFAULTS.skipRetryMs`, and strictly between the two clamps.
          WAITRON_SKIP_RETRY_MS: "45678",
        });
        const skippedEvent = await waitForEvent(lines, "drain.tenant_skipped");
        const event = await waitForEvent(lines, "loop.sleeping");
        return [started, event, skippedEvent] as const;
      });

      try {
        // The row was reached and skipped for its missing credential, not dropped some other way.
        expect(skipped.errorCode).toBe("credentials.missing");

        // `config.skipRetryMs` folds into `nextDueAt`, and 45678 sits inside both clamps. `sleepMsFor`
        // subtracts a `now()` read after the pass ran, so the tolerance absorbs the pass's duration
        // while staying far from `minTickMs` (1000), which a swapped field would report.
        expect(sleeping.sleepMs).toBeLessThanOrEqual(45678);
        expect(sleeping.sleepMs).toBeGreaterThan(45678 - 5000);
      } finally {
        await server.close();
      }
    } finally {
      // Only the `envios` row keeps the directory due.
      await sharedDb.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
    }
  }, 60_000);

  // The restart reset (topology design §5.2): a claim a previous run left `enviando` one second
  // ago is not stale by the drain's five-minute rule, so only the boot's reset returns it to
  // `pendiente`. No `fiscal.aeat` credential is sealed, so the drain then skips and the reset is the
  // only write the row sees.
  it("returns a previous run's in-flight claim to pendiente on its first pass", async () => {
    const port = await freePort();
    const seeded = await seedPendingEnvios(sharedDb, {
      count: 1,
      identity: {
        tillId: TILL_ENV.WAITRON_TILL_TILL_ID,
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        nif: "90000000K",
      },
    });
    const [registroId] = seeded.registroIds;
    const claimedAt = new Date(Date.now() - 1_000).toISOString();
    await sharedDb.execute(sql`
      update envios set estado = 'enviando', intentos = 1, enviado_en = ${claimedAt}
      where registro_id = ${registroId}
    `);

    try {
      const server = await withCapturedStdout(async (lines) => {
        const started = await startServer({
          ...KEY_ENV,
          WAITRON_VENUE_DIR: sharedVenueDir,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "production",
        });
        await waitForEvent(lines, "loop.sleeping");
        return started;
      });
      try {
        const rows = await sharedDb.execute<{ estado: string; incidencia: number }>(
          sql`select estado, incidencia from envios where registro_id = ${registroId}`,
        );
        expect(rows.rows).toEqual([{ estado: "pendiente", incidencia: 1 }]);
      } finally {
        await server.close();
      }
    } finally {
      await sharedDb.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
    }
  }, 60_000);

  // The Veri*Factu drain builds an AEAT client resolver each pass and releases it in `finally`
  // (`packages/fiscal-verifactu/src/slot.ts`). Only this test seeds both due work and a usable
  // `fiscal.aeat` credential, so only here is a real `Agent` built for that release to close.
  it("closes the mTLS transport it built for a tenant with due fiscal work and a usable fiscal.aeat credential", async () => {
    const port = await freePort();
    const seeded = await seedPendingEnvios(sharedDb, {
      count: 1,
      identity: {
        tillId: TILL_ENV.WAITRON_TILL_TILL_ID,
        nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
        nif: "90000000K",
      },
    });
    const material = mintMtlsMaterial();
    await withTransaction(sharedDb, (tx) =>
      putCredential(tx, loadKeyRing(KEY_ENV), {
        purpose: "fiscal.aeat",
        value: {
          pfxBase64: material.clientPfx.toString("base64"),
          passphrase: material.clientPassphrase,
          certKind: "representante",
        },
      }),
    );

    // `startServer` exposes no handle on the transport a pass built, so its release is observed here.
    const closeSpy = vi.spyOn(Agent.prototype, "close");
    try {
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_MIN_TICK_MS: "1000",
        WAITRON_MAX_TICK_MS: "600000",
        // Matches `seedPendingEnvios`'s default `entorno`, so the drain's environment guard does not
        // refuse the row and the pass makes a real submission attempt.
        WAITRON_ENV: "production",
      });
      try {
        await waitForPass(server.health);
        expect(closeSpy).toHaveBeenCalled();
      } finally {
        await server.close();
      }
    } finally {
      closeSpy.mockRestore();
      // Only the `envios` row keeps the directory due. `incidents` is cleared too, so a change to how
      // a failed submission is handled cannot leave a row behind for a later test.
      await sharedDb.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
      await sharedDb.execute(sql`delete from incidents `);
    }
  }, 60_000);

  // `stampDeployment` is permanent, so the stamp is deleted in `finally`: left behind, it would fail
  // every later production boot against this directory. This boot sets no `WAITRON_MIGRATIONS_DIR`,
  // so a migration run would throw `migrations.set_missing` from boot's from-source default; reaching
  // `deployment.environment_mismatch` instead shows the stamp guard ran before the migration seam.
  it("refuses to start, and runs no migration, against another environment's database", async () => {
    await stampDeployment(sharedDb, "preproduction");

    try {
      const error = await captureError(() =>
        startServer({
          ...KEY_ENV,
          WAITRON_VENUE_DIR: sharedVenueDir,
          WAITRON_ENV: "production",
        }),
      );
      expect(error).toMatchObject({ code: "deployment.environment_mismatch" });
    } finally {
      await sharedDb.execute(sql`delete from deployment where id = 1`);
    }
  });
});

// The reject test needs no storage: the guard runs at the top of `startServer`, and an unopenable
// venue directory keeps a storage failure from passing for it. The accept test needs the migrated
// directory: its proof is reaching `credentials.key_missing` at `loadKeyRing`, which runs after the
// stamp probe and migrations. No credentials key is set, so that is where a boot past the guard stops.
describe("startServer's maxTickMs-vs-drain-budget guard", () => {
  it("rejects WAITRON_MAX_TICK_MS at or above drain's staleness budget, before touching any infrastructure", async () => {
    const error = await captureError(() =>
      startServer({
        ...TILL_ENV,
        WAITRON_VENUE_DIR: UNOPENABLE_VENUE_DIR,
        WAITRON_MAX_TICK_MS: String(DUTY_BUDGET_MS[DRAIN_DUTY]),
      }),
    );
    expect(isAppError(error) && error.code).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_MAX_TICK_MS",
      reason: "at_or_above_drain_budget",
    });
  });

  it("lets a maxTickMs comfortably below the budget past this guard", async () => {
    const error = await captureError(() =>
      startServer({
        ...TILL_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_MAX_TICK_MS: String(DUTY_BUDGET_MS[DRAIN_DUTY] - 1),
      }),
    );
    expect(isAppError(error) && error.code).toBe("credentials.key_missing");
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is 20 MiB — the image-library upload ceiling", () => {
    // Bounds how large an upload the server will buffer; MAX_INPUT_PIXELS bounds the decode.
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("SP-C dev override reaches the live device routes only under devMode", () => {
  // `config.devMode` must reach the live device routes: under devMode the `x-waitron-dev-device`
  // header authenticates as the named device, and a non-dev boot must ignore it (fail closed). Two
  // devices bound to different tills show the header selects a specific device.
  let deviceId1: string;
  let deviceId2: string;
  let till2: string;

  beforeAll(async () => {
    const cfg: TillConfig = { ...loadTillConfig(TILL_ENV), orderFlow: "prepay" };
    // The FK on `devices` needs a real `tills` row per bound device.
    const insertTill = async (name: string): Promise<string> => {
      const [row] = await sharedDb
        .insert(tills)
        .values({ locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID, name })
        .returning({ id: tills.id });
      return row!.id;
    };
    const till1 = await insertTill("SP-C dev override till 1");
    till2 = await insertTill("SP-C dev override till 2");
    const enrolTillDevice = async (boundTillId: string): Promise<string> => {
      const [profile] = await sharedDb
        .insert(deviceProfiles)
        .values({ name: `Override device ${boundTillId}`, formFactor: "phone-portrait" })
        .returning({ id: deviceProfiles.id });
      const dev = await enrolDeviceForTest(sharedDb, cfg, {
        name: "SP-C dev override device",
        profileId: profile!.id,
        registerId: boundTillId,
      });
      return dev.deviceId;
    };
    deviceId1 = await enrolTillDevice(till1);
    deviceId2 = await enrolTillDevice(till2);
  }, 60_000);

  it("under devMode, the x-waitron-dev-device header authenticates AS that device on /api/device/me (no cookie)", async () => {
    await withCapturedStdout(async (lines) => {
      const port = await freePort();
      const server = await startServer({
        ...KEY_ENV,
        WAITRON_VENUE_DIR: sharedVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_HOST: "0.0.0.0",
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "dev",
        WAITRON_MIN_TICK_MS: "50",
        WAITRON_MAX_TICK_MS: "200",
        WAITRON_SKIP_RETRY_MS: "100",
      });
      try {
        expect(lines.some((line) => line.includes('"event":"mdns.responding"'))).toBe(false);
        // Device-2's binding: the override selected the named device, not device-1 or a default.
        const res = await fetch(`http://127.0.0.1:${port}/api/device/me`, {
          headers: { [DEV_DEVICE_HEADER]: deviceId2 },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { deviceId: string; tillId: string | null };
        expect(body.deviceId).toBe(deviceId2);
        expect(body.tillId).toBe(till2);
      } finally {
        await server.close();
      }
    });
  }, 60_000);

  it("a boot NOT in devMode ignores the header (401 with no cookie)", async () => {
    const port = await freePort();
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: sharedVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_LANDING_PORT: "0", // No privileged port-80 bind in tests.
      WAITRON_MIN_TICK_MS: "50",
      WAITRON_MAX_TICK_MS: "200",
      WAITRON_SKIP_RETRY_MS: "100",
    });
    try {
      // With `config.devMode` false the header is inert, and with no cookie the read is refused.
      const res = await fetch(`http://127.0.0.1:${port}/api/device/me`, {
        headers: { [DEV_DEVICE_HEADER]: deviceId1 },
      });
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  }, 60_000);
});

describe("DEFAULT_MIGRATIONS_ROOT", () => {
  it("resolves to an absolute path named drizzle, the layout scripts/copy-migrations.mjs builds beside the bundle", () => {
    // Coverage says nothing about this expression's correctness: a relative root or a wrong basename
    // would miss the folders `scripts/copy-migrations.mjs` copies beside the bundle.
    expect(isAbsolute(DEFAULT_MIGRATIONS_ROOT)).toBe(true);
    expect(basename(DEFAULT_MIGRATIONS_ROOT)).toBe("drizzle");
  });
});

/**
 * A minimal SMTP receiver on loopback: enough of the dialogue for one message per connection, and
 * every message's raw text kept in arrival order.
 */
async function startFakeSmtp(): Promise<{
  port: number;
  messages: string[];
  close: () => Promise<void>;
}> {
  const messages: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let pending = "";
    let data: string | undefined;
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      pending += chunk;
      for (let end = pending.indexOf("\r\n"); end !== -1; end = pending.indexOf("\r\n")) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data !== undefined) {
          if (line === ".") {
            messages.push(data);
            data = undefined;
            socket.write("250 queued\r\n");
          } else {
            data += `${line}\n`;
          }
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "DATA") {
          data = "";
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The tenant, location, node and till `KEY_ENV`'s ids name, seeded into `db` the way this file's
 * `beforeAll` seeds the shared directory. */
async function seedTradingVenue(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90000001R", legalName: "Route Wiring SL" });
  await db.insert(locations).values({
    id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Barra",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta en establecimiento",
  });
  await db.insert(nodes).values({
    id: TILL_ENV.WAITRON_TILL_NODE_ID,
    locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Route Wiring Till",
    filingModule: "verifactu",
  });
  await db.insert(tills).values({
    id: TILL_ENV.WAITRON_TILL_TILL_ID,
    locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
    name: "Route Wiring Till",
  });
}

describe("startServer — what a trading boot wires behind its management routes", () => {
  const ADMIN_PASSWORD = "dashPass123";
  const ORIGIN = "https://dashboard.example.com";
  let venue: { directory: string; store: VenueDatabase };
  let db: Database;
  let port: number;
  let server: StartedServer;
  let cookie: string;

  beforeAll(async () => {
    venue = await freshVenue();
    db = venue.store.venue;
    await seedTradingVenue(db);
    const [admin] = await db
      .insert(persons)
      .values({
        displayName: "Route Admin",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(ADMIN_PASSWORD),
        email: "route-admin@example.test",
        role: "admin",
      })
      .returning({ id: persons.id });
    const session = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: admin!.id }),
    );
    cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    port = await freePort();
    server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: venue.directory,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
    });
    await awaitListening(port);
  }, 120_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    const store = venue?.store;
    if (store !== undefined) await store.close();
    if (venue !== undefined) await rm(venue.directory, { recursive: true, force: true });
  });

  async function invite(email: string): Promise<unknown> {
    const [invitee] = await db
      .insert(persons)
      .values({
        displayName: `Invitee ${email}`,
        pinHash: hashPin("1234"),
        email,
        role: "staff",
        status: "pending",
      })
      .returning({ id: persons.id });
    const response = await fetch(
      `http://127.0.0.1:${port}/management-api/staff/${invitee!.id}/invitation`,
      { method: "POST", headers: { cookie, origin: ORIGIN } },
    );
    expect(response.status).toBe(200);
    return response.json();
  }

  async function changeOwnEmail(email: string): Promise<unknown> {
    const response = await fetch(`http://127.0.0.1:${port}/management-api/session/me/profile`, {
      method: "PUT",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Route Admin",
        firstNames: "Route",
        lastNames: "Admin",
        telephone: null,
        email,
        locale: "en-GB",
        currentPassword: ADMIN_PASSWORD,
      }),
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  it("sends account email through the SMTP gateway the vault holds, and sends none while it holds none", async () => {
    const inbox = await fetch(`http://127.0.0.1:${port}/management-api/email`, {
      headers: { cookie },
    });
    expect(inbox.status).toBe(200);
    expect(await inbox.json()).toEqual({ mode: "unconfigured", count: 0, messages: [] });
    expect(await invite("first-invitee@example.test")).toEqual({ invitationSent: false });
    expect(await changeOwnEmail("first-change@example.test")).toEqual({
      emailVerificationSent: false,
    });

    const smtp = await startFakeSmtp();
    try {
      // Resolved on every send, so a gateway configured while the box runs is used at once.
      await withTransaction(db, (tx) =>
        putCredential(tx, loadKeyRing(KEY_ENV), {
          purpose: "email.smtp",
          value: {
            url: `smtp://127.0.0.1:${smtp.port}`,
            from: "Waitron <no-reply@example.test>",
          },
        }),
      );
      const configured = await fetch(`http://127.0.0.1:${port}/management-api/email`, {
        headers: { cookie },
      });
      expect(await configured.json()).toEqual({ mode: "smtp", count: 0, messages: [] });

      expect(await invite("second-invitee@example.test")).toEqual({ invitationSent: true });
      expect(await changeOwnEmail("second-change@example.test")).toEqual({
        emailVerificationSent: true,
      });
      expect(smtp.messages).toHaveLength(2);
      expect(smtp.messages[0]).toMatch(/^To: second-invitee@example\.test$/m);
      expect(smtp.messages[1]).toMatch(/^To: second-change@example\.test$/m);
    } finally {
      await smtp.close();
    }
  }, 60_000);

  it("counts a library image with no name in the new default language as a gap, refusing the change", async () => {
    const current = (await (
      await fetch(`http://127.0.0.1:${port}/api/content-languages`)
    ).json()) as { defaultLanguage: string };
    const image = await samplePreparedImage({ width: 9, format: "png" });
    await withTransaction(db, (tx) =>
      uploadImage(
        tx,
        {
          image,
          names: { [current.defaultLanguage]: "Pan" },
          altText: {},
          labels: [],
        },
        { fallbackLanguage: current.defaultLanguage },
      ),
    );

    const response = await fetch(`http://127.0.0.1:${port}/management-api/content-languages`, {
      method: "PUT",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ defaultLanguage: "fr", languages: ["fr"] }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "content.default_missing", params: { language: "fr", count: 1 } },
    });
  }, 60_000);

  it("raises the backup-disabled alert from the backup supervisor's live status", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/management-api/alerts`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { alerts: { code: string }[] };
    expect(body.alerts.map((alert) => alert.code)).toContain("backup.disabled");
  }, 60_000);

  it("gives the archive routes and the bucket-copy routes one queue: a bucket-copy read waits behind a held rotation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handed = backupQueue.handed;
    const started = backupQueue.started;
    backupQueue.gate = gate;
    try {
      const rotation = fetch(`http://127.0.0.1:${port}/api/backup/rotate`, {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ recoveryKey: "k".repeat(MIN_PASSPHRASE_LENGTH) }),
      });
      await vi.waitFor(() => expect(backupQueue.started).toBe(started + 1), {
        timeout: POLL_TRIES * POLL_INTERVAL_MS,
      });

      const kit = fetch(`http://127.0.0.1:${port}/api/backup/stream/kit`, { headers: { cookie } });
      await vi.waitFor(() => expect(backupQueue.handed).toBe(handed + 2), {
        timeout: POLL_TRIES * POLL_INTERVAL_MS,
      });
      await delay(POLL_INTERVAL_MS);
      expect(backupQueue.started).toBe(started + 1);

      backupQueue.gate = undefined;
      release();
      const rotationResponse = await rotation;
      expect(rotationResponse.status).toBe(400);
      expect(await rotationResponse.json()).toEqual({
        error: { code: "backup.request_invalid", params: { field: "config" } },
      });
      const kitResponse = await kit;
      expect(backupQueue.started).toBe(started + 2);
      expect(kitResponse.status).toBe(409);
      expect(await kitResponse.json()).toEqual({
        error: { code: "backup.stream_not_configured", params: {} },
      });
    } finally {
      release();
      backupQueue.gate = undefined;
    }
  }, 60_000);
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
    const port = await freePort();
    const landingPort = await freePort();
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
   * trusted; `use` runs while it serves. */
  async function withSetupBoot(
    directory: string,
    env: Record<string, string>,
    use: (ctx: {
      post: (path: string, init: RequestInit) => Promise<Response>;
      kills: { pid: number; signal: string | number | undefined }[];
      stateDir: string;
    }) => Promise<void>,
  ): Promise<void> {
    const port = await freePort();
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
        expect(trading.WAITRON_TILL_TILL_ID).toBe(committed.tillId);
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
                  "WAITRON_TILL_TILL_ID=c0000000-0000-4000-8000-000000000003",
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
    const unreachable = await freePort();
    try {
      await withSetupBoot(venue.directory, {}, async ({ post, kills }) => {
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
        tillId: "33333333-3333-4333-8333-333333333333",
        nodeId: "44444444-4444-4444-8444-444444444444",
        seriesId: "55555555-5555-4555-8555-555555555555",
      },
      tenant: { country: "ES", taxId: "80000001K" },
      primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
      environment: "preproduction",
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
        expect(await provisioned.json()).toEqual({ provisioned: true, restarting: true });
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
});
