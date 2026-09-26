import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  readVenueHolder,
  stampDeployment,
  tenants,
  tills,
} from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { PENDING_ADOPTION_FILE } from "./finish-adoption.js";

/**
 * A start that fails after boot's long-lived open of the venue folder must give the folder back:
 * the open holds `venue.lock` for this process, and nothing else would ever close it.
 *
 * Observed through `venue.holder.json`, which this process writes when it first holds a folder and
 * removes on the last release (`packages/store/src/venue-liveness.ts`). So every folder here is
 * migrated and seeded through a handle closed BEFORE `startServer` runs: a handle the suite kept
 * open would keep the file whatever boot did.
 */

const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

let migrationsRoot: string;
const cleanup: string[] = [];

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-failed-start-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
}, 180_000);

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

/** A migrated venue folder holding the till's identity, with no handle left open on it. */
async function seededVenueDir(): Promise<string> {
  const directory = await tempDir("waitron-failed-start-venue-");
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  try {
    const db = store.venue;
    await db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "90444444J", legalName: "Failed Start SL" });
    await db.insert(locations).values({
      id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    });
    await db.insert(nodes).values({
      id: TILL_ENV.WAITRON_TILL_NODE_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Node",
      filingModule: "verifactu",
    });
    await db.insert(tills).values({
      id: TILL_ENV.WAITRON_TILL_TILL_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Till",
    });
    await db.insert(invoiceSeries).values({
      id: TILL_ENV.WAITRON_TILL_SERIES_ID,
      nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
      code: "A",
    });
    await stampDeployment(db, "preproduction");
    // The control: while a handle is open, the file names this process.
    expect(readVenueHolder(directory)?.pid).toBe(process.pid);
  } finally {
    await store.close();
  }
  expect(readVenueHolder(directory)).toBeNull();
  return directory;
}

/** A state folder whose module set leaves only Veri*Factu in the fiscal slot, unless `modules` says otherwise. */
async function stateDir(modules: Record<string, boolean> = { "fiscal-none": false }) {
  const dir = await tempDir("waitron-failed-start-state-");
  await writeFile(join(dir, "modules.json"), JSON.stringify({ modules }));
  return dir;
}

/** The `event` of every line boot logs to stdout while `fn` runs; each chunk still reaches stdout. */
async function withLoggedEvents(fn: () => Promise<void>): Promise<string[]> {
  const original = process.stdout.write.bind(process.stdout);
  const events: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    for (const match of String(chunk).matchAll(/"event":"([^"]+)"/g)) events.push(match[1]!);
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return events;
}

function tradingEnv(venueDir: string, state: string): Record<string, string> {
  return {
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_STATE_DIR: state,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    // A fixed high port: every case here fails before the listener binds, or while reading its TLS
    // files, so nothing ever listens on it.
    WAITRON_HTTP_PORT: "59331",
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    ...TILL_ENV,
  };
}

describe("a start that fails after the venue folder is opened gives the folder back", () => {
  it("when the pending-adoption file cannot be read", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    await writeFile(join(state, PENDING_ADOPTION_FILE), "not json");

    await expect(startServer(tradingEnv(venueDir, state))).rejects.toThrow(SyntaxError);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when an adoption-pending start cannot read its certificate", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    // Enough to take the adoption-pending branch; its worker fails on the empty record.
    await writeFile(join(state, PENDING_ADOPTION_FILE), "{}");

    await expect(
      startServer({
        ...tradingEnv(venueDir, state),
        WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
        WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when the enabled set fills no fiscal slot", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir({ "fiscal-verifactu": false, "fiscal-none": false });

    await expect(startServer(tradingEnv(venueDir, state))).rejects.toMatchObject({
      code: "module.fiscal_slot_empty",
    });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when the trading listener cannot read its certificate, stopping the bucket copy too", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();

    const events = await withLoggedEvents(async () => {
      await expect(
        startServer({
          ...tradingEnv(venueDir, state),
          WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
          WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
        }),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    expect(readVenueHolder(venueDir)).toBeNull();
    // `StreamHost.stop()` logs it whether or not a copy was running.
    expect(events).toContain("stream.stopped");
  }, 60_000);

  it("when the listener cannot read its certificate while a backup sweep holds its own open", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    const backupDir = await tempDir("waitron-failed-start-backup-");

    await expect(
      startServer(
        {
          ...tradingEnv(venueDir, state),
          WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
          WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
        },
        // The backup settings are read from the raw base env (`loadBoxEnv`), not the merged one.
        { WAITRON_BACKUP_DIR: backupDir, WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" },
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("in setup mode, when the listener cannot read its certificate", async () => {
    const venueDir = await tempDir("waitron-failed-start-setup-venue-");
    const state = await tempDir("waitron-failed-start-setup-state-");

    await expect(
      startServer({
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_STATE_DIR: state,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
        WAITRON_HTTP_PORT: "59331",
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
        WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);
});
