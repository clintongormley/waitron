import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteCredential, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult } from "@waitron/fiscal";
import { startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ARCHIVE_PURPOSE, writeArchiveSettings } from "./archive-settings.js";
import { startServer, type StartedServer } from "./boot.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import type { StorageBackend, StorageCall } from "./storage-backend.js";
import { provisionBillVenue, registroCount, type BillVenue } from "./testing/bill-venue.js";
import {
  copyMigrationsRoot,
  fetchHealthOk,
  httpsVia,
  waitForEvent,
  withCapturedStdout,
} from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";

/** When set, every call to an archive destination waits until it is stopped, or until `release`. */
const stall = vi.hoisted(() => ({
  on: false,
  started: [] as string[],
  pending: new Set<(reason: unknown) => void>(),
  release(): void {
    for (const fail of [...this.pending]) fail(new Error("released by the test"));
  },
}));
vi.mock("./backup-backends.js", async (original) => {
  const actual = await original<typeof import("./backup-backends.js")>();
  const hang = (operation: string, call: StorageCall): Promise<never> => {
    stall.started.push(operation);
    return new Promise((_resolve, reject) => {
      const fail = (reason: unknown) => {
        stall.pending.delete(fail);
        reject(reason);
      };
      stall.pending.add(fail);
      call.signal.addEventListener("abort", () => fail(call.signal.reason), { once: true });
    });
  };
  return {
    ...actual,
    buildBackupBackend: (dest: Parameters<typeof actual.buildBackupBackend>[0]) => {
      const real = actual.buildBackupBackend(dest);
      if (!stall.on) return real;
      const stalled: StorageBackend = {
        id: real.id,
        put: (_key, _bytes, call) => hang("put", call),
        putFile: (_key, _path, call) => hang("putFile", call),
        getFile: (_key, _outPath, call) => hang("getFile", call),
        get: (_key, call) => hang("get", call),
        list: (_prefix, call) => hang("list", call),
        delete: (_key, call) => hang("delete", call),
        deleteMany: (_keys, call) => hang("deleteMany", call),
        close: () => real.close(),
      };
      return stalled;
    },
  };
});

// A sale left unfiled makes the real drain skip on this venue's missing AEAT credentials, which fails
// `/health` for a reason no archive destination causes.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => ({
      ...actual.fiscalSlot(...args),
      drain: async () => emptyDrainResult(),
    }),
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
let venue: BillVenue;
let counter: ZoneOffers;
const suite = useVenueDb({
  resetPerTest: false,
  migrations,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counter = await offerProducts(db, venue.cfg, { zone: "counter", orderStart: "counter" });
  },
});

const scratches: string[] = [];
/** Set while `bootAndTrade`'s server runs; see `beforeServerStarts`. */
let serverRunning = false;
afterEach(async () => {
  serverRunning = false;
  stall.on = false;
  stall.started = [];
  await withTransaction(venue.db, (tx) => deleteCredential(tx, { purpose: ARCHIVE_PURPOSE }));
  await Promise.all(scratches.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tradingEnv(): Promise<{ env: Record<string, string>; scratch: string }> {
  const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-backup-network-"));
  scratches.push(scratch);
  const migrationsRoot = join(scratch, "migrations");
  await copyMigrationsRoot(migrationsRoot);
  await writeFile(
    join(scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  // The shape a box has after its setup boot: a tick refuses a state folder missing any recovery
  // file before it reaches a destination, and the leaf makes the trading listener HTTPS.
  await ensureBoxSecrets({ stateDir: scratch, hostnames: ["localhost"], now: () => new Date() });
  await writeFile(join(scratch, "trading.env"), "");
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  return {
    scratch,
    env: {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
      WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
      WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
    },
  };
}

function productIdOf(name: string): string {
  return venue.db.all<{ id: string }>(sql`select id from products where name = ${name}`)[0]!.id;
}

async function cashSale(base: string, via: RequestInit, workingOrderId: string): Promise<Response> {
  return fetch(`${base}/api/sales`, {
    ...via,
    method: "POST",
    headers: { "content-type": "application/json", cookie: venue.cookie },
    body: JSON.stringify({
      lines: [{ menuItemId: counter.offerFor(productIdOf("Tarta")), quantity: "1" }],
      tender: { method: "cash", amount: "20.00" },
      workingOrderId,
      zoneId: counter.zoneId,
    }),
  });
}

/** Starts the real server with `backupBase` as its raw base env, runs `whileStarted`, then sells,
 * reads `/health`, and runs whatever `whileStarted` handed back. */
async function bootAndTrade(
  backupBase: (scratch: string) => Promise<Record<string, string>>,
  whileStarted: (
    lines: readonly string[],
    http: { base: string; via: RequestInit },
  ) => Promise<(() => Promise<void>) | void>,
): Promise<void> {
  const { env, scratch } = await tradingEnv();
  const base = `https://127.0.0.1:${env.WAITRON_HTTP_PORT}`;
  const { via, close } = httpsVia(await readFile(join(scratch, "tls", "ca.crt")));
  await withCapturedStdout(async (lines) => {
    let server: StartedServer | undefined;
    try {
      const raw = await backupBase(scratch);
      serverRunning = true;
      server = await startServer(env, raw);
      const afterTrading = await whileStarted(lines, { base, via });
      const orderId = randomUUID();
      const sale = await cashSale(base, via, orderId);
      expect(sale.status, await sale.text()).toBe(200);
      expect(registroCount(venue, orderId)).toBe(1);
      expect((await fetchHealthOk(`${base}/health`, via)).status).toBe(200);
      await afterTrading?.();
    } finally {
      stall.release();
      if (server !== undefined) await server.close();
      serverRunning = false;
      await close();
    }
  });
}

/**
 * Refuses a write from this file's own connection while the server runs. The server shares this
 * process, and this engine waits for a lock synchronously: a write here while one of the server's
 * transactions is open stops the event loop, so that transaction cannot commit, and the write fails
 * with `database is locked` after the busy wait (main run 38430159396).
 */
function beforeServerStarts(): void {
  if (serverRunning) throw new Error("write to the venue database before the server starts");
}

async function managerCookie(): Promise<string> {
  beforeServerStarts();
  const session = await withTransaction(venue.db, (tx) =>
    startManagementSession(tx, { personId: venue.adminId }),
  );
  return `${MANAGEMENT_COOKIE}=${session.token}`;
}

describe("trading with an archive destination the box cannot use", () => {
  // Unavailability: the destination path is a regular file, so the folder cannot be created there.
  it("starts, sells and answers /health while every backup tick fails", async () => {
    await bootAndTrade(
      async (scratch) => {
        const notAFolder = join(scratch, "backup-destination-is-a-file");
        await writeFile(notAFolder, "not a folder");
        return { WAITRON_BACKUP_DIR: notAFolder, WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" };
      },
      async (lines) => {
        const failed = await waitForEvent(lines, "backup.destination_failed");
        expect(failed).toMatchObject({ destination: "primary" });
        expect(["ENOTDIR", "EEXIST"]).toContain(failed.errno);
      },
    );
  }, 60_000);

  // Unavailability: a test seam stands in for a destination where no call ever answers.
  it("starts, sells and answers /health while every call to a destination hangs, a status read included", async () => {
    stall.on = true;
    let cookie = "";
    await bootAndTrade(
      async (scratch) => {
        cookie = await managerCookie();
        return {
          WAITRON_BACKUP_DIR: join(scratch, "backups"),
          WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
        };
      },
      async (_lines, { base, via }) => {
        await vi.waitFor(() => expect(stall.started).toEqual(["putFile"]), { timeout: 30_000 });
        const statusRead = fetch(`${base}/api/backup/status`, { ...via, headers: { cookie } });
        await vi.waitFor(() => expect(stall.started).toEqual(["putFile", "list"]), {
          timeout: 30_000,
        });
        // The status read is still waiting on its listing while the sale and /health run.
        return async () => {
          stall.release();
          const answered = await statusRead;
          expect(answered.status, await answered.text()).toBe(200);
        };
      },
    );
  }, 60_000);
});

/** Seals an archive record into the venue database under `ring`. */
async function storeArchiveRecord(ring: KeyRing, dir: string): Promise<void> {
  beforeServerStarts();
  await withTransaction(venue.db, (tx) =>
    writeArchiveSettings(tx, ring, {
      enabled: true,
      destinations: [{ kind: "local-fs", id: "primary", dir }],
      schedule: { kind: "interval", ms: 60 * 60 * 1000 },
      retention: { count: 7, days: 30 },
      destinationTimeoutMs: 15 * 60 * 1000,
    }),
  );
}

/** The box's own key ring: `tradingEnv`'s `WAITRON_CREDENTIALS_KEY`. */
const boxRing = (): KeyRing =>
  loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });

async function expectArchivesOffFor(
  errorCode: string,
  cookie: string,
  lines: readonly string[],
  http: { base: string; via: RequestInit },
): Promise<void> {
  expect(await waitForEvent(lines, "backup.archive_settings_unusable")).toMatchObject({
    errorCode,
  });
  const status = await fetch(`${http.base}/api/backup/status`, {
    ...http.via,
    headers: { cookie },
  });
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({
    enabled: false,
    loadErrorCode: errorCode,
    backupStatus: { configured: false, loadErrorCode: errorCode },
  });
  const alerts = await fetch(`${http.base}/management-api/alerts`, {
    ...http.via,
    headers: { cookie },
  });
  const body = (await alerts.json()) as { alerts: { code: string; area: string }[] };
  expect(body.alerts).toContainEqual(
    expect.objectContaining({ code: "backup.archive_settings_unusable", area: "backup" }),
  );
}

describe("trading with dashboard archive settings the box cannot use", () => {
  it("starts, sells and answers /health with archives off when the record will not decrypt", async () => {
    let cookie = "";
    await bootAndTrade(
      async (scratch) => {
        const otherRing = loadKeyRing({
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 6).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
        });
        await storeArchiveRecord(otherRing, join(scratch, "backups"));
        cookie = await managerCookie();
        return {};
      },
      (lines, http) => expectArchivesOffFor("credentials.decrypt_failed", cookie, lines, http),
    );
  }, 60_000);

  it("starts, sells and answers /health with archives off when an enabled record has no recovery key", async () => {
    let cookie = "";
    await bootAndTrade(
      async (scratch) => {
        await storeArchiveRecord(boxRing(), join(scratch, "backups"));
        cookie = await managerCookie();
        return {};
      },
      (lines, http) => expectArchivesOffFor("backup.recovery_key_missing", cookie, lines, http),
    );
  }, 60_000);
});

describe("trading with environment backup settings beside a sealed record", () => {
  it("takes the environment's settings and never reads a sealed record that would not decrypt", async () => {
    let cookie = "";
    await bootAndTrade(
      async (scratch) => {
        const otherRing = loadKeyRing({
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 6).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
        });
        await storeArchiveRecord(otherRing, join(scratch, "sealed-backups"));
        cookie = await managerCookie();
        return {
          WAITRON_BACKUP_DIR: join(scratch, "env-backups"),
          WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
        };
      },
      async (lines, { base, via }) => {
        expect(await waitForEvent(lines, "backup.destination_completed")).toMatchObject({
          destination: "primary",
        });
        const status = await fetch(`${base}/api/backup/status`, { ...via, headers: { cookie } });
        expect(await status.json()).toMatchObject({
          enabled: true,
          source: "environment",
          loadErrorCode: null,
        });
      },
    );
  }, 60_000);

  it("refuses a stream folder overlapping the environment's archive bucket", async () => {
    stall.on = true;
    const place = { endpoint: "https://s3.example.test", region: "eu-north-1", bucket: "owner" };
    let cookie = "";
    await bootAndTrade(
      async () => {
        cookie = await managerCookie();
        return {
          WAITRON_BACKUP_DESTINATIONS: JSON.stringify([
            {
              kind: "s3",
              id: "offsite",
              ...place,
              accessKeyId: "AKIAENV",
              secretAccessKey: "env-secret-access-key",
            },
          ]),
          WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!",
        };
      },
      async (_lines, { base, via }) => {
        const res = await fetch(`${base}/api/backup/stream`, {
          ...via,
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            ...place,
            prefix: `archives/${venue.cfg.locationId}`,
            accessKeyId: "AKIASTREAM",
            secretAccessKey: "stream-secret-0123456789",
          }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { code: "backup.archive_namespace_overlap" },
        });
      },
    );
  }, 60_000);
});
